# Step 07 — Worker Agent

## 목적
Task Queue에서 청크를 가져와 SHA-256 해시 계산 및 `data_pool` Upsert 수행.  
처리된 `data_id` 목록을 Result Queue에 전송.

---

## 파일: `src/agents/WorkerAgent.ts`

### 핵심 로직

```typescript
async processTask(task: TaskMessage): Promise<void> {
  for (const row of task.rows) {
    // 1. SHA-256 해시 계산 (master_id + payload 조합)
    const hash = createHash('sha256')
      .update(`${row.master_id}:${JSON.stringify(row.payload)}`)
      .digest('hex');

    // 2. Upsert: 동일 해시 존재 시 삽입 스킵 (멱등성 보장)
    this.db.run(
      `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload) VALUES (?, ?, ?)`,
      [row.master_id, hash, JSON.stringify(row.payload)],
    );

    // 3. 기존 or 신규 data_id 조회
    const res = this.db.exec(`SELECT id FROM data_pool WHERE hash_value = ?`, [hash]);
    dataIds.push(res[0].values[0][0]);
  }

  // 4. processed_chunks 카운터 증가
  this.db.run(
    `UPDATE revision_master SET processed_chunks = processed_chunks + 1 WHERE rev_id = ?`,
    [task.rev_id],
  );

  // 5. 결과 큐에 전송
  this.resultQueue.push({ rev_id, chunk_id, status: 'success', data_ids: dataIds });
}
```

---

## 멱등성(Idempotency)

`INSERT OR IGNORE` + `UNIQUE(hash_value)` 조합으로 동일 데이터를 여러 번 삽입해도 결과가 동일함.  
→ Worker 장애 후 재시도(Retry) 시 중복 데이터 발생 없음.

---

## Scale-out 구조

```typescript
// main.ts — Worker 수만 바꾸면 병렬도 조정 가능
const workers = Array.from({ length: WORKER_COUNT }, (_, i) => new WorkerAgent(i + 1, db, resultQueue));
```

---

## 설계서 대응

`implementation_plan.md > Agent Roles > B. Worker Agent`:
- [x] 큐에서 Chunk를 가져옴
- [x] `Payload`의 해시 계산 (SHA-256)
- [x] `data_pool`에 `INSERT ... ON CONFLICT DO NOTHING` 수행
- [x] 성공한 `data_id` 리스트를 결과 큐에 전송
