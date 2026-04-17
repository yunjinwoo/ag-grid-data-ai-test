import express from 'express';
import path from 'path';
import { getDb } from './db/connection';
import { InMemoryQueue } from './queue/InMemoryQueue';
import { CoordinatorAgent } from './agents/CoordinatorAgent';
import { WorkerAgent } from './agents/WorkerAgent';
import { SnapshotAgent } from './agents/SnapshotAgent';
import { ValidationAgent } from './agents/ValidationAgent';
import { DataRow, TaskMessage, ResultMessage } from './types';
import type { Database, QueryExecResult } from 'sql.js';
import { saveDb } from './db/connection';

// ── 유틸 ───────────────────────────────────────────────────────────────────

function toRows(result: QueryExecResult[]): Record<string, unknown>[] {
  if (!result.length || !result[0].values.length) return [];
  const { columns, values } = result[0];
  return values.map(row =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])),
  );
}

function getSnapshotCount(db: Database, revId: number): number {
  const res = db.exec(`SELECT COUNT(*) FROM revision_snapshot WHERE rev_id = ?`, [revId]);
  return res.length ? (res[0].values[0][0] as number) : 0;
}

function getLatestCompletedRevId(db: Database): number | null {
  const res = db.exec(
    `SELECT rev_id FROM revision_master WHERE status='COMPLETED' ORDER BY rev_id DESC LIMIT 1`,
  );
  return res.length && res[0].values.length ? (res[0].values[0][0] as number) : null;
}

// ── 데이터 생성 (startIndex 기준 master_id 연속 부여) ──────────────────────

function generateData(count: number, startIndex: number, seed = 0): DataRow[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i;
    const s = (idx * 48_271 + seed * 1_234) % 1_000_000;
    return {
      master_id: `PROD-${String(idx + 1).padStart(6, '0')}`,
      payload: {
        name: `상품 ${idx + 1}`,
        price: (s % 99_000) + 1_000,
        stock: (s % 999) + 1,
        category: ['전자', '의류', '식품', '가구'][idx % 4],
      },
    };
  });
}

// ── 에이전트 파이프라인 ────────────────────────────────────────────────────
// prevRevId 가 있으면 → 해당 리비전의 데이터를 상속 후 신규 데이터 추가

async function runPipeline(
  db: Database,
  newData: DataRow[],
  memo: string,
  prevRevId: number | null = null,
) {
  const taskQueue = new InMemoryQueue<TaskMessage>('task');
  const resultQueue = new InMemoryQueue<ResultMessage>('result');

  const coordinator = new CoordinatorAgent(db, taskQueue);
  const workers = Array.from({ length: 3 }, (_, i) => new WorkerAgent(i + 1, db, resultQueue));
  const snapshot = new SnapshotAgent(db);
  const validation = new ValidationAgent(db);

  // 1. revision_master 생성
  const revId = await coordinator.createRevision(newData, memo);

  // 2. 신규 데이터 Worker 처리
  if (newData.length > 0) {
    const tasks = taskQueue.drain();
    const chunkSize = Math.max(1, Math.ceil(tasks.length / workers.length));
    await Promise.all(
      workers.map((w, i) =>
        Promise.all(tasks.slice(i * chunkSize, (i + 1) * chunkSize).map(t => w.processTask(t))),
      ),
    );
    snapshot.insertMappings(resultQueue.drain());
  }

  // 3. 이전 리비전 데이터 상속 (spec: INSERT INTO ... SELECT)
  let inheritedCount = 0;
  if (prevRevId !== null) {
    const before = getSnapshotCount(db, revId);
    snapshot.inheritUnchangedData(revId, prevRevId);
    inheritedCount = getSnapshotCount(db, revId) - before;
    console.log(`[Pipeline] rev_id=${revId} — 상속 ${inheritedCount}건 (from rev ${prevRevId})`);
  }

  // 4. 검증
  const total = getSnapshotCount(db, revId);
  const vr = validation.validate(revId, total);
  vr.passed
    ? coordinator.markCompleted(revId)
    : coordinator.markFailed(revId, vr.details);

  // 신규/상속 건수를 revision_master에 저장
  db.run(
    `UPDATE revision_master SET new_count=?, inherited_count=? WHERE rev_id=?`,
    [newData.length, inheritedCount, revId],
  );

  // DB를 파일로 저장 (revision.db)
  saveDb();

  return { revId, passed: vr.passed, newCount: newData.length, inheritedCount, total };
}

// ── 수정 전용 파이프라인 ──────────────────────────────────────────────────
// 수정된 행만 새 hash로 처리 → 나머지는 baseRevId에서 master_id 기준 상속

interface ChangeRow {
  master_id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

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

  const taskQueue = new InMemoryQueue<TaskMessage>('task');
  const resultQueue = new InMemoryQueue<ResultMessage>('result');
  const coordinator = new CoordinatorAgent(db, taskQueue);
  const workers = Array.from({ length: 3 }, (_, i) => new WorkerAgent(i + 1, db, resultQueue));
  const snapshot = new SnapshotAgent(db);
  const validation = new ValidationAgent(db);

  const revId = await coordinator.createRevision(newData, memo);

  const tasks = taskQueue.drain();
  const chunkSize = Math.max(1, Math.ceil(tasks.length / workers.length));
  await Promise.all(
    workers.map((w, i) =>
      Promise.all(tasks.slice(i * chunkSize, (i + 1) * chunkSize).map(t => w.processTask(t))),
    ),
  );
  snapshot.insertMappings(resultQueue.drain());

  // 수정된 master_id를 제외하고 나머지 상속
  const modifiedIds = changes.map(c => c.master_id);
  const inheritedCount = snapshot.inheritExcluding(revId, baseRevId, modifiedIds);

  const total = getSnapshotCount(db, revId);
  const vr = validation.validate(revId, total);
  vr.passed
    ? coordinator.markCompleted(revId)
    : coordinator.markFailed(revId, vr.details);

  db.run(
    `UPDATE revision_master SET new_count=0, inherited_count=? WHERE rev_id=?`,
    [inheritedCount, revId],
  );

  saveDb();
  return { revId, passed: vr.passed, modifiedCount: changes.length, inheritedCount, total };
}

// ── 통합 커밋 파이프라인 ──────────────────────────────────────────────────
// 수정(changes) + 삭제(deleteIds)를 한 번에 처리 → 새 리비전 1개 생성

async function runCommitPipeline(
  db: Database,
  baseRevId: number,
  changes: ChangeRow[],
  deleteIds: string[],
  memo: string,
) {
  const newData: DataRow[] = changes.map(c => ({
    master_id: c.master_id,
    payload: { name: c.name, price: c.price, stock: c.stock, category: c.category },
  }));

  const taskQueue = new InMemoryQueue<TaskMessage>('task');
  const resultQueue = new InMemoryQueue<ResultMessage>('result');
  const coordinator = new CoordinatorAgent(db, taskQueue);
  const workers = Array.from({ length: 3 }, (_, i) => new WorkerAgent(i + 1, db, resultQueue));
  const snapshot = new SnapshotAgent(db);
  const validation = new ValidationAgent(db);

  const revId = await coordinator.createRevision(newData, memo);

  // 수정된 행 Worker 처리 (변경사항 없으면 스킵)
  if (newData.length > 0) {
    const tasks = taskQueue.drain();
    const chunkSize = Math.max(1, Math.ceil(tasks.length / workers.length));
    await Promise.all(
      workers.map((w, i) =>
        Promise.all(tasks.slice(i * chunkSize, (i + 1) * chunkSize).map(t => w.processTask(t))),
      ),
    );
    snapshot.insertMappings(resultQueue.drain());
  }

  // 수정된 master_id + 삭제할 master_id 모두 제외하고 상속
  const excludedIds = [...changes.map(c => c.master_id), ...deleteIds];
  const inheritedCount = snapshot.inheritExcluding(revId, baseRevId, excludedIds);

  const total = getSnapshotCount(db, revId);
  const vr = validation.validate(revId, total);
  vr.passed
    ? coordinator.markCompleted(revId)
    : coordinator.markFailed(revId, vr.details);

  db.run(
    `UPDATE revision_master SET new_count=?, inherited_count=? WHERE rev_id=?`,
    [changes.length, inheritedCount, revId],
  );
  saveDb();

  return { revId, passed: vr.passed, editCount: changes.length, deleteCount: deleteIds.length, inheritedCount, total };
}

// ── 서버 부트스트랩 ───────────────────────────────────────────────────────

async function bootstrap() {
  const db = await getDb();

  // 초기 리비전 자동 생성 — 필요 시 주석 해제
  // console.log('[Server] 초기 데이터 생성 중...');
  // const r1 = await runPipeline(db, generateData(500, 0, 0), '초기 상품 데이터 (500건)', null);
  // await runPipeline(db, generateData(100, 500, 77), `2차 신규 상품 추가 (100건)`, r1.revId);
  // console.log('[Server] 초기 데이터 생성 완료\n');

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // ── 리비전 API ────────────────────────────────────────────────────────

  // 전체 리비전 목록 (스냅샷 건수 포함)
  app.get('/api/revisions', (_req, res) => {
    const revisions = toRows(db.exec('SELECT * FROM revision_master ORDER BY rev_id DESC'));
    const enriched = revisions.map(r => ({
      ...r,
      snapshot_count: getSnapshotCount(db, r.rev_id as number),
    }));
    res.json(enriched);
  });

  // 특정 리비전 AG Grid 데이터 (서버사이드 페이지네이션)
  app.get('/api/revisions/:id/data', (req, res) => {
    const revId = Number(req.params.id);
    if (isNaN(revId)) { res.status(400).json({ error: 'invalid id' }); return; }

    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const offset = Number(req.query.offset) || 0;
    const total = getSnapshotCount(db, revId);

    const raw = toRows(
      db.exec(
        `SELECT p.id, p.master_id, p.payload
         FROM revision_snapshot s
         JOIN data_pool p ON s.data_id = p.id
         WHERE s.rev_id = ?
         ORDER BY p.master_id
         LIMIT ? OFFSET ?`,
        [revId, limit, offset],
      ),
    );
    const rows = raw.map(r => ({
      id: r.id,
      master_id: r.master_id,
      ...(JSON.parse(r.payload as string) as Record<string, unknown>),
    }));
    res.json({ rows, total, limit, offset });
  });

  // 새 리비전 생성 — 직전 리비전 데이터 상속 + 신규 데이터 추가
  app.post('/api/revisions', async (req, res) => {
    const { count: rawCount = 100, memo = '새 리비전' } = req.body as {
      count?: number; memo?: string;
    };
    const count = Math.min(rawCount, 100_000);
    const prevRevId = getLatestCompletedRevId(db);
    const startIndex = prevRevId !== null ? getSnapshotCount(db, prevRevId) : 0;
    const seed = Math.floor(Date.now() % 100_000);
    const newData = generateData(count, startIndex, seed);
    const result = await runPipeline(db, newData, memo, prevRevId);
    res.json(result);
  });

  // 셀 수정 저장 — 수정된 행만 처리 후 새 리비전 생성
  app.post('/api/revisions/:id/edit', async (req, res) => {
    const baseRevId = Number(req.params.id);
    if (isNaN(baseRevId)) { res.status(400).json({ error: 'invalid id' }); return; }

    const { memo = '데이터 수정', changes } = req.body as {
      memo?: string;
      changes: ChangeRow[];
    };
    if (!Array.isArray(changes) || !changes.length) {
      res.status(400).json({ error: 'changes 배열이 필요합니다' }); return;
    }

    const result = await runEditPipeline(db, baseRevId, changes, memo);
    res.json(result);
  });

  // 선택 행 삭제 → 새 리비전 (빈 파이프라인 + 제외 상속)
  app.post('/api/revisions/:id/delete-rows', async (req, res) => {
    const baseRevId = Number(req.params.id);
    if (isNaN(baseRevId)) { res.status(400).json({ error: 'invalid id' }); return; }

    const { memo = '행 삭제', masterIds } = req.body as { memo?: string; masterIds: string[] };
    if (!Array.isArray(masterIds) || !masterIds.length) {
      res.status(400).json({ error: 'masterIds가 필요합니다' }); return;
    }

    const coordinator = new CoordinatorAgent(db, new InMemoryQueue<TaskMessage>('_'));
    const snapshot = new SnapshotAgent(db);
    const validation = new ValidationAgent(db);

    const revId = await coordinator.createRevision([], memo);
    const inheritedCount = snapshot.inheritExcluding(revId, baseRevId, masterIds);

    const total = getSnapshotCount(db, revId);
    const vr = validation.validate(revId, total);
    vr.passed ? coordinator.markCompleted(revId) : coordinator.markFailed(revId, vr.details);
    db.run(`UPDATE revision_master SET new_count=0, inherited_count=? WHERE rev_id=?`, [inheritedCount, revId]);
    saveDb();

    res.json({ revId, total, deletedCount: masterIds.length, inheritedCount });
  });

  // 수정 + 삭제 통합 커밋 → 새 리비전 1개 생성
  app.post('/api/revisions/:id/commit', async (req, res) => {
    const baseRevId = Number(req.params.id);
    if (isNaN(baseRevId)) { res.status(400).json({ error: 'invalid id' }); return; }

    const { memo = '변경사항 저장', changes = [], deleteIds = [] } = req.body as {
      memo?: string;
      changes?: ChangeRow[];
      deleteIds?: string[];
    };

    if (!changes.length && !deleteIds.length) {
      res.status(400).json({ error: '변경사항이 없습니다' }); return;
    }

    const result = await runCommitPipeline(db, baseRevId, changes, deleteIds, memo);
    res.json(result);
  });

  // 리비전 삭제 (snapshot + master 제거, data_pool은 유지)
  app.delete('/api/revisions/:id', (req, res) => {
    const revId = Number(req.params.id);
    if (isNaN(revId)) { res.status(400).json({ error: 'invalid id' }); return; }

    const check = db.exec(`SELECT rev_id FROM revision_master WHERE rev_id = ?`, [revId]);
    if (!check.length || !check[0].values.length) {
      res.status(404).json({ error: '리비전을 찾을 수 없습니다' }); return;
    }

    db.run(`DELETE FROM revision_snapshot WHERE rev_id = ?`, [revId]);
    db.run(`DELETE FROM revision_master   WHERE rev_id = ?`, [revId]);
    saveDb();
    res.json({ deleted: revId });
  });

  // ── DB 뷰어 API ───────────────────────────────────────────────────────

  const ALLOWED_TABLES = ['data_pool', 'revision_master', 'revision_snapshot'] as const;

  // 테이블별 건수 요약
  app.get('/api/db/stats', (_req, res) => {
    const stats = ALLOWED_TABLES.map(t => {
      const r = db.exec(`SELECT COUNT(*) FROM ${t}`);
      return { table: t, count: r[0].values[0][0] };
    });
    res.json(stats);
  });

  // 고아 data_pool 정리 — 어떤 리비전에도 참조되지 않는 행만 삭제
  app.post('/api/db/cleanup', (_req, res) => {
    const before = (db.exec('SELECT COUNT(*) FROM data_pool')[0].values[0][0]) as number;

    db.run(`
      DELETE FROM data_pool
      WHERE id NOT IN (SELECT DISTINCT data_id FROM revision_snapshot)
    `);

    const after = (db.exec('SELECT COUNT(*) FROM data_pool')[0].values[0][0]) as number;
    const removed = before - after;
    saveDb();

    console.log(`[DB] 고아 정리 — ${removed.toLocaleString()}행 삭제 (${before} → ${after})`);
    res.json({ removed, before, after });
  });

  // 테이블 데이터 조회 (페이징)
  app.get('/api/db/:table', (req, res) => {
    const table = req.params.table;
    if (!(ALLOWED_TABLES as readonly string[]).includes(table)) {
      res.status(400).json({ error: 'not allowed' }); return;
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const rows = toRows(db.exec(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]));
    const total = (db.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0]) as number;
    res.json({ rows, total, limit, offset });
  });

  const PORT = Number(process.env.PORT) || 3001;
  app.listen(PORT, () => {
    console.log(`[Server] http://localhost:${PORT}`);
    console.log('[Server] 브라우저를 열어 확인하세요\n');
  });
}

bootstrap().catch(err => {
  console.error('[Server] 오류:', err);
  process.exit(1);
});
