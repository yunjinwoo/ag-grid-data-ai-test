# Step 19 — 통합 커밋 버튼 (수정 + 삭제 한 번에)

## 목적
수정 저장 버튼과 행 삭제 버튼을 하나의 "적용" 버튼으로 통합.  
두 번의 파이프라인 실행을 한 번으로 줄이고 UI를 단순화.

---

## 이전 방식 (버튼 2개)

```
[✏️ 수정 3건]  [💾 저장 → 새 리비전]
[☑️ 5건 선택]  [🗑 삭제 → 새 리비전]
→ 각각 새 리비전 생성 (수정 후 삭제 = 리비전 2개 생성)
```

## 이후 방식 (버튼 1개)

```
[✏️ 수정 3건  ·  🗑 삭제 5건]  [✅ 적용 → 새 리비전]
→ 리비전 1개 생성 (수정 + 삭제 동시 처리)
```

---

## 백엔드 — `runCommitPipeline`

수정된 행 + 삭제할 행을 `inheritExcluding`에서 한 번에 제외.

```typescript
async function runCommitPipeline(
  db: Database,
  baseRevId: number,
  changes: ChangeRow[],    // 수정된 행
  deleteIds: string[],     // 삭제할 master_id
  memo: string,
) {
  // 1. 수정된 행만 Worker 처리 (새 hash 생성)
  if (newData.length > 0) {
    // ... Worker 처리 ...
    snapshot.insertMappings(resultQueue.drain());
  }

  // 2. 수정 ID + 삭제 ID 모두 제외하고 나머지 상속
  const excludedIds    = [...changes.map(c => c.master_id), ...deleteIds];
  const inheritedCount = snapshot.inheritExcluding(revId, baseRevId, excludedIds);
  //   ↑ 수정된 행: 새 hash로 교체됨
  //   ↑ 삭제된 행: 아예 상속 안 됨
}
```

### API 엔드포인트

```typescript
// POST /api/revisions/:id/commit
app.post('/api/revisions/:id/commit', async (req, res) => {
  const { memo = '변경사항 저장', changes = [], deleteIds = [] } = req.body;

  if (!changes.length && !deleteIds.length) {
    res.status(400).json({ error: '변경사항이 없습니다' }); return;
  }

  const result = await runCommitPipeline(db, baseRevId, changes, deleteIds, memo);
  res.json(result);
});
```

---

## 프론트엔드 — 통합 상태 관리

```javascript
// 수정: onCellValueChanged → pendingEdits Map
// 삭제: 체크박스 선택 → getSelectedRows()

function updateActionBar() {
  const editCount = pendingEdits.size;
  const selCount  = gridApi ? gridApi.getSelectedRows().length : 0;

  if (editCount === 0 && selCount === 0) {
    // 버튼 숨김
    return;
  }

  const parts = [];
  if (editCount > 0) parts.push(`✏️ 수정 ${editCount}건`);
  if (selCount  > 0) parts.push(`🗑 삭제 ${selCount}건`);
  badge.textContent = parts.join('  ·  ');
  // 버튼 표시
}

// 커밋 실행
async function commitChanges() {
  const changes   = Array.from(pendingEdits.values());
  const deleteIds = gridApi.getSelectedRows().map(r => r.master_id);

  const result = await fetch(`/api/revisions/${selectedRevId}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memo, changes, deleteIds }),
  }).then(r => r.json());

  pendingEdits.clear();
  // 새 리비전으로 이동
}
```

---

## fetch 오류 처리 개선

JSON 파싱 전 HTTP 상태 코드 확인 — 서버 오류 시 HTML이 반환되어 "Unexpected token '<'" 발생 방지.

```javascript
const resp = await fetch(url, options);
if (!resp.ok) {
  const text = await resp.text();
  throw new Error(`서버 오류 (${resp.status}): ${text.slice(0, 200)}`);
}
const result = await resp.json();
```

---

## 클릭 선택 효과 제거

```javascript
// 체크박스로만 선택, 행 클릭 시 선택 효과 없음
suppressRowClickSelection: true,
rowSelection: 'multiple',
```
