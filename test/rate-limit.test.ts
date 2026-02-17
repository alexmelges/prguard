import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb } from "../src/db.js";
import { checkInstallationRateLimit, incrementInstallationRateLimit } from "../src/rate-limit.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = createDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("checkInstallationRateLimit", () => {
  it("allows when no usage recorded", () => {
    const result = checkInstallationRateLimit(db, 12345, 50);
    expect(result).toEqual({ allowed: true, remaining: 50, used: 0 });
  });

  it("allows when under limit", () => {
    for (let i = 0; i < 10; i++) {
      incrementInstallationRateLimit(db, 12345);
    }
    const result = checkInstallationRateLimit(db, 12345, 50);
    expect(result).toEqual({ allowed: true, remaining: 40, used: 10 });
  });

  it("denies when at limit", () => {
    for (let i = 0; i < 50; i++) {
      incrementInstallationRateLimit(db, 12345);
    }
    const result = checkInstallationRateLimit(db, 12345, 50);
    expect(result).toEqual({ allowed: false, remaining: 0, used: 50 });
  });

  it("denies when over limit", () => {
    for (let i = 0; i < 55; i++) {
      incrementInstallationRateLimit(db, 12345);
    }
    const result = checkInstallationRateLimit(db, 12345, 50);
    expect(result).toEqual({ allowed: false, remaining: 0, used: 55 });
  });

  it("tracks installations independently", () => {
    for (let i = 0; i < 5; i++) {
      incrementInstallationRateLimit(db, 111);
    }
    incrementInstallationRateLimit(db, 222);

    expect(checkInstallationRateLimit(db, 111, 50).used).toBe(5);
    expect(checkInstallationRateLimit(db, 222, 50).used).toBe(1);
    expect(checkInstallationRateLimit(db, 333, 50).used).toBe(0);
  });

  it("uses custom daily limit", () => {
    for (let i = 0; i < 3; i++) {
      incrementInstallationRateLimit(db, 12345);
    }
    const result = checkInstallationRateLimit(db, 12345, 3);
    expect(result).toEqual({ allowed: false, remaining: 0, used: 3 });
  });
});

describe("incrementInstallationRateLimit", () => {
  it("creates record on first call", () => {
    incrementInstallationRateLimit(db, 12345);
    const result = checkInstallationRateLimit(db, 12345, 50);
    expect(result.used).toBe(1);
  });

  it("increments on subsequent calls", () => {
    incrementInstallationRateLimit(db, 12345);
    incrementInstallationRateLimit(db, 12345);
    incrementInstallationRateLimit(db, 12345);
    const result = checkInstallationRateLimit(db, 12345, 50);
    expect(result.used).toBe(3);
  });
});
