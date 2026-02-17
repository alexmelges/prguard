import { describe, expect, it } from "vitest";
import { withGitHubRetry } from "../src/github.js";

describe("withGitHubRetry", () => {
  it("returns result on success", async () => {
    const result = await withGitHubRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("retries on 403 and succeeds", async () => {
    let calls = 0;
    const result = await withGitHubRetry(() => {
      calls++;
      if (calls < 2) {
        const err = new Error("rate limited") as Error & { status: number };
        err.status = 403;
        throw err;
      }
      return Promise.resolve("ok");
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("throws non-retryable errors immediately", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    await expect(withGitHubRetry(() => { throw err; })).rejects.toThrow("not found");
  });
});
