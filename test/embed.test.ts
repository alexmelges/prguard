import { describe, expect, it } from "vitest";
import { buildEmbeddingInput } from "../src/embed.js";

describe("buildEmbeddingInput", () => {
  it("concatenates title, body, and diff", () => {
    const input = buildEmbeddingInput("Fix bug", "Description", "diff patch");
    expect(input).toContain("Fix bug");
    expect(input).toContain("Description");
    expect(input).toContain("diff patch");
  });

  it("handles empty fields", () => {
    const input = buildEmbeddingInput("Title", "", "");
    expect(input).toBe("Title");
  });

  it("truncates diff to 2000 chars", () => {
    const longDiff = "x".repeat(3000);
    const input = buildEmbeddingInput("T", "B", longDiff);
    expect(input.length).toBeLessThan(2100);
  });
});
