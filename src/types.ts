export type ItemType = "pr" | "issue";

export interface EmbeddingRecord {
  repo: string;
  type: ItemType;
  number: number;
  title: string;
  body: string;
  diffSummary: string;
  embedding: number[];
  active?: boolean;
}

export interface DuplicateMatch {
  type: ItemType;
  number: number;
  similarity: number;
  title: string;
}

export interface VisionEvaluation {
  score: number;
  aligned: boolean;
  reasoning: string;
  recommendation: "approve" | "review" | "reject";
}

export interface PRQualityInput {
  additions: number;
  deletions: number;
  changedFiles: number;
  hasTests: boolean;
  commitMessages: string[];
  contributorMergedPRs: number;
  contributorAccountAgeDays: number;
  ciPassing: boolean;
}

export interface PRQualityResult {
  score: number;
  recommendation: "approve" | "review" | "reject";
  reasons: string[];
}

export interface LabelConfig {
  duplicate: string;
  off_scope: string;
  on_track: string;
  needs_review: string;
  recommended: string;
}

export interface PRGuardConfig {
  vision: string;
  duplicate_threshold: number;
  vision_model: string;
  labels: LabelConfig;
  trusted_users: string[];
  quality_thresholds: {
    approve: number;
    reject: number;
  };
  max_diff_lines: number;
  dry_run: boolean;
  skip_bots: boolean;
  deep_review: boolean;
  review_model: string;
  max_diff_tokens: number;
  daily_limit: number;
  openai_api_key: string;
}

export interface CodeReview {
  summary: string;
  quality_score: number;
  correctness_concerns: string[];
  scope_assessment: string;
  verdict: "approve" | "review" | "reject";
  verdict_reasoning: string;
}

export interface AnalysisRecord {
  repo: string;
  type: ItemType;
  number: number;
  duplicates: DuplicateMatch[];
  visionScore: number | null;
  visionReasoning: string | null;
  recommendation: "approve" | "review" | "reject" | null;
  prQualityScore: number | null;
}
