import { describe, expect, it, beforeEach } from "vitest";
import { inc, get, resetMetrics, toPrometheus } from "../src/metrics.js";

describe("metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("increments counters", () => {
    inc("prs_analyzed_total");
    inc("prs_analyzed_total");
    inc("openai_calls_total", 3);

    expect(get("prs_analyzed_total")).toBe(2);
    expect(get("openai_calls_total")).toBe(3);
  });

  it("resets all counters", () => {
    inc("prs_analyzed_total", 5);
    inc("errors_total", 2);
    resetMetrics();

    expect(get("prs_analyzed_total")).toBe(0);
    expect(get("errors_total")).toBe(0);
  });

  it("outputs Prometheus text format", () => {
    inc("prs_analyzed_total", 10);
    inc("duplicates_found_total", 3);

    const output = toPrometheus();
    expect(output).toContain("# HELP prguard_prs_analyzed_total");
    expect(output).toContain("# TYPE prguard_prs_analyzed_total counter");
    expect(output).toContain("prguard_prs_analyzed_total 10");
    expect(output).toContain("prguard_duplicates_found_total 3");
    expect(output).toContain("prguard_errors_total 0");
  });
});
