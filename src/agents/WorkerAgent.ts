import { createHash } from 'crypto';
import { Database } from 'sql.js';
import { TaskMessage, ResultMessage } from '../types';
import { InMemoryQueue } from '../queue/InMemoryQueue';

export class WorkerAgent {
  constructor(
    private readonly id: number,
    private readonly db: Database,
    private readonly resultQueue: InMemoryQueue<ResultMessage>,
  ) {}

  async processTask(task: TaskMessage): Promise<void> {
    const { rev_id, chunk_id, rows } = task;
    const dataIds: number[] = [];

    // 트랜잭션으로 묶어 대용량 처리 안정성 확보
    this.db.run('BEGIN');
    try {
      for (const row of rows) {
        const payloadStr = JSON.stringify(row.payload);
        const hash = createHash('sha256')
          .update(`${row.master_id}:${payloadStr}`)
          .digest('hex');

        this.db.run(
          `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload) VALUES (?, ?, ?)`,
          [row.master_id, hash, payloadStr],
        );

        const res = this.db.exec(`SELECT id FROM data_pool WHERE hash_value = ?`, [hash]);
        dataIds.push(res[0].values[0][0] as number);
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }

    this.db.run(
      `UPDATE revision_master SET processed_chunks = processed_chunks + 1 WHERE rev_id = ?`,
      [rev_id],
    );

    this.resultQueue.push({ rev_id, chunk_id, status: 'success', data_ids: dataIds });
    console.log(
      `  [Worker-${this.id}] chunk ${chunk_id} 완료 — ${rows.length.toLocaleString()}건`,
    );
  }
}
