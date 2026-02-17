import type { Probot } from "probot";
import { buildSummaryComment } from "../comment.js";
import { loadRepoConfig } from "../config.js";
import {
  checkRateLimit,
  getAnalysis,
  getDb,
  listEmbeddings,
  upsertAnalysis,
  upsertEmbedding
} from "../db.js";
import { buildEmbeddingInput, createOpenAIClient, getEmbedding } from "../embed.js";
import { findDuplicates } from "../dedup.js";
import { withGitHubRetry } from "../github.js";
import { applyLabels, ensureLabels } from "../labels.js";
import { scorePRQuality } from "../quality.js";
import type {
  AnalysisRecord,
  DuplicateMatch,
  EmbeddingRecord,
  PRGuardConfig,
  PRQualityResult,
  VisionEvaluation
} from "../types.js";
import { evaluateVision } from "../vision.js";
import {
  isBot,
  normalizeBody,
  upsertSummaryComment,
  OPENAI_BUDGET_PER_HOUR,
  type Logger
} from "../util.js";

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

/**
 * Pick the best PR among duplicates by comparing quality scores.
 */
function pickBestPR(
  currentNumber: number,
  duplicates: DuplicateMatch[],
  currentQuality: PRQualityResult,
  db: import("better-sqlite3").Database,
  fullRepo: string
): number {
  const prCandidates = duplicates.filter((item) => item.type === "pr");
  if (prCandidates.length === 0) return currentNumber;

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

export async function handlePR(app: Probot, context: { octokit: any; payload: any }): Promise<void> {
  const log = app.log;
  const payload = context.payload as {
    pull_request: {
      number: number;
      title: string;
      body: string | null;
      user: { login: string; type?: string; created_at: string };
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

  if (config.trusted_users.includes(author)) {
    log.info(`Skipping trusted user ${author}`);
    return;
  }

  if (config.skip_bots && isBot(author, payload.pull_request.user.type)) {
    log.info(`Skipping bot user ${author}`);
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

  if (totalLines > config.max_diff_lines) {
    log.warn(`PR #${number} has ${totalLines} diff lines (max ${config.max_diff_lines}) — limited analysis`);
  }

  const files = await context.octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 });
  const hasTests = files.data.some((file: { filename: string }) => /(^test\/|\.test\.|\.spec\.)/i.test(file.filename));
  const ciPassing = checks.data.check_runs.length === 0 || checks.data.check_runs.every((run: { conclusion: string | null }) => run.conclusion === "success");

  const openaiClient = createOpenAIClient();

  const body = normalizeBody(payload.pull_request.body);
  const input = buildEmbeddingInput(payload.pull_request.title, body, diffSummary);
  const embedding = await getEmbedding(input, openaiClient, undefined, log);

  if (embedding.length === 0) {
    log.warn(`Embedding generation failed for PR #${number} — skipping analysis`);
    return;
  }

  const record: EmbeddingRecord = {
    repo: fullRepo,
    type: "pr",
    number,
    title: payload.pull_request.title,
    body,
    diffSummary,
    embedding
  };
  upsertEmbedding(db, record);

  const duplicates = findDuplicates(record, listEmbeddings(db, fullRepo), config.duplicate_threshold);

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
        body,
        diffSummary,
        logger: log
      })
    : { score: 0.5, aligned: true, reasoning: "No vision configured", recommendation: "review" };

  const bestPRNumber = pickBestPR(number, duplicates, quality, db, fullRepo);

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
