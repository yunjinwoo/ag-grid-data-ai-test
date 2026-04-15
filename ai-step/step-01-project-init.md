# Step 01 — 프로젝트 초기 설정

## 목적
Node.js + TypeScript 기반의 멀티에이전트 리비전 처리 시스템을 구성하기 위한 프로젝트 설정 파일 생성.

---

## 생성 파일

### `package.json`
```json
{
  "name": "ag-grid-data-revision-system",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "sql.js": "^1.12.0"
  },
  "devDependencies": {
    "@types/sql.js": "^1.4.9",
    "@types/node": "^20.11.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

## 결정 사항

| 항목 | 선택 | 이유 |
|------|------|------|
| 런타임 | Node.js v24 | 이미 설치되어 있음 |
| 언어 | TypeScript | 타입 안정성, 에이전트 인터페이스 명확화 |
| 타겟 | ES2020 | `Promise.all`, `for...of`, `BigInt` 등 최신 문법 활용 |
