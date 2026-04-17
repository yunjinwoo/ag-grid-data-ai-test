# ag-grid-data — 멀티에이전트 리비전 처리 시스템

## 프로젝트 목적

멀티에이전트 아키텍처를 학습·시연하기 위한 프로젝트.  
상품 데이터를 리비전(버전) 단위로 관리하며, 에이전트들이 역할을 나눠 처리한다.

---

## 실행

```bash
npm run server   # http://localhost:3001
```

서버 시작 시 초기 리비전 2개 자동 생성 (500건 + 100건 상속).  
`revision.db` 파일이 있으면 기존 데이터를 로드하고, 없으면 새로 생성한다.

---

## 핵심 아키텍처

### 에이전트 파이프라인

```
CoordinatorAgent  →  WorkerAgent (×3, 병렬)  →  SnapshotAgent  →  ValidationAgent
   리비전 생성         해시 계산 + upsert        스냅샷 매핑          건수 검증
```

### 리비전 상속 모델

```
REV #1: [A, B, C]              ← 신규 500건
REV #2: [A, B, C] + [D, E]    ← REV #1 상속 + 신규 100건
```

새 리비전은 이전 데이터를 **삭제하지 않고 revision_snapshot에서 참조만 추가**한다.

### DB 구조 (sql.js — WASM SQLite)

```
data_pool           : id, master_id, hash_value (UNIQUE), payload (JSON)
revision_master     : rev_id, memo, status, new_count, inherited_count, created_at
revision_snapshot   : rev_id, data_id  ← 리비전과 데이터의 N:N 연결
```

---

## 파일 구조

```
ag-grid-data/
├── CLAUDE.md                    ← 지금 이 파일
├── revision.db                  ← sql.js 내보낸 SQLite 파일 (자동 생성)
├── src/
│   ├── server.ts                ← Express API 서버 + 파이프라인 함수
│   ├── main.ts                  ← CLI 실행 (레거시)
│   ├── types.ts                 ← TaskMessage, ResultMessage, DataRow
│   ├── db/
│   │   └── connection.ts        ← getDb(), saveDb(), createSchema()
│   ├── agents/
│   │   ├── CoordinatorAgent.ts  ← createRevision(), markCompleted(), markFailed()
│   │   ├── WorkerAgent.ts       ← processTask() — hash + INSERT OR IGNORE
│   │   ├── SnapshotAgent.ts     ← insertMappings(), inheritUnchangedData(), inheritExcluding()
│   │   └── ValidationAgent.ts  ← validate() — row count 검증
│   └── queue/
│       └── InMemoryQueue.ts     ← push(), drain()
├── public/
│   └── index.html               ← AG Grid UI (CDN, 빌드 없음)
└── ai-step/                     ← 구현 히스토리 (단계별 MD 문서)
    ├── README.md
    ├── step-01 ~ step-10        ← CLI 멀티에이전트 시스템 구축
    └── step-11 ~ step-16        ← 웹 UI, 상속, 편집, 삭제, 성능 분석
```

---

## API 엔드포인트

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/revisions` | 전체 리비전 목록 (snapshot_count 포함) |
| GET | `/api/revisions/:id/data` | 특정 리비전 AG Grid 데이터 |
| POST | `/api/revisions` | 새 리비전 생성 (직전 리비전 상속 + 신규 추가) |
| POST | `/api/revisions/:id/edit` | 셀 수정 → 새 리비전 (변경된 행만 처리) |
| POST | `/api/revisions/:id/delete-rows` | 선택 행 삭제 → 새 리비전 |
| DELETE | `/api/revisions/:id` | 리비전 삭제 (data_pool은 유지) |
| GET | `/api/db/stats` | 테이블별 행 수 요약 |
| GET | `/api/db/:table` | 테이블 데이터 조회 (페이징) |
| POST | `/api/db/cleanup` | 고아 data_pool 행 삭제 |

---

## 절대 규칙 (반드시 지킬 것)

### 1. sql.js 트랜잭션 필수
대량 INSERT는 반드시 `BEGIN` / `COMMIT`으로 감싼다.  
빠뜨리면 WASM 메모리 오버플로우로 크래시 발생.

```typescript
this.db.run('BEGIN');
try {
  for (const row of rows) { /* INSERT */ }
  this.db.run('COMMIT');
} catch (e) {
  this.db.run('ROLLBACK');
  throw e;
}
```

### 2. better-sqlite3 사용 금지
Windows 환경에서 네이티브 컴파일 불가.  
반드시 `sql.js` (WASM) 사용.

### 3. data_pool 직접 삭제 금지
다른 리비전이 같은 data_id를 참조할 수 있음.  
삭제는 반드시 `POST /api/db/cleanup` (NOT IN 안전 쿼리) 경유.

### 4. saveDb() 호출 필수
모든 쓰기 작업 완료 후 `saveDb()`를 호출해야 파일에 반영됨.

### 5. inheritExcluding — master_id 기준으로 제외
수정/삭제 리비전에서 상속 제외 시 `data_id`가 아닌 `master_id` 기준 사용.  
수정된 행은 새 hash → 새 data_id를 가지므로 data_id로 제외할 수 없음.

---

## 주요 함수 참조

### `runPipeline(db, newData, memo, prevRevId)`
신규 데이터 처리 + 이전 리비전 상속 → 새 리비전 생성.

### `runEditPipeline(db, baseRevId, changes, memo)`
변경된 행만 Worker 처리 → `inheritExcluding`으로 나머지 상속.

### `generateData(count, startIndex, seed)`
결정론적 상품 데이터 생성. `startIndex`로 master_id 연속성 보장.

### `SnapshotAgent.inheritExcluding(revId, fromRevId, excludedMasterIds)`
`fromRevId`의 스냅샷에서 지정된 master_id를 제외하고 `revId`로 상속.

---

## 성능 특성

| 레코드 수 | 처리 시간 | 비고 |
|-----------|-----------|------|
| ~10,000 | <1s | 정상 |
| ~100,000 | ~3–5s | 허용 범위 |
| ~300,000 | 10s+ | sql.js 한계 접근 |

병목은 주로 `inheritExcluding`의 revision_snapshot 전체 스캔.  
프로덕션 대용량이 필요하면 PostgreSQL 마이그레이션 검토 (→ ai-step/step-16 참조).

---

## 구현 히스토리

단계별 상세 기록은 [ai-step/README.md](ai-step/README.md) 참조.

- **step-01~10**: 멀티에이전트 시스템 기초 (타입, DB, 큐, 4개 에이전트, CLI 실행)
- **step-11**: Express 서버 + AG Grid 웹 UI
- **step-12**: 리비전 상속 구조
- **step-13**: DB 파일 영속성 + 트랜잭션 최적화
- **step-14**: 셀 편집 → 새 리비전 저장
- **step-15**: 삭제 기능 (리비전·행·고아 정리)
- **step-16**: 성능 분석 및 향후 방향

<!-- 
 // 재사용 가능한 부분만 추출한 템플릿

# 프로젝트명

## 실행
npm run server

## 절대 규칙
- 코드 수정 전 반드시 파일을 읽을 것
- 트랜잭션이 필요한 DB 작업은 BEGIN/COMMIT으로 감쌀 것
- 삭제 전 연관 데이터 의존성 확인
- 외부 라이브러리 추가 전 사용자에게 먼저 확인

## 작업 방식
- 기능 단위로 백엔드→프론트 순서로 작업
- 완료 기준(체크리스트) 없이 작업 종료 금지
- 에러 발생 시 원인 파악 후 수정, 무조건 재시도 금지 -->