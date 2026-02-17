import { describe, expect, it } from "vitest";
import { buildSummaryComment, buildDegradedComment, summaryMarker } from "../src/comment.js";

describe("comment snapshots", () => {
  it("renders no-duplicates issue comment", () => {
    const comment = buildSummaryComment({
      duplicates: [],
      vision: null,
      quality: null,
      bestPRNumber: null,
      review: null,
      crossComparison: null
    });

    expect(comment).toMatchInlineSnapshot(`
      "<!-- prguard:summary -->
      ## 🛡️ PRGuard Triage Summary

      ### 🔍 Duplicate Check
      ✨ No close duplicates found.

      ---
      <sub>🤖 <a href="https://github.com/apps/prguard">PRGuard</a> · automated triage</sub>
      "
    `);
  });

  it("renders PR with 3 duplicates", () => {
    const comment = buildSummaryComment({
      duplicates: [
        { type: "pr", number: 10, similarity: 0.95, title: "Fix parser bug v1" },
        { type: "pr", number: 12, similarity: 0.88, title: "Another parser fix" },
        { type: "issue", number: 5, similarity: 0.86, title: "Parser is broken" },
      ],
      vision: { score: 0.72, aligned: true, reasoning: "PR adds a parser fix, aligned with project goals", recommendation: "review" },
      quality: { score: 0.72, recommendation: "review", reasons: ["No test changes detected"] },
      bestPRNumber: 10,
      review: null,
      crossComparison: null
    });

    expect(comment).toContain(summaryMarker());
    expect(comment).toContain("| #10 | pr | 95% | Fix parser bug v1 |");
    expect(comment).toContain("| #12 | pr | 88% | Another parser fix |");
    expect(comment).toContain("| #5 | issue | 86% | Parser is broken |");
    expect(comment).toContain("🟡 72%"); // quality score
    expect(comment).toContain("👀 review"); // recommendation
    expect(comment).toContain("⚠️ No test changes detected");
    expect(comment).toContain("PR #10 appears to be the strongest implementation");
  });

  it("renders PR with 2 duplicates, 0.72 quality, vision aligned", () => {
    const comment = buildSummaryComment({
      duplicates: [
        { type: "pr", number: 23, similarity: 0.92, title: "Add user authentication" },
        { type: "issue", number: 15, similarity: 0.87, title: "Need login feature" },
      ],
      vision: { score: 0.72, aligned: true, reasoning: "Implements requested authentication feature", recommendation: "review" },
      quality: { score: 0.72, recommendation: "review", reasons: [] },
      bestPRNumber: 23,
      review: null,
      crossComparison: null
    });

    // Verify structure
    expect(comment).toContain("## 🛡️ PRGuard Triage Summary");
    expect(comment).toContain("### 🔍 Duplicate Check");
    expect(comment).toContain("### 🎯 Vision Alignment");
    expect(comment).toContain("### 📊 PR Quality");
    expect(comment).toContain("### 🏆 Recommendation");

    // Verify data
    expect(comment).toContain("92%");
    expect(comment).toContain("87%");
    expect(comment).toContain("✅ Yes"); // aligned
    expect(comment).toContain("🟡 72%"); // score in yellow range
    expect(comment).toContain("👀 review");
    expect(comment).toContain("PR #23 appears to be the strongest");
  });

  it("renders vision-failed scenario", () => {
    const comment = buildSummaryComment({
      duplicates: [],
      vision: { score: 0.5, aligned: true, reasoning: "Vision analysis unavailable (API error)", recommendation: "review" },
      quality: { score: 0.65, recommendation: "review", reasons: ["New contributor (0 merged PRs)"] },
      bestPRNumber: null,
      review: null,
      crossComparison: null
    });

    expect(comment).toContain("Vision analysis unavailable (API error)");
    expect(comment).toContain("🟡 50%");
    expect(comment).toContain("⚠️ New contributor");
    expect(comment).not.toContain("🏆 Recommendation"); // no best PR when no duplicates
  });

  it("renders high-quality PR with no issues", () => {
    const comment = buildSummaryComment({
      duplicates: [],
      vision: { score: 0.95, aligned: true, reasoning: "Excellent alignment with project goals", recommendation: "approve" },
      quality: { score: 0.9, recommendation: "approve", reasons: [] },
      bestPRNumber: null,
      review: null,
      crossComparison: null
    });

    expect(comment).toContain("🟢 95%"); // vision score green
    expect(comment).toContain("🟢 90%"); // quality score green
    expect(comment).toContain("✅ approve");
    expect(comment).toContain("✨ No close duplicates");
  });

  it("renders reject recommendation", () => {
    const comment = buildSummaryComment({
      duplicates: [],
      vision: { score: 0.2, aligned: false, reasoning: "Completely unrelated to project", recommendation: "reject" },
      quality: { score: 0.3, recommendation: "reject", reasons: ["No test changes detected", "CI is not passing", "Very large diff (>1000 lines)"] },
      bestPRNumber: null,
      review: null,
      crossComparison: null
    });

    expect(comment).toContain("🔴 20%");
    expect(comment).toContain("❌ No");
    expect(comment).toContain("⛔ reject");
    expect(comment).toContain("🔴 30%");
  });

  it("renders comment with code review", () => {
    const comment = buildSummaryComment({
      duplicates: [{ type: "pr", number: 10, similarity: 0.92, title: "Similar fix" }],
      vision: null,
      quality: { score: 0.8, recommendation: "approve", reasons: [] },
      bestPRNumber: 10,
      review: {
        summary: "This PR fixes the auth bug by adding token validation.",
        quality_score: 8,
        correctness_concerns: ["Missing null check on line 42"],
        scope_assessment: "Focused on auth module only",
        verdict: "approve",
        verdict_reasoning: "Clean implementation",
      },
      crossComparison: "| PR | Quality | Concerns | Verdict |\n|----|---------|----------|---------|",
    });

    expect(comment).toContain("### 📝 Code Review");
    expect(comment).toContain("fixes the auth bug");
    expect(comment).toContain("8/10");
    expect(comment).toContain("Missing null check");
    expect(comment).toContain("### ⚖️ Cross-PR Comparison");
  });

  it("renders degraded comment", () => {
    const comment = buildDegradedComment();

    expect(comment).toContain(summaryMarker());
    expect(comment).toContain("temporarily unavailable");
    expect(comment).toContain("needs-review");
    expect(comment).toContain("degraded");
  });
});
