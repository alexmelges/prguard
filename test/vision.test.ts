import { describe, expect, it } from "vitest";
import { buildVisionPrompt, normalizeVisionEvaluation } from "../src/vision.js";

describe("buildVisionPrompt", () => {
  it("includes vision and PR fields", () => {
    const prompt = buildVisionPrompt({
      vision: "Only bug fixes",
      title: "Add feature",
      body: "body",
      diffSummary: "diff"
    });

    expect(prompt).toContain("Only bug fixes");
    expect(prompt).toContain("Add feature");
    expect(prompt).toContain("diff");
  });
});

describe("normalizeVisionEvaluation", () => {
  it("clamps score and infers fields", () => {
    const result = normalizeVisionEvaluation({ score: 2, reasoning: "ok" });
    expect(result.score).toBe(1);
    expect(result.aligned).toBe(true);
    expect(result.recommendation).toBe("approve");
  });

  it("fills fallback values", () => {
    const result = normalizeVisionEvaluation({});
    expect(result.score).toBe(0);
    expect(result.aligned).toBe(false);
    expect(result.reasoning).toBe("No reasoning provided");
    expect(result.recommendation).toBe("reject");
  });
});
