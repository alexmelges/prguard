import { describe, expect, it } from "vitest";
import { parseConfig, defaultConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("returns defaults for empty yaml", () => {
    const config = parseConfig("");
    expect(config).toEqual(defaultConfig);
  });

  it("merges partial config", () => {
    const config = parseConfig(`
vision: "Only bug fixes"
dry_run: true
quality_thresholds:
  approve: 0.8
`);
    expect(config.vision).toBe("Only bug fixes");
    expect(config.dry_run).toBe(true);
    expect(config.quality_thresholds.approve).toBe(0.8);
    expect(config.quality_thresholds.reject).toBe(0.45); // default
    expect(config.skip_bots).toBe(true); // default
  });

  it("supports skip_bots", () => {
    const config = parseConfig("skip_bots: false");
    expect(config.skip_bots).toBe(false);
  });

  it("supports max_diff_lines", () => {
    const config = parseConfig("max_diff_lines: 5000");
    expect(config.max_diff_lines).toBe(5000);
  });
});
