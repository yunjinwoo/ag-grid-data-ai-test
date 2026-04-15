# Step 03 — 공유 타입 정의

## 목적
에이전트 간 메시지 규약을 TypeScript 타입으로 고정하여, 인터페이스 불일치를 컴파일 타임에 차단.

---

## 파일: `src/types/index.ts`

```typescript
export type RevisionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface DataRow {
  master_id: string;
  payload: Record<string, unknown>;
}

export interface TaskMessage {
  rev_id: number;
  chunk_id: number;
  total_chunks: number;
  rows: DataRow[];
}

export interface ResultMessage {
  rev_id: number;
  chunk_id: number;
  status: 'success' | 'failed';
  data_ids: number[];
  error?: string;
}
```

---

## 타입 설계 의도

| 타입 | 역할 | 사용 에이전트 |
|------|------|---------------|
| `DataRow` | 입력 원본 행 1건 | Coordinator → Worker |
| `TaskMessage` | 큐에 투입되는 작업 단위 | Coordinator → Task Queue → Worker |
| `ResultMessage` | Worker의 처리 결과 | Worker → Result Queue → Snapshot |
| `RevisionStatus` | DB 상태값 리터럴 타입 | Coordinator, Validation |

### `TaskMessage` ↔ MD 설계 규약 대응

설계서(`multi_agent_revision_design.md`)에 정의된 JSON 규격:
```json
{ "rev_id": "REV_001", "chunk_id": 5, "total_chunks": 30, "rows": [...] }
```
→ TypeScript 인터페이스로 1:1 매핑 (`rev_id`는 DB Auto-increment이므로 `string` → `number`로 변경).
