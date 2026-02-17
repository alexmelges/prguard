import type { PRQualityInput, PRQualityResult } from "./types.js";

const MAX_LINES_FOR_FULL_SCORE = 350;

function scoreDiffQuality(additions: number, deletions: number, changedFiles: number): number {
  const totalLines = additions + deletions;
  const lineScore = Math.max(0, 1 - totalLines / MAX_LINES_FOR_FULL_SCORE);
  const fileScore = changedFiles <= 8 ? 1 : Math.max(0, 1 - (changedFiles - 8) / 20);
  return 0.6 * lineScore + 0.4 * fileScore;
}

function scoreCommitHygiene(messages: string[]): number {
  if (messages.length === 0) {
    return 0.2;
  }

  const badPatterns = [/wip/i, /fix\s*stuff/i, /^update$/i, /^changes$/i];
  const goodCount = messages.filter((msg) => {
    const trimmed = msg.trim();
    if (trimmed.length < 8 || trimmed.length > 90) {
      return false;
    }
    return !badPatterns.some((pattern) => pattern.test(trimmed));
  }).length;

  return goodCount / messages.length;
}

function scoreContributorHistory(mergedPRs: number, accountAgeDays: number): number {
  const history = Math.min(1, mergedPRs / 8);
  const age = Math.min(1, accountAgeDays / 365);
  return 0.7 * history + 0.3 * age;
}

export function scorePRQuality(input: PRQualityInput): PRQualityResult {
  const diffQuality = scoreDiffQuality(input.additions, input.deletions, input.changedFiles);
  const testScore = input.hasTests ? 1 : 0.3;
  const commitScore = scoreCommitHygiene(input.commitMessages);
  const contributorScore = scoreContributorHistory(
    input.contributorMergedPRs,
    input.contributorAccountAgeDays
  );
  const ciScore = input.ciPassing ? 1 : 0;

  const score =
    0.3 * diffQuality +
    0.2 * testScore +
    0.15 * commitScore +
    0.15 * contributorScore +
    0.2 * ciScore;

  const reasons: string[] = [];
  if (!input.hasTests) {
    reasons.push("No test changes detected");
  }
  if (!input.ciPassing) {
    reasons.push("CI is not passing");
  }
  if (input.changedFiles > 12 || input.additions + input.deletions > 700) {
    reasons.push("Diff is broad and may need scoping");
  }

  const recommendation = score >= 0.75 ? "approve" : score >= 0.45 ? "review" : "reject";

  return {
    score,
    recommendation,
    reasons
  };
}
