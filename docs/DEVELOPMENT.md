# 개발 환경과 첫 프로토타입

2026-09-19. 제품 목표는 GAME_DESIGN.md를 따른다. 브라우저 화면과 2026-09-20 통합 검증의 최신 상태는 [반복 개발 결과](ITERATION_RESULTS.md)와 [화면 품질 기록](VISUAL_QUALITY.md)을 먼저 확인한다.

## 실행

Node 22 이상과 npm이 필요하다. 이 PC는 Node 24.13.0 / npm 11.6.2를 확인했다.

```powershell
npm ci
npm test
npm run dev
```

npm test는 타입 검사, Nakama ES5 번들 생성과 자동 테스트를 수행한다.
npm run dev는 http://127.0.0.1:7351 에서 같은 전투 코어를 사용하는 로컬 서버를 실행한다.
종료는 Ctrl+C. Unity 실행은 CLIENT_SETUP.md를 따른다. 재시작하면 연습 경기는 초기화된다.

## 구현 범위

| 영역 | 현재 |
| --- | --- |
| 전투 | 10Hz, 고정 시드, 독립 전장,24웨이브,최종 보스,개인 패배 |
| 데이터 | 27종·18개 레시피. 소유권·재료·자원·중복 요청 검증 |
| 강화 | 세 축9태그,최대5단계,보너스 합산 |
| 스토리 | 6·12·18웨이브,최대2기 실제 파견,원래 칸 보존,복귀·공동 보상 |
| 연결 | 로컬 토큰과120초 단절 유예,Nakama 인증 사용자 어댑터 |
| Unity | 개발용 UI와 임시 도형 애니메이션. 에디터 실행 검증 필요 |
| 후속 콘텐츠 | 3전장·2난도·고유 스킬·최종 아트·음악 |
| 후속 서비스 | 영구 해금·기록·튜토리얼·정식 초대/매칭 UX·계정 관리·배포 |

현재 모든 어댑터는 연습 모드이며 영구 보상이 없고 전설 레시피가 잠겨 있다.
모든 유닛은 단일 대상 기본 공격을 한다. 수치는 첫 실험값이며 재미·난도 검증 완료가 아니다.
8인 시뮬레이션은 확장 조사이며 실제 8인 플레이 검증을 대신하지 않는다.

## 로컬 HTTP

방/참가자ID는 영문·숫자·밑줄·하이픈1~32자. 방당4명,프로세스당32개 방.
첫 참가부터 연습이 진행된다. 빈 자리는 AI로 위장하지 않는다.
새 연습은 다른 방ID 또는 서버 재시작을 사용한다. 보스 단계 이후 신규 입장을 차단한다.

| 요청 | 의미 |
| --- | --- |
| GET /health | 상태 |
| GET /content | 단일 원본 콘텐츠 |
| POST /session | {roomId,playerId,protocolVersion:"1",contentVersion:"0.1.0-practice"} → {token,playerId,state} |
| GET /state | Bearer 토큰으로 전체 표시 상태 |
| POST /action | Bearer 토큰과{seq,type,recipeId?,tag?,unitIds?} → {ok,error?,state} |

type은 summon/combine/upgrade/dispatch/leave.
조합은 recipeId와 실제 소유 유닛ID 배열, 강화는 태그를 보낸다.
참가자별 순번이 증가한다. 응답 유실 시 같은 순번·같은 내용으로 재전송한다.
거부된 행동도 유효한 순번이면 소비할 수 있어 서버 lastSeq를 기준으로 다음 값을 정한다.
재접속 /session에도 기존 토큰이 필요하다. 다른 세션은 동일ID를 인수할 수 없다.
3초 동안 조회/행동이 없으면 단절로 인식하고 이후120초 유예를 적용한다.
표시 상태에는 난수 상태와 내부 재전송 기록을 포함하지 않는다.

로컬 HTTP는127.0.0.1에만 바인딩하고 브라우저 출처 요청을 거부한다.
공개 서비스 인증과 영구 저장을 대신하지 않는다. iPhone LAN 연결은 현재 경로의 검증 범위가 아니다.

## Nakama 실행

Docker Desktop Linux 엔진이 필요하다.

```powershell
npm run build
docker compose up -d
docker compose logs nakama
```

API는 로컬7350,관리 콘솔은 로컬7352. 로컬HTTP7351과 충돌하지 않는다.
Compose 암호는 로컬 예제값이며 외부 공개용 설정이 아니다.
인증된 Nakama 클라이언트는 create_practice RPC에 protocolVersion/contentVersion을 보낸다.
돌려받은 matchId에 같은 버전 metadata로 참가한다. 네 실제 참가자가 접속하면 시작한다.
4명 매칭 서버 콜백도 등록된다. 현재 Unity는 로컬HTTP를 사용하며 Nakama 소켓 연동은 후속 작업이다.
opcode1:행동,2:전체 표시 상태,3:행동 결과,4:대기 로비.
한 사용자에 한 접속만 허용한다. 단절된 기존 참가자는 같은 인증 계정으로 돌아온다.

자동 테스트의 VM 검증은 번들 로드·핸들러·메시지 검증이다.
실제 Nakama 런타임/PostgreSQL/네 사람 네트워크 검증을 완료한 것은 아니다.

## 외부 준비

Unity Hub와 고정 Unity6.3 LTS 에디터, Docker Desktop, 테스트 iPhone이 필요하다.
iOS 최종 빌드에는 Mac/Xcode 또는 별도 승인한 클라우드 빌드가 필요하다.
TestFlight/App Store 단계에서 Apple 개발자 계정·서명과 실제 플레이테스터를 준비한다.
유료 가입·구매·공개 배포는 진행하지 않았다.

## 공식 기술 근거

- [Nakama TypeScript](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/)
- [Match handler](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-handler/)
- [Docker Compose](https://heroiclabs.com/docs/nakama/getting-started/install/docker/)
