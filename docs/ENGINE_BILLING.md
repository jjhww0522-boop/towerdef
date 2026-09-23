# 엔진 결제 연결 상태

브라우저 개발 서버의 엔진/충전 저장 로직이다. 실제 App Store/Google Play 결제와 Unity 클라이언트는 아직 연결하지 않았다. 실행 중인 개발 서버는 한 프로세스만 같은 profiles.json을 소유해야 한다.

## 적용된 규칙
- 처음 5개, 최대 5개. 일반/연습 새 참가에 1개. 30분마다 1개 자연 회복.
- 오프라인 회복은 저장된 nextRecoveryAt과 서버 시계로 계산. 클라이언트 시각/잔액을 받지 않는다.
- consumeEngine(profileId, expeditionId)는 입장 기록과 잔액을 한 번에 저장한다. 같은 원정 재접속 무료. 서버 재시작 후 사라진 원정을 복구하는 기능은 별도다.
- 유료 상품 계약은 engine_refill: 현재 엔진을 최대 5개로 즉시 채우는 완충이다. 5개를 더 쌓는 상품이 아니다.
- refillEngines는 검증된 구매를 전달받는 내부 함수다. 플랫폼+거래 ID를 전 계정에 걸쳐 영구 기록해 중복 지급과 다른 계정 재사용을 막는다.

## API와 연결점
- GET /profile: engines { count, max, nextRecoveryAt, recoveryIntervalMs, serverTime }.
- GET /engine/store: 인증 필요. 기본값 available:false, reason:store_not_configured.
- POST /engine/refill: 인증 필요. 기본 개발 서버는 503. 실제 구매/과금 없음.
- createDevServer({ verifyEnginePurchase }) 옵션은 서버 전용 비동기 검증 함수다. 입력 { platform, purchaseToken, profileId }. 원본 토큰은 응답/저장 파일에 넣지 않는다.
- 검증 함수가 반환할 값: { platform:'apple'|'google', transactionId, productId:'engine_refill', profileId, status:'purchased' }.
- 함수는 신뢰 가능한 스토어 검증 결과와 앱/상품/계정의 일치를 확인해야 한다. HTTP 요청의 성공 주장, 가격, 상품 ID, 거래 ID, 계정 ID를 그대로 반환하는 구현은 사용할 수 없다.
- 검증 불가/대기/취소/다른 계정/다른 상품은 지급하지 않는다. 저장 실패 시 거래 기록과 엔진이 함께 반영되지 않아 재시도할 수 있다.
- 검사는 주입한 검증기로 실행한다. 외부 결제 샌드박스 검사나 실제 구매 검증이 아니다.

## 실제 출시 전에 필요한 연결
1. 스토어에 실제 소비성 상품과 가격 등록. engine_refill은 현재 내부 논리 상품 ID이며 스토어 상품 ID 매핑이 필요하다.
2. Unity의 네이티브 구매 UI와 현재 프로필을 동일한 인증 계정에 연결.
3. 앱/스토어 계정 식별자와 서버 검증을 연결하고, 구매 대기/취소/재전달 처리.
4. 서버에 지급이 영구 저장된 뒤 구매 완료/acknowledgement/consume 처리. 저장 실패 전에 거래를 완료 처리하지 않는다.
5. 환불/취소 통지와 복구 검증, 테스트 스토어에서 실구매 수명 주기 검증.
6. 구매 확인 도중 자연 회복으로 이미 가득 찬 경우의 상품 안내/처리를 확정한다. 지금은 완충 계약이며 결제 버튼은 비활성이다.

[Google 보안](https://developer.android.com/google/play/billing/security), [Google 일회성 구매](https://developer.android.com/google/play/billing/lifecycle/one-time), [Apple StoreKit](https://developer.apple.com/documentation/storekit/in-app-purchase).
