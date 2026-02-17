import { describe, expect, it } from "vitest";
import { scorePRQuality } from "../src/quality.js";

describe("scorePRQuality", () => {
  it("scores a focused healthy PR highly", () => {
    const result = scorePRQuality({
      additions: 40,
      deletions: 10,
      changedFiles: 3,
      hasTests: true,
      commitMessages: ["fix(parser): handle edge case", "test: add regression"],
      contributorMergedPRs: 5,
      contributorAccountAgeDays: 400,
      ciPassing: true
    });

    expect(result.score).toBeGreaterThan(0.75);
    expect(result.recommendation).toBe("approve");
  });

  it("scores risky PR lower", () => {
    const result = scorePRQuality({
      additions: 900,
      deletions: 300,
      changedFiles: 28,
      hasTests: false,
      commitMessages: ["update", "wip"],
      contributorMergedPRs: 0,
      contributorAccountAgeDays: 2,
      ciPassing: false
    });

    expect(result.score).toBeLessThan(0.45);
    expect(result.recommendation).toBe("reject");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
