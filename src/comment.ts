import type { DuplicateMatch, PRQualityResult, VisionEvaluation } from "./types.js";

const MARKER = "<!-- prguard:summary -->";

export function summaryMarker(): string {
  return MARKER;
}

function formatDuplicateSection(duplicates: DuplicateMatch[]): string {
  if (duplicates.length === 0) {
    return "- No close duplicates found.";
  }

  const lines = duplicates.map(
    (item) =>
      `- #${item.number} (${item.type}) similarity ${item.similarity.toFixed(2)}: ${item.title}`
  );

  return lines.join("\n");
}

export function buildSummaryComment(params: {
  duplicates: DuplicateMatch[];
  vision: VisionEvaluation | null;
  quality: PRQualityResult | null;
  bestPRNumber: number | null;
}): string {
  const parts = [MARKER, "## PRGuard Triage Summary", "### Duplicate Check", formatDuplicateSection(params.duplicates)];

  if (params.vision) {
    parts.push(
      "### Vision Alignment",
      `- Score: ${params.vision.score.toFixed(2)}`,
      `- Aligned: ${params.vision.aligned ? "yes" : "no"}`,
      `- Reasoning: ${params.vision.reasoning}`
    );
  }

  if (params.quality) {
    parts.push(
      "### PR Quality",
      `- Score: ${params.quality.score.toFixed(2)}`,
      `- Recommendation: ${params.quality.recommendation}`
    );

    if (params.quality.reasons.length > 0) {
      parts.push(`- Notes: ${params.quality.reasons.join("; ")}`);
    }
  }

  if (params.bestPRNumber) {
    parts.push("### Recommendation", `PR #${params.bestPRNumber} appears to be the strongest implementation.`);
  }

  return `${parts.join("\n\n")}\n`;
}
