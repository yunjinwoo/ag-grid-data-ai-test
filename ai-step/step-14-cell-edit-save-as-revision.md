# Step 14 — 셀 편집 → 새 리비전 저장

## 목적
AG Grid에서 셀(name, price, stock, category)을 직접 수정하고,  
저장 버튼 클릭 시 **변경된 행만** 처리해 새 리비전을 생성.

---

## 아키텍처

```
[AG Grid 셀 수정]
    ↓ onCellValueChanged
pendingEdits Map<master_id, ChangeRow>
    ↓ 저장 버튼 클릭
POST /api/revisions/:baseRevId/edit
    ↓
runEditPipeline()
  ├─ 변경된 행 → Worker 처리 (새 hash, 새 data_id)
  ├─ snapshot.insertMappings()
  └─ snapshot.inheritExcluding(revId, baseRevId, modifiedMasterIds)
      ↓
새 리비전 = 수정된 행(새 hash) + 나머지 행(baseRevId에서 상속)
```

---

## 백엔드

### `runEditPipeline` — 수정 전용 파이프라인

```typescript
async function runEditPipeline(
  db: Database,
  baseRevId: number,
  changes: ChangeRow[],
  memo: string,
) {
  const newData: DataRow[] = changes.map(c => ({
    master_id: c.master_id,
    payload: { name: c.name, price: c.price, stock: c.stock, category: c.category },
  }));

  // 1. 새 리비전 생성
  const revId = await coordinator.createRevision(newData, memo);

  // 2. 변경된 행 Worker 처리 (새 hash 계산 → data_pool upsert)
  const tasks     = taskQueue.drain();
  await Promise.all(workers.map((w, i) => ...));
  snapshot.insertMappings(resultQueue.drain());

  // 3. 수정된 master_id를 제외하고 나머지 상속
  const modifiedIds    = changes.map(c => c.master_id);
  const inheritedCount = snapshot.inheritExcluding(revId, baseRevId, modifiedIds);

  // 4. 검증 + 완료 마킹
  const vr = validation.validate(revId, total);
  vr.passed ? coordinator.markCompleted(revId) : coordinator.markFailed(revId, vr.details);

  db.run(`UPDATE revision_master SET new_count=0, inherited_count=? WHERE rev_id=?`, [inheritedCount, revId]);
  saveDb();
  return { revId, modifiedCount: changes.length, inheritedCount, total };
}
```

### API 엔드포인트

```typescript
app.post('/api/revisions/:id/edit', async (req, res) => {
  const baseRevId = Number(req.params.id);
  const { memo = '데이터 수정', changes } = req.body as {
    memo?: string;
    changes: ChangeRow[];   // [{ master_id, name, price, stock, category }]
  };

  if (!Array.isArray(changes) || !changes.length) {
    res.status(400).json({ error: 'changes 배열이 필요합니다' }); return;
  }

  const result = await runEditPipeline(db, baseRevId, changes, memo);
  res.json(result);
});
```

---

## `inheritExcluding` — 핵심 메서드

일반 `inheritUnchangedData`는 data_id 기준으로 상속.  
수정된 행은 **새 hash → 새 data_id**를 가지므로 data_id로 제외할 수 없음.  
→ `master_id` 기준으로 제외해야 함.

```typescript
inheritExcluding(revId: number, fromRevId: number, excludedMasterIds: string[]): number {
  const ph = excludedMasterIds.map(() => '?').join(', ');
  this.db.run(
    `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id)
     SELECT ?, s.data_id
     FROM revision_snapshot s
     JOIN data_pool p ON s.data_id = p.id
     WHERE s.rev_id = ?
       AND p.master_id NOT IN (${ph})`,
    [revId, fromRevId, ...excludedMasterIds],
  );
  // ...
}
```

---

## 프론트엔드

### AG Grid 컬럼 편집 설정

```javascript
const columnDefs = [
  { field: 'master_id', editable: false },
  { field: 'name',      editable: true },
  { field: 'price',     editable: true, valueParser: p => Number(p.newValue) },
  { field: 'stock',     editable: true, valueParser: p => Number(p.newValue) },
  { field: 'category',  editable: true },
];
```

### 변경 추적

```javascript
const pendingEdits = new Map(); // master_id → ChangeRow

gridOptions.onCellValueChanged = ({ data }) => {
  pendingEdits.set(data.master_id, {
    master_id: data.master_id,
    name:      data.name,
    price:     data.price,
    stock:     data.stock,
    category:  data.category,
  });
  updateEditBadge();  // 수정 건수 배지 업데이트
};
```

### 저장 버튼

```javascript
async function saveEdits() {
  if (!pendingEdits.size) return;
  const changes = [...pendingEdits.values()];
  const memo    = `${changes.length}건 수정`;

  const res = await fetch(`/api/revisions/${currentRevId}/edit`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ memo, changes }),
  });
  const data = await res.json();

  pendingEdits.clear();
  await refreshRevisions();        // 사이드바 갱신
  await selectRevision(data.revId, memo, 0, data.inheritedCount);
}
```

---

## UI 요소

- **편집 배지**: 수정된 행 수 표시 (0이면 숨김)
- **저장 버튼**: 편집 내용이 있을 때만 활성화
- **툴바 칩**: `신규 N건 | 상속 M건` 표시
