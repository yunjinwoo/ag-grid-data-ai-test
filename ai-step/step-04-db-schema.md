# Step 04 — DB 스키마 및 연결 모듈

## 목적
`revision_system_spec.md`에 정의된 3개 테이블을 SQLite로 구현하고, 싱글턴 패턴으로 DB 연결을 관리.

---

## 파일: `src/db/connection.ts`

```typescript
import initSqlJs, { Database } from 'sql.js';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();
  db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS data_pool ( ... );
    CREATE TABLE IF NOT EXISTS revision_master ( ... );
    CREATE TABLE IF NOT EXISTS revision_snapshot ( ... );
  `);

  return db;
}
```

---

## 스키마

### `data_pool` — 데이터 본체 저장소
```sql
CREATE TABLE IF NOT EXISTS data_pool (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id  TEXT    NOT NULL,
  hash_value TEXT    NOT NULL UNIQUE,  -- SHA-256, 중복 방지 키
  payload    TEXT    NOT NULL          -- JSON 직렬화 문자열
);
```

### `revision_master` — 리비전 메타 + 에이전트 상태 추적
```sql
CREATE TABLE IF NOT EXISTS revision_master (
  rev_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  memo             TEXT,
  created_by       TEXT    NOT NULL DEFAULT 'system',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  status           TEXT    NOT NULL DEFAULT 'PENDING',   -- PENDING|PROCESSING|COMPLETED|FAILED
  total_chunks     INTEGER NOT NULL DEFAULT 0,
  processed_chunks INTEGER NOT NULL DEFAULT 0,
  error_log        TEXT
);
```

> `status`, `total_chunks`, `processed_chunks`, `error_log` 컬럼은  
> `implementation_plan.md > Proposed Changes > 스키마 확장` 항목에 따라 추가됨.

### `revision_snapshot` — 매핑 테이블
```sql
CREATE TABLE IF NOT EXISTS revision_snapshot (
  rev_id  INTEGER NOT NULL,
  data_id INTEGER NOT NULL,
  PRIMARY KEY (rev_id, data_id),
  FOREIGN KEY (rev_id)  REFERENCES revision_master(rev_id),
  FOREIGN KEY (data_id) REFERENCES data_pool(id)
);
```

---

## AG Grid 연동 쿼리

특정 리비전의 전체 데이터를 단일 JOIN으로 조회:

```sql
SELECT p.*
FROM revision_snapshot s
JOIN data_pool p ON s.data_id = p.id
WHERE s.rev_id = :target_rev_id;
```
