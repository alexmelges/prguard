import type { Probot } from "probot";
import { deactivateEmbedding, getDb } from "./db.js";
import { handleIssue } from "./handlers/issue.js";
import { handlePR } from "./handlers/pr.js";
import type { ItemType } from "./types.js";

/** Handle PR/issue closed events — deactivate embeddings. */
async function handleClosed(app: Probot, context: { payload: any }, type: ItemType): Promise<void> {
  const log = app.log;
  const db = getDb();

  let owner: string, repo: string, number: number;

  if (type === "pr") {
    const payload = context.payload as {
      pull_request: { number: number };
      repository: { name: string; owner: { login: string } };
    };
    owner = payload.repository.owner.login;
    repo = payload.repository.name;
    number = payload.pull_request.number;
  } else {
    const payload = context.payload as {
      issue: { number: number; pull_request?: unknown };
      repository: { name: string; owner: { login: string } };
    };
    if (payload.issue.pull_request) return;
    owner = payload.repository.owner.login;
    repo = payload.repository.name;
    number = payload.issue.number;
  }

  const fullRepo = `${owner}/${repo}`;
  deactivateEmbedding(db, fullRepo, type, number);
  log.info(`Deactivated embedding for ${type} #${number} in ${fullRepo}`);
}

export default (app: Probot): void => {
  app.log.info("PRGuard loaded 🛡️");

  app.on(["pull_request.opened", "pull_request.edited"], async (context) => {
    try {
      await handlePR(app, context);
    } catch (error) {
      app.log.error({ error }, `PRGuard failed processing PR`);
    }
  });

  app.on(["issues.opened", "issues.edited"], async (context) => {
    try {
      await handleIssue(app, context);
    } catch (error) {
      app.log.error({ error }, `PRGuard failed processing issue`);
    }
  });

  app.on("pull_request.closed", async (context) => {
    try {
      await handleClosed(app, context, "pr");
    } catch (error) {
      app.log.error({ error }, `PRGuard failed handling PR close`);
    }
  });

  app.on("issues.closed", async (context) => {
    try {
      await handleClosed(app, context, "issue");
    } catch (error) {
      app.log.error({ error }, `PRGuard failed handling issue close`);
    }
  });
};
