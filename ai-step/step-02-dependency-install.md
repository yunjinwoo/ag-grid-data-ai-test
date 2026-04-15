# Step 02 — 의존성 설치

## 목적
프로젝트 실행에 필요한 npm 패키지 설치.

---

## 과정: `better-sqlite3` → `sql.js` 교체

### 최초 시도
`better-sqlite3`를 선택했으나 설치 실패.

```
npm error gyp ERR! find VS
npm error You need to install the latest version of Visual Studio
npm error including the "Desktop development with C++" workload.
```

**원인**: `better-sqlite3`는 C++ 네이티브 모듈이므로 Visual Studio Build Tools가 필요함.  
현재 환경에 Build Tools가 미설치 상태.

### 해결: `sql.js` 채택
`sql.js`는 SQLite를 WebAssembly로 컴파일한 순수 JavaScript 패키지로, 네이티브 컴파일 없이 동작.

```bash
npm install
# added 23 packages in 1s — 0 vulnerabilities
```

---

## 최종 의존성 트리

```
sql.js          ^1.12.0    SQLite (WebAssembly, 컴파일 불필요)
@types/sql.js   ^1.4.9     TypeScript 타입 정의
@types/node     ^20.11.0   Node.js 내장 모듈 타입 (crypto, events 등)
ts-node         ^10.9.2    TypeScript 직접 실행
typescript      ^5.3.3     TypeScript 컴파일러
```

---

## 참고: 운영 전환 시 교체 대상

| 개발 환경 | 운영 환경 |
|-----------|-----------|
| `sql.js` (인메모리) | PostgreSQL / MySQL |
| `InMemoryQueue` | Redis + BullMQ |
