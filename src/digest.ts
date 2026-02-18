/**
 * Weekly digest generator for PRGuard.
 * Produces a markdown summary of repo activity over the past 7 days.
 */

import type Database from "better-sqlite3";
import { getRepoReport, getWeeklyDigestData, type RepoReport, type WeeklyDigestData } from "./db.js";

export interface DigestOptions {
  repo: string;
  db: Database.Database;
  repoUrl?: string;
}

/** Format a quality score as a colored emoji indicator. */
function qualityEmoji(score: number): string {
  if (score >= 8) return "🟢";
  if (score >= 6) return "🟡";
  if (score >= 4) return "🟠";
  return "🔴";
}

/** Generate repo health report markdown (used by /prguard report). */
export function generateReport(opts: DigestOptions): string {
  const { repo, db } = opts;
  const r = getRepoReport(db, repo);
  const repoUrl = opts.repoUrl ?? `https://github.com/${repo}`;

  const lines: string[] = [
    `## 🛡️ PRGuard — Repository Health Report`,
    "",
    `**Repository:** [${repo}](${repoUrl})`,
    `**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "### 📊 Overview",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total tracked items | ${r.totalItems} |`,
    `| Active items | ${r.activeItems} (${r.prs} PRs, ${r.issues} issues) |`,
    `| Duplicates detected | ${r.duplicateCount} (${(r.duplicateRate * 100).toFixed(1)}% rate) |`,
    `| Avg quality score | ${qualityEmoji(r.avgQuality)} ${r.avgQuality.toFixed(1)}/10 |`,
    `| Events (24h) | ${r.eventsLast24Hours} |`,
    `| Events (7d) | ${r.eventsLast7Days} |`,
    "",
    "### 📈 Quality Distribution",
    "",
    `| Rating | Count |`,
    `|--------|-------|`,
    `| 🟢 Excellent (8+) | ${r.qualityDist.excellent} |`,
    `| 🟡 Good (6-7) | ${r.qualityDist.good} |`,
    `| 🟠 Needs Work (4-5) | ${r.qualityDist.needs_work} |`,
    `| 🔴 Poor (<4) | ${r.qualityDist.poor} |`,
    "",
    "### ✅ Verdicts",
    "",
    `| Verdict | Count |`,
    `|---------|-------|`,
    `| ✅ Approve | ${r.verdictCounts.approve} |`,
    `| 👀 Review | ${r.verdictCounts.review} |`,
    `| ❌ Reject | ${r.verdictCounts.reject} |`,
  ];

  if (r.topDuplicatePairs.length > 0) {
    lines.push(
      "",
      "### 🔗 Top Duplicate Pairs",
      "",
      `| Items | Similarity |`,
      `|-------|-----------|`,
    );
    for (const pair of r.topDuplicatePairs) {
      lines.push(
        `| [#${pair.number1}](${repoUrl}/issues/${pair.number1}) ↔ [#${pair.number2}](${repoUrl}/issues/${pair.number2}) | ${(pair.similarity * 100).toFixed(1)}% |`
      );
    }
  }

  lines.push(
    "",
    "---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a> — repo health report</sub>"
  );

  return lines.join("\n");
}

/** Generate weekly digest markdown (used by CLI and scheduled digests). */
export function generateWeeklyDigest(opts: DigestOptions): string {
  const { repo, db } = opts;
  const d = getWeeklyDigestData(db, repo);
  const r = getRepoReport(db, repo);
  const repoUrl = opts.repoUrl ?? `https://github.com/${repo}`;

  const lines: string[] = [
    `## 🛡️ PRGuard — Weekly Digest`,
    "",
    `**Repository:** [${repo}](${repoUrl})`,
    `**Period:** Last 7 days`,
    `**Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "### 📊 This Week's Activity",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| New items tracked | ${d.newItems7d.length} |`,
    `| Duplicates found | ${d.duplicatesFound7d} |`,
    `| Reviews completed | ${d.reviewsCompleted7d} |`,
    `| Avg quality score | ${qualityEmoji(d.avgQuality7d)} ${d.avgQuality7d.toFixed(1)}/10 |`,
    `| Total events | ${d.eventCount7d} |`,
    "",
    "### ✅ Verdicts This Week",
    "",
    `| Verdict | Count |`,
    `|---------|-------|`,
    `| ✅ Approve | ${d.verdicts7d.approve} |`,
    `| 👀 Review | ${d.verdicts7d.review} |`,
    `| ❌ Reject | ${d.verdicts7d.reject} |`,
  ];

  if (d.newItems7d.length > 0) {
    lines.push(
      "",
      "### 📝 New Items",
      "",
      `| # | Type | Title |`,
      `|---|------|-------|`,
    );
    for (const item of d.newItems7d.slice(0, 15)) {
      const icon = item.type === "pr" ? "🔀" : "🐛";
      lines.push(`| [#${item.number}](${repoUrl}/issues/${item.number}) | ${icon} ${item.type} | ${item.title} |`);
    }
    if (d.newItems7d.length > 15) {
      lines.push(`| ... | | +${d.newItems7d.length - 15} more |`);
    }
  }

  // Recommendations
  const recs: string[] = [];
  if (r.duplicateRate > 0.2) {
    recs.push("⚠️ **High duplicate rate** — consider consolidating related issues before they pile up.");
  }
  if (r.avgQuality < 5) {
    recs.push("⚠️ **Low average quality** — review contribution guidelines and PR templates.");
  }
  if (d.newItems7d.length === 0) {
    recs.push("ℹ️ **No new activity** this week. Repository may be in maintenance mode.");
  }
  if (r.verdictCounts.reject > r.verdictCounts.approve) {
    recs.push("⚠️ **More rejections than approvals** — check if contribution standards are clearly documented.");
  }

  if (recs.length > 0) {
    lines.push("", "### 💡 Recommendations", "");
    for (const rec of recs) {
      lines.push(`- ${rec}`);
    }
  }

  lines.push(
    "",
    "---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a> — weekly digest</sub>"
  );

  return lines.join("\n");
}
