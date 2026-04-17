# SKILL.md — 재사용 가능한 기술 패턴 모음

이 프로젝트에서 학습하고 검증한 기술 패턴.  
다른 프로젝트에 그대로 적용 가능한 것들만 추렸음.

---

## 1. sql.js (WASM SQLite) — Node.js 환경

### 언제 쓰나
- 네이티브 SQLite 컴파일 불가 환경 (Windows, 일부 CI)
- 가볍게 SQLite를 쓰고 싶은데 `better-sqlite3`가 빌드 실패할 때

### 핵심 설정

```typescript
import initSqlJs from 'sql.js';

const SQL = await initSqlJs({
  // WASM 힙 확장 필수 (대용량 데이터 처리 시)
  // 1 page = 64KB / initial: 128MB / maximum: 1GB
  wasmMemory: new WebAssembly.Memory({ initial: 2048, maximum: 16384 }),
} as any);  // as any: 타입 정의 누락

// tsconfig.json에 "DOM" lib 추가 필요 (WebAssembly 타입)
// "lib": ["ES2020", "DOM"]
```

### 파일 영속성

```typescript
// 로드
const fileData = fs.readFileSync('db.sqlite');
db = new SQL.Database(fileData);

// 저장 (쓰기 작업마다 호출)
const data = db.export();
fs.writeFileSync('db.sqlite', Buffer.from(data));
```

### 대량 INSERT — 트랜잭션 필수

```typescript
// ❌ 트랜잭션 없음 → 10,000행 이상에서 WASM 크래시
db.run('INSERT ...');  // 반복

// ✅ 트랜잭션으로 묶기
db.run('BEGIN');
try {
  for (const row of rows) { db.run('INSERT ...'); }
  db.run('COMMIT');
} catch (e) { db.run('ROLLBACK'); throw e; }
```

### 대용량 상속 쿼리 — 배치 처리

```typescript
// ❌ 단일 INSERT...SELECT (30만 행 → WASM 힙 폭발)
db.run(`INSERT INTO b SELECT ... FROM a WHERE ...`);

// ✅ 5,000행씩 배치
const BATCH = 5_000;
let offset = 0;
while (true) {
  const rows = db.exec(`SELECT ... FROM a LIMIT ? OFFSET ?`, [BATCH, offset]);
  if (!rows.length || !rows[0].values.length) break;
  db.run('BEGIN');
  for (const [id] of rows[0].values) db.run('INSERT INTO b ...', [id]);
  db.run('COMMIT');
  if (rows[0].values.length < BATCH) break;
  offset += BATCH;
}
```

---

## 2. AG Grid Community — 서버사이드 페이지네이션

### Infinite Row Model (Community에서 서버사이드 구현)

```javascript
const gridApi = agGrid.createGrid(element, {
  rowModelType: 'infinite',
  cacheBlockSize: 200,          // 서버 요청 단위
  maxBlocksInCache: 5,          // 메모리 캐시 블록 수
  pagination: true,
  paginationPageSize: 100,
  paginationPageSizeSelector: false,  // 내장 드롭다운 제거 (UI 버그 방지)
  rowSelection: 'multiple',
  suppressRowClickSelection: true,    // 클릭 선택 효과 제거
});

// datasource — async 대신 .then() 사용 (v31 호환성)
gridApi.setGridOption('datasource', {
  getRows(params) {
    const limit = params.endRow - params.startRow;
    fetch(`/api/data?limit=${limit}&offset=${params.startRow}`)
      .then(r => r.json())
      .then(res => params.successCallback(res.rows, res.total))
      .catch(() => params.failCallback());
  }
});
```

### AG Grid 내부 요소 조작 (커스텀 UI 주입)

```javascript
// 페이지 바에 커스텀 셀렉터 주입
setTimeout(() => {
  const panel = document.querySelector('#myGrid .ag-paging-panel');
  if (panel && !panel.querySelector('.my-custom')) {
    const el = document.createElement('div');
    el.className = 'my-custom';
    el.innerHTML = `<select>...</select>`;
    panel.prepend(el);
  }
}, 0);
```

---

## 3. nginx 서브경로 배포 패턴

### 문제: fetch 절대경로가 서브경로를 무시함

```
브라우저가 /grid/ 에서 로드된 index.html이
fetch('/api/data') 호출
→ 브라우저는 /api/data 로 요청 (서버 루트로 감)
→ nginx의 /grid/ 블록이 잡지 못함
```

### 해결: API_BASE 자동 감지

```javascript
// index.html 최상단
const API_BASE = window.location.pathname.startsWith('/grid') ? '/grid' : '';

// 모든 fetch에 적용
fetch(API_BASE + '/api/data')
fetch(API_BASE + `/api/items/${id}`)
```

### nginx 설정

```nginx
location /myapp/ {
    rewrite ^/myapp/(.*)$ /$1 break;  # /myapp/ 접두사 제거
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## 4. Express 서버 — 실용 패턴

### PORT 환경변수

```typescript
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT);
// 로컬: npm run server       → 3000
// 배포: PORT=3001 pm2 start  → 3001
```

### fetch 오류 처리 (HTML 에러 페이지 방지)

```javascript
// ❌ JSON 파싱 실패 → "Unexpected token '<'"
const data = await fetch(url).then(r => r.json());

// ✅ 상태 코드 먼저 확인
const resp = await fetch(url, options);
if (!resp.ok) {
  const text = await resp.text();
  throw new Error(`서버 오류 (${resp.status}): ${text.slice(0, 200)}`);
}
const data = await resp.json();
```

### SQL Injection 방지 — 테이블명 화이트리스트

```typescript
const ALLOWED_TABLES = ['users', 'orders', 'products'] as const;

app.get('/api/db/:table', (req, res) => {
  const table = req.params.table;
  if (!(ALLOWED_TABLES as readonly string[]).includes(table)) {
    res.status(400).json({ error: 'not allowed' }); return;
  }
  // 이제 안전하게 사용 가능
  db.exec(`SELECT * FROM ${table}`);
});
```

---

## 5. GitHub Actions — Node.js 서버 배포 패턴

```yaml
- name: SCP 전송 (빌드 결과물만)
  uses: appleboy/scp-action@master
  with:
    source: "dist,public,package.json,package-lock.json"
    target: "~/myapp"
    # node_modules, .env, DB 파일 등은 제외

- name: 서버 재시작
  uses: appleboy/ssh-action@master
  with:
    script: |
      cd ~/myapp
      npm install --omit=dev   # devDependencies 제외
      pm2 delete myapp || true
      PORT=3001 pm2 start dist/server.js --name "myapp"
      pm2 save
```

### 전송 제외 대상 (항상 서버에서 유지)
- `node_modules/` — 서버에서 `npm install`
- `.env` — 서버에 직접 설정
- `*.db`, `*.sqlite` — 데이터 보존
- `src/` — 소스는 불필요 (dist/ 만 전송)

---

## 6. 해시 기반 중복 제거 패턴

```typescript
// 동일 내용 = 동일 hash → INSERT OR IGNORE로 자동 중복 제거
const hash = createHash('sha256')
  .update(`${master_id}:${JSON.stringify(payload)}`)
  .digest('hex');

db.run(
  `INSERT OR IGNORE INTO data_pool (master_id, hash_value, payload)
   VALUES (?, ?, ?)`,
  [master_id, hash, JSON.stringify(payload)],
);

// 방금 삽입됐든 이미 있었든 같은 id 반환
const res = db.exec(`SELECT id FROM data_pool WHERE hash_value = ?`, [hash]);
const dataId = res[0].values[0][0];
```

---

## 7. 이벤트 위임 + data-* 속성 패턴

```javascript
// ❌ 문제: inline onclick에서 따옴표 충돌
items.innerHTML = `<div onclick="fn(${JSON.stringify(memo)})">`;

// ✅ 해결: data-* + 이벤트 위임
items.innerHTML = `<div data-id="${id}" data-memo="${memo.replace(/"/g, '&quot;')}">`;

container.onclick = e => {
  const item = e.target.closest('.revision-item');
  if (!item) return;
  fn(Number(item.dataset.id), item.dataset.memo);
};
```

---

## 8. 모달 드래그 닫힘 방지

```javascript
// ❌ 문제: 입력창에서 드래그 → mouseup이 overlay에서 발생 → 모달 닫힘
overlay.onclick = e => { if (e.target === overlay) overlay.close(); };

// ✅ 해결: mousedown 시작점도 overlay여야 닫히도록
let mouseDownOnOverlay = false;
overlay.addEventListener('mousedown', e => {
  mouseDownOnOverlay = e.target === e.currentTarget;
});
overlay.addEventListener('mouseup', e => {
  if (mouseDownOnOverlay && e.target === e.currentTarget) overlay.classList.remove('open');
  mouseDownOnOverlay = false;
});
```
