/**
 * GitHub API helpers with rate-limit awareness.
 */

const GITHUB_RETRY_DELAYS = [1000, 5000, 30000];

/**
 * Wrap a GitHub API call with retry on 403 (secondary rate limit) and 5xx errors.
 * Respects `retry-after` header when present.
 */
export async function withGitHubRetry<T>(
  fn: () => Promise<T>,
  logger?: { warn: (msg: string) => void }
): Promise<T> {
  for (let attempt = 0; attempt <= GITHUB_RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      const isRetryable = status === 403 || status === 429 || (status !== undefined && status >= 500);

      if (!isRetryable || attempt === GITHUB_RETRY_DELAYS.length) {
        throw error;
      }

      // Check for retry-after header
      const headers = (error as { response?: { headers?: Record<string, string> } }).response?.headers;
      const retryAfter = headers?.["retry-after"];
      const delay = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : GITHUB_RETRY_DELAYS[attempt];

      logger?.warn(`GitHub API ${status} — retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("withGitHubRetry: exhausted retries");
}
