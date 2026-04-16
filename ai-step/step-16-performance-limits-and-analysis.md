# Step 16 — 성능 한계 분석 및 향후 방향

## 목적
100,000건 제한 설정의 배경, sql.js 성능 특성 파악,  
그리고 대용량(30만건+) 처리 시 발생하는 병목 분석.

---

## 현재 제한

```typescript
// POST /api/revisions
const count = Math.min(rawCount, 100_000);  // 100,000건 상한
```

이전: 30,000건 → 트랜잭션 최적화 후 100,000건으로 상향.

---

## sql.js 성능 특성

| 항목 | 내용 |
|------|------|
| 엔진 | SQLite WASM (Emscripten 컴파일) |
| 메모리 | WASM 선형 메모리 — 힙 증가에 한계 |
| 트랜잭션 없음 | 행당 WAL flush → 10,000행 = 10,000 fsync 등가 |
| 트랜잭션 적용 | 청크 단위 1회 flush → 10~20× 빠름 |
| 파일 I/O | `db.export()` → Buffer → writeFileSync (동기 직렬화) |

---

## 병목 지점별 분석

### 1. Worker 처리 (INSERT + SELECT)
- 행당 2 SQL (`INSERT OR IGNORE` + `SELECT id`)
- 트랜잭션으로 묶으면 10,000행 → ~0.3s
- 병목이 아님

### 2. `inheritExcluding` / `inheritUnchangedData`
```sql
INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id)
SELECT ?, s.data_id
FROM revision_snapshot s
JOIN data_pool p ON s.data_id = p.id
WHERE s.rev_id = ?
  AND p.master_id NOT IN (...)
```
- `revision_snapshot` 전체 스캔 (인덱스 없으면 O(N))
- **30만건 이상에서 병목 발생**
- sql.js는 네이티브 SQLite 대비 5~10× 느림

### 3. `db.export()` — 저장
- DB 전체를 메모리로 직렬화 후 파일 쓰기
- 데이터가 클수록 선형 증가
- 30만건 DB: ~100ms

### 4. AG Grid 렌더링
- `rowData` 배열을 한 번에 넘기므로 100,000행 이상은 브라우저 렌더링 지연
- AG Grid 무한 스크롤(서버 사이드 Row Model) 전환으로 해결 가능

---

## 30만건 시나리오에서 관찰된 증상

- 신규 리비전 추가 시 **inheritExcluding 단계**에서 5~15초 대기
- `db.export()` 자체는 ~200ms로 허용 범위
- WASM 힙 부족(메모리 크래시)은 트랜잭션 적용 후 해결됨
- 브라우저에서 30만행 그리드 로딩은 ~3~5초 (DOM 렌더링 병목)

---

## 현재 구조의 적합 규모

| 레코드 수 | 리비전 처리 | 그리드 렌더링 |
|-----------|-------------|--------------|
| ~10,000 | 빠름 (<1s) | 빠름 |
| ~100,000 | 허용 (~3s) | 허용 (~1s) |
| ~300,000 | 느림 (10s+) | 느림 (3s+) |
| 1,000,000+ | sql.js 한계 초과 | 불가 |

---

## 향후 개선 방향

### 단기 (sql.js 유지)
- `revision_snapshot`에 `(rev_id, data_id)` 복합 인덱스 추가
- `data_pool`에 `master_id` 인덱스 추가
- `inheritExcluding` 쿼리를 `LEFT JOIN ... IS NULL` 패턴으로 교체 (NOT IN보다 빠름)

```sql
-- 최적화 버전
INSERT OR IGNORE INTO revision_snapshot (rev_id, data_id)
SELECT ?, s.data_id
FROM revision_snapshot s
LEFT JOIN data_pool p ON s.data_id = p.id AND p.master_id IN (...)
WHERE s.rev_id = ?
  AND p.id IS NULL
```

### 중기 (PostgreSQL 마이그레이션)
- `better-pg` 또는 `postgres` 패키지 사용
- 네이티브 연결 풀 + 인덱스 → 100× 이상 성능 향상
- AG Grid 서버 사이드 Row Model 도입

### 장기 (완전 분산)
- 청크 처리를 Node.js Worker Thread로 실제 병렬화
- Redis Queue로 InMemoryQueue 교체
- 리비전 스냅샷을 오브젝트 스토리지(S3)로 오프로드

---

## 현재 결론

개발·데모 목적 (10만건 이하): **sql.js + 트랜잭션 구조로 충분**  
프로덕션 대용량 처리: **PostgreSQL + Worker Thread 마이그레이션 필요**
