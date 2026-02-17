import type { Probot, ApplicationFunctionOptions } from "probot";
import type { Request, Response } from "express";
import { deactivateEmbedding, reactivateEmbedding, getDb, getStats, getRecentActivity, getQualityDistribution, getRepoStats } from "./db.js";
import { renderDashboard } from "./dashboard.js";
import { handleCommand } from "./handlers/command.js";
import { handleIssue } from "./handlers/issue.js";
import { handlePR } from "./handlers/pr.js";
import { inc, toPrometheus } from "./metrics.js";
import type { ItemType } from "./types.js";

const startTime = Date.now();

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
    router.get("/", (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PRGuard — Automated PR &amp; Issue Triage</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 80px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.6; }
    h1 { font-size: 2.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #555; font-size: 1.1rem; margin-bottom: 2rem; }
    .features { list-style: none; padding: 0; }
    .features li { padding: 0.4rem 0; }
    .cta { display: inline-block; background: #238636; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 1.5rem; }
    .cta:hover { background: #2ea043; }
    .links { margin-top: 2rem; color: #555; }
    .links a { color: #0969da; text-decoration: none; }
    .links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>🛡️ PRGuard</h1>
  <p class="subtitle">Automated PR &amp; Issue triage for GitHub — duplicate detection, quality scoring, and vision alignment.</p>
  <ul class="features">
    <li>🔍 <strong>Duplicate Detection</strong> — Embeddings-based similarity search</li>
    <li>📊 <strong>PR Quality Scoring</strong> — Diff size, tests, commit hygiene, CI status</li>
    <li>🎯 <strong>Vision Alignment</strong> — LLM evaluation against your project goals</li>
    <li>📝 <strong>Deep Code Review</strong> — AI-powered review with cross-PR comparison</li>
    <li>🏷️ <strong>Auto-labeling</strong> — duplicate, off-scope, on-track, recommended</li>
    <li>⚡ <strong>Rate Limiting &amp; BYOK</strong> — Per-installation budgets, bring your own key</li>
  </ul>
  <a class="cta" href="https://github.com/apps/prguard">Install on GitHub →</a>
  <div class="links">
    <p><a href="/healthz">Health Check</a> · <a href="/metrics">Metrics</a> · <a href="https://github.com/your-org/prguard">Source Code</a></p>
  </div>
</body>
</html>`);
    });

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

    router.get("/dashboard", (_req: Request, res: Response) => {
      try {
        const db = getDb();
        const stats = getStats(db);
        const recent = getRecentActivity(db);
        const dist = getQualityDistribution(db);
        const repos = getRepoStats(db);
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(renderDashboard(stats, recent, dist, repos, uptimeSeconds));
      } catch {
        res.status(503).send("Dashboard unavailable");
      }
    });

    router.get("/api/stats", (_req: Request, res: Response) => {
      try {
        const db = getDb();
        res.status(200).json({
          stats: getStats(db),
          recent_activity: getRecentActivity(db),
          quality_distribution: getQualityDistribution(db),
          repo_stats: getRepoStats(db),
        });
      } catch {
        res.status(503).json({ error: "Stats unavailable" });
      }
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

      inc("reopens_total");
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

  app.on("issues.reopened", async (context) => {
    try {
      const payload = context.payload as {
        issue: { number: number; pull_request?: unknown };
        repository: { name: string; owner: { login: string } };
      };
      if (payload.issue.pull_request) return;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const number = payload.issue.number;
      const fullRepo = `${owner}/${repo}`;
      const db = getDb();

      const reactivated = reactivateEmbedding(db, fullRepo, "issue", number);
      if (reactivated) {
        app.log.info({ repo: fullRepo, number, action: "issue.reopened" }, `Reactivated embedding for issue #${number}`);
      } else {
        app.log.info({ repo: fullRepo, number, action: "issue.reopened" }, `No deactivated embedding found for issue #${number} — will re-analyze`);
      }

      inc("reopens_total");
      // Re-run full analysis on reopen
      await handleIssue(app, context);
    } catch (error) {
      inc("errors_total");
      app.log.error({ error, action: "issue.reopened" }, "PRGuard failed handling issue reopen");
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
