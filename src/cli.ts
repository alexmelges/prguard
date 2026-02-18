#!/usr/bin/env node
/**
 * PRGuard CLI — backfill existing PRs/issues for a repository.
 *
 * Usage:
 *   npx tsx src/cli.ts backfill owner/repo
 *
 * Requires GITHUB_TOKEN and OPENAI_API_KEY environment variables.
 */

import { Octokit } from "@octokit/rest";
import { createDb, upsertEmbedding, listEmbeddings } from "./db.js";
import { buildEmbeddingInput, createOpenAIClient, getEmbedding } from "./embed.js";
import { generateReport, generateWeeklyDigest } from "./digest.js";
import type { EmbeddingRecord } from "./types.js";

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`)
};

async function backfill(fullRepo: string): Promise<void> {
  const [owner, repo] = fullRepo.split("/");
  if (!owner || !repo) {
    logger.error("Usage: backfill owner/repo");
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.error("GITHUB_TOKEN is required");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const openai = createOpenAIClient();
  const db = createDb();

  // Build set of already-processed items to skip
  const existing = listEmbeddings(db, fullRepo, 10000);
  const existingKeys = new Set(existing.map((e) => `${e.type}:${e.number}`));

  // Backfill open PRs
  logger.info(`Fetching open PRs for ${fullRepo}...`);
  let prPage = 1;
  let prCount = 0;
  while (true) {
    const { data: prs } = await octokit.pulls.list({
      owner, repo, state: "open", per_page: 100, page: prPage
    });
    if (prs.length === 0) break;

    for (const pr of prs) {
      if (existingKeys.has(`pr:${pr.number}`)) {
        logger.info(`Skipping PR #${pr.number} — already embedded`);
        continue;
      }
      let diffSummary = "";
      try {
        const { data: files } = await octokit.pulls.listFiles({
          owner, repo, pull_number: pr.number, per_page: 100
        });
        diffSummary = files
          .map((f) => `${f.filename}\n${(f.patch ?? "").slice(0, 300)}`)
          .join("\n\n")
          .slice(0, 2000);
      } catch {
        logger.warn(`Could not fetch files for PR #${pr.number}`);
      }

      const input = buildEmbeddingInput(pr.title, pr.body ?? "", diffSummary);
      const embedding = await getEmbedding(input, openai, undefined, logger);
      if (embedding.length === 0) {
        logger.warn(`Skipping PR #${pr.number} — embedding failed`);
        continue;
      }

      const record: EmbeddingRecord = {
        repo: fullRepo,
        type: "pr",
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        diffSummary,
        embedding
      };
      upsertEmbedding(db, record);
      prCount++;
      logger.info(`Embedded PR #${pr.number}: ${pr.title}`);

      // Rate limit: ~50ms between calls
      await new Promise((r) => setTimeout(r, 50));
    }
    prPage++;
  }

  // Backfill open issues
  logger.info(`Fetching open issues for ${fullRepo}...`);
  let issuePage = 1;
  let issueCount = 0;
  while (true) {
    const { data: issues } = await octokit.issues.listForRepo({
      owner, repo, state: "open", per_page: 100, page: issuePage
    });
    // Filter out PRs (GitHub includes them in issues endpoint)
    const realIssues = issues.filter((i) => !i.pull_request);
    if (issues.length === 0) break;

    for (const issue of realIssues) {
      if (existingKeys.has(`issue:${issue.number}`)) {
        logger.info(`Skipping issue #${issue.number} — already embedded`);
        continue;
      }
      const input = buildEmbeddingInput(issue.title, issue.body ?? "");
      const embedding = await getEmbedding(input, openai, undefined, logger);
      if (embedding.length === 0) {
        logger.warn(`Skipping issue #${issue.number} — embedding failed`);
        continue;
      }

      const record: EmbeddingRecord = {
        repo: fullRepo,
        type: "issue",
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        diffSummary: "",
        embedding
      };
      upsertEmbedding(db, record);
      issueCount++;
      logger.info(`Embedded issue #${issue.number}: ${issue.title}`);

      await new Promise((r) => setTimeout(r, 50));
    }
    issuePage++;
  }

  logger.info(`Backfill complete: ${prCount} PRs, ${issueCount} issues`);
}

const command = process.argv[2];
const target = process.argv[3];

function report(fullRepo: string): void {
  const db = createDb();
  const md = generateReport({ repo: fullRepo, db, repoUrl: `https://github.com/${fullRepo}` });
  console.log(md);
}

function digest(fullRepo: string): void {
  const db = createDb();
  const md = generateWeeklyDigest({ repo: fullRepo, db, repoUrl: `https://github.com/${fullRepo}` });
  console.log(md);
}

if (command === "backfill" && target) {
  backfill(target).catch((err) => {
    logger.error(String(err));
    process.exit(1);
  });
} else if (command === "report" && target) {
  report(target);
} else if (command === "digest" && target) {
  digest(target);
} else {
  console.log("PRGuard CLI");
  console.log("");
  console.log("Commands:");
  console.log("  backfill <owner/repo>  Embed all open PRs and issues");
  console.log("  report <owner/repo>    Generate repo health report");
  console.log("  digest <owner/repo>    Generate weekly activity digest");
  console.log("");
  console.log("Environment:");
  console.log("  GITHUB_TOKEN    GitHub personal access token");
  console.log("  OPENAI_API_KEY  OpenAI API key");
  console.log("  DATABASE_PATH   SQLite path (default: ./prguard.db)");
}
