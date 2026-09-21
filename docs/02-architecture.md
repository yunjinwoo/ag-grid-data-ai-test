# 02. 아키텍처 — 멀티에이전트 파이프라인 & 리비전 상속 모델

## 에이전트 파이프라인

```
CoordinatorAgent  →  WorkerAgent (×3, 병렬)  →  SnapshotAgent  →  ValidationAgent
   리비전 생성         해시 계산 + upsert        스냅샷 매핑          건수 검증
```

각 에이전트는 `src/agents/`에 클래스로 구현되어 있고, `src/server.ts`의 파이프라인 함수(`runPipeline`,
`runEditPipeline`, `runCommitPipeline`)가 이들을 순서대로 호출해 오케스트레이션한다.

### A. CoordinatorAgent (`src/agents/CoordinatorAgent.ts`)

- `createRevision(data, memo)`:
  1. `revision_master`에 `status='PENDING'` 행 생성, `total_chunks` 계산
  2. `status='PROCESSING'`으로 업데이트
  3. 데이터를 `CHUNK_SIZE = 2_000`건 단위로 잘라 `TaskMessage`로 만들어 `taskQueue`에 push
- `markCompleted(revId)` / `markFailed(revId, errorLog)`: 검증 결과에 따라 최종 상태 반영

> `CHUNK_SIZE`는 원래 10,000이었으나 WASM 메모리 문제로 2,000으로 축소되었다.
> 배경은 [06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md#wasm-메모리-크래시) 참고.

### B. WorkerAgent (`src/agents/WorkerAgent.ts`) — 3개 병렬 실행

- `processTask(task)`:
  1. 각 행에 대해 `SHA-256(master_id:JSON(payload))` 해시 계산
  2. `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload)` — 동일 해시면 무시(멱등성)
  3. 실제 삽입된(또는 이미 존재하는) `data_pool.id`를 조회해 `data_ids` 배열에 수집
  4. `resultQueue`에 `ResultMessage` push
- 전체 처리는 `BEGIN`/`COMMIT` 트랜잭션으로 감싸 WASM 크래시를 방지한다 (절대 규칙 1).

`server.ts`에서 워커 3개에 태스크를 균등 분배하는 방식:

```typescript
const workers = Array.from({ length: 3 }, (_, i) => new WorkerAgent(i + 1, db, resultQueue));
const chunkSize = Math.max(1, Math.ceil(tasks.length / workers.length));
await Promise.all(
  workers.map((w, i) =>
    Promise.all(tasks.slice(i * chunkSize, (i + 1) * chunkSize).map(t => w.processTask(t))),
  ),
);
```

### C. SnapshotAgent (`src/agents/SnapshotAgent.ts`)

세 가지 메서드로 "리비전 ↔ 데이터" 매핑을 관리한다.

| 메서드 | 용도 |
|--------|------|
| `insertMappings(results)` | Worker 처리 결과(`data_ids`)를 현재 리비전에 매핑 |
| `inheritUnchangedData(revId, prevRevId)` | 이전 리비전의 모든 데이터를 현재 리비전으로 상속 (신규 리비전 생성 시) |
| `inheritExcluding(revId, fromRevId, excludedMasterIds)` | 이전 리비전에서 특정 `master_id`만 제외하고 상속 (수정/삭제 시) |

두 상속 메서드 모두 5,000건 배치(`LIMIT/OFFSET`)로 나눠 `BEGIN`/`COMMIT`을 반복 수행한다 —
대용량(30만 건)에서 단일 `INSERT ... SELECT`가 WASM 힙을 터뜨리는 문제를 배치 처리로 회피한 것이다.

### D. ValidationAgent (`src/agents/ValidationAgent.ts`)

- `validate(revId, expectedCount)`:
  1. **Row Count 검증**: `revision_snapshot`의 실제 건수 vs 기대 건수 비교
  2. **해시 샘플링 검증**: 최대 10건을 뽑아 `hash_value`가 64자(SHA-256 hex) 문자열인지 확인
  3. 둘 다 통과해야 `passed = true`

## 리비전 상속 모델

```
REV #1: [A, B, C]              ← 신규 500건
REV #2: [A, B, C] + [D, E]     ← REV #1 상속 + 신규 100건
```

새 리비전은 이전 데이터를 **삭제하지 않고 `revision_snapshot`에서 참조만 추가**한다.
실제 데이터(`data_pool`)는 리비전 간에 공유되며, 어떤 리비전이 어떤 데이터를 갖는지는
`revision_snapshot (rev_id, data_id)` 매핑만으로 결정된다.

### 세 가지 파이프라인 시나리오

`src/server.ts`에는 상황별로 3개의 파이프라인 함수가 있다.

1. **`runPipeline(db, newData, memo, prevRevId)`** — 신규 리비전 생성
   - 신규 데이터를 Worker로 처리 → `insertMappings`
   - `prevRevId`가 있으면 `inheritUnchangedData`로 이전 리비전 전체 상속
   - `POST /api/revisions`에서 사용

2. **`runEditPipeline(db, baseRevId, changes, memo)`** — 셀 수정 저장
   - 변경된 행만 새 `payload`로 Worker 처리 (새 hash → 새 `data_pool` 행 생성)
   - `inheritExcluding(revId, baseRevId, modifiedMasterIds)`로 나머지 상속
   - `POST /api/revisions/:id/edit`에서 사용

3. **`runCommitPipeline(db, baseRevId, changes, deleteIds, memo)`** — 수정 + 삭제 통합 커밋
   - 변경된 행 Worker 처리
   - `excludedIds = [...수정된 master_id, ...삭제할 master_id]`로 `inheritExcluding` 호출
   - 리비전 1개만 생성되어 수정과 삭제가 하나의 커밋으로 묶인다
   - `POST /api/revisions/:id/commit`에서 사용 (가장 최신 방식, [ai-step/step-19](../ai-step/step-19-unified-commit-button.md) 참고)

> **왜 `master_id` 기준으로 제외하는가?**
> 수정된 행은 payload가 바뀌어 새 `hash_value` → 새 `data_id`를 갖는다.
> 옛 `data_id`로 제외 목록을 만들면 새로 생성된 data_id는 걸러지지 않으므로,
> 비즈니스 키인 `master_id` 기준으로 제외해야 한다 (CLAUDE.md 절대 규칙 5).

## 통신 메시지 포맷 (`src/types/index.ts`)

```typescript
interface TaskMessage {
  rev_id: number;
  chunk_id: number;
  total_chunks: number;
  rows: DataRow[];          // { master_id, payload }
}

interface ResultMessage {
  rev_id: number;
  chunk_id: number;
  status: 'success' | 'failed';
  data_ids: number[];
  error?: string;
}
```

`InMemoryQueue<T>`(`src/queue/InMemoryQueue.ts`)는 Redis 큐를 대체하는 경량 구현으로,
`push`/`pop`/`drain`만 제공하는 배열 기반 큐다. 파이프라인 함수가 동기적으로 `drain()`해서
워커에 분배하므로 실제로는 진짜 비동기 메시징이라기보다 "역할 분리를 위한 자료구조"에 가깝다.

다음: [03-database-schema.md](03-database-schema.md) — 테이블 구조와 쿼리 패턴.
