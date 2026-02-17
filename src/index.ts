import type { Probot } from "probot";
import { buildSummaryComment, summaryMarker } from "./comment.js";
import { loadRepoConfig } from "./config.js";
import {
  checkRateLimit,
  deactivateEmbedding,
  getDb,
  listEmbeddings,
  upsertAnalysis,
  upsertEmbedding
} from "./db.js";
import { buildEmbeddingInput, createOpenAIClient, getEmbedding } from "./embed.js";
import { findDuplicates } from "./dedup.js";
import { withGitHubRetry } from "./github.js";
import { applyLabels, ensureLabels } from "./labels.js";
import { scorePRQuality } from "./quality.js";
import type {
  AnalysisRecord,
  DuplicateMatch,
  EmbeddingRecord,
  ItemType,
  PRGuardConfig,
  PRQualityResult,
  VisionEvaluation
} from "./types.js";
import { evaluateVision } from "./vision.js";

/** Max OpenAI API calls per repo per hour. */
const OPENAI_BUDGET_PER_HOUR = 60;

interface HandlerContext {
  octokit: any;
  payload: any;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

function normalizeBody(body: string | null | undefined): string {
  return body ?? "";
}

function isBot(login: string): boolean {
  return login.endsWith("[bot]") || login === "dependabot" || login === "renovate";
}

async function fetchContributorMergedPRs(
  octokit: any,
  owner: string,
  repo: string,
  author: string,
  log: Logger
): Promise<number> {
  try {
    const result = await withGitHubRetry(
      () => octokit.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:pr is:merged author:${author}`,
        per_page: 1
      }),
      log
    );
    return (result as { data: { total_count: number } }).data.total_count ?? 0;
  } catch (error) {
    log.warn(`Failed to fetch merged PR count for ${author}: ${error}`);
    return 0;
  }
}

async function fetchPRDiffSummary(context: {
  octokit: any;
  owner: string;
  repo: string;
  pullNumber: number;
  maxLines: number;
  log: Logger;
}): Promise<{ summary: string; totalLines: number }> {
  const files = await context.octokit.pulls.listFiles({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber,
    per_page: 100
  });

  let totalLines = 0;
  const chunks = files.data.map((file: { filename: string; patch?: string; additions: number; deletions: number }) => {
    totalLines += (file.additions ?? 0) + (file.deletions ?? 0);
    const patch = (file.patch ?? "").slice(0, 300);
    return `${file.filename}\n${patch}`.trim();
  });

  if (totalLines > context.maxLines) {
    context.log.warn(`PR #${context.pullNumber} has ${totalLines} lines — truncating diff`);
  }

  return {
    summary: chunks.join("\n\n").slice(0, 2000),
    totalLines
  };
}

async function upsertSummaryComment(context: {
  octokit: any;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  dryRun: boolean;
  log: Logger;
}): Promise<void> {
  if (context.dryRun) {
    context.log.info(`[DRY RUN] Would post/update comment on #${context.issueNumber}`);
    return;
  }

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

import { getAnalysis } from "./db.js";

/**
 * Pick the best PR among duplicates by comparing quality scores.
 * Falls back to the current PR if no analysis exists for duplicates.
 */
function pickBestPRClean(
  currentNumber: number,
  duplicates: DuplicateMatch[],
  currentQuality: PRQualityResult,
  db: import("better-sqlite3").Database,
  fullRepo: string
): number {
  const prCandidates = duplicates.filter((item) => item.type === "pr");
  if (prCandidates.length === 0) {
    return currentNumber;
  }

  let bestNumber = currentNumber;
  let bestScore = currentQuality.score;

  for (const candidate of prCandidates) {
    const analysis = getAnalysis(db, fullRepo, "pr", candidate.number);
    const candidateScore = analysis?.prQualityScore ?? 0;
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestNumber = candidate.number;
    }
  }

  return bestNumber;
}

async function handlePR(app: Probot, context: HandlerContext): Promise<void> {
  const log = app.log;
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
  const author = payload.pull_request.user.login;
  const db = getDb();

  log.info(`Processing PR #${number} in ${fullRepo} by ${author}`);

  const config = await loadRepoConfig({ octokit: context.octokit, owner, repo });

  // Skip trusted users
  if (config.trusted_users.includes(author)) {
    log.info(`Skipping trusted user ${author}`);
    return;
  }

  // Skip bots if configured
  if (config.skip_bots && isBot(author)) {
    log.info(`Skipping bot user ${author}`);
    return;
  }

  // Check for empty PRs
  if (!payload.pull_request.title && !payload.pull_request.body) {
    log.warn(`PR #${number} has no title or body — skipping`);
    return;
  }

  // Rate limit check
  if (!checkRateLimit(db, fullRepo, OPENAI_BUDGET_PER_HOUR)) {
    log.warn(`Rate limit exceeded for ${fullRepo} — skipping OpenAI calls`);
    return;
  }

  if (!config.dry_run) {
    await ensureLabels({ octokit: context.octokit, owner, repo, labels: config.labels });
  }

  const commits = await context.octokit.pulls.listCommits({ owner, repo, pull_number: number, per_page: 100 });
  const checks = await context.octokit.checks.listForRef({ owner, repo, ref: payload.pull_request.head.sha, per_page: 50 });

  const { summary: diffSummary, totalLines } = await fetchPRDiffSummary({
    octokit: context.octokit, owner, repo, pullNumber: number,
    maxLines: config.max_diff_lines, log
  });

  // Skip massive diffs
  if (totalLines > config.max_diff_lines) {
    log.warn(`PR #${number} has ${totalLines} diff lines (max ${config.max_diff_lines}) — limited analysis`);
  }

  const files = await context.octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 });
  const hasTests = files.data.some((file: { filename: string }) => /(^test\/|\.test\.|\.spec\.)/i.test(file.filename));
  const ciPassing = checks.data.check_runs.length === 0 || checks.data.check_runs.every((run: { conclusion: string | null }) => run.conclusion === "success");

  const openaiClient = createOpenAIClient();

  const input = buildEmbeddingInput(payload.pull_request.title, normalizeBody(payload.pull_request.body), diffSummary);
  const embedding = await getEmbedding(input, openaiClient, undefined, log);

  // Graceful degradation: if embedding failed, skip duplicate detection
  if (embedding.length === 0) {
    log.warn(`Embedding generation failed for PR #${number} — skipping analysis`);
    return;
  }

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

  // Fetch actual merged PR count (#1)
  const contributorMergedPRs = await fetchContributorMergedPRs(context.octokit, owner, repo, author, log);

  const quality = scorePRQuality({
    additions: payload.pull_request.additions,
    deletions: payload.pull_request.deletions,
    changedFiles: payload.pull_request.changed_files,
    hasTests,
    commitMessages: commits.data.map((commit: { commit: { message: string } }) => commit.commit.message.split("\n")[0]),
    contributorMergedPRs,
    contributorAccountAgeDays: Math.max(
      0,
      Math.floor((Date.now() - new Date(payload.pull_request.user.created_at).valueOf()) / (24 * 60 * 60 * 1000))
    ),
    ciPassing
  }, config.quality_thresholds);

  const vision: VisionEvaluation = config.vision
    ? await evaluateVision({
        client: openaiClient,
        model: config.vision_model,
        vision: config.vision,
        title: payload.pull_request.title,
        body: normalizeBody(payload.pull_request.body),
        diffSummary,
        logger: log
      })
    : { score: 0.5, aligned: true, reasoning: "No vision configured", recommendation: "review" };

  // Improved pickBestPR (#9)
  const bestPRNumber = pickBestPRClean(number, duplicates, quality, db, fullRepo);

  const labelsToApply = [config.labels.needs_review];
  if (duplicates.length > 0) {
    labelsToApply.push(config.labels.duplicate);
  }
  if (config.vision) {
    labelsToApply.push(vision.aligned ? config.labels.on_track : config.labels.off_scope);
  }
  if (bestPRNumber === number && duplicates.length > 0) {
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

  if (!config.dry_run) {
    await applyLabels({
      octokit: context.octokit,
      owner,
      repo,
      issueNumber: number,
      labels: [...new Set(labelsToApply)]
    });
  } else {
    log.info(`[DRY RUN] Would apply labels: ${labelsToApply.join(", ")}`);
  }

  const summary = buildSummaryComment({
    duplicates,
    vision: config.vision ? vision : null,
    quality,
    bestPRNumber: duplicates.length > 0 ? bestPRNumber : null
  });

  await upsertSummaryComment({
    octokit: context.octokit,
    owner,
    repo,
    issueNumber: number,
    body: summary,
    dryRun: config.dry_run,
    log
  });

  log.info(`PRGuard analyzed PR #${number} in ${fullRepo} — quality=${quality.score.toFixed(2)} vision=${vision.score.toFixed(2)}`);
}

async function handleIssue(app: Probot, context: HandlerContext): Promise<void> {
  const log = app.log;
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
  const author = payload.issue.user.login;
  const db = getDb();

  log.info(`Processing issue #${number} in ${fullRepo} by ${author}`);

  const config = await loadRepoConfig({ octokit: context.octokit, owner, repo });

  if (config.trusted_users.includes(author)) {
    log.info(`Skipping trusted user ${author}`);
    return;
  }

  if (config.skip_bots && isBot(author)) {
    log.info(`Skipping bot user ${author}`);
    return;
  }

  if (!payload.issue.title && !payload.issue.body) {
    log.warn(`Issue #${number} has no title or body — skipping`);
    return;
  }

  if (!checkRateLimit(db, fullRepo, OPENAI_BUDGET_PER_HOUR)) {
    log.warn(`Rate limit exceeded for ${fullRepo} — skipping`);
    return;
  }

  if (!config.dry_run) {
    await ensureLabels({ octokit: context.octokit, owner, repo, labels: config.labels });
  }

  const openaiClient = createOpenAIClient();
  const input = buildEmbeddingInput(payload.issue.title, normalizeBody(payload.issue.body));
  const embedding = await getEmbedding(input, openaiClient, undefined, log);

  if (embedding.length === 0) {
    log.warn(`Embedding generation failed for issue #${number} — skipping`);
    return;
  }

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

  const labelsToApply = duplicates.length > 0
    ? [config.labels.duplicate, config.labels.needs_review]
    : [config.labels.needs_review];

  if (!config.dry_run) {
    await applyLabels({
      octokit: context.octokit,
      owner,
      repo,
      issueNumber: number,
      labels: labelsToApply
    });
  } else {
    log.info(`[DRY RUN] Would apply labels: ${labelsToApply.join(", ")}`);
  }

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
    body: summary,
    dryRun: config.dry_run,
    log
  });

  log.info(`PRGuard analyzed issue #${number} in ${fullRepo}`);
}

/** Handle PR/issue closed events — deactivate embeddings (#8). */
async function handleClosed(app: Probot, context: HandlerContext, type: ItemType): Promise<void> {
  const log = app.log;
  const db = getDb();

  let owner: string, repo: string, number: number;

  if (type === "pr") {
    const payload = context.payload as {
      pull_request: { number: number };
      repository: { name: string; owner: { login: string } };
    };
    owner = payload.repository.owner.login;
    repo = payload.repository.name;
    number = payload.pull_request.number;
  } else {
    const payload = context.payload as {
      issue: { number: number; pull_request?: unknown };
      repository: { name: string; owner: { login: string } };
    };
    if (payload.issue.pull_request) return;
    owner = payload.repository.owner.login;
    repo = payload.repository.name;
    number = payload.issue.number;
  }

  const fullRepo = `${owner}/${repo}`;
  deactivateEmbedding(db, fullRepo, type, number);
  log.info(`Deactivated embedding for ${type} #${number} in ${fullRepo}`);
}

export default (app: Probot): void => {
  app.log.info("PRGuard loaded 🛡️");

  app.on(["pull_request.opened", "pull_request.edited"], async (context) => {
    try {
      await handlePR(app, context);
    } catch (error) {
      app.log.error({ error }, `PRGuard failed processing PR`);
    }
  });

  app.on(["issues.opened", "issues.edited"], async (context) => {
    try {
      await handleIssue(app, context);
    } catch (error) {
      app.log.error({ error }, `PRGuard failed processing issue`);
    }
  });

  // Cleanup on close/merge (#8)
  app.on("pull_request.closed", async (context) => {
    try {
      await handleClosed(app, context, "pr");
    } catch (error) {
      app.log.error({ error }, `PRGuard failed handling PR close`);
    }
  });

  app.on("issues.closed", async (context) => {
    try {
      await handleClosed(app, context, "issue");
    } catch (error) {
      app.log.error({ error }, `PRGuard failed handling issue close`);
    }
  });
};
