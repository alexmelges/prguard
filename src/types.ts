export type ItemType = "pr" | "issue";

export interface EmbeddingRecord {
  repo: string;
  type: ItemType;
  number: number;
  title: string;
  body: string;
  diffSummary: string;
  embedding: number[];
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
