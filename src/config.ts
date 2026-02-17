import { load } from "js-yaml";
import type { PRGuardConfig } from "./types.js";

export const defaultConfig: PRGuardConfig = {
  vision: "",
  duplicate_threshold: 0.85,
  vision_model: "gpt-4o-mini",
  labels: {
    duplicate: "prguard:duplicate",
    off_scope: "prguard:off-scope",
    on_track: "prguard:on-track",
    needs_review: "prguard:needs-review",
    recommended: "prguard:recommended"
  },
  trusted_users: []
};

export function parseConfig(yamlText: string): PRGuardConfig {
  const parsed = (load(yamlText) ?? {}) as Partial<PRGuardConfig>;

  return {
    vision: parsed.vision ?? defaultConfig.vision,
    duplicate_threshold: parsed.duplicate_threshold ?? defaultConfig.duplicate_threshold,
    vision_model: parsed.vision_model ?? defaultConfig.vision_model,
    labels: {
      ...defaultConfig.labels,
      ...(parsed.labels ?? {})
    },
    trusted_users: parsed.trusted_users ?? defaultConfig.trusted_users
  };
}

export async function loadRepoConfig(params: {
  octokit: {
    repos: {
      getContent: (args: {
        owner: string;
        repo: string;
        path: string;
      }) => Promise<{ data: { content?: string; encoding?: string } }>;
    };
  };
  owner: string;
  repo: string;
}): Promise<PRGuardConfig> {
  try {
    const response = await params.octokit.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: ".github/prguard.yml"
    });

    const content = response.data.content;
    const encoding = response.data.encoding;

    if (!content || encoding !== "base64") {
      return defaultConfig;
    }

    const yamlText = Buffer.from(content, "base64").toString("utf8");
    return parseConfig(yamlText);
  } catch {
    return defaultConfig;
  }
}
