# Step 08 — Snapshot Agent

## 목적
Worker들의 처리 결과(Result Queue)를 수집하여 `revision_snapshot` 매핑 테이블에 Bulk Insert.  
이전 리비전에서 변경되지 않은 데이터도 현재 리비전으로 상속.

---

## 파일: `src/agents/SnapshotAgent.ts`

### 핵심 로직

```typescript
// 1. 모든 Worker 결과를 revision_snapshot에 삽입
insertMappings(results: ResultMessage[]): void {
  for (const result of results) {
    for (const dataId of result.data_ids) {
      this.db.run(
        `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id) VALUES (?, ?)`,
        [result.rev_id, dataId],
      );
    }
  }
}

// 2. 이전 리비전 데이터 상속 (변경되지 않은 행 복사)
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

---

## 설계서 대응

`revision_system_spec.md > 3. 핵심 비즈니스 로직 > 스냅샷 구성`:

| 설계서 항목 | 구현 메서드 |
|-------------|-------------|
| Step 1: 이전 리비전의 수정되지 않은 행 복사 (`INSERT INTO ... SELECT`) | `inheritUnchangedData()` |
| Step 2: 신규/수정 데이터 매핑 추가 | `insertMappings()` |

`implementation_plan.md > Agent Roles > C. Snapshot Agent`:
- [x] Worker가 전달한 `data_id`들을 수집
- [x] `revision_snapshot` 테이블에 Bulk Insert
- [x] 이전 리비전에서 변경되지 않은 데이터 이어붙이기 (`INSERT INTO ... SELECT`)
