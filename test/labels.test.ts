import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config.js";
import { applyLabels, ensureLabels } from "../src/labels.js";

function statusError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

describe("ensureLabels", () => {
  it("creates missing labels when getLabel returns 404", async () => {
    const getLabel = vi.fn(async ({ name }: { name: string }) => {
      if (name === defaultConfig.labels.duplicate) {
        throw statusError(404, "Not Found");
      }
      return {};
    });

    const createLabel = vi.fn(async () => ({}));

    await ensureLabels({
      octokit: {
        issues: {
          getLabel,
          createLabel,
          addLabels: vi.fn()
        }
      },
      owner: "acme",
      repo: "prguard",
      labels: defaultConfig.labels
    });

    expect(createLabel).toHaveBeenCalledTimes(1);
    expect(createLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "prguard",
      name: defaultConfig.labels.duplicate,
      color: "b60205",
      description: "Potential duplicate submission"
    });
  });

  it("does not create labels when getLabel fails with non-404", async () => {
    const getLabel = vi.fn(async () => {
      throw statusError(500, "GitHub unavailable");
    });

    const createLabel = vi.fn(async () => ({}));

    await ensureLabels({
      octokit: {
        issues: {
          getLabel,
          createLabel,
          addLabels: vi.fn()
        }
      },
      owner: "acme",
      repo: "prguard",
      labels: defaultConfig.labels
    });

    expect(createLabel).not.toHaveBeenCalled();
  });

  it("continues processing labels when createLabel fails", async () => {
    const getLabel = vi.fn(async () => {
      throw statusError(404, "Not Found");
    });

    const createLabel = vi
      .fn(async ({ name }: { name: string }) => {
        if (name === defaultConfig.labels.duplicate) {
          throw statusError(422, "Already exists");
        }
        return {};
      });

    await ensureLabels({
      octokit: {
        issues: {
          getLabel,
          createLabel,
          addLabels: vi.fn()
        }
      },
      owner: "acme",
      repo: "prguard",
      labels: {
        duplicate: defaultConfig.labels.duplicate,
        off_scope: defaultConfig.labels.off_scope,
        on_track: defaultConfig.labels.on_track,
        needs_review: defaultConfig.labels.needs_review,
        recommended: defaultConfig.labels.recommended
      }
    });

    expect(createLabel).toHaveBeenCalledTimes(5);
    expect(createLabel).toHaveBeenCalledWith(expect.objectContaining({
      name: defaultConfig.labels.off_scope,
      color: "d93f0b"
    }));
  });
});

describe("applyLabels", () => {
  it("returns early when there are no labels to apply", async () => {
    const addLabels = vi.fn(async () => ({}));

    await applyLabels({
      octokit: { issues: { addLabels } },
      owner: "acme",
      repo: "prguard",
      issueNumber: 12,
      labels: []
    });

    expect(addLabels).not.toHaveBeenCalled();
  });

  it("applies labels when provided", async () => {
    const addLabels = vi.fn(async () => ({}));

    await applyLabels({
      octokit: { issues: { addLabels } },
      owner: "acme",
      repo: "prguard",
      issueNumber: 12,
      labels: ["prguard:on-track", "prguard:needs-review"]
    });

    expect(addLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "prguard",
      issue_number: 12,
      labels: ["prguard:on-track", "prguard:needs-review"]
    });
  });

  it("swallows addLabels errors", async () => {
    const addLabels = vi.fn(async () => {
      throw statusError(403, "Forbidden");
    });

    await expect(applyLabels({
      octokit: { issues: { addLabels } },
      owner: "acme",
      repo: "prguard",
      issueNumber: 12,
      labels: ["prguard:on-track"]
    })).resolves.toBeUndefined();
  });
});
