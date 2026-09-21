# 01. 프로젝트 개요

## 목적

멀티에이전트 아키텍처를 학습·시연하기 위한 프로젝트로, 상품 데이터를 **리비전(버전) 단위**로 관리한다.
데이터 처리를 역할이 분리된 여러 에이전트(Coordinator / Worker / Snapshot / Validation)가 나누어 수행하고,
결과를 AG Grid 웹 UI로 확인할 수 있다.

핵심 설계 원칙 (원본: [revision_system_spec.md](../revision_system_spec.md)):
- **데이터 불변성 (Immutability)**: 한 번 저장된 데이터 행은 수정하지 않고, 변경 시 새 행을 추가한다 (Append-only).
- **참조 기반 스냅샷 (Reference-based Snapshot)**: 리비전은 실제 데이터를 복사하지 않고, `revision_snapshot`을 통해 `data_pool`의 행을 참조만 한다.

## 실행

```bash
npm install
npm run server   # http://localhost:3001 (환경변수 PORT로 변경 가능)
```

`revision.db` 파일이 있으면 기존 데이터를 로드하고, 없으면 새로 생성한다 (`src/db/connection.ts`의 `getDb()`).

> 참고: `src/server.ts`의 `bootstrap()`에는 초기 리비전 2개(500건 + 100건 상속)를 자동 생성하는 코드가
> 있으나 현재는 주석 처리되어 있다. 필요 시 주석을 해제해서 사용한다.

다른 npm 스크립트:

| 스크립트 | 설명 |
|----------|------|
| `npm run server` | `ts-node src/server.ts` — 웹 서버 실행 (실사용 진입점) |
| `npm run dev` | `ts-node src/main.ts` — CLI 실행 (레거시, 초기 단계 산출물) |
| `npm run build` | `tsc` — `dist/`로 컴파일 |
| `npm start` | `node dist/server.js` — 빌드 결과물 실행 (배포 환경) |

## 파일 구조

```
ag-grid-data/
├── CLAUDE.md                    ← 프로젝트 규칙 요약 (AI 어시스턴트용)
├── docs/                        ← 지금 이 폴더 — 주제별 참고 문서
├── revision.db                  ← sql.js 내보낸 SQLite 파일 (자동 생성, git 추적 안 함 권장)
├── implementation_plan.md       ← 초기 기획 문서 (설계 vs 구현 차이는 docs/README.md 참고)
├── multi_agent_revision_design.md
├── revision_system_spec.md
├── src/
│   ├── server.ts                ← Express API 서버 + 파이프라인 함수 (runPipeline 등)
│   ├── main.ts                  ← CLI 실행 (레거시)
│   ├── types/index.ts           ← TaskMessage, ResultMessage, DataRow, RevisionStatus
│   ├── db/
│   │   └── connection.ts        ← getDb(), saveDb(), createSchema()
│   ├── agents/
│   │   ├── CoordinatorAgent.ts  ← createRevision(), markCompleted(), markFailed()
│   │   ├── WorkerAgent.ts       ← processTask() — 해시 계산 + INSERT OR IGNORE
│   │   ├── SnapshotAgent.ts     ← insertMappings(), inheritUnchangedData(), inheritExcluding()
│   │   └── ValidationAgent.ts   ← validate() — row count + 해시 샘플링 검증
│   └── queue/
│       └── InMemoryQueue.ts     ← push(), pop(), drain() (EventEmitter 기반)
├── public/
│   └── index.html               ← AG Grid UI (CDN 로드, 별도 빌드 없음)
├── .github/workflows/           ← VPS 배포용 GitHub Actions
└── ai-step/                     ← 구현 히스토리 (20단계 상세 기록)
```

## 기술 스택

| 영역 | 사용 기술 | 비고 |
|------|-----------|------|
| 서버 | Express 4 + TypeScript | `ts-node`로 즉시 실행 |
| DB | **sql.js** (WASM SQLite) | `better-sqlite3` 사용 금지 — Windows 네이티브 컴파일 문제 |
| 큐 | `InMemoryQueue` (자체 구현, EventEmitter 기반) | 최초 설계는 Redis였으나 미사용 |
| 프런트엔드 | AG Grid Community (CDN, `ag-grid-community@31.3.2`) | 빌드 도구 없이 순수 HTML/JS |
| 해시 | Node `crypto` — SHA-256 | 데이터 변경 감지 및 중복 제거용 |
| 배포 | nginx + PM2 + GitHub Actions | [06-troubleshooting-and-ops.md](06-troubleshooting-and-ops.md) 참고 |

다음: [02-architecture.md](02-architecture.md) — 에이전트 파이프라인과 상속 모델 상세.
