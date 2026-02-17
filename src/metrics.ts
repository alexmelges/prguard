/** In-memory metrics counters for PRGuard observability. */

interface Counters {
  prs_analyzed_total: number;
  issues_analyzed_total: number;
  duplicates_found_total: number;
  openai_calls_total: number;
  errors_total: number;
  openai_degraded_total: number;
  commands_processed_total: number;
  reopens_total: number;
  rate_limited_total: number;
}

const counters: Counters = {
  prs_analyzed_total: 0,
  issues_analyzed_total: 0,
  duplicates_found_total: 0,
  openai_calls_total: 0,
  errors_total: 0,
  openai_degraded_total: 0,
  commands_processed_total: 0,
  reopens_total: 0,
  rate_limited_total: 0,
};

export function inc(key: keyof Counters, amount = 1): void {
  counters[key] += amount;
}

export function get(key: keyof Counters): number {
  return counters[key];
}

/** Reset all counters (for testing). */
export function resetMetrics(): void {
  for (const key of Object.keys(counters) as Array<keyof Counters>) {
    counters[key] = 0;
  }
}

/** Prometheus-compatible text format. */
export function toPrometheus(): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(counters)) {
    const name = `prguard_${key}`;
    lines.push(`# HELP ${name} PRGuard counter for ${key.replace(/_/g, " ")}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  }
  return lines.join("\n") + "\n";
}
