# AI Step 문서 목록

멀티에이전트 리비전 처리 시스템 구현 과정을 단계별로 기록한 문서.

| 번호 | 파일 | 내용 |
|------|------|------|
| 01 | [step-01-project-init.md](step-01-project-init.md) | package.json, tsconfig.json 생성 |
| 02 | [step-02-dependency-install.md](step-02-dependency-install.md) | npm 설치 — better-sqlite3 실패 → sql.js 교체 |
| 03 | [step-03-types.md](step-03-types.md) | 공유 타입 정의 (TaskMessage, ResultMessage) |
| 04 | [step-04-db-schema.md](step-04-db-schema.md) | SQLite 스키마 3개 테이블 구현 |
| 05 | [step-05-queue.md](step-05-queue.md) | 인메모리 큐 (Redis 대체) |
| 06 | [step-06-coordinator-agent.md](step-06-coordinator-agent.md) | Coordinator Agent — 작업 생성·분할·투입 |
| 07 | [step-07-worker-agent.md](step-07-worker-agent.md) | Worker Agent — 해시 계산 + Upsert |
| 08 | [step-08-snapshot-agent.md](step-08-snapshot-agent.md) | Snapshot Agent — 매핑 삽입·상속 |
| 09 | [step-09-validation-agent.md](step-09-validation-agent.md) | Validation Agent — Row Count + 해시 검증 |
| 10 | [step-10-main-and-result.md](step-10-main-and-result.md) | main.ts 오케스트레이션 및 실행 결과 |
