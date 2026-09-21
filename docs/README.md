# docs — 참고 문서 모음

`ag-grid-data`(멀티에이전트 리비전 처리 시스템)를 다시 파악하거나 확장할 때 참고할 수 있도록,
설계·구현·운영 내용을 주제별로 정리한 문서입니다.

프로젝트 개요는 [../CLAUDE.md](../CLAUDE.md)를 우선 참고하세요. 이 폴더는 그 내용을 더 깊게 풀어 설명합니다.

## 목차

| 문서 | 내용 |
|------|------|
| [01-overview.md](01-overview.md) | 프로젝트 목적, 실행 방법, 파일 구조 |
| [02-architecture.md](02-architecture.md) | 멀티에이전트 파이프라인, 리비전 상속 모델 |
| [03-database-schema.md](03-database-schema.md) | 테이블 스키마, 쿼리 패턴, ERD |
| [04-api-reference.md](04-api-reference.md) | REST API 엔드포인트 전체 레퍼런스 |
| [05-implementation-guide.md](05-implementation-guide.md) | 핵심 로직 구현 방법 (해시, 상속, 트랜잭션) |
| [06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md) | 트러블슈팅(WASM 메모리 크래시 등), 성능, 배포 |

## 원본 설계 문서 vs 실제 구현

프로젝트 루트에는 초기 기획 단계에서 작성된 설계 문서 3개가 있습니다.
실제 구현은 이 설계에서 **일부 변경**되었으므로, 아래 대응을 참고해 원본 문서를 읽으세요.

| 루트 설계 문서 | 실제 구현과의 차이 |
|----------------|----------------------|
| [implementation_plan.md](../implementation_plan.md) | 큐를 Redis로 설계했으나 실제로는 `InMemoryQueue`(EventEmitter 기반) 사용. Postgre/MySQL 언급되지만 실제로는 sql.js(WASM SQLite) 사용 |
| [multi_agent_revision_design.md](../multi_agent_revision_design.md) | 청크 크기 1만~3만 건으로 설계했으나 실제로는 WASM 메모리 한계로 2,000건으로 축소 (자세한 내용은 [06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md)) |
| [revision_system_spec.md](../revision_system_spec.md) | 스키마와 핵심 SQL 패턴은 설계대로 구현됨. `hash_value`는 SHA-256 사용 |

더 세밀한 단계별 구현 기록(총 20단계)은 [ai-step/README.md](../ai-step/README.md)에 있습니다.
이 `docs/` 폴더는 그 20개 문서를 주제별로 재구성·요약한 것이며, 특정 변경의 배경을 깊게 알고 싶다면
`ai-step/step-NN-*.md`를 직접 참고하세요.
