# 05. 구현 가이드 — 핵심 로직을 어떻게 구현했는가

이 문서는 "무엇을 만들었나"가 아니라 **"어떤 방식으로 구현했나"**에 집중한다.
같은 패턴을 다른 기능에 적용하거나, 비슷한 시스템을 새로 만들 때 참고한다.

## 1. 변경 감지 — 해시 기반 중복 제거

`WorkerAgent.processTask()` (`src/agents/WorkerAgent.ts:20-33`):

```typescript
const payloadStr = JSON.stringify(row.payload);
const hash = createHash('sha256')
  .update(`${row.master_id}:${payloadStr}`)
  .digest('hex');

db.run(
  `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload) VALUES (?, ?, ?)`,
  [row.master_id, hash, payloadStr],
);

const res = db.exec(`SELECT id FROM data_pool WHERE hash_value = ?`, [hash]);
dataIds.push(res[0].values[0][0] as number);
```

- 해시 입력에 `master_id`를 포함시키는 이유: 서로 다른 상품이 우연히 같은 payload를 가져도
  (예: 재고 0, 가격 0인 신규 상품 여러 개) 다른 데이터로 취급하기 위함.
- `INSERT OR IGNORE` + `hash_value UNIQUE` 조합으로 **멱등성**을 얻는다 — 같은 데이터를 여러 번
  처리해도 `data_pool`에는 한 번만 저장되고, 항상 같은 `id`를 반환한다.
- INSERT 직후 별도 `SELECT`로 id를 가져오는 이유: `INSERT OR IGNORE`가 무시된 경우
  `last_insert_rowid()`가 갱신되지 않으므로, hash_value로 재조회해야 신규/기존 모두 정확한 id를 얻는다.

## 2. 리비전 생성 — Coordinator → Worker → Snapshot → Validation 순서 강제

`runPipeline()` (`src/server.ts:56-111`)이 오케스트레이터 역할을 한다. 순서를 강제하는 이유:

1. Coordinator가 먼저 `revision_master` 행을 만들어 `rev_id`를 확보해야 Worker가 그 rev_id로
   결과를 기록할 수 있다.
2. Worker가 `data_pool` 삽입을 마쳐야 Snapshot이 매핑할 `data_id`가 존재한다.
3. Snapshot이 매핑(및 상속)을 마쳐야 Validation이 `revision_snapshot` 건수를 셀 수 있다.
4. Validation 통과 여부에 따라 Coordinator가 최종 상태(`COMPLETED`/`FAILED`)를 반영한다.

3개 Worker는 태스크 배열을 균등 분할해 `Promise.all`로 병렬 처리한다(`src/server.ts:74-82`).
같은 DB 인스턴스를 공유하지만 각 워커의 처리 구간(`BEGIN`~`COMMIT`)이 순차적으로 실행되므로
(단일 스레드 Node 이벤트 루프 + WASM) 실제 동시 쓰기 충돌은 발생하지 않는다.

## 3. 상속 — "삭제 없이 참조만 추가"를 SQL로 구현하는 법

새 리비전이 이전 데이터를 물려받을 때, 실제로는 **새로운 `revision_snapshot` 행만 INSERT**한다.
`data_pool`은 전혀 건드리지 않는다.

```sql
-- 개념적으로는 이 INSERT ... SELECT 한 문장:
INSERT INTO revision_snapshot (rev_id, data_id)
SELECT :newRevId, data_id FROM revision_snapshot WHERE rev_id = :prevRevId;
```

하지만 대용량(수십만 건)에서는 위 단일 쿼리가 WASM 힙을 넘겨 크래시를 일으키므로,
실제 구현(`SnapshotAgent.inheritUnchangedData` / `inheritExcluding`)은 `LIMIT/OFFSET` 5,000건씩
배치로 나누어 반복 실행한다 ([06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md) 참고).

`inheritExcluding`은 제외 대상이 있을 때 `JOIN`으로 `master_id`를 걸러낸다:

```sql
SELECT s.data_id
FROM revision_snapshot s
JOIN data_pool p ON s.data_id = p.id
WHERE s.rev_id = :fromRevId
  AND p.master_id NOT IN (:excludedMasterIds...)
LIMIT :BATCH OFFSET :offset;
```

`data_id`가 아닌 `master_id`로 제외하는 이유는 [02-architecture.md](02-architecture.md#리비전-상속-모델)에서 설명한 대로,
수정된 행은 새 해시로 인해 새 `data_id`를 갖기 때문이다.

## 4. 수정(Edit) — "바뀐 행만 새로 만들고 나머지는 상속"

`runEditPipeline()` (`src/server.ts:124-170`)의 흐름:

1. 프런트엔드에서 받은 `changes`(수정된 행 전체 payload)를 `DataRow[]`로 변환
2. Worker가 새 payload로 해시 계산 → 새 `hash_value`이므로 `data_pool`에 새 행 생성
3. `inheritExcluding(revId, baseRevId, changes.map(c => c.master_id))`로 나머지 상속
4. 결과적으로 새 리비전에는 "바뀐 행의 새 버전" + "안 바뀐 행의 기존 참조"가 공존

`runCommitPipeline()`은 여기에 `deleteIds`를 더해 제외 목록을
`[...changes.map(c => c.master_id), ...deleteIds]`로 확장한 것뿐이다 — 삭제는 "상속 대상에서
빼는 것"으로 표현되므로 별도 DELETE 로직이 필요 없다.

## 5. 검증 — 왜 두 단계로 나눴는가

`ValidationAgent.validate()`는 Row Count 비교와 해시 샘플링을 모두 수행한다.

- **Row Count만으로는 부족한 이유**: 건수가 맞아도 잘못된 `data_id`가 매핑됐을 가능성을 배제하지 못한다.
- **전수 해시 검증을 하지 않는 이유**: 30만 건 전체를 검사하면 비용이 크므로, 10건 샘플링으로
  "해시 형식이 정상인지"만 빠르게 확인 — 프로덕션이라면 샘플 크기나 검증 항목을 확장해야 한다.

## 6. 서버사이드 페이지네이션 (AG Grid 연동)

`GET /api/revisions/:id/data`는 `limit`/`offset`을 받아 SQL 단에서 페이징한다
([ai-step/step-18](../ai-step/step-18-server-side-pagination.md)). AG Grid의 Infinite Row Model과
짝을 이뤄, 30만 건을 한 번에 프런트엔드로 내려보내지 않고 뷰포트에 필요한 만큼만 요청한다.
`ORDER BY p.master_id`로 정렬을 고정해 페이지 간 순서가 흔들리지 않게 한다.

## 7. 통합 커밋 UX (수정 + 삭제 → 리비전 1개)

초기 구현은 편집과 삭제가 각각 별도 리비전을 만들었으나, 사용자가 "여러 셀을 고치고 몇 행을 지운 뒤
한 번에 저장"하는 흐름과 맞지 않아 `runCommitPipeline` + `POST /api/revisions/:id/commit`으로
통합했다 ([ai-step/step-19](../ai-step/step-19-unified-commit-button.md)). UI 관점에서 "커밋"이라는
단일 동작이 DB 관점에서는 여전히 "Worker 처리 + 확장된 제외 목록으로 상속"이라는 동일한 패턴으로
표현된다는 점이 이 아키텍처의 핵심 장점이다.

다음: [06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md) — 트러블슈팅, 성능, 배포.
