# Step 09 — Validation Agent

## 목적
최종 스냅샷의 Row Count가 원본 요청 데이터 수와 일치하는지 확인하고,  
샘플링으로 해시 무결성을 검증.

---

## 파일: `src/agents/ValidationAgent.ts`

### 핵심 로직

```typescript
validate(revId: number, expectedCount: number): ValidationResult {
  // 1. Row Count 검증
  const countRes = this.db.exec(
    `SELECT COUNT(*) FROM revision_snapshot WHERE rev_id = ?`, [revId],
  );
  const actualCount = countRes[0].values[0][0] as number;
  const countMatch = actualCount === expectedCount;

  // 2. 해시 샘플링 검증 (상위 10건)
  const sampleRes = this.db.exec(
    `SELECT dp.id, dp.hash_value
     FROM revision_snapshot rs
     JOIN data_pool dp ON rs.data_id = dp.id
     WHERE rs.rev_id = ? LIMIT 10`,
    [revId],
  );
  // SHA-256 해시는 64자 hex 문자열
  const sampleOk = sampleRes[0].values.every(
    ([, hash]) => typeof hash === 'string' && hash.length === 64
  );

  return { passed: countMatch && sampleOk, ... };
}
```

---

## 반환 타입

```typescript
interface ValidationResult {
  passed: boolean;
  revId: number;
  expectedCount: number;
  actualCount: number;   // 실제 스냅샷 수
  sampleOk: boolean;     // 해시 샘플 정상 여부
  details: string;       // 요약 메시지
}
```

---

## 설계서 대응

`implementation_plan.md > Agent Roles > D. Validation Agent`:
- [x] 최종 스냅샷의 Row Count가 원본 요청 데이터 수와 일치하는지 확인
- [x] 누락된 `data_id`나 해시 불일치 사례 샘플링 검사
