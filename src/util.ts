import { summaryMarker } from "./comment.js";

/** Max OpenAI API calls per repo per hour. */
export const OPENAI_BUDGET_PER_HOUR = 60;

export interface Logger {
  info: (msgOrObj: string | Record<string, unknown>, msg?: string) => void;
  warn: (msgOrObj: string | Record<string, unknown>, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export function normalizeBody(body: string | null | undefined): string {
  return body ?? "";
}

export function isBot(login: string, userType?: string): boolean {
  if (userType === "Bot") return true;
  return login.endsWith("[bot]") || login === "dependabot" || login === "renovate";
}

export async function upsertSummaryComment(context: {
  octokit: any;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  dryRun: boolean;
  log: Logger;
}): Promise<void> {
  try {
    if (context.dryRun) {
      context.log.info(`[DRY RUN] Would post/update comment on #${context.issueNumber}`);
      return;
    }

    const comments = await context.octokit.issues.listComments({
      owner: context.owner,
      repo: context.repo,
      issue_number: context.issueNumber,
      per_page: 100
    });

    const marker = summaryMarker();
    const existing = comments.data.find((comment: { body?: string }) => comment.body?.includes(marker));

    if (existing) {
      await context.octokit.issues.updateComment({
        owner: context.owner,
        repo: context.repo,
        comment_id: existing.id,
        body: context.body
      });
      return;
    }

    await context.octokit.issues.createComment({
      owner: context.owner,
      repo: context.repo,
      issue_number: context.issueNumber,
      body: context.body
    });
  } catch (error) {
    context.log.warn(`Failed to upsert summary comment on #${context.issueNumber}: ${error}`);
  }
}
