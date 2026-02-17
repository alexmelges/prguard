import type { DashboardStats, RecentActivityRow, QualityDistribution, RepoStatsRow, EventRow } from "./db.js";

const VERSION = process.env.npm_package_version ?? "0.1.0";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTime(iso: string): string {
  const d = new Date(iso + "Z");
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function badgeColor(rec: string | null): string {
  switch (rec) {
    case "approve": return "#22c55e";
    case "review": return "#eab308";
    case "reject": return "#ef4444";
    default: return "#6b7280";
  }
}

function actionColor(action: string): string {
  switch (action) {
    case "analyzed": return "#22c55e";
    case "reviewed": return "#22c55e";
    case "duplicate_found": return "#eab308";
    case "command": return "#3b82f6";
    case "error": return "#ef4444";
    case "skipped": return "#6b7280";
    case "rate_limited": return "#6b7280";
    case "closed": return "#6b7280";
    default: return "#6b7280";
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "analyzed": return "Analyzed";
    case "reviewed": return "Reviewed";
    case "duplicate_found": return "Duplicate";
    case "command": return "Command";
    case "error": return "Error";
    case "skipped": return "Skipped";
    case "rate_limited": return "Rate Limited";
    case "closed": return "Closed";
    default: return action;
  }
}

function qualityBarColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#3b82f6";
  if (score >= 4) return "#eab308";
  return "#ef4444";
}

export function renderDashboard(
  stats: DashboardStats,
  recentActivity: RecentActivityRow[],
  qualityDist: QualityDistribution,
  repoStats: RepoStatsRow[],
  uptimeSeconds: number,
  events: EventRow[] = [],
): string {
  const uptimeStr = formatUptime(uptimeSeconds);
  const totalQuality = qualityDist.excellent + qualityDist.good + qualityDist.needs_work + qualityDist.poor;
  const maxBucket = Math.max(qualityDist.excellent, qualityDist.good, qualityDist.needs_work, qualityDist.poor, 1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>PRGuard Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.5;
      min-height: 100vh;
    }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-bottom: 1px solid #1e293b;
      padding: 1.5rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .header-left { display: flex; align-items: center; gap: 0.75rem; }
    .logo { font-size: 2rem; }
    .header h1 { font-size: 1.5rem; font-weight: 700; color: #f8fafc; }
    .header-meta { color: #94a3b8; font-size: 0.85rem; }
    .header-meta span { margin-left: 1.5rem; }

    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem;
    }
    .card-label { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    .card-value { font-size: 2rem; font-weight: 700; color: #f8fafc; margin-top: 0.25rem; }
    .card-value.accent { color: #3b82f6; }

    .section { margin-bottom: 2rem; }
    .section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #f8fafc;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #1e293b;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th {
      text-align: left;
      padding: 0.6rem 0.75rem;
      color: #94a3b8;
      font-weight: 500;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #334155;
    }
    td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid #1e293b;
    }
    tr:hover { background: rgba(59, 130, 246, 0.05); }

    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      color: #fff;
    }
    .type-badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 500;
      background: #334155;
      color: #94a3b8;
    }

    .quality-bar-container {
      width: 80px;
      height: 8px;
      background: #334155;
      border-radius: 4px;
      overflow: hidden;
      display: inline-block;
      vertical-align: middle;
    }
    .quality-bar {
      height: 100%;
      border-radius: 4px;
    }
    .quality-score { margin-left: 0.5rem; font-size: 0.85rem; }

    .chart-section { margin-bottom: 2rem; }
    .chart-row {
      display: flex;
      align-items: center;
      margin-bottom: 0.75rem;
      gap: 0.75rem;
    }
    .chart-label {
      width: 100px;
      font-size: 0.85rem;
      color: #94a3b8;
      text-align: right;
      flex-shrink: 0;
    }
    .chart-bar-bg {
      flex: 1;
      height: 28px;
      background: #1e293b;
      border-radius: 6px;
      overflow: hidden;
    }
    .chart-bar {
      height: 100%;
      border-radius: 6px;
      display: flex;
      align-items: center;
      padding-left: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #fff;
      min-width: fit-content;
    }
    .chart-count {
      width: 50px;
      text-align: right;
      font-size: 0.85rem;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .empty { color: #64748b; font-style: italic; padding: 1rem 0; }

    @media (max-width: 640px) {
      .container { padding: 1rem; }
      .header { padding: 1rem; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      .quality-bar-container { width: 50px; }
      .chart-label { width: 70px; font-size: 0.75rem; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="logo">🛡️</span>
      <h1>PRGuard Dashboard</h1>
    </div>
    <div class="header-meta">
      v${escapeHtml(VERSION)}<span>Uptime: ${escapeHtml(uptimeStr)}</span>
    </div>
  </div>

  <div class="container">
    <div class="cards">
      <div class="card">
        <div class="card-label">Repos Monitored</div>
        <div class="card-value accent">${stats.repos}</div>
      </div>
      <div class="card">
        <div class="card-label">Items Analyzed</div>
        <div class="card-value">${stats.analyses + stats.reviews}</div>
      </div>
      <div class="card">
        <div class="card-label">Duplicates Found</div>
        <div class="card-value">${stats.duplicates_found}</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Quality Score</div>
        <div class="card-value accent">${stats.avg_quality > 0 ? stats.avg_quality.toFixed(1) : "—"}</div>
      </div>
      <div class="card">
        <div class="card-label">Events Today</div>
        <div class="card-value">${events.length}</div>
      </div>
    </div>

    <div class="section">
      <h2>Event Log</h2>
      ${events.length === 0 ? '<p class="empty">No events yet.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Repo</th>
            <th>#</th>
            <th>Event</th>
            <th>Action</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          ${events.map(row => `
          <tr>
            <td>${escapeHtml(formatTime(row.created_at))}</td>
            <td>${escapeHtml(row.repo)}</td>
            <td>${row.number ?? "—"}</td>
            <td><span class="type-badge">${escapeHtml(row.event_type)}</span></td>
            <td><span class="badge" style="background:${actionColor(row.action)}">${escapeHtml(actionLabel(row.action))}</span></td>
            <td>${row.detail ? escapeHtml(row.detail).slice(0, 80) : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>`}
    </div>

    <div class="section chart-section">
      <h2>Quality Distribution</h2>
      ${totalQuality === 0 ? '<p class="empty">No quality data yet.</p>' : `
      <div class="chart-row">
        <div class="chart-label">Excellent (8–10)</div>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${(qualityDist.excellent / maxBucket) * 100}%;background:#22c55e">${qualityDist.excellent}</div></div>
        <div class="chart-count">${qualityDist.excellent}</div>
      </div>
      <div class="chart-row">
        <div class="chart-label">Good (6–8)</div>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${(qualityDist.good / maxBucket) * 100}%;background:#3b82f6">${qualityDist.good}</div></div>
        <div class="chart-count">${qualityDist.good}</div>
      </div>
      <div class="chart-row">
        <div class="chart-label">Needs Work (4–6)</div>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${(qualityDist.needs_work / maxBucket) * 100}%;background:#eab308">${qualityDist.needs_work}</div></div>
        <div class="chart-count">${qualityDist.needs_work}</div>
      </div>
      <div class="chart-row">
        <div class="chart-label">Poor (0–4)</div>
        <div class="chart-bar-bg"><div class="chart-bar" style="width:${(qualityDist.poor / maxBucket) * 100}%;background:#ef4444">${qualityDist.poor}</div></div>
        <div class="chart-count">${qualityDist.poor}</div>
      </div>`}
    </div>

    <div class="section">
      <h2>Per-Repo Breakdown</h2>
      ${repoStats.length === 0 ? '<p class="empty">No repos tracked yet.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Embeddings</th>
            <th>Analyses</th>
            <th>Reviews</th>
            <th>Duplicates</th>
          </tr>
        </thead>
        <tbody>
          ${repoStats.map(row => `
          <tr>
            <td>${escapeHtml(row.repo)}</td>
            <td>${row.embeddings}</td>
            <td>${row.analyses}</td>
            <td>${row.reviews}</td>
            <td>${row.duplicates}</td>
          </tr>`).join("")}
        </tbody>
      </table>`}
    </div>
  </div>
</body>
</html>`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
