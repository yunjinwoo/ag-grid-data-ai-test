# Step 12 — 리비전 상속 (Revision Inheritance)

## 목적
새 리비전 생성 시 이전 데이터를 전부 삭제하는 방식에서,  
**이전 리비전 데이터를 그대로 유지하고 신규 데이터만 추가**하는 방식으로 전환.

---

## 핵심 개념

```
REV #1: [A, B, C]           ← 초기 데이터 500건
REV #2: [A, B, C] + [D, E]  ← REV #1 상속 + 신규 100건 추가
```

`revision_snapshot` 테이블이 `(rev_id, data_id)` 쌍으로 구성되므로,  
상속은 단순히 **이전 rev_id의 data_id를 새 rev_id로 복사**하는 INSERT.

---

## 변경 사항

### 1. `generateData` — startIndex 도입

```typescript
// 이전: 항상 PROD-000001부터 시작 → 신규 추가 시 master_id 중복
function generateData(count: number): DataRow[]

// 이후: startIndex로 연속 master_id 보장
function generateData(count: number, startIndex: number, seed = 0): DataRow[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i;
    // ...
    master_id: `PROD-${String(idx + 1).padStart(6, '0')}`,
  });
}
```

### 2. `runPipeline` — prevRevId 파라미터 추가

```typescript
async function runPipeline(
  db: Database,
  newData: DataRow[],
  memo: string,
  prevRevId: number | null = null,   // ← 추가
) {
  // ...신규 데이터 Worker 처리 후...

  // 3. 이전 리비전 데이터 상속
  if (prevRevId !== null) {
    snapshot.inheritUnchangedData(revId, prevRevId);
  }
}
```

### 3. `SnapshotAgent.inheritUnchangedData`

```typescript
inheritUnchangedData(revId: number, prevRevId: number): void {
  this.db.run(
    `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id)
     SELECT ?, data_id FROM revision_snapshot
     WHERE rev_id = ?
       AND data_id NOT IN (SELECT data_id FROM revision_snapshot WHERE rev_id = ?)`,
    [revId, prevRevId, revId],
  );
}
```

`INSERT OR IGNORE`: 신규로 추가한 data_id가 이미 있으면 스킵 (중복 방지).

### 4. 서버 부트스트랩에서 상속 관계 시연

```typescript
const r1 = await runPipeline(db, generateData(500, 0, 0),   '초기 상품 데이터 (500건)', null);
await     runPipeline(db, generateData(100, 500, 77), '2차 신규 상품 추가 (100건)', r1.revId);
// REV #2 = 500 상속 + 100 신규 = 600건
```

---

## POST /api/revisions — 신규 리비전 생성 로직

```typescript
app.post('/api/revisions', async (req, res) => {
  const prevRevId  = getLatestCompletedRevId(db);        // 직전 완료 리비전
  const startIndex = prevRevId !== null
    ? getSnapshotCount(db, prevRevId)                    // 이어서 번호 부여
    : 0;
  const newData = generateData(count, startIndex, seed);
  const result  = await runPipeline(db, newData, memo, prevRevId);
  res.json(result);
});
```

---

## revision_master 컬럼 추가

```sql
-- db/connection.ts createSchema()
new_count       INTEGER DEFAULT 0,
inherited_count INTEGER DEFAULT 0
```

파이프라인 완료 후 UPDATE:

```typescript
db.run(
  `UPDATE revision_master SET new_count=?, inherited_count=? WHERE rev_id=?`,
  [newData.length, inheritedCount, revId],
);
```

UI 사이드바에서 신규/상속 건수를 칩(chip)으로 표시하는 데 사용.

---

## 검증

| 시나리오 | 기대 결과 |
|----------|-----------|
| REV #1 (500건) | snapshot_count = 500 |
| REV #2 (100건 추가) | snapshot_count = 600, inherited=500, new=100 |
| REV #N 신규 리비전 | 직전 전체 + 신규 건수 |
