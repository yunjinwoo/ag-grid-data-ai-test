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

    for (const row of rows) {
      const payloadStr = JSON.stringify(row.payload);
      const hash = createHash('sha256')
        .update(`${row.master_id}:${payloadStr}`)
        .digest('hex');

      // Upsert: 해시 충돌 시 기존 ID 사용 (중복 방지)
      this.db.run(
        `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload)
         VALUES (?, ?, ?)`,
        [row.master_id, hash, payloadStr],
      );

      const res = this.db.exec(
        `SELECT id FROM data_pool WHERE hash_value = ?`,
        [hash],
      );
      const dataId = res[0].values[0][0] as number;
      dataIds.push(dataId);
    }

    // processed_chunks 증가
    this.db.run(
      `UPDATE revision_master
       SET processed_chunks = processed_chunks + 1
       WHERE rev_id = ?`,
      [rev_id],
    );

    const result: ResultMessage = {
      rev_id,
      chunk_id,
      status: 'success',
      data_ids: dataIds,
    };

    this.resultQueue.push(result);
    console.log(
      `  [Worker-${this.id}] chunk ${chunk_id} 처리 완료 — ${rows.length.toLocaleString()}건 → ${dataIds.length.toLocaleString()}개 ID`,
    );
  }
}
