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
  trusted_users: [],
  quality_thresholds: {
    approve: 0.75,
    reject: 0.45
  },
  max_diff_lines: 10000,
  dry_run: false,
  skip_bots: true,
  deep_review: true,
  review_model: "gpt-4o-mini",
  max_diff_tokens: 8000,
  daily_limit: 50,
  openai_api_key: ""
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
    trusted_users: parsed.trusted_users ?? defaultConfig.trusted_users,
    quality_thresholds: {
      ...defaultConfig.quality_thresholds,
      ...(parsed.quality_thresholds ?? {})
    },
    max_diff_lines: parsed.max_diff_lines ?? defaultConfig.max_diff_lines,
    dry_run: parsed.dry_run ?? defaultConfig.dry_run,
    skip_bots: parsed.skip_bots ?? defaultConfig.skip_bots,
    deep_review: parsed.deep_review ?? defaultConfig.deep_review,
    review_model: parsed.review_model ?? defaultConfig.review_model,
    max_diff_tokens: parsed.max_diff_tokens ?? defaultConfig.max_diff_tokens,
    daily_limit: parsed.daily_limit ?? defaultConfig.daily_limit,
    openai_api_key: parsed.openai_api_key ?? defaultConfig.openai_api_key
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
