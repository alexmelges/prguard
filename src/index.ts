import type { Probot } from "probot";
import { buildSummaryComment, summaryMarker } from "./comment.js";
import { loadRepoConfig } from "./config.js";
import { createDb, listEmbeddings, upsertAnalysis, upsertEmbedding } from "./db.js";
import { buildEmbeddingInput, createOpenAIClient, getEmbedding } from "./embed.js";
import { findDuplicates } from "./dedup.js";
import { applyLabels, ensureLabels } from "./labels.js";
import { scorePRQuality } from "./quality.js";
import type { AnalysisRecord, DuplicateMatch, EmbeddingRecord, ItemType, PRQualityResult } from "./types.js";
import { evaluateVision } from "./vision.js";

const db = createDb();

function getClient() {
  return createOpenAIClient();
}

interface HandlerContext {
  octokit: any;
  payload: any;
}

function normalizeBody(body: string | null | undefined): string {
  return body ?? "";
}

async function fetchPRDiffSummary(context: {
  octokit: any;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<string> {
  const files = await context.octokit.pulls.listFiles({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber,
    per_page: 100
  });

  const chunks = files.data.map((file: { filename: string; patch?: string }) => {
    const patch = (file.patch ?? "").slice(0, 300);
    return `${file.filename}\n${patch}`.trim();
  });

  return chunks.join("\n\n").slice(0, 2000);
}

async function upsertSummaryComment(context: {
  octokit: any;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<void> {
  const comments = await context.octokit.issues.listComments({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.issueNumber,
    per_page: 100
  });

  const marker = summaryMarker();
  const existing = comments.data.find((comment: { body?: string }) => comment.body?.includes(marker));

  if (existing) {
    await context.octokit.issues.updateComment({
      owner: context.owner,
      repo: context.repo,
      comment_id: existing.id,
      body: context.body
    });
    return;
  }

  await context.octokit.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.issueNumber,
    body: context.body
  });
}

function pickBestPR(currentNumber: number, duplicates: DuplicateMatch[], currentQuality: PRQualityResult): number {
  if (currentQuality.score >= 0.7) {
    return currentNumber;
  }

  const prCandidates = duplicates.filter((item) => item.type === "pr");
  if (prCandidates.length === 0) {
    return currentNumber;
  }

  return prCandidates[0].number;
}

async function handlePR(app: Probot, context: HandlerContext): Promise<void> {
  const payload = context.payload as {
    pull_request: {
      number: number;
      title: string;
      body: string | null;
      user: { login: string; created_at: string };
      additions: number;
      deletions: number;
      changed_files: number;
      commits: number;
      merged: boolean;
      head: { sha: string };
    };
    repository: { name: string; owner: { login: string } };
  };

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const number = payload.pull_request.number;
  const fullRepo = `${owner}/${repo}`;

  const config = await loadRepoConfig({ octokit: context.octokit, owner, repo });
  if (config.trusted_users.includes(payload.pull_request.user.login)) {
    return;
  }

  await ensureLabels({ octokit: context.octokit, owner, repo, labels: config.labels });

  const commits = await context.octokit.pulls.listCommits({ owner, repo, pull_number: number, per_page: 100 });
  const checks = await context.octokit.checks.listForRef({ owner, repo, ref: payload.pull_request.head.sha, per_page: 50 });
  const files = await context.octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 });

  const hasTests = files.data.some((file: { filename: string }) => /(^test\/|\.test\.|\.spec\.)/i.test(file.filename));
  const ciPassing = checks.data.check_runs.length === 0 || checks.data.check_runs.every((run: { conclusion: string | null }) => run.conclusion === "success");
  const diffSummary = await fetchPRDiffSummary({ octokit: context.octokit, owner, repo, pullNumber: number });
  const input = buildEmbeddingInput(payload.pull_request.title, normalizeBody(payload.pull_request.body), diffSummary);
  const embedding = await getEmbedding(input, getClient());

  const record: EmbeddingRecord = {
    repo: fullRepo,
    type: "pr",
    number,
    title: payload.pull_request.title,
    body: normalizeBody(payload.pull_request.body),
    diffSummary,
    embedding
  };
  upsertEmbedding(db, record);

  const duplicates = findDuplicates(record, listEmbeddings(db, fullRepo), config.duplicate_threshold);

  const quality = scorePRQuality({
    additions: payload.pull_request.additions,
    deletions: payload.pull_request.deletions,
    changedFiles: payload.pull_request.changed_files,
    hasTests,
    commitMessages: commits.data.map((commit: { commit: { message: string } }) => commit.commit.message.split("\n")[0]),
    contributorMergedPRs: 0,
    contributorAccountAgeDays: Math.max(
      0,
      Math.floor((Date.now() - new Date(payload.pull_request.user.created_at).valueOf()) / (24 * 60 * 60 * 1000))
    ),
    ciPassing
  });

  const vision = await evaluateVision({
    client: getClient(),
    model: config.vision_model,
    vision: config.vision,
    title: payload.pull_request.title,
    body: normalizeBody(payload.pull_request.body),
    diffSummary
  });

  const bestPRNumber = pickBestPR(number, duplicates, quality);
  const labelsToApply = [config.labels.needs_review];
  if (duplicates.length > 0) {
    labelsToApply.push(config.labels.duplicate);
  }
  labelsToApply.push(vision.aligned ? config.labels.on_track : config.labels.off_scope);
  if (bestPRNumber === number) {
    labelsToApply.push(config.labels.recommended);
  }

  const analysis: AnalysisRecord = {
    repo: fullRepo,
    type: "pr",
    number,
    duplicates,
    visionScore: vision.score,
    visionReasoning: vision.reasoning,
    recommendation: quality.recommendation,
    prQualityScore: quality.score
  };
  upsertAnalysis(db, analysis);

  await applyLabels({
    octokit: context.octokit,
    owner,
    repo,
    issueNumber: number,
    labels: [...new Set(labelsToApply)]
  });

  const summary = buildSummaryComment({
    duplicates,
    vision,
    quality,
    bestPRNumber
  });

  await upsertSummaryComment({
    octokit: context.octokit,
    owner,
    repo,
    issueNumber: number,
    body: summary
  });

  app.log.info(`PRGuard analyzed PR #${number} in ${fullRepo}`);
}

async function handleIssue(app: Probot, context: HandlerContext): Promise<void> {
  const payload = context.payload as {
    issue: {
      number: number;
      title: string;
      body: string | null;
      user: { login: string };
      pull_request?: unknown;
    };
    repository: { name: string; owner: { login: string } };
  };

  if (payload.issue.pull_request) {
    return;
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const number = payload.issue.number;
  const fullRepo = `${owner}/${repo}`;

  const config = await loadRepoConfig({ octokit: context.octokit, owner, repo });
  if (config.trusted_users.includes(payload.issue.user.login)) {
    return;
  }

  await ensureLabels({ octokit: context.octokit, owner, repo, labels: config.labels });

  const input = buildEmbeddingInput(payload.issue.title, normalizeBody(payload.issue.body));
  const embedding = await getEmbedding(input, getClient());

  const record: EmbeddingRecord = {
    repo: fullRepo,
    type: "issue",
    number,
    title: payload.issue.title,
    body: normalizeBody(payload.issue.body),
    diffSummary: "",
    embedding
  };
  upsertEmbedding(db, record);

  const duplicates = findDuplicates(record, listEmbeddings(db, fullRepo), config.duplicate_threshold);

  const analysis: AnalysisRecord = {
    repo: fullRepo,
    type: "issue",
    number,
    duplicates,
    visionScore: null,
    visionReasoning: null,
    recommendation: null,
    prQualityScore: null
  };
  upsertAnalysis(db, analysis);

  const labelsToApply = duplicates.length > 0 ? [config.labels.duplicate, config.labels.needs_review] : [config.labels.needs_review];

  await applyLabels({
    octokit: context.octokit,
    owner,
    repo,
    issueNumber: number,
    labels: labelsToApply
  });

  const summary = buildSummaryComment({
    duplicates,
    vision: null,
    quality: null,
    bestPRNumber: null
  });

  await upsertSummaryComment({
    octokit: context.octokit,
    owner,
    repo,
    issueNumber: number,
    body: summary
  });

  app.log.info(`PRGuard analyzed issue #${number} in ${fullRepo}`);
}

export default (app: Probot): void => {
  const handler = async (context: HandlerContext, type: ItemType): Promise<void> => {
    try {
      if (type === "pr") {
        await handlePR(app, context);
      } else {
        await handleIssue(app, context);
      }
    } catch (error) {
      app.log.error({ error }, "PRGuard processing failed");
    }
  };

  app.on(["pull_request.opened", "pull_request.edited"], async (context) => {
    await handler(context, "pr");
  });

  app.on(["issues.opened", "issues.edited"], async (context) => {
    await handler(context, "issue");
  });
};
