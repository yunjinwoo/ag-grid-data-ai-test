import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

let db: Database | null = null;

// 프로젝트 루트의 revision.db 파일로 저장
export const DB_PATH = path.join(__dirname, '../../revision.db');

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    // 기존 파일이 있으면 로드
    const fileData = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileData);
    console.log(`[DB] 기존 DB 로드: ${DB_PATH}`);
  } else {
    // 없으면 새로 생성 후 스키마 적용
    db = new SQL.Database();
    console.log('[DB] 새 DB 생성');
    createSchema(db);
  }

  return db;
}

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS data_pool (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      master_id  TEXT    NOT NULL,
      hash_value TEXT    NOT NULL UNIQUE,
      payload    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revision_master (
      rev_id           INTEGER PRIMARY KEY AUTOINCREMENT,
      memo             TEXT,
      created_by       TEXT    NOT NULL DEFAULT 'system',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      status           TEXT    NOT NULL DEFAULT 'PENDING',
      total_chunks     INTEGER NOT NULL DEFAULT 0,
      processed_chunks INTEGER NOT NULL DEFAULT 0,
      new_count        INTEGER NOT NULL DEFAULT 0,
      inherited_count  INTEGER NOT NULL DEFAULT 0,
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
}

// 현재 인메모리 DB를 파일로 저장
export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log(`[DB] 저장 완료: ${DB_PATH}`);
}
