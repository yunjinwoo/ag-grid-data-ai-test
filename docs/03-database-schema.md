# 03. 데이터베이스 스키마

`src/db/connection.ts`의 `createSchema()`에 정의되어 있다. sql.js(WASM SQLite)를 사용하며,
메모리상의 DB를 `saveDb()` 호출 시 `revision.db` 파일로 내보낸다(export).

## ERD 개요

```
data_pool ──┐
            │ 1:N (data_id로 참조됨)
            ▼
revision_snapshot ──── N:1 ──── revision_master
 (rev_id, data_id)               (rev_id PK)
```

## 테이블 정의

### `data_pool` — 데이터 본체 저장소

```sql
CREATE TABLE data_pool (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id  TEXT    NOT NULL,
  hash_value TEXT    NOT NULL UNIQUE,
  payload    TEXT    NOT NULL   -- JSON 문자열
);
```

- 모든 리비전에 걸쳐 **공유**되는 실제 데이터 저장소. 동일 `hash_value`는 중복 저장하지 않는다 (Append-only).
- `master_id`: 비즈니스 키 (예: `PROD-000123`). 같은 `master_id`라도 값이 바뀌면 새 행(새 `hash_value`)이 생긴다.
- `hash_value`: `SHA-256(master_id + ':' + JSON.stringify(payload))`. UNIQUE 제약으로 `INSERT OR IGNORE` 시 멱등성 보장.
- `payload`: 실제 필드(JSON) — 현재 상품 데이터는 `{ name, price, stock, category }` 구조.

### `revision_master` — 리비전 메타데이터

```sql
CREATE TABLE revision_master (
  rev_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  memo             TEXT,
  created_by       TEXT    NOT NULL DEFAULT 'system',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  status           TEXT    NOT NULL DEFAULT 'PENDING',   -- PENDING | PROCESSING | COMPLETED | FAILED
  total_chunks     INTEGER NOT NULL DEFAULT 0,
  processed_chunks INTEGER NOT NULL DEFAULT 0,
  new_count        INTEGER NOT NULL DEFAULT 0,
  inherited_count  INTEGER NOT NULL DEFAULT 0,
  error_log        TEXT
);
```

- `status`는 파이프라인 진행 상황을 나타낸다. `CoordinatorAgent`가 `PENDING → PROCESSING`,
  `ValidationAgent`의 결과에 따라 `→ COMPLETED` 또는 `→ FAILED`로 전이시킨다.
- `total_chunks` / `processed_chunks`: `WorkerAgent.processTask()`가 청크 하나를 끝낼 때마다
  `processed_chunks + 1`로 증가 — 진행률 추적용 (현재 UI에서 실시간 표시는 하지 않음).
- `new_count` / `inherited_count`: 파이프라인 종료 후 `UPDATE`로 기록 — 리비전 목록 화면에서 "신규 N / 상속 M" 표시에 사용.

### `revision_snapshot` — 리비전-데이터 매핑 (N:N)

```sql
CREATE TABLE revision_snapshot (
  rev_id  INTEGER NOT NULL,
  data_id INTEGER NOT NULL,
  PRIMARY KEY (rev_id, data_id),
  FOREIGN KEY (rev_id)  REFERENCES revision_master(rev_id),
  FOREIGN KEY (data_id) REFERENCES data_pool(id)
);
```

- 복합 PK `(rev_id, data_id)`로 중복 매핑을 방지 — 상속 시 `INSERT OR IGNORE`와 결합해 멱등적으로 동작.
- 이 테이블 하나로 "어떤 리비전이 어떤 데이터를 포함하는가"가 전부 결정된다.
  데이터 자체는 절대 복사되지 않는다.

## 핵심 쿼리 패턴

### 특정 리비전의 전체 데이터 조회 (AG Grid 연동)

```sql
SELECT p.id, p.master_id, p.payload
FROM revision_snapshot s
JOIN data_pool p ON s.data_id = p.id
WHERE s.rev_id = :target_rev_id
ORDER BY p.master_id
LIMIT :limit OFFSET :offset;   -- 서버사이드 페이지네이션 (ai-step/step-18)
```

### 리비전 스냅샷 건수

```sql
SELECT COUNT(*) FROM revision_snapshot WHERE rev_id = ?;
```

### 고아 `data_pool` 행 정리 (`POST /api/db/cleanup`)

```sql
DELETE FROM data_pool
WHERE id NOT IN (SELECT DISTINCT data_id FROM revision_snapshot);
```

> **절대 규칙**: `data_pool`을 직접 삭제하지 않는다. 다른 리비전이 같은 `data_id`를 참조할 수 있기
> 때문에, 삭제는 반드시 위 "NOT IN" 안전 쿼리를 통해서만 수행한다 (`POST /api/db/cleanup` 경유).

## 트랜잭션 규칙

대량 INSERT/UPDATE는 반드시 `BEGIN`/`COMMIT`으로 감싼다. sql.js는 WASM 메모리 위에서 동작하므로
트랜잭션 없이 대량 쓰기를 하면 메모리 오버플로우로 크래시가 발생한다 (자세한 원인과 해결책은
[06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md) 참고).

```typescript
db.run('BEGIN');
try {
  for (const row of rows) { /* INSERT */ }
  db.run('COMMIT');
} catch (e) {
  db.run('ROLLBACK');
  throw e;
}
```

## 영속성

- `getDb()`: `revision.db` 파일이 있으면 로드, 없으면 `createSchema()`로 새로 생성.
- `saveDb()`: 인메모리 DB를 `db.export()`로 바이트로 내보낸 뒤 `fs.writeFileSync`로 파일에 기록.
  **모든 쓰기 작업(파이프라인, 삭제, cleanup) 완료 후 반드시 호출해야** 실제 파일에 반영된다.

다음: [04-api-reference.md](04-api-reference.md) — REST API 전체 레퍼런스.
