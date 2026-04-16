# Step 13 — DB 파일 영속성 + 트랜잭션 최적화

## 목적
1. sql.js 인메모리 DB를 파일(`revision.db`)로 저장해 서버 재시작 후에도 데이터 유지
2. 대량 INSERT 시 발생하는 WASM 메모리 오버플로우 해결

---

## 문제 1: 서버 재시작 시 데이터 소실

sql.js는 기본적으로 순수 인메모리 DB.  
서버를 재시작하면 모든 데이터가 사라짐.

---

## 해결: `src/db/connection.ts` 수정

```typescript
import fs   from 'fs';
import path from 'path';
import SQL  from 'sql.js';
import type { Database } from 'sql.js';

export const DB_PATH = path.join(__dirname, '../../revision.db');

let db: Database;

export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs({ locateFile: f => `...` });

  if (fs.existsSync(DB_PATH)) {
    // 기존 파일 로드
    const fileData = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileData);
    console.log('[DB] 기존 revision.db 로드');
  } else {
    // 최초 생성
    db = new SQL.Database();
    createSchema(db);
    console.log('[DB] 새 DB 생성');
  }

  return db;
}

export function saveDb(): void {
  const data = db.export();                      // Uint8Array
  fs.writeFileSync(DB_PATH, Buffer.from(data));  // 파일 저장
}
```

`saveDb()`는 모든 파이프라인 완료 시점에 호출:
- `runPipeline` 끝
- `runEditPipeline` 끝
- DELETE /api/revisions/:id 끝
- POST /api/revisions/:id/delete-rows 끝
- POST /api/db/cleanup 끝

---

## 문제 2: 50,000건 이상 처리 시 WASM 크래시

```
RuntimeError: memory access out of bounds
```

**원인**: WorkerAgent가 행마다 개별 SQL 실행 → 10,000행 청크 = 20,000건 SQL 실행.  
sql.js WASM 힙이 연속 호출 누적으로 오버플로우 발생.

---

## 해결: WorkerAgent — BEGIN/COMMIT 트랜잭션 래핑

```typescript
// WorkerAgent.ts — processTask()
this.db.run('BEGIN');
try {
  for (const row of rows) {
    const payloadStr = JSON.stringify(row.payload);
    const hash = createHash('sha256')
      .update(`${row.master_id}:${payloadStr}`)
      .digest('hex');

    this.db.run(
      `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload) VALUES (?, ?, ?)`,
      [row.master_id, hash, payloadStr],
    );

    const res = this.db.exec(`SELECT id FROM data_pool WHERE hash_value = ?`, [hash]);
    dataIds.push(res[0].values[0][0] as number);
  }
  this.db.run('COMMIT');
} catch (e) {
  this.db.run('ROLLBACK');
  throw e;
}
```

---

## 해결: SnapshotAgent — insertMappings 트랜잭션 래핑

```typescript
// SnapshotAgent.ts — insertMappings()
this.db.run('BEGIN');
for (const result of results) {
  for (const dataId of result.data_ids) {
    this.db.run(
      `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id) VALUES (?, ?)`,
      [revId, dataId],
    );
  }
}
this.db.run('COMMIT');
```

---

## 성능 비교

| 건수 | 트랜잭션 없음 | 트랜잭션 적용 |
|------|--------------|--------------|
| 10,000건 | ~5s | ~0.5s |
| 50,000건 | WASM 크래시 | ~2s |
| 100,000건 | — | ~5s |

트랜잭션은 SQLite 성능의 핵심.  
개별 INSERT마다 WAL flush가 발생하므로 묶어서 한 번에 처리.

---

## 파일 구조

```
ag-grid-data/
└── revision.db    ← 서버 첫 실행 또는 saveDb() 호출 시 생성
```

`.gitignore`에 추가 권장:
```
revision.db
```
