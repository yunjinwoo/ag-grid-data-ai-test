import { Database } from 'sql.js';
import { ResultMessage } from '../types';

export class SnapshotAgent {
  constructor(private readonly db: Database) {}

  insertMappings(results: ResultMessage[]): void {
    const revId = results[0].rev_id;
    let totalMapped = 0;

    for (const result of results) {
      for (const dataId of result.data_ids) {
        this.db.run(
          `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id) VALUES (?, ?)`,
          [revId, dataId],
        );
        totalMapped++;
      }
    }

    console.log(
      `\n[Snapshot] rev_id=${revId} — revision_snapshot에 ${totalMapped.toLocaleString()}개 매핑 삽입 완료`,
    );
  }

  // 이전 리비전에서 변경되지 않은 데이터를 현재 리비전으로 복사
  inheritUnchangedData(revId: number, prevRevId: number): void {
    this.db.run(
      `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id)
       SELECT ?, data_id FROM revision_snapshot
       WHERE rev_id = ?
         AND data_id NOT IN (SELECT data_id FROM revision_snapshot WHERE rev_id = ?)`,
      [revId, prevRevId, revId],
    );

    const countRes = this.db.exec(
      `SELECT COUNT(*) FROM revision_snapshot WHERE rev_id = ?`,
      [revId],
    );
    const total = countRes[0].values[0][0] as number;
    console.log(`[Snapshot] 이전 리비전(${prevRevId}) 데이터 상속 완료 — 현재 총 ${total.toLocaleString()}개`);
  }
}
