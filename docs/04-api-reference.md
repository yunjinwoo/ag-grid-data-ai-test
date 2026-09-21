# 04. API 레퍼런스

모든 엔드포인트는 `src/server.ts`의 `bootstrap()` 안에 정의되어 있다. 기본 포트는 `3001`
(`process.env.PORT`로 변경 가능). 응답은 모두 JSON.

## 리비전 API

### `GET /api/revisions`

전체 리비전 목록을 최신순으로 반환. 각 항목에 `snapshot_count`(해당 리비전의 데이터 건수)를 붙여서 준다.

```
응답: [{ rev_id, memo, status, total_chunks, processed_chunks, new_count, inherited_count,
         created_at, error_log, snapshot_count }, ...]
```

### `GET /api/revisions/:id/data`

특정 리비전의 AG Grid용 데이터. **서버사이드 페이지네이션** 적용 ([ai-step/step-18](../ai-step/step-18-server-side-pagination.md)).

| 쿼리 파라미터 | 기본값 | 제한 |
|---------------|--------|------|
| `limit` | 200 | 최대 1000 |
| `offset` | 0 | — |

```
응답: { rows: [{ id, master_id, ...payload필드 }], total, limit, offset }
```

### `POST /api/revisions`

직전 `COMPLETED` 리비전을 상속하면서 신규 데이터를 추가해 새 리비전을 생성한다.
내부적으로 `runPipeline()` 호출.

```
요청 바디: { count?: number (기본 100, 최대 100,000), memo?: string }
응답:      { revId, passed, newCount, inheritedCount, total }
```

- `startIndex`는 직전 리비전의 데이터 건수를 기준으로 계산돼 `master_id`가 연속되도록 한다
  (`generateData(count, startIndex, seed)`).

### `POST /api/revisions/:id/edit`

셀 수정을 새 리비전으로 저장. `:id`는 기준(base) 리비전. 내부적으로 `runEditPipeline()` 호출.

```
요청 바디: { memo?: string, changes: [{ master_id, name, price, stock, category }, ...] }  // changes 필수, 최소 1건
응답:      { revId, passed, modifiedCount, inheritedCount, total }
```

### `POST /api/revisions/:id/delete-rows`

선택한 행을 제외한 새 리비전을 생성 (Worker 처리 없이 `inheritExcluding`만 수행).

```
요청 바디: { memo?: string, masterIds: string[] }  // 필수, 최소 1건
응답:      { revId, total, deletedCount, inheritedCount }
```

### `POST /api/revisions/:id/commit`

**수정 + 삭제를 한 번에 커밋**하는 통합 엔드포인트 — 리비전 1개만 생성된다
([ai-step/step-19](../ai-step/step-19-unified-commit-button.md)). 내부적으로 `runCommitPipeline()` 호출.

```
요청 바디: { memo?: string, changes?: ChangeRow[], deleteIds?: string[] }
           // changes와 deleteIds 둘 다 비어있으면 400 에러
응답:      { revId, passed, editCount, deleteCount, inheritedCount, total }
```

> `edit`와 `delete-rows`는 개별 엔드포인트로 남아있지만, 웹 UI는 `commit` 엔드포인트를
> 통해 수정/삭제를 하나의 저장 동작으로 묶어 처리한다.

### `DELETE /api/revisions/:id`

리비전 자체를 삭제한다. `revision_snapshot`과 `revision_master`의 해당 행만 제거하고
**`data_pool`은 그대로 유지**한다 (다른 리비전이 참조할 수 있으므로).

```
응답: { deleted: revId }   // 존재하지 않으면 404
```

## DB 뷰어 API

### `GET /api/db/stats`

`data_pool`, `revision_master`, `revision_snapshot` 3개 테이블의 행 수 요약.

```
응답: [{ table: 'data_pool', count }, { table: 'revision_master', count }, { table: 'revision_snapshot', count }]
```

### `GET /api/db/:table`

테이블 데이터 페이징 조회. `:table`은 `data_pool` / `revision_master` / `revision_snapshot`만 허용
(화이트리스트, SQL 인젝션 방지).

| 쿼리 파라미터 | 기본값 | 제한 |
|---------------|--------|------|
| `limit` | 100 | 최대 500 |
| `offset` | 0 | — |

```
응답: { rows, total, limit, offset }
```

### `POST /api/db/cleanup`

`revision_snapshot`에서 참조되지 않는 `data_pool` 고아 행을 삭제한다 (NOT IN 안전 쿼리).

```
응답: { removed, before, after }
```

## 공통 사항

- 모든 쓰기 엔드포인트는 처리 완료 후 내부적으로 `saveDb()`를 호출해 `revision.db` 파일에 반영한다.
- 잘못된 `:id` 파라미터는 `400 { error: 'invalid id' }`로 응답.
- 프런트엔드(`public/index.html`)는 VPS 배포 시 경로 접두사 문제를 피하기 위해
  `API_BASE = location.pathname.startsWith('/grid') ? '/grid' : ''`로 모든 fetch 호출 앞에 붙인다
  ([06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md#vps-배포) 참고).

다음: [05-implementation-guide.md](05-implementation-guide.md) — 핵심 로직을 실제로 어떻게 구현했는지.
