# Step 06 — Coordinator Agent

## 목적
전체 작업을 생성·분할하고 Task Queue에 투입. 완료 후 최종 상태를 기록.

---

## 파일: `src/agents/CoordinatorAgent.ts`

### 핵심 로직

```typescript
async createRevision(data: DataRow[], memo = '자동 생성'): Promise<number> {
  const totalChunks = Math.ceil(data.length / this.CHUNK_SIZE); // CHUNK_SIZE = 10,000

  // 1. revision_master 레코드 생성 (PENDING)
  this.db.run(
    `INSERT INTO revision_master (memo, status, total_chunks) VALUES (?, 'PENDING', ?)`,
    [memo, totalChunks],
  );

  const revId = ...last_insert_rowid();

  // 2. 상태 PROCESSING으로 전환
  this.db.run(`UPDATE revision_master SET status='PROCESSING' WHERE rev_id=?`, [revId]);

  // 3. 청크 분할 후 Task Queue에 투입
  for (let i = 0; i < totalChunks; i++) {
    const chunk = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    taskQueue.push({ rev_id: revId, chunk_id: i + 1, total_chunks: totalChunks, rows: chunk });
  }

  return revId;
}
```

---

## 상태 전이

```
생성 요청
    │
    ▼
 PENDING  ──── createRevision() 호출 시
    │
    ▼
PROCESSING ──── 큐 투입 완료 후
    │
    ├─── 검증 통과 ──▶ COMPLETED
    │
    └─── 검증 실패 ──▶ FAILED (error_log 기록)
```

---

## 설계서 대응

`implementation_plan.md > Agent Roles > A. Coordinator Agent`:
- [x] `revision_master` 레코드 생성 (Status: PENDING)
- [x] 데이터를 10,000~30,000건 단위의 Chunk로 분할
- [x] Task Queue에 작업 투입
- [x] 최종 상태 업데이트 (`markCompleted` / `markFailed`)
