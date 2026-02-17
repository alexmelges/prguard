/** Named constants extracted from magic numbers throughout the codebase. */

// --- CLI ---
/** Max characters for diff summary in CLI output. */
export const CLI_MAX_DIFF_CHARS = 2000;
/** Default per_page for API list calls. */
export const DEFAULT_PAGE_SIZE = 50;

// --- Review ---
/** Max characters of diff to send for code review. */
export const MAX_REVIEW_DIFF_CHARS = 24000;
/** Max quality score (1-10 scale). */
export const MAX_QUALITY_SCORE = 10;

// --- Retry ---
/** Max retries for GitHub API calls. */
export const GITHUB_MAX_RETRIES = 10;
/** Retry backoff base in milliseconds. */
export const GITHUB_RETRY_BACKOFF_MS = 1000;

// --- Database ---
/** Default limit for recent activity queries. */
export const DB_RECENT_LIMIT = 20;

// --- Quality ---
/** Threshold for "large PR" in quality scoring (lines changed). */
export const LARGE_PR_THRESHOLD = 700;
/** Score for max quality (percentage). */
export const QUALITY_MAX_PERCENT = 90;
/** Min commits for commit message quality check. */
export const MIN_COMMITS_FOR_QUALITY = 12;

// --- Rate Limiting ---
/** Rate limit window for per-repo budget (calls per hour). */
export const RATE_LIMIT_WINDOW_CALLS = 10;

// --- Comment ---
/** Max duplicate entries to show in summary comment. */
export const MAX_DISPLAYED_DUPLICATES = 10;

// --- Time ---
/** Milliseconds in 24 hours. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- Dashboard colors ---
export const DASHBOARD_ACCENT_COLOR = '#238636';
export const DASHBOARD_BG_COLOR = '#334155';
