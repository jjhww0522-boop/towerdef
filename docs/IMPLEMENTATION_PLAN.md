# 첫 플레이 버전 구현 계획 — 2026-09-19

기준: `GAME_DESIGN.md`, `HANDOFF.md`. 기존에 위임한 구현 결정을 적용한다.

## 목표와 완료 기준

Unity 표시 클라이언트와 TypeScript 권위 서버가 동일한 콘텐츠를 사용하고,
소환·확정 조합·강화·개인 전투·공동 스토리를 자동 테스트로 검증하는 첫 개발 버전.
정식 출시, 실기기 성능, 실제 사람 네 명의 재미 검증은 별도 단계다.

1. 서버 담당: JSON 콘텐츠와 순수 TypeScript 전투 코어 → 고정 시드 재현, 자원/소유권/중복 요청, 파견 복귀, 독립 패배 테스트.
2. 클라이언트 담당: Unity 2D 가로 화면, 상태 표시와 입력, 절차적 임시 애니메이션 → 서버 프로토콜 일치 및 가능한 컴파일 검증.
3. 아트 담당: 외부 에셋 후보 공식 출처 조사, 애니메이션 제작 규격과 출처 장부 → 실제 사용 자산과 후보를 구분.
4. 통합 담당: Node 로컬 실행기, Nakama 연결 구성, 설치/실행 문서 → 타입 검사·단위 테스트·로컬 HTTP 통합 검증.

## 파일 소유권

- 서버 담당: `server/core/`, `shared/content.json`, `tests/core.test.mjs`.
- 클라이언트 담당: `client/`, `docs/CLIENT_SETUP.md`.
- 아트 담당: `docs/ART_PIPELINE.md`, `assets/README.md`, `assets/manifest.json`.
- 통합 담당: 나머지 설정·도구·서버 어댑터·테스트·README.

## 공통 계약

코어는 외부 의존성과 Node API 없이 작성한다. ES2015 문법에서 ES5로 컴파일 가능해야 한다.
`server/core/index.ts`는 아래 인터페이스를 노출한다.

```ts
createGame(options: {playerIds: string[]; seed: number; practice?: boolean}): GameState
applyAction(game: GameState, playerId: string, action: Action): {ok: boolean; error?: string}
tick(game: GameState): void // 0.1초 한 스텝
setConnection(game: GameState, playerId: string, connected: boolean): void
```

Action: `{seq:number,type:"summon"|"combine"|"upgrade"|"dispatch"|"leave",recipeId?:string,tag?:string,unitIds?:number[]}`.
상태는 JSON 직렬화 가능하며 다음 필드를 사용한다. 추가 내부 필드는 허용한다.

```text
GameState: protocolVersion:string, contentVersion:string, tick:number, wave:number,
  status:"playing"|"finished", practice:boolean, players:Player[], story:Story|null
Player: id:string, gold:number, status:"active"|"defeated"|"cleared"|"left",
  connected:boolean, lastSeq:number, units:Unit[], enemies:Enemy[], upgrades:{[tag:string]:number}
Unit: id:number, definitionId:string, slot:number, dispatched:boolean
Enemy: id:number, hp:number, maxHp:number, progress:number, boss:boolean
Story: wave:number, hp:number, maxHp:number, remainingTicks:number,
  status:"active"|"success"|"failed"
```

콘텐츠 JSON: `version`, `units` (id/name/rarity/faction/troop/trait/attack/attackIntervalTicks),
`recipes` (id/result/ingredients:string[]/unlockBattlefield:number), `rules` 및 필요한 밸런스 값.
태그: `shu/wei/wu`, `infantry/archer/cavalry`, `might/strategy/command`。
`unlockBattlefield:0` 은 초기 해금. 첫 버전은 연습으로 취급하고 영구 보상은 지급하지 않는다.

로컬 개발 HTTP (127.0.0.1:7351):
- `GET /content` → JSON content.
- `POST /session` body `{roomId,playerId}` → `{token,playerId,state}`; 방 참가/재접속.
- `GET /state` with `Authorization: Bearer token` → GameState.
- `POST /action` with token/body Action → `{ok,error?,state}`.
- 최대 4자리. 로컬 연습은 첫 참가부터 진행하며 빈 자리를 AI로 위장하지 않는다.
- 로컬 세션은 디버깅용이며 공개 환경에는 사용하지 않는다.

## 현재 제약

Node 24.13.0과 npm 11.6.2 확인. Unity 기본 설치 경로와 Docker CLI는 확인되지 않음.
dotnet 실행기는 있으나 SDK 목록이 비어 있음. Unity/iOS 실행 검증에는 도구 설치가 필요하다.
유료 구매, 외부 인프라 생성, 공개 배포는 이번 로컬 구현에 포함하지 않는다.
