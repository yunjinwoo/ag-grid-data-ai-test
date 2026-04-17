# Step 18 — 서버사이드 페이지네이션 (Infinite Row Model)

## 목적
클라이언트가 전체 데이터를 한 번에 로드하던 방식에서,  
페이지 단위로 서버에서 가져오는 방식으로 전환.  
30만 건 이상에서도 브라우저 렌더링 지연 없음.

---

## AG Grid Community — Row Model 종류

| Row Model | Community | 설명 |
|-----------|-----------|------|
| Client-side | ✅ | 전체 로드 후 클라이언트에서 정렬/필터 |
| Infinite | ✅ | 페이지 단위 서버 요청 (스크롤/페이지 이동 시) |
| Server-side | ❌ Enterprise only | 정렬/필터도 서버에서 처리 |
| Viewport | ❌ Enterprise only | 보이는 행만 로드 |

→ Community에서 서버사이드 페이지네이션은 **Infinite Row Model** 사용.

---

## 백엔드 변경 — 페이지네이션 파라미터 추가

```typescript
// GET /api/revisions/:id/data?limit=200&offset=0
app.get('/api/revisions/:id/data', (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 200, 1000);
  const offset = Number(req.query.offset) || 0;
  const total  = getSnapshotCount(db, revId);

  const rows = /* SELECT ... LIMIT ? OFFSET ? */;
  res.json({ rows, total, limit, offset });  // ← 배열 대신 객체로 반환
});
```

---

## 프론트엔드 변경 — Infinite Row Model 설정

### 핵심: datasource 패턴

```javascript
gridApi = agGrid.createGrid(element, {
  rowModelType: 'infinite',      // 서버사이드 모드
  cacheBlockSize: 200,           // 한 번에 서버에서 가져오는 행 수
  maxBlocksInCache: 5,           // 캐시에 유지할 블록 수 (200 × 5 = 1,000행)
  pagination: true,
  paginationPageSize: 100,
  paginationPageSizeSelector: false,   // 내장 page size 드롭다운 제거
  rowSelection: 'multiple',
  suppressRowClickSelection: true,     // 클릭 선택 효과 제거
});

// 그리드 생성 후 datasource 설정 (async 대신 .then() 사용)
const datasource = {
  getRows(params) {
    const limit = params.endRow - params.startRow;
    fetch(`/api/revisions/${revId}/data?limit=${limit}&offset=${params.startRow}`)
      .then(r => r.json())
      .then(res => {
        params.successCallback(res.rows, res.total);  // 두 번째 인자 = 전체 건수
      })
      .catch(() => params.failCallback());
  },
};
gridApi.setGridOption('datasource', datasource);
```

### ⚠️ 주의: async getRows 사용 금지

```javascript
// ❌ 문제: AG Grid v31이 Promise 반환을 무시하는 경우 있음
getRows: async (params) => { ... }

// ✅ 해결: 일반 함수 + .then() 체인
getRows(params) { fetch(...).then(...); }
```

---

## 내장 page size 셀렉터 문제 및 해결

```
문제: paginationPageSize 드롭다운이 viewport 밖으로 넘어가 그리드 전체를 덮음
해결: paginationPageSizeSelector: false → 내장 제거
대안: AG Grid pagination 바(.ag-paging-panel) 안에 커스텀 <select> 주입
```

```javascript
// 그리드 렌더링 완료 후 pagination 바에 주입
setTimeout(() => {
  const pagingPanel = document.querySelector('#myGrid .ag-paging-panel');
  if (pagingPanel && !pagingPanel.querySelector('.custom-page-size')) {
    const wrap = document.createElement('div');
    wrap.className = 'custom-page-size';
    wrap.innerHTML = `행 수 <select>...</select>`;
    wrap.querySelector('select').onchange = e => {
      gridApi.setGridOption('paginationPageSize', Number(e.target.value));
    };
    pagingPanel.prepend(wrap);
  }
}, 0);
```

---

## 초기 데이터 자동 생성 주석 처리

```typescript
// 서버 시작 시 자동 생성 코드 비활성화
// const r1 = await runPipeline(db, generateData(500, 0, 0), '초기 상품 데이터', null);
// await runPipeline(db, generateData(100, 500, 77), '2차 신규 상품 추가', r1.revId);
```

`revision.db` 파일이 없으면 빈 DB로 시작. 필요 시 주석 해제.

---

## 성능 비교

| 방식 | 30만 건 로드 시간 | 메모리 |
|------|-----------------|--------|
| Client-side | 3~5s + 브라우저 3GB+ | 전체 메모리 점유 |
| Infinite Row Model | 첫 200행만 (<0.5s) | 현재 캐시만 점유 |
