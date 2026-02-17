import type { LabelConfig } from "./types.js";

export async function ensureLabels(params: {
  octokit: {
    issues: {
      getLabel: (args: { owner: string; repo: string; name: string }) => Promise<unknown>;
      createLabel: (args: {
        owner: string;
        repo: string;
        name: string;
        color: string;
        description: string;
      }) => Promise<unknown>;
      addLabels: (args: {
        owner: string;
        repo: string;
        issue_number: number;
        labels: string[];
      }) => Promise<unknown>;
    };
  };
  owner: string;
  repo: string;
  labels: LabelConfig;
}): Promise<void> {
  try {
    const defaults: Record<keyof LabelConfig, { color: string; description: string }> = {
      duplicate: { color: "b60205", description: "Potential duplicate submission" },
      off_scope: { color: "d93f0b", description: "Likely outside project vision" },
      on_track: { color: "0e8a16", description: "Aligned with project vision" },
      needs_review: { color: "fbca04", description: "Maintainer review needed" },
      recommended: { color: "1d76db", description: "Strongest implementation among duplicates" }
    };

    for (const [key, name] of Object.entries(params.labels) as Array<[keyof LabelConfig, string]>) {
      try {
        await params.octokit.issues.getLabel({
          owner: params.owner,
          repo: params.repo,
          name
        });
      } catch {
        await params.octokit.issues.createLabel({
          owner: params.owner,
          repo: params.repo,
          name,
          color: defaults[key].color,
          description: defaults[key].description
        });
      }
    }
  } catch {
    // Label operations are non-critical — continue gracefully
  }
}

export async function applyLabels(params: {
  octokit: {
    issues: {
      addLabels: (args: {
        owner: string;
        repo: string;
        issue_number: number;
        labels: string[];
      }) => Promise<unknown>;
    };
  };
  owner: string;
  repo: string;
  issueNumber: number;
  labels: string[];
}): Promise<void> {
  if (params.labels.length === 0) {
    return;
  }

  try {
    await params.octokit.issues.addLabels({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      labels: params.labels
    });
  } catch {
    // Label application is non-critical — continue gracefully
  }
}
