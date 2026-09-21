# 06. 트러블슈팅 · 성능 · 배포

## WASM 메모리 크래시

### 증상

300K+ 행 규모 DB에서 신규 리비전 추가 시 다음과 같이 크래시 발생 ([ai-step/step-17](../ai-step/step-17-wasm-memory-fix.md)):

```
[Worker-1] chunk 13 완료 — 2,000건
RuntimeError: memory access out of bounds
    at wasm://wasm/0028444a:wasm-function[235]:0xee54
```

청크 크기를 10,000 → 2,000으로만 줄여서는 해결되지 않았다.

### 원인

sql.js는 DB 파일 전체를 WASM 선형 메모리(기본 약 16MB = 256 pages)에 올려서 동작한다.
DB 파일이 100MB를 넘어가면 로드 자체는 되어도, INSERT 작업의 임시 버퍼가 들어갈 여유 공간이
없어 크래시가 난다.

### 해결 (4가지 조치를 함께 적용)

1. **WASM 힙 크기 확장** (`src/db/connection.ts`):
   ```typescript
   const SQL = await initSqlJs({
     wasmMemory: new WebAssembly.Memory({ initial: 2048, maximum: 16384 }),
   } as any);
   // initial: 2048 pages = 128MB, maximum: 16384 pages = 1GB
   ```
   `@types/sql.js`에 `wasmMemory` 옵션이 없어 `as any`로 우회. 런타임은 실제로 지원함.

2. **`tsconfig.json`에 `"DOM"` lib 추가**: `WebAssembly.Memory` 타입이 DOM lib에 정의되어 있어
   타입 인식을 위해 필요 (런타임 동작과는 무관).

3. **상속 쿼리 배치 처리** (`SnapshotAgent`): 단일 `INSERT ... SELECT` 대신 5,000건 단위
   `LIMIT/OFFSET` 반복 + `BEGIN`/`COMMIT`. → 중간 결과셋이 힙을 한 번에 차지하는 문제 해결.

4. **Worker 청크 크기 축소**: `CoordinatorAgent.CHUNK_SIZE`를 10,000 → 2,000으로 낮춰
   트랜잭션 하나가 점유하는 임시 메모리를 1/5로 축소.

### 결과

| DB 크기 | 조치 전 | 조치 후 |
|---------|---------|---------|
| ~100K 행 | 정상 | 정상 |
| ~300K 행 | chunk 13에서 크래시 | 정상 완료 |
| ~500K+ 행 | — | 128MB 힙으로 처리 가능 |

**교훈**: sql.js 기반 시스템에서 대량 쓰기를 다룰 때는 (1) 힙을 넉넉히 잡고, (2) 모든 대량 쓰기를
작은 배치로 쪼개고, (3) 배치마다 트랜잭션을 여닫는 3가지를 함께 적용해야 안정적이다.
하나만 적용하면 임계 규모에서 다시 크래시가 재발한다.

## 성능 특성

| 레코드 수 | 처리 시간 | 비고 |
|-----------|-----------|------|
| ~10,000 | <1s | 정상 |
| ~100,000 | ~3–5s | 허용 범위 |
| ~300,000 | 10s+ | sql.js 한계 접근 |

병목은 주로 `inheritExcluding`의 `revision_snapshot` 전체 스캔이다. 리비전 수가 늘어날수록
스캔 대상 행도 누적되므로, 리비전이 매우 많아지면 (수백 개 이상) 상속 비용이 커진다.
프로덕션 규모의 대용량이 필요하면 PostgreSQL 등 실제 서버형 DB로 마이그레이션을 검토한다
(`revision_snapshot(rev_id)`, `data_pool(master_id)`, `data_pool(hash_value)` 인덱스 활용 전제).

## 서버사이드 페이지네이션

30만 건을 한 번에 프런트엔드로 내려보내지 않기 위해 AG Grid Infinite Row Model +
`GET /api/revisions/:id/data?limit=&offset=`로 전환했다 ([ai-step/step-18](../ai-step/step-18-server-side-pagination.md)).
브라우저 메모리 문제와 초기 로딩 지연을 동시에 해결한다.

## VPS 배포 (nginx + PM2 + GitHub Actions)

배포 대상: VPS `/grid/` 경로. 상세: [ai-step/step-20](../ai-step/step-20-vps-deployment.md).

### 배포 파이프라인

```
GitHub Push (main)
    → GitHub Actions: npm install && npm run build (tsc)
    → SCP 전송 (dist/, public/, package.json, package-lock.json)
    → 서버에서 npm install --omit=dev
    → PORT=3001 pm2 start dist/server.js --name "ag-grid"
```

`revision.db`는 배포 전송 대상에서 **의도적으로 제외**되어 서버의 기존 데이터가 보존된다.
(최초 배포 시에는 파일이 없으므로 빈 DB가 자동 생성됨.)

### nginx 리버스 프록시

```nginx
location /grid/ {
    rewrite ^/grid/(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 경로 접두사 문제와 `API_BASE`

`/grid/`에서 로드된 `index.html`이 `fetch('/api/...')`를 호출하면 nginx의 루트(`/`) 블록으로
잘못 라우팅된다. 해결책은 프런트엔드에서 현재 경로를 보고 API 베이스를 동적으로 결정하는 것:

```javascript
const API_BASE = window.location.pathname.startsWith('/grid') ? '/grid' : '';
fetch(API_BASE + '/api/revisions');
```

| 환경 | URL | API_BASE | 실제 요청 |
|------|-----|----------|-----------|
| 로컬 | `localhost:3001` | `""` | `/api/revisions` |
| VPS | `/grid/` | `"/grid"` | `/grid/api/revisions` → nginx가 `/api/revisions`로 rewrite |

### 환경변수

```typescript
const PORT = Number(process.env.PORT) || 3001;
```

로컬은 기본 포트, VPS는 `PORT=3001 pm2 start ...`로 명시 지정.

### GitHub Secrets (Actions에서 필요)

| Secret | 설명 |
|--------|------|
| `SERVER_IP` | VPS IP |
| `SERVER_USER` | SSH 사용자 |
| `SSH_PRIVATE_KEY` | SSH 개인키 |

### VPS 초기 세팅 체크리스트

```bash
mkdir -p ~/ag-grid-data
sudo chown -R deploy-user:deploy-user ~/ag-grid-data
node --version        # v18+ 필요 (WASM 지원)
pm2 startup && pm2 save
sudo nginx -t && sudo systemctl restart nginx
```

`git clone`은 불필요 — GitHub Actions가 빌드 결과물만 SCP로 전송한다.
