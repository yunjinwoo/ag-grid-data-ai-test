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
| 11 | [step-11-express-server-and-web-ui.md](step-11-express-server-and-web-ui.md) | Express 서버 + AG Grid 웹 UI (CDN) |
| 12 | [step-12-revision-inheritance.md](step-12-revision-inheritance.md) | 리비전 상속 — 이전 데이터 유지 + 신규 추가 |
| 13 | [step-13-db-file-persistence-and-transactions.md](step-13-db-file-persistence-and-transactions.md) | DB 파일 영속성 + 트랜잭션으로 WASM 크래시 해결 |
| 14 | [step-14-cell-edit-save-as-revision.md](step-14-cell-edit-save-as-revision.md) | 셀 편집 → 새 리비전 저장 (inheritExcluding) |
| 15 | [step-15-deletion-features.md](step-15-deletion-features.md) | 리비전 삭제 · 행 삭제 · 고아 data_pool 정리 |
| 16 | [step-16-performance-limits-and-analysis.md](step-16-performance-limits-and-analysis.md) | 성능 한계 분석 및 향후 PostgreSQL 마이그레이션 방향 |
| 17 | [step-17-wasm-memory-fix.md](step-17-wasm-memory-fix.md) | WASM 메모리 한계 해결 — 힙 확장 + 배치 상속 + 청크 축소 |
