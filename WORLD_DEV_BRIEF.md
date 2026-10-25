# WORLD — 개발 에이전트 작업 지시서

> 프로젝트 코드명: **world** (공식 브랜드 미정)  
> MVP URL: **https://world.euiyun.com**  
> 제품 유형: 현실 지구를 바탕으로 한 글로벌 **비동기 영토 점유·거래·성장 웹게임**  
> 우선순위: **재미와 재방문 검증 > 안정적인 경제 > 최소 운영비 > 그래픽 화려함**

## 0. 에이전트에게 주는 지시

당신은 이 프로젝트의 시니어 풀스택 개발자, 게임 시스템 설계자, 보안 리뷰어다. 아래 요구사항을 기준으로 먼저 실행 가능한 MVP를 만들고, 가정이나 미정 사항은 `docs/decisions.md`에 기록한다. 불필요한 기능, LLM API, WebSocket, 별도 게임 서버, 마이크로서비스, 블록체인/NFT, 실시간 위치 추적은 만들지 않는다.

작업 시작 시 리포지토리를 조사하고 기존 설정을 보존한다. `docs/plan.md`에 작업 체크리스트를 작성하고 작은 단위로 구현/테스트/커밋한다. 비밀키는 절대 코드에 넣지 않는다. UI는 **영어 기본, 한국어 번역 가능하도록** 문자열을 분리한다. PC/모바일 반응형으로 만든다.

**불명확한 점은 운영비가 적고 쉽게 변경 가능한 선택으로 결정한다.** 단, 금전 거래/계정 보안/법률에 영향을 주는 부분은 추측하지 말고 기능 플래그로 비활성화한 후 검토 사항을 기록한다.

## 1. 제품 비전 및 범위

### 제품 한 줄 소개

> Claim a piece of a second Earth, develop your territory, trade resources, and shape its history together.

브랜드는 임시로 **WORLD**. 전쟁이 아니라 **제2의 지구, 토지 점유, 성장, 경제, 공동체**가 핵심이다. 경쟁·영토 분쟁은 게임의 하나의 수단이다. 부동산 투자/실제 토지 권리/자산 수익을 암시하지 않는다.

### 타깃
- 전 세계 브라우저 게임 이용자 / 지도 탐험 및 수집을 좋아하는 사용자
- PC 탐험 + 모바일 간단 행동·확인
- 초기에는 영어권 중심, 한국어 UI 지원

### 핵심 루프
1. 사용자 무료 가입 → 시작 구역과 기본 토지 1칸 배정(중복 없이 원자적 할당)
2. 지도에서 주변 미점유 토지를 발견 → 행동력으로 점유 시도
3. 소유 토지에서 자원 생산 → 시설 건설 또는 시장에서 자원 구매/판매
4. 플레이어 간 인접 영토 분쟁(비동기, 사전 규칙 공개) 또는 거래
5. 하루 1~2회 변화 확인, 주간 랭킹/정착 기록 확인

**로그인하지 않고도 지도를 구경할 수 있어야 한다.** 가입은 점유/거래 시점에만 필요.

## 2. 비즈니스 및 경제 원칙

### 무료 이용자
- 지도 탐험, 회원가입, 기본 토지 1칸, 토지 점유, 기본 생산, 시설, 자원 거래, 랭킹에 참여
- 행동력은 시간 기반으로 충전; 결제로 추가 행동력 구매 불가
- 핵심 플레이를 돈으로 잠그지 않음

### 게임 내 화폐
- `Gold`: **플레이 중 얻는 통화**. 자원/시설/시즌 토지 사용권의 인게임 거래에 사용. 현금 구매 불가, 출금·현금 환전·외부 전송 불가.
- `Gems`: **유료 프리미엄 통화**. 운영자가 제공하는 장식 스킨·프로필·깃발·꾸미기에만 사용. 플레이어 간 송금·교환·거래 금지. Gold로 환전 불가.
- `Gold` ↔ `Gems` 직접/간접 교환 불가; Gems 아이템은 유저 간 거래 불가.
- **유료로 전투력, 행동력, 승률, 점령 가능 범위를 구매하는 기능 금지.**
- 게임 재화/영토는 현실의 소유권이나 투자 상품이 아니다.

### 결제 패키지(초안; 실제 PG 연결 전 기능 플래그 OFF)
| 패키지 | USD | Gems | 설명 |
|---|---:|---:|---|
| Starter | $1 | 100 | 초소액 체험 |
| Builder | $10 | 1,100 | 일반 이용자 |
| Founder | $100 | 12,000 | 수집가/후원자 |

- MVP 1차는 **실제 결제 없이 가짜 상점 UI/테스트 결제 모드만** 만든다. 카드 정보를 직접 저장하지 않는다.
- 실제 판매 전: 관할별 게임 등급/가상재화/환불/청소년/세금 및 PG 판매 정책을 검토한다. 한국·글로벌 적용 가능 여부를 단정하지 않는다.
- 결제 연동 때 서버가 검증한 **PG 웹훅**으로만 Gems를 지급하고, 이벤트 ID 기준 중복 지급을 차단한다. $1 단위 결제의 수수료 수익성을 별도 분석한다.
- 현금 상금, 거래소, 재화 환매, NFT, 확률형 유료 아이템은 MVP에서 제외.

### 시즌·소유 설계
- 기본 시즌 30일. 시범 시즌은 7일로 설정 가능.
- 토지 점유는 시즌 내 **게임상 사용권**이며 시즌 종료 후 규칙에 따라 리셋 가능. 게임 시작 전 UI에 명시.
- 계정·업적·장식 구매·역대 시즌 기록은 유지.
- 유료 상품과 영토 영구 소유를 연결하지 않는다.
- 시즌 종료 시 보상을 명예 배지·꾸미기 아이템 위주로 지급.

## 3. 게임 규칙: 구현 가능한 MVP 기본값

| 항목 | 초기 규칙 | 설정 방식 |
|---|---|---|
| 지도 | 실제 지구의 해안/육지 형태를 **간략화한 2D 지도** | 지도 데이터 라이선스 확인 |
| 월드 셀 | MVP 활성 영역 최대 256×256 논리 셀 | 서버 환경변수/설정 |
| 시작지 | 운영자가 지정한 인구 밀집 플레이 존 중 빈 땅 1칸 | DB 원자적 할당 |
| 점유 | 소유 땅과 상하좌우 인접한 빈 육지 셀 | 행동력 1 |
| 행동력 | 6시간당 1, 최대 4 (서버 시간으로 계산) | DB 저장 없이 lazy 계산 가능 |
| 생산 | 예: 농지 식량/광산 철/임야 목재 | 6시간 턴 정산 또는 lazy 계산 |
| 분쟁 | 인접한 다른 플레이어 땅에 공격 명령, 6시간 턴 종료 후 판정 | 1차 MVP에서는 OFF 가능 |
| 방어 | 시설·지형·보급 기반 결정적 공식 | 난수 사용 시 seed 기록 |
| 거래 | 자원에 대한 지정가 매매, Gold 결제 | 1차 MVP |
| 토지 거래 | 2차 단계, 소유권·시즌 만료·동시성 검증 이후 | 기능 플래그 OFF |
| 랭킹 | 영토 수, 생산량, 시즌 점수 | 1~6시간 캐싱 |

**중요: 활성 셀 256×256은 전체 실제 지구 해상도를 뜻하지 않는다.** 초기 지도는 지구 형태를 보여주지만, 실제 점유 가능한 구역만 제한적으로 개방한다. 실제 지구의 동일 위경도에 대응되는 글로벌 격자를 대량 사전 생성하지 않는다. `region_id + x + y` 방식의 논리 좌표를 사용해 추후 영역을 확장한다.

분쟁 전투 MVP는 자동 공격만 남발하지 않도록 비용과 쿨다운을 설정한다. 전투 결과가 유료 구매에 의해 직접 좌우되지 않게 한다. 방어자가 장기간 미접속했다고 지속적으로 모든 자산을 잃지 않도록 보호 기간을 둔다.

## 4. 기술 아키텍처 — 최소 트래픽

### 권장 스택
- Frontend: **TypeScript + React + Vite** (또는 리포지토리에 확정된 기존 스택 유지)
- 지도: **SVG/Canvas**, 필요 시 PixiJS. MVP에 3D/Mapbox/고가 지도 SDK 불필요
- API: **Cloudflare Workers**
- DB: **Cloudflare D1 (SQLite)**
- Assets: 배포된 정적 파일 + Cloudflare CDN, 업로드가 필요해지면 R2
- Auth: 검증된 OAuth 또는 매직링크; 제3자 인증 비용/제약 비교 후 선택. 초기 MVP에는 이메일+인증 링크 구현 가능
- Tests: Vitest, Playwright, Workers/D1 통합 테스트
- CI: GitHub Actions
- 배포: Cloudflare DNS + `world.euiyun.com`

### 비용 절감 규칙
1. 공용 지도 바탕은 정적 타일/벡터로 CDN 캐싱; 서버 요청마다 지형 생성 금지.
2. 카메라 영역별 **청크 데이터** 요청, ETag/버전 기반 조건부 응답. 보이지 않는 지형 다운로드 금지.
3. 전황 자동 갱신은 탭 활성 시 **최소 60~120초**, 비활성 탭에서는 정지. 새로고침 버튼 제공.
4. **WebSocket, SSE, 실시간 유닛 이동 없음.** 명령 작성 및 결과 확인만 API 호출.
5. 행동력과 자원 생산은 매초 DB 업데이트하지 않고 `last_settled_at` 기준으로 계산.
6. 턴 정산은 6시간 주기의 예약 작업 또는 접근 시 lazy settlement; **전체 월드 스캔 금지**, 미처리 명령만 인덱스로 조회.
7. 랭킹은 주기적으로 스냅샷을 생성하고 캐싱.
8. 이미지 합성/AI 추론은 서버에서 실행하지 않음. 건물·깃발은 사전 제작한 SVG 요소를 클라이언트에서 구성.
9. 읽기/쓰기 쿼리 인덱스를 정의하고, 무료 할당량 지표를 수집한다. Cloudflare 최신 가격·무료 한도는 배포 시 재검증.
10. API에 사용자별 rate limit, 거래/공격 cooldown, abuse prevention 적용.

### 트래픽 예산 지표
- 로그인 없는 공개 지도 탐험: 가급적 CDN cache hit
- 한 세션의 동적 API: **목표 10~20회 이내** (인터랙션 수에 따라 달라짐)
- 최초 모바일 JS 다운로드 경량화, 지도 청크 크기 제한
- DB rows read/write, API requests, 캐시 hit 비율을 관리 화면에 기록

## 5. 핵심 데이터 모델(초안)

```
users(id, auth_provider, created_at, status)
profiles(user_id, display_name, locale, flag_style, created_at)
regions(id, name, bounds_json, status, map_version, season_id)
seasons(id, begins_at, ends_at, status, rules_version)
territories(id, region_id, x, y, terrain_type, owner_user_id, season_id, acquired_at, version)
player_state(user_id, season_id, energy_value, energy_updated_at, gold_balance, last_settled_at, version)
resources(user_id, season_id, kind, quantity, version)
structures(id, territory_id, structure_type, level, built_at)
actions(id, user_id, season_id, type, payload_json, status, resolve_at, idempotency_key, created_at)
market_orders(id, seller_user_id, item_type, item_id_or_kind, quantity, price_gold, status, created_at)
trade_ledger(id, order_id, buyer_user_id, seller_user_id, gold_amount, asset_json, created_at)
gold_ledger(id, user_id, season_id, delta, reason, ref_type, ref_id, created_at)
gems_ledger(id, user_id, delta, reason, ref_type, ref_id, created_at)
products(id, sku, usd_cents, gem_amount, active)
payments(id, user_id, provider, provider_event_id, external_payment_id, usd_cents, status, created_at)
reports(id, reporter_user_id, target_type, target_id, reason, status, created_at)
```

- 실제 구현 시 D1 지원 SQL, 외래키, unique index, transaction/batch 의미를 확인한다.
- `UNIQUE(region_id, x, y, season_id)` 등 중복 점유 금지, `UNIQUE(user_id,idempotency_key)` 등 요청 중복 방지.
- Gold/Gems 거래는 **append-only ledger + 잔액 materialization** 방식을 사용하며, 잔액 음수 방지 및 정합성 검증을 테스트한다.
- 거래는 동시 구매·동시 공격·재전송 상황에서 **원자적 조건부 업데이트**로 처리한다. D1이 지원하는 실제 원자성 범위에 맞춰 설계하고 테스트한다.
- Gems 및 Gold 잔액을 클라이언트로부터 받아 신뢰하지 않는다.
- 표시되는 지명/지도 데이터에는 적절한 출처·라이선스 표기.

## 6. API (예시)

공개 읽기:
- `GET /api/world/config`
- `GET /api/regions`
- `GET /api/map/chunks?region=...&cx=...&cy=...` (ETag, CDN 캐시)
- `GET /api/territories/:id`
- `GET /api/leaderboards?season=...`

인증 사용자:
- `GET /api/me`
- `GET /api/me/state`
- `POST /api/actions/claim` (`idempotency_key` 필수)
- `POST /api/actions/attack` (2차 플래그)
- `POST /api/structures/build`
- `GET /api/market/orders`
- `POST /api/market/orders`
- `POST /api/market/orders/:id/buy`
- `POST /api/market/orders/:id/cancel`
- `GET /api/me/transactions`

결제(플래그 비활성에서 시작):
- `GET /api/store/catalog`
- `POST /api/payments/checkout`
- `POST /api/payments/webhook` (서명 검증, 중복 이벤트 처리)

인증/권한/검증 실패에 대한 명시적 에러 코드, 리소스별 소유권 검사, 입력 크기 제한, 권한 없는 열람 제한을 구현한다.

## 7. UI/UX 페이지

- `/` — 세계 지도: 모바일 터치/핀치, PC 드래그/휠, 줌 레벨에 따른 클러스터 표시, 주변 영토/보유 영토 색상 구분
- `/region/:id` — 지역 상세 및 영토 탐색
- `/territory/:id` — 지형, 소유자, 생산, 시설, 점유/거래 가능 여부
- `/me` — 영토, 자원, 행동력, 업적, 거래 내역
- `/market` — 생산물 목록·검색·매매
- `/leaderboard` — 지역/시즌 순위
- `/store` — Gems 가격 및 스킨(실결제 비활성 상태 명시)
- `/rules` — 시즌 리셋, 분쟁, 게임머니, 환불/유료상품 설명
- `/admin` — 기본 운영 대시보드(권한 필수)

필수 모바일 테스트: 작은 화면(360px), 저속 네트워크, 핀치/드래그 오작동, 버튼 터치 영역, 결제 복귀/로그인 유지.

## 8. 단계별 구현 계획

### Phase 0 — 기반 작업
- [ ] 모노리포 또는 단일 저장소 구성 / README / .env.example
- [ ] Cloudflare Workers+D1 개발환경 및 마이그레이션
- [ ] 공유 DTO/검증 스키마 / 타입 검사 / 테스트 / CI
- [ ] 지도 데이터 출처, 라이선스 및 사용량 정책 조사
- [ ] 기능 플래그(`COMBAT_ENABLED`, `MARKET_ENABLED`, `PAYMENTS_ENABLED`)

### Phase 1 — 플레이 가능한 무료 MVP (최우선)
- [ ] 로그인 없는 지도 탐험, 경량 청크 렌더링
- [ ] 인증/프로필, 시작 타일 원자적 배정
- [ ] 인접 영토 점유, 에너지 회복
- [ ] Gold·자원 생산 계산, 기본 건설
- [ ] 시즌 랭킹, 영토 상세, 방문자 이벤트(개인정보 최소화)
- [ ] 서버 레이트 리밋, 로깅, 운영자 롤
- [ ] 모바일/PC UI, 테스트 데이터 초기화 스크립트

### Phase 2 — 경제 및 비동기 경쟁
- [ ] 자원 주문/구매/취소, 원장 정합성·경쟁 상태 테스트
- [ ] 공격 선언/방어/6시간 판정/전쟁 보고서
- [ ] 신규 플레이어 보호, 반복 공격 남용 방지
- [ ] 시즌 종료/리셋/명예 보상 시뮬레이션
- [ ] 부정행위 탐지 및 관리자 신고 처리

### Phase 3 — 결제 도입(무료 참여·유지율 검증 후)
- [ ] $1/$10/$100 Gems 팩 상품 정의
- [ ] 유료 구매 가능한 비거래성 꾸미기 콘텐츠
- [ ] PG 적합성 및 법/등급분류/세금/환불 검토 체크 완료
- [ ] 테스트 결제/서명 웹훅 검증/중복 지급 차단
- [ ] 결제 성공·실패·환불/차지백 원장 처리
- [ ] 환불 시 사용된 Gems 처리 정책 및 사용자 안내

### Phase 4 — 글로벌 성장
- [ ] 동맹, 이웃 초대, 공유 카드
- [ ] 국가/지역별 지역 개방, 시즌 이벤트
- [ ] 접근성/현지화, 대규모 캐시·DB 비용 점검
- [ ] 추천 및 발견 기능은 비AI 정렬·필터 우선

## 9. 게임의 성공/실패 검증

이 프로젝트의 사업 가설은 “사람들이 제2의 지구에 자신의 흔적을 남기고, 거래/점유 결과를 확인하기 위해 자발적으로 돌아온다”이다.

- 첫 21일: 실제 외부 가입자 100명 이상 모집을 목표로 하되, 지인·테스트 계정 별도 분리.
- 주요 지표: D1·D7 재방문율, 주간 행동 수행 사용자, 주간 거래 성사 수, 사용자당 지도 탐험 세션, 영토 재방문율.
- 1차 내부 목표(검증용 가설): D1 ≥ 25%, D7 ≥ 10%, 첫 주 가입자의 30% 이상이 점유 행동 2회 이상.
- 현금결제 전에는 유저가 전쟁/거래/탐험에 반복 참여하는지 입증.
- 유료 검증은 상품에 실제 금전 지불 의사가 있는지 확인하되, 리워드·과금 압박·투자성 문구 금지.
- 관리자/운영자 봇은 인기도/경제 성과 분석에서 별도 표시.

## 10. 위협 모델·안전장치

- API 자동화 봇, 다중계정 점유, 계정 탈취, 자원 복제, 전투 요청 재전송, 시장 이중 구매, 자기 거래를 통한 시세 조작, 유료 재화 차지백 악용
- idempotency, 정수형 잔액, DB 조건부 업데이트, 시간 동기화, 권한별 API 제한, 입력 검증, CSP, HTTPS, 로그 비식별화
- 거래는 투명한 이력과 일정 거래세(예: Gold 3% 소각) 적용
- 신규 유저 보호와 휴면 소유자 보호, 신고/제재, 금지된 닉네임/깃발 필터
- 실제 거주지·실제 토지 소유자와 게임상 점유가 무관함을 명시; 실제 개인 주택 좌표와 사용자 연계 노출 금지
- 개인정보처리방침·약관·게임 등급·결제 취소/환불 정책은 실제 서비스 공개 전 준비

## 11. 완료 기준 (Definition of Done)

- 인터넷 연결된 모바일·PC 브라우저에서 동일 계정으로 플레이 가능
- 새 사용자가 3분 안에 무료 토지 1칸 배정 및 추가 인접 점유에 도전 가능
- 2개의 동시 점유 요청에도 동일 토지에 소유자 2명이 생기지 않음
- 자원 거래의 구매·판매·취소·동시 구매·재시도에서 Gold·자산 보존 법칙 유지
- 새로고침/브라우저 재실행에도 상태 정확
- 지도 로딩과 서버 요청량을 계측 가능하고 캐시 사용 확인
- 보안·부정행위 테스트 및 모바일 E2E 테스트 통과
- 무료 게임 MVP는 PG/LLM 서비스 없이 정상 동작
- 실제 돈을 받는 기능은 법률/정책 검토 전에는 기본값 OFF

## 12. 에이전트가 먼저 제출할 결과물

구현 시작과 함께 다음 파일을 순서대로 생성한다.
1. `README.md`: 시작/실행/테스트/배포 방법
2. `docs/plan.md`: Phase별 체크리스트와 현재 진행 상태
3. `docs/architecture.md`: 주요 컴포넌트, 캐시와 D1 접근 구조
4. `docs/economy.md`: Gold/Gems, 생산·소모량, 인플레이션 제어
5. `docs/game-rules.md`: 행동력·점유·전투·시즌 수식
6. `docs/data-model.md`: 마이그레이션과 인덱스 설명
7. `docs/security.md`: 게임머니·결제·봇 방어 위협 모델
8. `docs/legal-release-checklist.md`: 출시 국가별 게임/결제 점검 항목(법적 판단 단정 금지)

**우선 Phase 1을 작동시키고, 에이전트가 임의로 Phase 3 실결제를 켜지 않도록 한다.**

