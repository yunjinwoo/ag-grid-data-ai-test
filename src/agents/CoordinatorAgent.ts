import { Database } from 'sql.js';
import { DataRow, TaskMessage } from '../types';
import { InMemoryQueue } from '../queue/InMemoryQueue';

export class CoordinatorAgent {
  private readonly CHUNK_SIZE = 10_000;

  constructor(
    private readonly db: Database,
    private readonly taskQueue: InMemoryQueue<TaskMessage>,
  ) {}

  async createRevision(data: DataRow[], memo = '자동 생성'): Promise<number> {
    console.log(`\n[Coordinator] 리비전 생성 시작 — 총 ${data.length.toLocaleString()}건`);

    const totalChunks = Math.ceil(data.length / this.CHUNK_SIZE);

    this.db.run(
      `INSERT INTO revision_master (memo, status, total_chunks, processed_chunks)
       VALUES (?, 'PENDING', ?, 0)`,
      [memo, totalChunks],
    );

    const revRow = this.db.exec('SELECT last_insert_rowid() AS id');
    const revId = revRow[0].values[0][0] as number;

    console.log(`[Coordinator] revision_master 생성 완료 — rev_id=${revId}, total_chunks=${totalChunks}`);

    this.db.run(
      `UPDATE revision_master SET status='PROCESSING' WHERE rev_id=?`,
      [revId],
    );

    for (let i = 0; i < totalChunks; i++) {
      const chunk = data.slice(i * this.CHUNK_SIZE, (i + 1) * this.CHUNK_SIZE);
      const task: TaskMessage = {
        rev_id: revId,
        chunk_id: i + 1,
        total_chunks: totalChunks,
        rows: chunk,
      };
      this.taskQueue.push(task);
    }

    console.log(`[Coordinator] Task Queue에 ${totalChunks}개 청크 투입 완료`);
    return revId;
  }

  markCompleted(revId: number): void {
    this.db.run(
      `UPDATE revision_master SET status='COMPLETED' WHERE rev_id=?`,
      [revId],
    );
    console.log(`[Coordinator] rev_id=${revId} → 상태: COMPLETED`);
  }

  markFailed(revId: number, errorLog: string): void {
    this.db.run(
      `UPDATE revision_master SET status='FAILED', error_log=? WHERE rev_id=?`,
      [errorLog, revId],
    );
    console.log(`[Coordinator] rev_id=${revId} → 상태: FAILED`);
  }
}
