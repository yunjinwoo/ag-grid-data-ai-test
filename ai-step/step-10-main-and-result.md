# Step 10 — 진입점(main.ts) 및 실행 결과

## 목적
4개 에이전트를 순서에 따라 오케스트레이션하고, 실행 결과를 검증.

---

## 파일: `src/main.ts`

### 워크플로우

```
[1] getDb()               SQLite 초기화
[2] generateDemoData()    30,000건 더미 데이터 생성
[3] Coordinator           revision_master 생성 → 3개 청크 Task Queue 투입
[4] Worker × 3 (병렬)     Promise.all → 각 청크 해시 계산 + Upsert
[5] Snapshot              Result Queue drain → revision_snapshot 매핑 삽입
[6] Validation            Row Count + 해시 샘플 검증
[7] Coordinator           COMPLETED / FAILED 상태 업데이트
[8] AG Grid 쿼리 시연     revision_snapshot JOIN data_pool 상위 5건 출력
```

### 병렬 처리 구조

```typescript
const allTasks = taskQueue.drain();                         // 3개 청크
const chunkSize = Math.ceil(allTasks.length / WORKER_COUNT); // Worker당 1개

const workerPromises = workers.map((worker, i) => {
  const assigned = allTasks.slice(i * chunkSize, (i + 1) * chunkSize);
  return Promise.all(assigned.map(task => worker.processTask(task)));
});

await Promise.all(workerPromises);  // 3 Worker 동시 실행
```

---

## 실행 명령

```bash
npm run dev
# 또는
npx ts-node src/main.ts
```

---

## 실행 결과 (실측)

```
============================================================
  멀티에이전트 리비전 처리 시스템 — 데모 실행
============================================================
[System] SQLite DB 초기화 완료
[System] 데모 데이터 30,000건 생성 완료

[Coordinator] 리비전 생성 시작 — 총 30,000건
[Coordinator] revision_master 생성 완료 — rev_id=1, total_chunks=3
[Coordinator] Task Queue에 3개 청크 투입 완료

[System] Worker 3개로 병렬 처리 시작...
  [Worker-1] chunk 1 처리 완료 — 10,000건 → 10,000개 ID
  [Worker-2] chunk 2 처리 완료 — 10,000건 → 10,000개 ID
  [Worker-3] chunk 3 처리 완료 — 10,000건 → 10,000개 ID

[System] 모든 Worker 처리 완료

[Snapshot] rev_id=1 — revision_snapshot에 30,000개 매핑 삽입 완료

[Validation] rev_id=1 검증 시작 (기대값: 30,000건)
[Validation] Row Count: 30,000 / 30,000 → OK | Hash 샘플링 (10건): OK
[Validation] 최종 결과: PASSED
[Coordinator] rev_id=1 → 상태: COMPLETED

============================================================
  최종 처리 결과
============================================================
  rev_id          : 1
  상태            : COMPLETED
  처리 청크       : 3 / 3
  입력 데이터     : 30,000건
  스냅샷 매핑     : 30,000건
  검증            : PASSED
  총 소요 시간    : 2.61s
============================================================

[AG Grid 연동 쿼리 시연 — 상위 5건]
  id=1  master_id=PROD-000001  name=상품 1  price=19303
  id=2  master_id=PROD-000002  name=상품 2  price=82735
  id=3  master_id=PROD-000003  name=상품 3  price=87920
  id=4  master_id=PROD-000004  name=상품 4  price=31784
  id=5  master_id=PROD-000005  name=상품 5  price=42120
```

---

## 성능 지표

| 항목 | 값 |
|------|----|
| 입력 데이터 | 30,000건 |
| 청크 수 | 3개 (10,000건씩) |
| 병렬 Worker 수 | 3개 |
| 총 소요 시간 | 2.61s |
| 처리 속도 | ~11,494건/s |
| 검증 결과 | PASSED |
