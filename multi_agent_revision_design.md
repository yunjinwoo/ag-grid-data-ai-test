# 멀티에이전트 협업 리비전 시스템 설계 (Multi-Agent Design)

본 문서는 다수의 에이전트가 협업하여 대용량 데이터(20~30만 건)를 처리할 때의 역할과 규칙을 정의한다.

## 1. 시스템 워크플로우

1.  **Coordinator**: 리비전을 생성하고 작업을 분할하여 큐에 투입.
2.  **Workers (Parallel)**: 큐에서 작업을 가져와 해시 계산 및 `data_pool` 삽입.
3.  **Snapshot Agent**: 삽입 완료된 ID들을 수합하여 `revision_snapshot` 매핑 생성.
4.  **Validation Agent**: 리비전 완결성 검증 후 상태를 `COMPLETED`로 변경.

---

## 2. 에이전트 상세 역할 (Agent Personas)

### A. Coordinator Agent
- **입력**: 원본 데이터셋 (30만 건)
- **수행**: 
    - `revision_master` 레코드 생성 (status='PENDING').
    - 데이터를 10,000건 단위의 Chunk(총 30개)로 분할.
    - 각 Chunk에 대해 `rev_id`, `chunk_id`, `data`를 포함한 태스크 생성.
- **도구**: DB Write API, Task Queue Push API.

### B. Worker Agent (Scale-out 가능)
- **입력**: Task Message (rev_id, chunk_id, data)
- **수행**:
    - 개별 Row의 `payload` 해시 계산.
    - `data_pool`에 Upsert (해시 충돌 시 기존 ID 확보).
    - 처리 완료된 `data_id` 리스트와 `chunk_id`를 결과 큐에 전송.
- **도구**: SQL Upsert 익스텐션, Result Queue Push API.

### C. Snapshot Agent
- **입력**: Worker들의 처리 결과
- **수행**:
    - 모든 `chunk_id`가 수집될 때까지 대기 또는 실시간 스트리밍 삽입.
    - `revision_snapshot`에 `(rev_id, data_id)` 대량 삽입.
    - 이전 리비전 대비 변경되지 않은 행(Row) 정보 연계.
- **도구**: SQL Bulk Insert.

---

## 3. 통신 데이터 규격 (Messaging Spec)

### [수행 태스크 (Task)]
```json
{
  "rev_id": "REV_001",
  "chunk_id": 5,
  "total_chunks": 30,
  "rows": [
    {"master_id": "P001", "payload": {"name": "Item 1", "price": 100}},
    ...
  ]
}
```

### [처리 결과 (Result)]
```json
{
  "rev_id": "REV_001",
  "chunk_id": 5,
  "status": "success",
  "data_ids": [101, 102, 105, ...]
}
```

---

## 4. 장애 대응 및 예외 처리

- **멱등성(Idempotency)**: 모든 작업은 동일한 데이터에 대해 여러 번 실행해도 결과가 같아야 함 (`data_pool` 해시 기반 중복 체크 활용).
- **부분 실패**: 특정 `chunk_id` 실패 시 해당 청크만 재할당(Retry).
- **타임아웃**: 5분 이상 응답이 없는 워커의 작업은 Task Queue로 반환(Re-queue).

---

## 5. 모니터링 포인트

- `revision_master`의 `processed_chunks` / `total_chunks` 비율 확인.
- 작업 시작 시각과 종료 시각 기록을 통한 처리 성능성 측정.
