import { Database } from 'sql.js';

export interface ValidationResult {
  passed: boolean;
  revId: number;
  expectedCount: number;
  actualCount: number;
  sampleOk: boolean;
  details: string;
}

export class ValidationAgent {
  private readonly SAMPLE_SIZE = 10;

  constructor(private readonly db: Database) {}

  validate(revId: number, expectedCount: number): ValidationResult {
    console.log(`\n[Validation] rev_id=${revId} 검증 시작 (기대값: ${expectedCount.toLocaleString()}건)`);

    // 1. 스냅샷 Row Count 검증
    const countRes = this.db.exec(
      `SELECT COUNT(*) FROM revision_snapshot WHERE rev_id = ?`,
      [revId],
    );
    const actualCount = countRes[0].values[0][0] as number;
    const countMatch = actualCount === expectedCount;

    // 2. 샘플링 검증: 무작위 data_id에 대해 hash_value 존재 여부 확인
    const sampleRes = this.db.exec(
      `SELECT dp.id, dp.hash_value
       FROM revision_snapshot rs
       JOIN data_pool dp ON rs.data_id = dp.id
       WHERE rs.rev_id = ?
       LIMIT ?`,
      [revId, this.SAMPLE_SIZE],
    );

    const sampleOk =
      sampleRes.length > 0 &&
      sampleRes[0].values.every(([, hash]) => typeof hash === 'string' && (hash as string).length === 64);

    const passed = countMatch && sampleOk;
    const details = [
      `Row Count: ${actualCount.toLocaleString()} / ${expectedCount.toLocaleString()} → ${countMatch ? 'OK' : 'MISMATCH'}`,
      `Hash 샘플링 (${this.SAMPLE_SIZE}건): ${sampleOk ? 'OK' : 'FAILED'}`,
    ].join(' | ');

    console.log(`[Validation] ${details}`);
    console.log(`[Validation] 최종 결과: ${passed ? 'PASSED' : 'FAILED'}`);

    return { passed, revId, expectedCount, actualCount, sampleOk, details };
  }
}
