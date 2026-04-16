# Step 15 — 삭제 기능 (리비전 삭제 · 행 삭제 · 고아 정리)

## 목적
3가지 삭제 기능 구현:
1. **리비전 삭제** — 사이드바에서 특정 리비전 제거
2. **행 삭제** — 그리드에서 선택한 행을 제외한 새 리비전 생성
3. **고아 data_pool 정리** — 어떤 리비전에도 참조되지 않는 data_pool 행 삭제

---

## 1. 리비전 삭제

### 안전성 고려
`revision_snapshot`과 `revision_master`만 삭제.  
`data_pool`은 다른 리비전에서 공유될 수 있으므로 **유지**.

```typescript
// DELETE /api/revisions/:id
app.delete('/api/revisions/:id', (req, res) => {
  const revId = Number(req.params.id);

  // 존재 여부 확인
  const check = db.exec(`SELECT rev_id FROM revision_master WHERE rev_id = ?`, [revId]);
  if (!check.length || !check[0].values.length) {
    res.status(404).json({ error: '리비전을 찾을 수 없습니다' }); return;
  }

  db.run(`DELETE FROM revision_snapshot WHERE rev_id = ?`, [revId]);
  db.run(`DELETE FROM revision_master   WHERE rev_id = ?`, [revId]);
  saveDb();
  res.json({ deleted: revId });
});
```

### 프론트엔드 — 호버 삭제 버튼

```html
<div class="revision-item" data-rev-id="1" data-memo="초기 데이터">
  <button class="delete-rev-btn" data-del-rev="1">✕</button>
  ...
</div>
```

```javascript
container.onclick = async e => {
  const delBtn = e.target.closest('.delete-rev-btn');
  if (delBtn) {
    const revId = Number(delBtn.dataset.delRev);
    if (!confirm(`리비전 #${revId}를 삭제하시겠습니까?`)) return;
    await fetch(`/api/revisions/${revId}`, { method: 'DELETE' });
    await refreshRevisions();
    return;
  }
  // 일반 클릭: selectRevision(...)
};
```

---

## 2. 행 삭제 → 새 리비전

선택된 행을 제외한 나머지를 상속해 새 리비전 생성.  
실제 data_pool 삭제 없이 **리비전에서 참조만 제거**.

```typescript
// POST /api/revisions/:id/delete-rows
app.post('/api/revisions/:id/delete-rows', async (req, res) => {
  const baseRevId = Number(req.params.id);
  const { memo = '행 삭제', masterIds } = req.body as {
    memo?: string; masterIds: string[];
  };

  const coordinator = new CoordinatorAgent(db, new InMemoryQueue('_'));
  const snapshot    = new SnapshotAgent(db);
  const validation  = new ValidationAgent(db);

  // 빈 newData로 리비전 생성 (신규 데이터 없음)
  const revId          = await coordinator.createRevision([], memo);
  // 삭제 대상 master_id 제외하고 나머지 상속
  const inheritedCount = snapshot.inheritExcluding(revId, baseRevId, masterIds);

  const total = getSnapshotCount(db, revId);
  const vr    = validation.validate(revId, total);
  vr.passed
    ? coordinator.markCompleted(revId)
    : coordinator.markFailed(revId, vr.details);

  db.run(`UPDATE revision_master SET new_count=0, inherited_count=? WHERE rev_id=?`,
         [inheritedCount, revId]);
  saveDb();
  res.json({ revId, total, deletedCount: masterIds.length, inheritedCount });
});
```

### 프론트엔드 — 체크박스 + 삭제 버튼

```javascript
// AG Grid 체크박스 컬럼
{ checkboxSelection: true, headerCheckboxSelection: true, width: 50 }

// 선택 변경 시 배지 업데이트
gridOptions.onSelectionChanged = () => {
  const count = gridOptions.api.getSelectedRows().length;
  selectionBadge.textContent = `${count}건 선택`;
  selectionBadge.style.display = count ? 'inline' : 'none';
  deleteRowsBtn.disabled = !count;
};

// 행 삭제 실행
async function deleteSelectedRows() {
  const rows      = gridOptions.api.getSelectedRows();
  const masterIds = rows.map(r => r.master_id);
  const memo      = `${masterIds.length}건 삭제`;

  const res = await fetch(`/api/revisions/${currentRevId}/delete-rows`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ memo, masterIds }),
  });
  const data = await res.json();
  await refreshRevisions();
  await selectRevision(data.revId, memo, 0, data.inheritedCount);
}
```

---

## 3. 고아 data_pool 정리

리비전을 삭제해도 `data_pool`은 남아 있음.  
다른 리비전에서 공유하지 않는 **고아 행**만 안전하게 삭제.

```typescript
// POST /api/db/cleanup
app.post('/api/db/cleanup', (_req, res) => {
  const before = db.exec('SELECT COUNT(*) FROM data_pool')[0].values[0][0] as number;

  db.run(`
    DELETE FROM data_pool
    WHERE id NOT IN (SELECT DISTINCT data_id FROM revision_snapshot)
  `);

  const after   = db.exec('SELECT COUNT(*) FROM data_pool')[0].values[0][0] as number;
  const removed = before - after;
  saveDb();

  console.log(`[DB] 고아 정리 — ${removed}행 삭제 (${before} → ${after})`);
  res.json({ removed, before, after });
});
```

### 왜 `NOT IN (SELECT DISTINCT ...)`이 안전한가?

- `revision_snapshot`에 남은 data_id는 누군가의 리비전이 참조 중
- `DISTINCT`로 중복 제거 후 NOT IN → 참조 없는 행만 삭제
- 다른 리비전에서 공유하는 hash는 `data_pool`에 유지됨

---

## 삭제 흐름 요약

```
리비전 삭제  →  revision_snapshot + revision_master 삭제
                data_pool 유지 (공유 가능)
                      ↓ (필요 시)
행 삭제      →  선택된 master_id 제외 + inheritExcluding → 새 리비전
고아 정리    →  어떤 리비전에도 없는 data_pool 행만 삭제
```
