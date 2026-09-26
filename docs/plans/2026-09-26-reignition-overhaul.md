# 재점화 대격변 패치 실행 계획

> Agent workflow: superpowers:subagent-driven-development. 작업 권한과 설계 판단은 사용자가 위임했다. 일반 구현마다 재승인을 요청하지 않는다.

**목표:** 폐품로봇 원정대의 반복 조립 전투를 위협을 읽고 대응하는 원정으로 발전시킨다. 기존 5개 구역, 저장 기록, 훈련과 협동은 보존한다.
**구조:** 서버가 적 역할·웨이브 예고·전술·전투 통계를 결정한다. 브라우저는 해당 상태만 연출하며 임무 통신과 보고서를 연결한다.
**기술:** 기존 TypeScript/Nakama core, Canvas, vanilla JS, WebAudio, Node test, Playwright. 신규 외부 런타임 의존성 없음.
**설계 기준:** 본 문서의 계약과 사용자 요청. 자동 검증은 출시 인증이나 실제 소비자 조사로 표현하지 않는다.

## 전역 조건

- 현재 0.10.1, 197개 테스트 통과를 기준선으로 한다. 사용자 프로필을 삭제하거나 초기화하지 않는다.
- 피격/지원/시설 피해 연출은 실제 서버 사건에 연결한다. 장식용 가짜 보스 능력은 넣지 않는다.
- 유료 구매, 개인정보 전송, 배포는 이번 패치에 필요하지 않다.
- 기존 자산이나 타 게임의 캐릭터·음원·UI를 복사하지 않는다. 설계 참고와 직접 만든 코드 그래픽/오디오를 구분해 기록한다.
- 모바일 360×640, 390×844, 가로 667×375와 데스크톱을 확인한다. 훈련·접속·재시도·저장 회귀도 검증한다.
- 작업 브랜치 `feat/reignition-overhaul`. 공유 작업 디렉터리에서 파일 소유권으로 충돌을 막는다.

## 작업 및 담당

1. **코어 / game_core** — `server/core/index.ts`, `server/protocol.ts`, `shared/content.json`, 코어 테스트. 침투·공성·군집 역할과 확정 웨이브 예고. 과부하(6초, 아군 본진 피해 +50%) / EMP(적 이동·공성 3초, 보스 1초), 공통 40초 재사용. 훈련 제외, 협동 구역 격리, 요청 재시도 안전. 실제 피해·처치·시설 피해·전술 사용 통계. 기존 정책과 변경 후 정책 비교.
2. **연출 / dev_expert** — `playtest/battlefield.js`, `casual-art.js`, 새 `combat-audio.js` 및 관련 테스트. 역할별 실루엣, 피격 반동과 순간 자세 정지, 실제 전술 효과, 시설 경보. 음성 수 제한 및 예약음 취소, 움직임 줄이기 지원.
3. **기획 / game_designer** — 공식 출처 조사와 `docs/reference/2026-09-26-reference-ledger.md`, 새 `playtest/mission-content.js`. 5개 임무의 독자적인 브리핑·진행 통신·결과와 대응 힌트. 자료 조사 후 독립 검토.
4. **통합 / root** — 앱·HTML·CSS, 정적 자원 허용 목록, 콘텐츠 검증기. 전술 버튼, 접근 가능한 적 정보/작전 일지, 다음 위협과 준비 시간, 방해하지 않는 통신, 실측 보고서와 재도전 힌트. 오디오 수명주기와 단축키 연결.
5. **검증 / root + 독립 검토** — 전체 단위/API, 기존 훈련/모바일/전투 브라우저 검사와 신규 작전 흐름 검사. 스크린샷 직접 확인, 오류 수정, 변경 기록·검증 증거·남은 출시 과제 기록.

## 인터페이스 계약

- `state.encounter`: 훈련은 null, 나머지는 `{current,next,remainingTicks}`. Encounter `{wave,label,description,archetype,count,startTick,spawnIntervalTicks,routeCount}`.
- 적 `archetype`: grunt / runner / plated / swarm / boss. `stunned`는 실제 행동 정지 상태.
- `player.tactical`: `{cooldownRemainingTicks,overdriveRemainingTicks,lastUseTick,lastKind}`.
- action `{seq,type:'tactic',tactic:'overdrive'|'emp'}`. 프로토콜 1, 콘텐츠 버전 `0.11.0-reignition`.
- `battleStats`: `{kills,damageDealt,facilityDamageTaken,tacticsUsed:{overdrive,emp},biggestHit,peakEnemies}`. 과잉 피해와 공동 스토리 피해는 본진 피해 수치에서 제외.
- `createCombatAudio(context)` → `{play(type,event),stop()}`. 기존 event에 `pan` 선택 필드; facility-hit/boss-entry/emp/overdrive 사건 지원. 앱에서 사용자 동작으로 시작하고 음소거·탭 숨김·원정 전환 때 중지.
- `MISSION_STORIES[1..5]`: `{chapter,title,briefing,speaker,opening,midpoint,warning,victory,defeat,lesson}`. 평문 문자열.

## 검토 중점

1. 전술 중복 요청·쿨다운 경계·기절 중 시설 공격·보스 시간 만료 순서.
2. 훈련의 고정 단계와 원래 행동 허용 범위 보존.
3. 통신과 전술 조작이 작은 화면에서 전장/조립/판매 조작을 가리지 않는지.
4. 사운드 설정 변경·탭 숨김 이후 예약음 재생과 AudioContext 누수.
5. 적 구성 변화가 추가 버튼을 강제하거나 후반 보스를 불합리하게 만들지 않는지.

## 진행 기록

- 기준선: 197/197 테스트. 감사 완료; 코어·연출·기획 파일 소유권 확정.
- 사전 교차 점검: 코어↔앱은 위 계약, 코어↔렌더러는 archetype/stunned/tactical, 연출↔앱은 오디오 API, 기획↔앱은 MISSION_STORIES. 공유 파일 중복 소유 없음.
- 판단: 기존 잘 동작하는 가전 로봇·맵 자산을 유지하고 적 실루엣과 상태에 예산을 집중. 새로운 외부 이미지 구입/수집은 불필요.
- 판단: 장갑 면역 대신 체력/속도/시설 피해 차이로 대응을 만든다. 설명 부담과 불공정한 랜덤 상성을 줄인다.
- 작업 1 완료: 적 역할·예고·전술·동결 결과 통계, 10개 코어 회귀 검사, 900회 정책 비교. 후반 보스 체력은 비교 근거로 15% 조정.
- 작업 2 완료: SVG 역할 실루엣, 피격 반동·잔흔·상태, 위치 합성음. renderer/audio 담당 검사와 실제 Chrome 출력 확인.
- 작업 3 완료: 공식 6작품·7URL 참고 대장, 독자적인 5구역 대사. 후속 정확성 검토 5건을 찾아 수정하고 모두 재검증.
- 작업 4 완료: 예고·지원 조작·관제 일지·브리핑·보고서, 콘텐츠 검증, 오디오 생명주기. 작은 화면 조작 방해와 첫 음소거 해제 회귀를 실제 브라우저에서 발견·수정.
- 작업 5 완료: 전체 220개 및 작전25/훈련12/전투8/흐름10/엔진맵18/HTTP협동21개 통과. 마지막 독립 코드 검토에서 발견한 채굴장 터치 문제도 수정·재검증. 검토 범위의 미해결 P1/P2 없음.
- 인계: 기존 저장을 보존한 로컬 서버 7351 실행·브라우저 홈/이동/오류 확인. 참고 출처, 패치 내용, 자동 검증 범위와 실제 기기/사람 검증 과제를 문서화. 외부 배포·공유 브랜치 병합은 이번 구현에 포함하지 않으며 작업 브랜치를 보존한다.
