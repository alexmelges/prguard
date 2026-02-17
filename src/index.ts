import type { Probot, ApplicationFunctionOptions } from "probot";
import type { Request, Response } from "express";
import { deactivateEmbedding, reactivateEmbedding, getDb } from "./db.js";
import { handleCommand } from "./handlers/command.js";
import { handleIssue } from "./handlers/issue.js";
import { handlePR } from "./handlers/pr.js";
import { inc, toPrometheus } from "./metrics.js";
import type { ItemType } from "./types.js";

/** Handle PR/issue closed events — deactivate embeddings. */
async function handleClosed(app: Probot, context: { payload: any }, type: ItemType): Promise<void> {
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
  app.log.info({ repo: fullRepo, number, action: `${type}.closed` }, `Deactivated embedding for ${type} #${number}`);
}

/** Validate required environment and log config summary at startup. */
function validateStartup(app: Probot): void {
  const missing: string[] = [];
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    app.log.error({ missing }, `Missing required environment variables: ${missing.join(", ")}`);
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  // Verify DB is writable
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    app.log.info({ action: "startup" }, "Database connection verified");
  } catch (error) {
    app.log.error({ error, action: "startup" }, "Database is not writable");
    throw error;
  }

  app.log.info({
    action: "startup",
    databasePath: process.env.DATABASE_PATH ?? "./prguard.db",
    logLevel: process.env.LOG_LEVEL ?? "info",
    port: process.env.PORT ?? "3000",
  }, "PRGuard configuration summary");
}

export default (app: Probot, { getRouter }: ApplicationFunctionOptions): void => {
  validateStartup(app);
  app.log.info({ action: "startup" }, "PRGuard loaded 🛡️");

  // Health check and metrics endpoints
  if (getRouter) {
    const router = getRouter();
    router.get("/healthz", (_req: Request, res: Response) => {
      try {
        const db = getDb();
        db.prepare("SELECT 1").get();
        res.status(200).json({ status: "ok", db: "connected" });
      } catch {
        res.status(503).json({ status: "error", db: "disconnected" });
      }
    });

    router.get("/metrics", (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.status(200).send(toPrometheus());
    });
  }

  app.on(["pull_request.opened", "pull_request.edited"], async (context) => {
    try {
      await handlePR(app, context);
    } catch (error) {
      inc("errors_total");
      const repo = `${context.payload.repository.owner.login}/${context.payload.repository.name}`;
      const number = context.payload.pull_request.number;
      app.log.error({ error, repo, number, action: "pr.analyze" }, "PRGuard failed processing PR");
    }
  });

  app.on(["issues.opened", "issues.edited"], async (context) => {
    try {
      await handleIssue(app, context);
    } catch (error) {
      inc("errors_total");
      const repo = `${context.payload.repository.owner.login}/${context.payload.repository.name}`;
      const number = context.payload.issue.number;
      app.log.error({ error, repo, number, action: "issue.analyze" }, "PRGuard failed processing issue");
    }
  });

  app.on("pull_request.reopened", async (context) => {
    try {
      const payload = context.payload as {
        pull_request: { number: number };
        repository: { name: string; owner: { login: string } };
      };
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const number = payload.pull_request.number;
      const fullRepo = `${owner}/${repo}`;
      const db = getDb();

      const reactivated = reactivateEmbedding(db, fullRepo, "pr", number);
      if (reactivated) {
        app.log.info({ repo: fullRepo, number, action: "pr.reopened" }, `Reactivated embedding for PR #${number}`);
      } else {
        app.log.info({ repo: fullRepo, number, action: "pr.reopened" }, `No deactivated embedding found for PR #${number} — will re-analyze`);
      }

      // Re-run full analysis on reopen
      await handlePR(app, context);
    } catch (error) {
      inc("errors_total");
      app.log.error({ error, action: "pr.reopened" }, "PRGuard failed handling PR reopen");
    }
  });

  app.on("pull_request.closed", async (context) => {
    try {
      await handleClosed(app, context, "pr");
    } catch (error) {
      inc("errors_total");
      app.log.error({ error, action: "pr.closed" }, "PRGuard failed handling PR close");
    }
  });

  app.on("issues.closed", async (context) => {
    try {
      await handleClosed(app, context, "issue");
    } catch (error) {
      inc("errors_total");
      app.log.error({ error, action: "issue.closed" }, "PRGuard failed handling issue close");
    }
  });

  app.on("issue_comment.created", async (context) => {
    try {
      await handleCommand(app, context);
    } catch (error) {
      inc("errors_total");
      const repo = `${context.payload.repository.owner.login}/${context.payload.repository.name}`;
      const number = context.payload.issue.number;
      app.log.error({ error, repo, number, action: "command.error" }, "PRGuard failed processing command");
    }
  });
};
