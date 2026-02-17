import type { Probot } from "probot";
import { buildSummaryComment, buildDegradedComment } from "../comment.js";
import { loadRepoConfig } from "../config.js";
import {
  checkRateLimit,
  getDb,
  listEmbeddings,
  upsertAnalysis,
  upsertEmbedding
} from "../db.js";
import { buildEmbeddingInput, createOpenAIClient, getEmbedding } from "../embed.js";
import { findDuplicates } from "../dedup.js";
import { applyLabels, ensureLabels } from "../labels.js";
import { inc } from "../metrics.js";
import type { AnalysisRecord, EmbeddingRecord } from "../types.js";
import { checkInstallationRateLimit, incrementInstallationRateLimit } from "../rate-limit.js";
import {
  isBot,
  normalizeBody,
  upsertSummaryComment,
  OPENAI_BUDGET_PER_HOUR,
} from "../util.js";

export async function handleIssue(app: Probot, context: { octokit: any; payload: any }): Promise<void> {
  const log = app.log;
  const payload = context.payload as {
    issue: {
      number: number;
      title: string;
      body: string | null;
      user: { login: string; type?: string };
      pull_request?: unknown;
    };
    repository: { name: string; owner: { login: string } };
    installation?: { id: number };
  };

  if (payload.issue.pull_request) return;

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const number = payload.issue.number;
  const fullRepo = `${owner}/${repo}`;
  const author = payload.issue.user.login;
  const db = getDb();

  log.info({ repo: fullRepo, number, author, action: "issue.start" }, `Processing issue #${number} in ${fullRepo} by ${author}`);

  const config = await loadRepoConfig({ octokit: context.octokit, owner, repo });

  if (config.trusted_users.includes(author)) {
    log.info({ repo: fullRepo, number, author, action: "issue.skip_trusted" }, `Skipping trusted user ${author}`);
    return;
  }

  if (config.skip_bots && isBot(author, payload.issue.user.type)) {
    log.info({ repo: fullRepo, number, author, action: "issue.skip_bot" }, `Skipping bot user ${author}`);
    return;
  }

  // Per-installation daily rate limit check
  const installationId = payload.installation?.id;
  if (installationId) {
    const rateLimit = checkInstallationRateLimit(db, installationId, config.daily_limit);
    if (!rateLimit.allowed) {
      log.warn({ repo: fullRepo, number, installationId, action: "issue.daily_limit" }, `Daily analysis limit reached for installation ${installationId}`);
      await upsertSummaryComment({
        octokit: context.octokit,
        owner,
        repo,
        issueNumber: number,
        body: `⚠️ **PRGuard daily analysis limit reached** (${rateLimit.used}/${config.daily_limit}). Resets at midnight UTC.`,
        dryRun: config.dry_run,
        log
      });
      return;
    }
  }

  if (!checkRateLimit(db, fullRepo, OPENAI_BUDGET_PER_HOUR)) {
    log.warn({ repo: fullRepo, number, action: "issue.rate_limited" }, `Rate limit exceeded for ${fullRepo} — skipping`);
    return;
  }

  if (!config.dry_run) {
    await ensureLabels({ octokit: context.octokit, owner, repo, labels: config.labels });
  }

  // Attempt OpenAI — graceful degradation
  // BYOK: use repo-provided API key if configured
  let openaiClient;
  try {
    openaiClient = config.openai_api_key
      ? createOpenAIClient(config.openai_api_key)
      : createOpenAIClient();
  } catch {
    log.warn({ repo: fullRepo, number, action: "issue.openai_unavailable" }, "OpenAI client creation failed — degrading gracefully");
    await handleDegradedIssue({ context, config, owner, repo, number, log });
    inc("openai_degraded_total");
    inc("issues_analyzed_total");
    return;
  }

  const body = normalizeBody(payload.issue.body);
  const input = buildEmbeddingInput(payload.issue.title, body);
  const embedding = await getEmbedding(input, openaiClient, undefined, log);
  inc("openai_calls_total");

  if (embedding.length === 0) {
    log.warn({ repo: fullRepo, number, action: "issue.embedding_failed" }, `Embedding generation failed for issue #${number} — degrading gracefully`);
    await handleDegradedIssue({ context, config, owner, repo, number, log });
    inc("openai_degraded_total");
    inc("issues_analyzed_total");
    return;
  }

  const record: EmbeddingRecord = {
    repo: fullRepo,
    type: "issue",
    number,
    title: payload.issue.title,
    body,
    diffSummary: "",
    embedding
  };
  upsertEmbedding(db, record);

  const duplicates = findDuplicates(record, listEmbeddings(db, fullRepo), config.duplicate_threshold);
  if (duplicates.length > 0) {
    inc("duplicates_found_total", duplicates.length);
  }

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
    log.info({ repo: fullRepo, number, labels: labelsToApply, action: "issue.dry_run_labels" }, `[DRY RUN] Would apply labels: ${labelsToApply.join(", ")}`);
  }

  const summary = buildSummaryComment({
    duplicates,
    vision: null,
    quality: null,
    bestPRNumber: null,
    review: null,
    crossComparison: null
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

  // Increment daily rate limit counter
  if (installationId) {
    incrementInstallationRateLimit(db, installationId);
  }

  inc("issues_analyzed_total");
  log.info({ repo: fullRepo, number, duplicates: duplicates.length, action: "issue.complete" }, `PRGuard analyzed issue #${number} in ${fullRepo}`);
}

/** Handle an issue when OpenAI is unavailable. */
async function handleDegradedIssue(params: {
  context: { octokit: any };
  config: import("../types.js").PRGuardConfig;
  owner: string;
  repo: string;
  number: number;
  log: import("../util.js").Logger;
}): Promise<void> {
  const { context, config, owner, repo, number, log } = params;

  if (!config.dry_run) {
    await ensureLabels({ octokit: context.octokit, owner, repo, labels: config.labels });
    await applyLabels({
      octokit: context.octokit,
      owner,
      repo,
      issueNumber: number,
      labels: [config.labels.needs_review]
    });
  }

  const summary = buildDegradedComment();

  await upsertSummaryComment({
    octokit: context.octokit,
    owner,
    repo,
    issueNumber: number,
    body: summary,
    dryRun: config.dry_run,
    log
  });

  log.warn({ repo: `${owner}/${repo}`, number, action: "issue.degraded" }, `Posted degraded comment for issue #${number}`);
}
