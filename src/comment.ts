import type { DuplicateMatch, PRQualityResult, VisionEvaluation } from "./types.js";

const MARKER = "<!-- prguard:summary -->";

export function summaryMarker(): string {
  return MARKER;
}

function qualityEmoji(score: number): string {
  if (score >= 0.75) return "🟢";
  if (score >= 0.45) return "🟡";
  return "🔴";
}

function recommendationEmoji(rec: string): string {
  if (rec === "approve") return "✅";
  if (rec === "review") return "👀";
  return "⛔";
}

function formatDuplicateSection(duplicates: DuplicateMatch[]): string {
  if (duplicates.length === 0) {
    return "✨ No close duplicates found.";
  }

  const lines = duplicates.map(
    (item) =>
      `| #${item.number} | ${item.type} | ${(item.similarity * 100).toFixed(0)}% | ${item.title} |`
  );

  return [
    "| # | Type | Similarity | Title |",
    "|---|------|-----------|-------|",
    ...lines
  ].join("\n");
}

export function buildSummaryComment(params: {
  duplicates: DuplicateMatch[];
  vision: VisionEvaluation | null;
  quality: PRQualityResult | null;
  bestPRNumber: number | null;
}): string {
  const parts = [
    MARKER,
    "## 🛡️ PRGuard Triage Summary\n",
    "### 🔍 Duplicate Check",
    formatDuplicateSection(params.duplicates)
  ];

  if (params.vision) {
    const vEmoji = params.vision.aligned ? "✅" : "❌";
    parts.push(
      "\n### 🎯 Vision Alignment",
      `- **Score:** ${qualityEmoji(params.vision.score)} ${(params.vision.score * 100).toFixed(0)}%`,
      `- **Aligned:** ${vEmoji} ${params.vision.aligned ? "Yes" : "No"}`,
      `- **Assessment:** ${params.vision.reasoning}`,
      `- **Recommendation:** ${recommendationEmoji(params.vision.recommendation)} ${params.vision.recommendation}`
    );
  }

  if (params.quality) {
    parts.push(
      "\n### 📊 PR Quality",
      `- **Score:** ${qualityEmoji(params.quality.score)} ${(params.quality.score * 100).toFixed(0)}%`,
      `- **Recommendation:** ${recommendationEmoji(params.quality.recommendation)} ${params.quality.recommendation}`
    );

    if (params.quality.reasons.length > 0) {
      parts.push(`- **Notes:** ${params.quality.reasons.map((r) => `⚠️ ${r}`).join(", ")}`);
    }
  }

  if (params.bestPRNumber) {
    parts.push(
      "\n### 🏆 Recommendation",
      `PR #${params.bestPRNumber} appears to be the strongest implementation among related submissions.`
    );
  }

  parts.push(
    "\n---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a> · automated triage</sub>"
  );

  return `${parts.join("\n")}\n`;
}

/** Comment posted when OpenAI is unavailable (graceful degradation). */
export function buildDegradedComment(): string {
  return [
    MARKER,
    "## 🛡️ PRGuard Triage Summary\n",
    "⚠️ **Automated analysis is temporarily unavailable.** The AI service could not be reached.",
    "",
    "A maintainer will need to review this manually. PRGuard has applied the `needs-review` label.",
    "",
    "---",
    "<sub>🤖 <a href=\"https://github.com/apps/prguard\">PRGuard</a> · automated triage (degraded)</sub>"
  ].join("\n") + "\n";
}
