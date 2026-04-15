import initSqlJs, { Database } from 'sql.js';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();
  db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS data_pool (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      master_id TEXT    NOT NULL,
      hash_value TEXT   NOT NULL UNIQUE,
      payload   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revision_master (
      rev_id           INTEGER PRIMARY KEY AUTOINCREMENT,
      memo             TEXT,
      created_by       TEXT    NOT NULL DEFAULT 'system',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      status           TEXT    NOT NULL DEFAULT 'PENDING',
      total_chunks     INTEGER NOT NULL DEFAULT 0,
      processed_chunks INTEGER NOT NULL DEFAULT 0,
      error_log        TEXT
    );

    CREATE TABLE IF NOT EXISTS revision_snapshot (
      rev_id  INTEGER NOT NULL,
      data_id INTEGER NOT NULL,
      PRIMARY KEY (rev_id, data_id),
      FOREIGN KEY (rev_id)  REFERENCES revision_master(rev_id),
      FOREIGN KEY (data_id) REFERENCES data_pool(id)
    );
  `);

  return db;
}
