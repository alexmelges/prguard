import { describe, expect, it } from "vitest";
import { clusterDuplicates, cosineSimilarity, findDuplicates } from "../src/dedup.js";
import type { EmbeddingRecord } from "../src/types.js";

describe("cosineSimilarity", () => {
  it("returns 1 for equal vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for empty or mismatched vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("calculates correct similarity for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("findDuplicates", () => {
  const current: EmbeddingRecord = {
    repo: "a/b",
    type: "pr",
    number: 10,
    title: "Fix parser",
    body: "desc",
    diffSummary: "patch",
    embedding: [1, 0]
  };

  it("finds similar items above threshold", () => {
    const existing: EmbeddingRecord[] = [
      { ...current, number: 11, embedding: [0.9, 0.1], title: "Fix parser bug" },
      { ...current, number: 12, embedding: [0, 1], title: "Add docs" },
      { ...current, number: 10 }
    ];

    const result = findDuplicates(current, existing, 0.85);
    expect(result).toHaveLength(1);
    expect(result[0]?.number).toBe(11);
  });

  it("returns empty array when no existing items", () => {
    const result = findDuplicates(current, [], 0.85);
    expect(result).toHaveLength(0);
  });

  it("filters out same item (same type and number)", () => {
    const existing: EmbeddingRecord[] = [
      { ...current, number: 10, embedding: [1, 0] }
    ];
    const result = findDuplicates(current, existing, 0.5);
    expect(result).toHaveLength(0);
  });

  it("includes different types with same number", () => {
    const existing: EmbeddingRecord[] = [
      { ...current, type: "issue", number: 10, embedding: [1, 0] }
    ];
    const result = findDuplicates(current, existing, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("issue");
  });
});

describe("clusterDuplicates", () => {
  it("clusters related items", () => {
    const items: EmbeddingRecord[] = [
      {
        repo: "a/b",
        type: "pr",
        number: 1,
        title: "A",
        body: "",
        diffSummary: "",
        embedding: [1, 0]
      },
      {
        repo: "a/b",
        type: "pr",
        number: 2,
        title: "B",
        body: "",
        diffSummary: "",
        embedding: [0.95, 0.05]
      },
      {
        repo: "a/b",
        type: "issue",
        number: 3,
        title: "C",
        body: "",
        diffSummary: "",
        embedding: [0, 1]
      }
    ];

    const clusters = clusterDuplicates(items, 0.9);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members.map((m) => m.number)).toEqual([1, 2]);
  });

  it("returns empty clusters for empty input", () => {
    const clusters = clusterDuplicates([], 0.9);
    expect(clusters).toHaveLength(0);
  });

  it("returns empty clusters for single item (no duplicates)", () => {
    const items: EmbeddingRecord[] = [
      {
        repo: "a/b",
        type: "pr",
        number: 1,
        title: "A",
        body: "",
        diffSummary: "",
        embedding: [1, 0]
      }
    ];
    const clusters = clusterDuplicates(items, 0.9);
    expect(clusters).toHaveLength(0);
  });

  it("clusters all items when they are all similar", () => {
    const items: EmbeddingRecord[] = [
      { repo: "a/b", type: "pr", number: 1, title: "A", body: "", diffSummary: "", embedding: [1, 0] },
      { repo: "a/b", type: "pr", number: 2, title: "B", body: "", diffSummary: "", embedding: [0.99, 0.01] },
      { repo: "a/b", type: "pr", number: 3, title: "C", body: "", diffSummary: "", embedding: [0.98, 0.02] }
    ];
    const clusters = clusterDuplicates(items, 0.9);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toHaveLength(3);
  });
});
