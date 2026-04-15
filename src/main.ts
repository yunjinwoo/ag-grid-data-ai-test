import { getDb } from './db/connection';
import { InMemoryQueue } from './queue/InMemoryQueue';
import { CoordinatorAgent } from './agents/CoordinatorAgent';
import { WorkerAgent } from './agents/WorkerAgent';
import { SnapshotAgent } from './agents/SnapshotAgent';
import { ValidationAgent } from './agents/ValidationAgent';
import { DataRow, TaskMessage, ResultMessage } from './types';

// ── 데모용 더미 데이터 생성 ──────────────────────────────────────────────────
function generateDemoData(count: number): DataRow[] {
  const rows: DataRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      master_id: `PROD-${String(i + 1).padStart(6, '0')}`,
      payload: {
        name: `상품 ${i + 1}`,
        price: Math.floor(Math.random() * 100_000) + 1_000,
        stock: Math.floor(Math.random() * 1_000),
        category: ['전자', '의류', '식품', '가구'][i % 4],
      },
    });
  }
  return rows;
}

// ── 메인 실행 ────────────────────────────────────────────────────────────────
async function main() {
  const DEMO_COUNT = 30_000; // 실제 설계는 300,000건; 데모는 3만건
  const WORKER_COUNT = 3;

  console.log('='.repeat(60));
  console.log('  멀티에이전트 리비전 처리 시스템 — 데모 실행');
  console.log('='.repeat(60));

  // DB 초기화
  const db = await getDb();
  console.log('[System] SQLite DB 초기화 완료');

  // 큐 초기화
  const taskQueue = new InMemoryQueue<TaskMessage>('task-queue');
  const resultQueue = new InMemoryQueue<ResultMessage>('result-queue');

  // 에이전트 초기화
  const coordinator = new CoordinatorAgent(db, taskQueue);
  const workers = Array.from(
    { length: WORKER_COUNT },
    (_, i) => new WorkerAgent(i + 1, db, resultQueue),
  );
  const snapshot = new SnapshotAgent(db);
  const validation = new ValidationAgent(db);

  // ── 1단계: 데이터 생성 및 Coordinator가 큐에 투입 ──────────────────────────
  const startTime = Date.now();
  const data = generateDemoData(DEMO_COUNT);
  console.log(`\n[System] 데모 데이터 ${DEMO_COUNT.toLocaleString()}건 생성 완료`);

  const revId = await coordinator.createRevision(data, '1차 상품 데이터 리비전');

  // ── 2단계: Worker들이 Task Queue에서 병렬로 작업 처리 ─────────────────────
  console.log(`\n[System] Worker ${WORKER_COUNT}개로 병렬 처리 시작...`);

  const allTasks: TaskMessage[] = taskQueue.drain();
  const chunkSize = Math.ceil(allTasks.length / WORKER_COUNT);

  const workerPromises = workers.map((worker, i) => {
    const assigned = allTasks.slice(i * chunkSize, (i + 1) * chunkSize);
    return Promise.all(assigned.map(task => worker.processTask(task)));
  });

  await Promise.all(workerPromises);
  console.log(`\n[System] 모든 Worker 처리 완료`);

  // ── 3단계: Snapshot Agent가 매핑 삽입 ──────────────────────────────────────
  const allResults = resultQueue.drain();
  snapshot.insertMappings(allResults);

  // ── 4단계: Validation Agent가 최종 검증 ────────────────────────────────────
  const result = validation.validate(revId, DEMO_COUNT);

  // ── 5단계: Coordinator가 최종 상태 업데이트 ────────────────────────────────
  if (result.passed) {
    coordinator.markCompleted(revId);
  } else {
    coordinator.markFailed(revId, result.details);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // ── 최종 리포트 ────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  최종 처리 결과');
  console.log('='.repeat(60));

  const masterRes = db.exec(
    `SELECT rev_id, status, total_chunks, processed_chunks FROM revision_master WHERE rev_id=?`,
    [revId],
  );
  const [rid, status, totalChunks, processedChunks] = masterRes[0].values[0];

  console.log(`  rev_id          : ${rid}`);
  console.log(`  상태            : ${status}`);
  console.log(`  처리 청크       : ${processedChunks} / ${totalChunks}`);
  console.log(`  입력 데이터     : ${DEMO_COUNT.toLocaleString()}건`);
  console.log(`  스냅샷 매핑     : ${result.actualCount.toLocaleString()}건`);
  console.log(`  검증            : ${result.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`  총 소요 시간    : ${elapsed}s`);
  console.log('='.repeat(60));

  // AG Grid용 쿼리 시연
  console.log('\n[AG Grid 연동 쿼리 시연 — 상위 5건]');
  const gridRes = db.exec(
    `SELECT p.id, p.master_id, p.payload
     FROM revision_snapshot s
     JOIN data_pool p ON s.data_id = p.id
     WHERE s.rev_id = ?
     LIMIT 5`,
    [revId],
  );
  if (gridRes.length > 0) {
    gridRes[0].values.forEach(([id, masterId, payload]) => {
      const parsed = JSON.parse(payload as string);
      console.log(`  id=${id}  master_id=${masterId}  name=${parsed.name}  price=${parsed.price}`);
    });
  }
}

main().catch(err => {
  console.error('[System] 치명적 오류:', err);
  process.exit(1);
});
