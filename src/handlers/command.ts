import type { Probot } from "probot";
import { loadRepoConfig } from "../config.js";
import {
  checkRateLimit,
  deactivateEmbedding,
  deleteAnalysisAndReview,
  getDb,
  getEmbeddingRecord,
  listEmbeddings,
  logEvent,
  upsertEmbedding,
  upsertAnalysis,
  upsertReview
} from "../db.js";
import { buildEmbeddingInput, createOpenAIClient, getEmbedding } from "../embed.js";
import { buildSummaryComment } from "../comment.js";
import { findDuplicates, cosineSimilarity } from "../dedup.js";
import { applyLabels, ensureLabels } from "../labels.js";
import { evaluateVision } from "../vision.js";
import { reviewPR, buildCrossComparison } from "../review.js";
import { scorePRQuality } from "../quality.js";
import { withGitHubRetry } from "../github.js";
import { inc } from "../metrics.js";
import { checkInstallationRateLimit, incrementInstallationRateLimit } from "../rate-limit.js";
import {
  isBot,
  normalizeBody,
  upsertSummaryComment,
  OPENAI_BUDGET_PER_HOUR,
  type Logger
} from "../util.js";
import type {
  AnalysisRecord,
  CodeReview,
  DuplicateMatch,
  EmbeddingRecord,
  ItemType,
  PRGuardConfig,
  PRQualityResult,
  VisionEvaluation
} from "../types.js";
import { generateReport, generateWeeklyDigest } from "../digest.js";

export type SlashCommand =
  | { kind: "review" }
  | { kind: "compare"; targetNumber: number }
  | { kind: "config" }
  | { kind: "ignore" }
  | { kind: "report" }
  | { kind: "stale"; days: number }
  | { kind: "digest" }
  | { kind: "help" };

/** Parse a /prguard command from comment body. Returns null if no command found. */
export function parseCommand(body: string): SlashCommand | null {
  // Match /prguard at the start of a line
  const match = body.match(/^\/prguard\s+(\S+)(?:\s+(.*))?$/m);
  if (!match) return null;

  const subcommand = match[1].toLowerCase();
  const args = match[2]?.trim() ?? "";

  switch (subcommand) {
    case "review":
      return { kind: "review" };
    case "compare": {
      const numMatch = args.match(/^#?(\d+)$/);
      if (!numMatch) return null;
      return { kind: "compare", targetNumber: parseInt(numMatch[1], 10) };
    }
    case "config":
      return { kind: "config" };
    case "ignore":
      return { kind: "ignore" };
    case "report":
      return { kind: "report" };
    case "stale": {
      const daysMatch = args.match(/^(\d+)$/);
      return { kind: "stale", days: daysMatch ? parseInt(daysMatch[1], 10) : 30 };
    }
    case "digest":
      return { kind: "digest" };
    case "help":
      return { kind: "help" };
    default:
      return null;
  }
}

/** Check if commenter has write or admin access to the repo. */
async function hasWriteAccess(
  octokit: any,
  owner: string,
  repo: string,
  username: string
): Promise<boolean> {
  try {
    const { data } = await octokit.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username
    });
    return data.permission === "admin" || data.permission === "write";
  } catch {
    return false;
  }
}

/** Determine the ItemType for the issue/PR this comment is on. */
function getItemType(payload: { issue: { pull_request?: unknown } }): ItemType {
  return payload.issue.pull_request ? "pr" : "issue";
}

export async function handleCommand(app: Probot, context: { octokit: any; payload: any }): Promise<void> {
  const log = app.log;
  const payload = context.payload as {
    comment: { body: string; user: { login: string } };
    issue: {
      number: number;
      title: string;
      body: string | null;
      user: { login: string; type?: string; created_at?: string };
      pull_request?: unknown;
    };
    repository: { name: string; owner: { login: string } };
    installation?: { id: number };
  };

  const commentBody = payload.comment.body;
  const command = parseCommand(commentBody);
  if (!command) return;

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const fullRepo = `${owner}/${repo}`;
  const number = payload.issue.number;
  const commenter = payload.comment.user.login;
  const itemType = getItemType(payload);

  log.info(
    { repo: fullRepo, number, commenter, command: command.kind, action: "command.received" },
    `Received /prguard ${command.kind} from ${commenter} on ${itemType} #${number}`
  );

  inc("commands_processed_total");

  // Permission check
  const authorized = await hasWriteAccess(context.octokit, owner, repo, commenter);
  if (!authorized) {
    log.info(
      { repo: fullRepo, number, commenter, action: "command.denied" },
      `Denied /prguard ${command.kind} from ${commenter} — insufficient permissions`
    );
    await context.octokit.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: `> /prguard ${command.kind}\n\n⚠️ Sorry @${commenter}, only users with **write** or **admin** access can use PRGuard commands.`
    });
    return;
  }

  const config = await loadRepoConfig({ octokit: context.octokit, owner, repo });
  const db = getDb();

  logEvent(db, { repo: fullRepo, eventType: "issue_comment.created", number, action: "command", detail: JSON.stringify({ command: command.kind, commenter }) });

  switch (command.kind) {
    case "help":
      await handleHelp(context.octokit, owner, repo, number);
      break;
    case "config":
      await handleConfig(context.octokit, owner, repo, number, config);
      break;
    case "ignore":
      await handleIgnore({ octokit: context.octokit, owner, repo, number, fullRepo, itemType, config, log });
      break;
    case "review":
      await handleReview({ app, context, owner, repo, number, fullRepo, itemType, config, log });
      break;
    case "compare":
      await handleCompare({ octokit: context.octokit, owner, repo, number, fullRepo, itemType, targetNumber: command.targetNumber, config, log });
      break;
    case "report":
      await handleReport(context.octokit, owner, repo, number, fullRepo);
      break;
    case "stale":
      await handleStale(context.octokit, owner, repo, number, command.days);
      break;
    case "digest":
      await handleDigest(context.octokit, owner, repo, number, fullRepo);
      break;
  }

  log.info(
    { repo: fullRepo, number, command: command.kind, action: "command.complete" },
    `Completed /prguard ${command.kind} on ${itemType} #${number}`
  );
}

async function handleHelp(octokit: any, owner: string, repo: string, number: number): Promise<void> {
  const body = [
    "## 🛡️ PRGuard Commands\n",
    "| Command | Description |",
    "|---------|-------------|",
    "| `/prguard review` | Force a fresh review (re-embed, re-score, update comment) |",
    "| `/prguard compare #123` | Compare this PR/issue against another |",
    "| `/prguard config` | Show the repo's current PRGuard configuration |",
    "| `/prguard ignore` | Ignore this PR/issue (skip future analysis, remove labels) |",
    "| `/prguard report` | Generate a repo health report |",
    "| `/prguard stale` | List stale issues/PRs (default 30 days) |",
    "| `/prguard stale 60` | List items stale for 60+ days |",
    "| `/prguard digest` | Generate a weekly activity digest |",
    "| `/prguard help` | Show this help message |",
    "",
    "Commands require **write** or **admin** access to the repository.",
    "",
    "---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a></sub>"
  ].join("\n");

  await octokit.issues.createComment({ owner, repo, issue_number: number, body });
}

async function handleConfig(
  octokit: any,
  owner: string,
  repo: string,
  number: number,
  config: PRGuardConfig
): Promise<void> {
  const lines = [
    "## 🛡️ PRGuard Configuration\n",
    "```yaml",
    `vision: "${config.vision || "(not set)"}"`,
    `duplicate_threshold: ${config.duplicate_threshold}`,
    `vision_model: ${config.vision_model}`,
    `review_model: ${config.review_model}`,
    `deep_review: ${config.deep_review}`,
    `skip_bots: ${config.skip_bots}`,
    `dry_run: ${config.dry_run}`,
    `max_diff_lines: ${config.max_diff_lines}`,
    `max_diff_tokens: ${config.max_diff_tokens}`,
    `daily_limit: ${config.daily_limit}`,
    `quality_thresholds:`,
    `  approve: ${config.quality_thresholds.approve}`,
    `  reject: ${config.quality_thresholds.reject}`,
    `labels:`,
    `  duplicate: ${config.labels.duplicate}`,
    `  off_scope: ${config.labels.off_scope}`,
    `  on_track: ${config.labels.on_track}`,
    `  needs_review: ${config.labels.needs_review}`,
    `  recommended: ${config.labels.recommended}`,
    `trusted_users: [${config.trusted_users.join(", ")}]`,
    `openai_api_key: ${config.openai_api_key ? "(set)" : "(not set)"}`,
    "```",
    "",
    "Configure via `.github/prguard.yml` in your repository.",
    "",
    "---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a></sub>"
  ];

  await octokit.issues.createComment({ owner, repo, issue_number: number, body: lines.join("\n") });
}

async function handleIgnore(params: {
  octokit: any;
  owner: string;
  repo: string;
  number: number;
  fullRepo: string;
  itemType: ItemType;
  config: PRGuardConfig;
  log: Logger;
}): Promise<void> {
  const { octokit, owner, repo, number, fullRepo, itemType, config, log } = params;
  const db = getDb();

  // Deactivate embedding (soft delete)
  deactivateEmbedding(db, fullRepo, itemType, number);
  // Clean up analysis and review records
  deleteAnalysisAndReview(db, fullRepo, itemType, number);

  // Remove PRGuard labels
  const prguardLabels = Object.values(config.labels);
  for (const label of prguardLabels) {
    try {
      await octokit.issues.removeLabel({ owner, repo, issue_number: number, name: label });
    } catch {
      // Label may not be applied — ignore
    }
  }

  log.info({ repo: fullRepo, number, action: "command.ignore" }, `Ignored ${itemType} #${number}`);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: number,
    body: [
      `## 🛡️ PRGuard — Ignored\n`,
      `This ${itemType === "pr" ? "pull request" : "issue"} has been marked as **ignored**. PRGuard will skip future analysis and labels have been removed.`,
      "",
      "To undo, re-open the item or use `/prguard review` to force a fresh analysis.",
      "",
      "---",
      "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a></sub>"
    ].join("\n")
  });
}

async function handleReview(params: {
  app: Probot;
  context: { octokit: any; payload: any };
  owner: string;
  repo: string;
  number: number;
  fullRepo: string;
  itemType: ItemType;
  config: PRGuardConfig;
  log: Logger;
}): Promise<void> {
  const { app, context, owner, repo, number, fullRepo, itemType, config, log } = params;

  // For PRs, delegate to the existing handlePR pipeline
  if (itemType === "pr") {
    const { handlePR } = await import("./pr.js");
    await handlePR(app, context);
    return;
  }

  // For issues, delegate to the existing handleIssue pipeline
  const { handleIssue } = await import("./issue.js");
  await handleIssue(app, context);
}

async function handleCompare(params: {
  octokit: any;
  owner: string;
  repo: string;
  number: number;
  fullRepo: string;
  itemType: ItemType;
  targetNumber: number;
  config: PRGuardConfig;
  log: Logger;
}): Promise<void> {
  const { octokit, owner, repo, number, fullRepo, itemType, targetNumber, config, log } = params;
  const db = getDb();

  // Look up embeddings for both items
  const currentEmbed = getEmbeddingRecord(db, fullRepo, itemType, number);

  // Try to find the target as either a PR or issue
  let targetEmbed = getEmbeddingRecord(db, fullRepo, "pr", targetNumber);
  if (!targetEmbed) {
    targetEmbed = getEmbeddingRecord(db, fullRepo, "issue", targetNumber);
  }

  if (!currentEmbed) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: `> /prguard compare #${targetNumber}\n\n⚠️ No embedding found for this ${itemType === "pr" ? "PR" : "issue"} (#${number}). Run \`/prguard review\` first to generate an analysis.`
    });
    return;
  }

  if (!targetEmbed) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: `> /prguard compare #${targetNumber}\n\n⚠️ No embedding found for #${targetNumber}. That item may not have been analyzed yet.`
    });
    return;
  }

  const similarity = cosineSimilarity(currentEmbed.embedding, targetEmbed.embedding);
  const pct = (similarity * 100).toFixed(1);
  const isDuplicate = similarity >= config.duplicate_threshold;

  const emoji = isDuplicate ? "🔴" : similarity >= 0.5 ? "🟡" : "🟢";
  const verdict = isDuplicate
    ? "These items are **likely duplicates**."
    : similarity >= 0.5
    ? "These items have **some overlap** but are probably distinct."
    : "These items appear to be **unrelated**.";

  const body = [
    `## 🛡️ PRGuard — Comparison\n`,
    `| Item | Type | Title |`,
    `|------|------|-------|`,
    `| #${number} | ${itemType} | ${currentEmbed.title} |`,
    `| #${targetNumber} | ${targetEmbed.type} | ${targetEmbed.title} |`,
    "",
    `**Similarity:** ${emoji} ${pct}% (threshold: ${(config.duplicate_threshold * 100).toFixed(0)}%)`,
    "",
    verdict,
    "",
    "---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a></sub>"
  ].join("\n");

  await octokit.issues.createComment({ owner, repo, issue_number: number, body });
}

async function handleReport(
  octokit: any,
  owner: string,
  repo: string,
  number: number,
  fullRepo: string
): Promise<void> {
  const db = getDb();
  const body = generateReport({ repo: fullRepo, db, repoUrl: `https://github.com/${fullRepo}` });
  await octokit.issues.createComment({ owner, repo, issue_number: number, body });
}

async function handleStale(
  octokit: any,
  owner: string,
  repo: string,
  number: number,
  days: number
): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const staleItems: Array<{ type: string; number: number; title: string; updated_at: string; url: string }> = [];

  try {
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "asc",
      per_page: 100,
    });

    for (const issue of issues) {
      if (issue.pull_request) continue;
      if (issue.updated_at < cutoff) {
        staleItems.push({
          type: "issue",
          number: issue.number,
          title: issue.title,
          updated_at: issue.updated_at,
          url: issue.html_url,
        });
      }
    }

    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "asc",
      per_page: 100,
    });

    for (const pr of prs) {
      if (pr.updated_at < cutoff) {
        staleItems.push({
          type: "pr",
          number: pr.number,
          title: pr.title,
          updated_at: pr.updated_at,
          url: pr.html_url,
        });
      }
    }
  } catch {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: `> /prguard stale\n\n⚠️ Failed to fetch repository data. Please check that PRGuard has read access.`,
    });
    return;
  }

  if (staleItems.length === 0) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: [
        `## 🛡️ PRGuard — Stale Items\n`,
        `✅ No items have been inactive for ${days}+ days. Your repo is in great shape!`,
        "",
        "---",
        `<sub>🤖 <a href="https://github.com/apps/prguard">PRGuard</a></sub>`,
      ].join("\n"),
    });
    return;
  }

  const lines: string[] = [
    `## 🛡️ PRGuard — Stale Items (${days}+ days)\n`,
    `Found **${staleItems.length}** items with no activity for ${days}+ days:\n`,
    `| # | Type | Title | Last Updated |`,
    `|---|------|-------|-------------|`,
  ];

  for (const item of staleItems.slice(0, 25)) {
    const icon = item.type === "pr" ? "🔀" : "🐛";
    const daysSince = Math.floor((Date.now() - new Date(item.updated_at).getTime()) / (24 * 60 * 60 * 1000));
    lines.push(
      `| [#${item.number}](${item.url}) | ${icon} ${item.type} | ${item.title.slice(0, 60)} | ${daysSince}d ago |`
    );
  }

  if (staleItems.length > 25) {
    lines.push(`| ... | | +${staleItems.length - 25} more | |`);
  }

  lines.push(
    "",
    "💡 **Tip:** Consider closing items that are no longer relevant, or use `/prguard ignore` to exclude them from future analysis.",
    "",
    "---",
    `<sub>🤖 <a href="https://github.com/apps/prguard">PRGuard</a></sub>`,
  );

  await octokit.issues.createComment({ owner, repo, issue_number: number, body: lines.join("\n") });
}

async function handleDigest(
  octokit: any,
  owner: string,
  repo: string,
  number: number,
  fullRepo: string
): Promise<void> {
  const db = getDb();
  const body = generateWeeklyDigest({ repo: fullRepo, db, repoUrl: `https://github.com/${fullRepo}` });
  await octokit.issues.createComment({ owner, repo, issue_number: number, body });
}
