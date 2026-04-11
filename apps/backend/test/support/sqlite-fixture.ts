import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SEED_SQL = `
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  total_amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  refund_type TEXT,
  shipping_status TEXT NOT NULL,
  paid_at TEXT,
  merchant_id INTEGER NOT NULL
);
INSERT INTO orders (id, status, total_amount, payment_method, refund_type, shipping_status, paid_at, merchant_id) VALUES
  (1, 'paid', 129.90, 'alipay', NULL, 'shipped', '2026-03-01T08:00:00Z', 1001),
  (2, 'paid', 88.00, 'wechat', NULL, 'delivered', '2026-03-03T10:30:00Z', 1002),
  (3, 'pending', 56.50, 'card', NULL, 'pending', NULL, 1001),
  (4, 'refunded', 199.00, 'alipay', 'quality', 'returned', '2026-03-05T12:00:00Z', 1003),
  (5, 'paid', 49.90, 'wechat', NULL, 'in_transit', '2026-03-06T09:15:00Z', 1002),
  (6, 'cancelled', 35.00, 'card', NULL, 'cancelled', NULL, 1004),
  (7, 'paid', 320.00, 'bank', NULL, 'delivered', '2026-03-07T15:45:00Z', 1001),
  (8, 'refunded', 75.20, 'wechat', 'timeout', 'returned', '2026-03-08T11:20:00Z', 1002);
`;

export interface SqliteFixture {
  dbPath: string;
  cleanup: () => Promise<void>;
}

export async function createSeededSqliteFixture(prefix: string): Promise<SqliteFixture> {
  const tempDir = await mkdtemp(join(tmpdir(), `text2sql-${prefix}-`));
  const dbPath = join(tempDir, "text2sql.db");

  try {
    await execFileAsync("sqlite3", [dbPath, SEED_SQL]);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(
      `Failed to prepare sqlite fixture via sqlite3: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return {
    dbPath,
    cleanup: async () => {
      await rm(dbPath, { force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}
