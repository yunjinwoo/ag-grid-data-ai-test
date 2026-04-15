# 대용량 데이터 리비전 관리 시스템 설계서 (System Specification)

## 1. 개요 (Overview)
본 문서는 회당 20~30만 건에 달하는 대용량 데이터셋의 변경 이력(Revision)을 효율적으로 관리하기 위한 아키텍처를 정의한다. 
핵심 원칙은 **'데이터 불변성(Immutability)'**과 **'참조 기반 스냅샷(Reference-based Snapshot)'**이다.

## 2. 데이터베이스 설계 (Schema)

### A. data_pool (데이터 본체 저장소)
- 역할: 모든 데이터 행의 버전별 실제 값을 저장.
- 특이사항: 동일 데이터는 중복 저장하지 않으며, 수정 시 신규 Row를 생성한다(Append-only).
- 컬럼:
    - `id`: PK (BigInt/Identity)
    - `master_id`: 원본 비즈니스 키 (예: 상품코드)
    - `hash_value`: 내용 변경 감지용 Hash (예: SHA-256)
    - `payload`: 실제 데이터 (JSON/JSONB 타입 - 필드 확장성 대응)

### B. revision_master (리비전 메타데이터)
- 역할: 리비전 그 자체에 대한 정보 관리.
- 컬럼: `rev_id` (PK), `memo`, `created_by`, `created_at`

### C. revision_snapshot (매핑 테이블)
- 역할: 특정 리비전에 포함되는 모든 `data_id` 리스트를 정의.
- 컬럼:
    - `rev_id`: FK (revision_master)
    - `data_id`: FK (data_pool)
    - *복합 PK 설정: (rev_id, data_id)*

## 3. 핵심 비즈니스 로직 (Core Logic)

### [Scenario: 리비전 생성 프로세스]
1. **데이터 비교**: 입력된 30만 건의 행 각각에 대해 `hash_value`를 계산.
2. **선택적 삽입**: `hash_value`가 기존 `data_pool`에 없는 경우에만 `data_pool`에 `INSERT`.
3. **스냅샷 구성**:
    - **Step 1 (기존 데이터 유지)**: 이전 리비전의 `data_id`들 중 수정되지 않은 행들의 ID를 새 리비전 번호로 복사 (`INSERT INTO ... SELECT`).
    - **Step 2 (신규/수정 데이터 추가)**: 새로 `INSERT`된 `data_id`들을 새 리비전 번호로 매핑 추가.

### [Scenario: 특정 리비전 조회 (AG Grid 연동)]
- 단일 JOIN 쿼리로 특정 시점의 전체 데이터(30만 건)를 즉시 추출.
```sql
SELECT p.* FROM revision_snapshot s
JOIN data_pool p ON s.data_id = p.id
WHERE s.rev_id = :target_rev_id;