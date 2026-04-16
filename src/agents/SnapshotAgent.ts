import { Database } from 'sql.js';
import { ResultMessage } from '../types';

export class SnapshotAgent {
  constructor(private readonly db: Database) {}

  insertMappings(results: ResultMessage[]): void {
    if (!results.length) return;
    const revId = results[0].rev_id;
    let totalMapped = 0;

    this.db.run('BEGIN');
    for (const result of results) {
      for (const dataId of result.data_ids) {
        this.db.run(
          `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id) VALUES (?, ?)`,
          [revId, dataId],
        );
        totalMapped++;
      }
    }
    this.db.run('COMMIT');

    console.log(
      `\n[Snapshot] rev_id=${revId} — revision_snapshot에 ${totalMapped.toLocaleString()}개 매핑 삽입 완료`,
    );
  }

  // 수정 리비전용: fromRevId에서 상속하되 수정된 master_id 제외
  inheritExcluding(revId: number, fromRevId: number, excludedMasterIds: string[]): number {
    if (excludedMasterIds.length === 0) {
      this.inheritUnchangedData(revId, fromRevId);
    } else {
      const ph = excludedMasterIds.map(() => '?').join(', ');
      this.db.run(
        `INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id)
         SELECT ?, s.data_id
         FROM revision_snapshot s
         JOIN data_pool p ON s.data_id = p.id
         WHERE s.rev_id = ?
           AND p.master_id NOT IN (${ph})`,
        [revId, fromRevId, ...excludedMasterIds],
      );
    }
    const res = this.db.exec(`SELECT COUNT(*) FROM revision_snapshot WHERE rev_id = ?`, [revId]);
    const total = res[0].values[0][0] as number;
    const inherited = total - excludedMasterIds.length;
    console.log(`[Snapshot] rev_id=${revId} — 상속 ${inherited.toLocaleString()}건 (수정 제외 ${excludedMasterIds.length}건)`);
    return inherited;
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
