import type { Probot } from "probot";
import { buildSummaryComment } from "../comment.js";
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
import type { AnalysisRecord, EmbeddingRecord } from "../types.js";
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
  };

  if (payload.issue.pull_request) return;

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

  if (config.skip_bots && isBot(author, payload.issue.user.type)) {
    log.info(`Skipping bot user ${author}`);
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
  const body = normalizeBody(payload.issue.body);
  const input = buildEmbeddingInput(payload.issue.title, body);
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
    body,
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
