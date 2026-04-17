# Step 20 — VPS 배포 (nginx + GitHub Actions + PM2)

## 목적
로컬 개발 환경을 VPS(49.247.202.50)의 `/grid/` 경로로 배포.  
기존 nginx에 location 블록 추가, GitHub Actions CI/CD 자동화.

---

## 배포 구조

```
GitHub Push (main)
    ↓ GitHub Actions
    ├─ npm install + npm run build (tsc)
    └─ SCP 전송 → ~/ag-grid-data/
           ├─ dist/        (컴파일된 JS)
           ├─ public/      (index.html)
           ├─ package.json
           └─ package-lock.json
                   ↓
              npm install --omit=dev
              PORT=3001 pm2 start dist/server.js

브라우저 → 49.247.202.50/grid/
    ↓ nginx
    → 127.0.0.1:3001 (Express)
```

---

## nginx 설정 추가

```nginx
# /etc/nginx/sites-available/upbit-alert 에 추가
location /grid/ {
    rewrite ^/grid/(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3001;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 포트 배정 현황

| 서비스 | 포트 | 경로 |
|--------|------|------|
| Upbit Alert | 5000 | /upbit/ |
| Review Frontend | 3000 | /review/ |
| **AG Grid** | **3001** | **/grid/** |

---

## API_BASE 자동 감지 — 경로 문제 해결

### 문제
`index.html`이 `/grid/` 에서 로드되면, `fetch('/api/...')` 요청은  
nginx의 `/grid/` 블록이 아닌 루트 `/` 블록(랜딩페이지)으로 라우팅됨.

### 해결
```javascript
// index.html 상단
const API_BASE = window.location.pathname.startsWith('/grid') ? '/grid' : '';

// 모든 fetch 호출에 API_BASE 적용
fetch(API_BASE + '/api/revisions')
fetch(API_BASE + `/api/revisions/${revId}/data?...`)
```

| 환경 | URL | API_BASE | 실제 요청 |
|------|-----|---------|---------|
| 로컬 | `localhost:5500` | `""` | `/api/revisions` |
| VPS | `/grid/` | `"/grid"` | `/grid/api/revisions` |

nginx가 `/grid/api/revisions` → Express `/api/revisions` 으로 rewrite.

---

## PORT 환경변수

```typescript
// server.ts
const PORT = Number(process.env.PORT) || 5500;
```

```bash
# 로컬 개발
npm run server          # → localhost:5500

# VPS 배포
PORT=3001 pm2 start dist/server.js --name "ag-grid"
```

---

## GitHub Actions — `.github/workflows/deploy.yml`

```yaml
name: Deploy AG Grid Server to iwinv
on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: 빌드
        run: npm install && npm run build

      - name: SCP 전송
        uses: appleboy/scp-action@master
        with:
          host: ${{ secrets.SERVER_IP }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          source: "dist,public,package.json,package-lock.json"
          target: "~/ag-grid-data"
          # revision.db 는 전송 제외 (서버 데이터 보존)

      - name: PM2 재시작
        uses: appleboy/ssh-action@master
        with:
          # ...
          script: |
            cd ~/ag-grid-data
            npm install --omit=dev
            pm2 delete ag-grid || true
            PORT=3001 pm2 start dist/server.js --name "ag-grid"
            pm2 save && pm2 list
```

### GitHub Secrets 필요 항목

| Secret | 설명 |
|--------|------|
| `SERVER_IP` | VPS IP (49.247.202.50) |
| `SERVER_USER` | SSH 사용자 (deploy-user) |
| `SSH_PRIVATE_KEY` | SSH 개인키 |

---

## VPS 초기 서버 세팅 체크리스트

```bash
# 1. 디렉토리 생성 및 권한
mkdir -p ~/ag-grid-data
sudo chown -R deploy-user:deploy-user ~/ag-grid-data
sudo chmod -R 755 ~/ag-grid-data

# 2. Node.js v18+ 확인 (WASM 지원 필요)
node --version

# 3. PM2 재부팅 자동시작 (최초 1회)
pm2 startup
# → 출력된 sudo 명령어 실행
pm2 save

# 4. nginx 설정 추가 후 문법 검사 및 재시작
sudo nginx -t
sudo systemctl restart nginx
```

> `git clone` 불필요 — GitHub Actions SCP가 빌드 결과물만 전송.

---

## revision.db 경로

```
~/ag-grid-data/dist/db/connection.js
  __dirname = ~/ag-grid-data/dist/db/
  path.join(__dirname, '../../revision.db')
           = ~/ag-grid-data/revision.db  ✓
```

배포 시 `revision.db`는 전송하지 않으므로 서버 데이터 보존됨.  
첫 배포 후 빈 DB가 자동 생성됨.
