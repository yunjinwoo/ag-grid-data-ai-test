# Step 17 — WASM 메모리 한계 해결

## 증상

300K+ 행 DB에서 신규 리비전 추가 시 크래시:

```
[Worker-1] chunk 13 완료 — 2,000건
RuntimeError: memory access out of bounds
    at wasm://wasm/0028444a:wasm-function[235]:0xee54
```

청크 수를 줄여도(10,000 → 2,000) 동일하게 발생.

---

## 원인 분석

### sql.js 동작 방식
```
revision.db 파일 (100MB+)
    ↓ 전체 로드
WASM 선형 메모리 (기본 ~16MB)
    ↑ 100MB 넣으려면 당연히 터짐
```

sql.js는 DB 파일 전체를 WASM 힙에 올려서 작동한다.  
300K 행 DB가 커질수록 힙이 꽉 차고, INSERT 작업의 임시 버퍼가 들어갈 자리가 없어진다.

### WASM 메모리 단위
```
1 page = 64KB
기본값  ≈  256 pages = 16MB   ← 300K 행 DB에는 턱없이 부족
```

---

## 해결 1: WASM 힙 크기 확장 (`src/db/connection.ts`)

```typescript
const SQL = await initSqlJs({
  wasmMemory: new WebAssembly.Memory({ initial: 2048, maximum: 16384 }),
} as any);
// initial: 2048 pages = 128MB (시작 시 확보)
// maximum: 16384 pages = 1GB  (필요 시 자동 확장 상한)
```

`as any` 이유: sql.js 타입 정의(`@types/sql.js`)에 `wasmMemory` 옵션이 누락되어 있음.  
실제 sql.js 런타임은 해당 옵션을 지원한다.

---

## 해결 2: `tsconfig.json` — `lib`에 `"DOM"` 추가

```json
"lib": ["ES2020", "DOM"]
```

`WebAssembly.Memory` 타입은 TypeScript `DOM` 라이브러리에 정의됨.  
Node.js 프로젝트이지만 타입 인식을 위해 DOM lib 추가. 런타임 동작에는 영향 없음.

---

## 해결 3: 상속 쿼리 배치 처리 (`src/agents/SnapshotAgent.ts`)

300K 행 `INSERT ... SELECT` 단일 쿼리 → 5,000행씩 반복

```typescript
// inheritUnchangedData / inheritExcluding 공통 패턴
const BATCH = 5_000;
let offset = 0;

while (true) {
  const rows = this.db.exec(
    `SELECT data_id FROM revision_snapshot WHERE rev_id = ? LIMIT ? OFFSET ?`,
    [prevRevId, BATCH, offset],
  );
  if (!rows.length || !rows[0].values.length) break;

  this.db.run('BEGIN');
  for (const [dataId] of rows[0].values) {
    this.db.run(`INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id) VALUES (?, ?)`, [revId, dataId]);
  }
  this.db.run('COMMIT');

  if (rows[0].values.length < BATCH) break;
  offset += BATCH;
}
```

단일 쿼리의 중간 결과셋이 WASM 힙을 한 번에 점유하던 문제를 해결.

---

## 해결 4: Worker 청크 크기 축소 (`src/agents/CoordinatorAgent.ts`)

```typescript
private readonly CHUNK_SIZE = 2_000;  // 이전: 10_000
```

각 트랜잭션이 점유하는 WASM 임시 메모리를 1/5로 축소.

---

## 적용 후 결과

| DB 크기 | 이전 | 이후 |
|---------|------|------|
| ~100K 행 | 정상 | 정상 |
| ~300K 행 | chunk 13에서 크래시 | 정상 완료 |
| ~500K+ 행 | — | 128MB 힙으로 처리 가능 |

---

## 메모리 계산 기준

| 항목 | 크기 |
|------|------|
| data_pool 행 1개 | ~200 bytes |
| 300K 행 data_pool | ~60MB |
| revision_snapshot (5개 리비전) | ~12MB |
| 작업 버퍼 여유 | ~56MB |
| **필요 최소 힙** | **~128MB** |

`initial: 2048 pages = 128MB`로 설정한 근거.
