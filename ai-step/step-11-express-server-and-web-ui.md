# Step 11 — Express 서버 + AG Grid 웹 UI

## 목적
CLI 데모에서 브라우저에서 확인·조작 가능한 웹 애플리케이션으로 전환.

---

## 구조 결정

```
ag-grid-data/
├── src/server.ts     ← Express API 서버 (기존 에이전트 코드 재사용)
├── public/index.html ← AG Grid UI (CDN, 빌드 없음)
└── package.json      ← express, @types/express 추가
```

Express가 `public/` 정적 파일을 서빙 → 백엔드/프론트가 같은 포트(3000)에서 동작.  
AG Grid는 CDN으로 로드하여 별도 빌드 스텝 없음.

---

## 설치 패키지

```bash
npm install express
npm install -D @types/express
```

---

## API 엔드포인트

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/revisions` | 전체 리비전 목록 (snapshot_count 포함) |
| GET | `/api/revisions/:id/data` | 특정 리비전 AG Grid 데이터 |
| POST | `/api/revisions` | 새 리비전 생성 (에이전트 파이프라인 실행) |
| GET | `/api/db/stats` | 테이블별 행 수 요약 |
| GET | `/api/db/:table` | 테이블 데이터 조회 (페이징) |

---

## 서버 시작 시 초기 데이터 자동 생성

```typescript
// 서버 부트스트랩 시 리비전 2개 자동 생성 (상속 관계 시연)
const r1 = await runPipeline(db, generateData(500, 0, 0), '초기 상품 데이터', null);
await runPipeline(db, generateData(100, 500, 77), '2차 신규 상품 추가', r1.revId);
// REV #2: 500 상속 + 100 신규 = 600건
```

---

## UI 주요 기능

- **사이드바**: 리비전 목록 (상태 배지, 총 건수)
- **메인 그리드**: AG Grid Community (정렬·필터·페이지네이션)
- **DB 뷰어**: 헤더 버튼 → 3개 테이블 탭·통계 카드·페이징

---

## 발견된 버그 및 수정

### onclick 인라인에서 따옴표 충돌
```javascript
// ❌ 문제: JSON.stringify("초기 상품") → "초기 상품" (큰따옴표 포함)
onclick="selectRevision(1, "초기 상품")"  // 속성이 중간에 닫힘

// ✅ 해결: data-* 속성 + 이벤트 위임
<div data-rev-id="1" data-memo="초기 상품">
container.onclick = e => {
  const item = e.target.closest('.revision-item');
  selectRevision(Number(item.dataset.revId), item.dataset.memo);
};
```

### 모달 드래그 시 닫힘 현상
```javascript
// ❌ 문제: 입력창 안에서 드래그 → mouseup이 overlay에서 발생 → click 이벤트로 닫힘

// ✅ 해결: mousedown 시작점도 overlay여야 닫히도록
let mouseDownOnOverlay = false;
overlay.addEventListener('mousedown', e => { mouseDownOnOverlay = e.target === e.currentTarget; });
overlay.addEventListener('mouseup',   e => {
  if (mouseDownOnOverlay && e.target === e.currentTarget) overlay.classList.remove('open');
  mouseDownOnOverlay = false;
});
```

---

## 실행 명령

```bash
npm run server
# → http://localhost:5500
```
