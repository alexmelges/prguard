import type Database from "better-sqlite3";

const DEFAULT_DAILY_LIMIT = 50;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  used: number;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export function checkInstallationRateLimit(
  db: Database.Database,
  installationId: number,
  dailyLimit: number = DEFAULT_DAILY_LIMIT
): RateLimitResult {
  const date = todayUTC();

  const row = db
    .prepare("SELECT count FROM installation_rate_limits WHERE installation_id = ? AND date = ?")
    .get(installationId, date) as { count: number } | undefined;

  const used = row?.count ?? 0;
  const remaining = Math.max(0, dailyLimit - used);

  return {
    allowed: used < dailyLimit,
    remaining,
    used,
  };
}

export function incrementInstallationRateLimit(
  db: Database.Database,
  installationId: number
): void {
  const date = todayUTC();

  db.prepare(
    `INSERT INTO installation_rate_limits (installation_id, date, count)
     VALUES (?, ?, 1)
     ON CONFLICT(installation_id, date)
     DO UPDATE SET count = count + 1`
  ).run(installationId, date);
}
