# 모바일 실기기 우선 구현 기록

**후속 유닛 설계 변경:** 사용자의 요청으로 아래 작업 2·3단계의 5종 시작/복합3 기획은 [6속성별 4단계 + 공통 S, 전체 25종·24식](../design/SIX_ELEMENT_ROSTER.md)으로 대체한다. 챕터 1은 그중 1~3단계 18종·12식, 4단계와 S는 후반 해금 방향이다. 새 소환·훈련·연구 이관을 함께 준비하고 특수 4단계 조합은 이후 업데이트로 분리한다. 아래는 당시 승인 계획과 구현 이력이며, 이 기록 갱신을 실행 콘텐츠나 실기기 검증 완료로 보지 않는다.

승인: 2026-09-27 대화의 «Implement the plan». 기준: `0.11.1-quick-start`, `feat/reignition-overhaul`.

## 작업과 검증 순서

1. **현재 규칙으로 아이폰 첫 완주:** Unity 세로 UGUI, 최신 DTO·기하·실제 공격 기록, 홈/프로필/무료 훈련/원정/정산/재도전. 명시적 LAN 개발 연결, 서버 중단 원정의 1회 엔진 반환. 판정과 경제는 서버가 소유한다.
2. **조합·학습:** 첫 실기기 통과 뒤 5종 각 20%, 동일 3기→2/3등급, 복합 3종. 훈련과 해금·직뽑기를 함께 변경한다. 초기 150고철·수거20·판매35%·강화9축을 기준으로 비교한다.
3. **표현:** 첫 제작 세트 기본5+대표2/3등급, 적4역할+보스. 실기기 식별·성능 통과 뒤 18종으로 확대한다. 15초 도입은 이 관문 뒤에 제작한다.
4. **챕터/협동:** 8구역 3/4/4/4/5/4/5/6분, 난도1/1.5/2/2/2.5/2/3/3.5, 배치12/12/14/14/14/16/16/16. 최초 클리어 엔진1 반환. 4인 파견·관전·복귀 이해 검증.
5. **실제 QA:** 첫 아이폰 흐름→4인/각16기 30분 지속 성능→실제4명 파일럿→32명 확대. 자동 검사와 인간 관찰은 별도 기록한다.

## 소유와 공통 계약

- root: 통합, `server/protocol.ts`, 공개 기하 계약 검사, iOS Keychain 플러그인, 빌드/검증 도구와 인계.
- 서버팀: `tools/dev-server.mjs`, `tools/progression.mjs`, LAN 설정과 해당 테스트.
- 클라이언트팀: `client/Assets/Scripts`, `Editor`, `Tests`, 장면과 패키지/ProjectSettings.
- 아트팀: `client/Assets/Resources/MobileArt`, 독자 아트 원본/변환 도구, 자산 대장/아트 기준.
- `/content.battlefieldLayouts`: `battlefieldId,width,height,rotateInPortrait,routes[{points[{x,y}],closed,length}],slots[{x,y}],facility:{x,y}|null`. 훈련0과 실제 구역을 포함하며 서버와 같은 좌표 원본을 쓴다.
- 프로필과 전투 토큰은 분리한다. iOS 자격은 Keychain에 보관하고 오류 시 평문 저장으로 대체하지 않는다.
- `profile.lastInterruption`: `null | {expeditionId,reason:'server_restart',at,enginesRefunded}`. 일반 단절은 중단 환급이 아니다.
- 원정 정상 정산과 중단 환급은 배타적·원자적이며, 예전 `engineEntries`만으로 과거 입장을 환급하지 않는다.

## 후속 기록 이관 계약

구역1→1,2→2,3→5,4→7,5→8로 의미를 대응하고 원본을 보존한다. 입장 권한은 후퇴하지 않으며 새 중간 구역을 클리어했다고 꾸미지 않는다. 이관한 클리어에는 초회 보상을 다시 주지 않는다. 삭제되는 실제 보유 연구4종은 옛 가격표60/100/160/240크레딧을 이관 영수증과 함께 한 번 보상한다.

## 진행·판단 기록

- 시작 전 `npm test`: 221/221 통과. 기존 두 설계 문서의 staged 변경은 보존한다.
- 승인된 기존 기능 브랜치에서 파일별 편집자를 분리해 작업한다. 별도 체크아웃으로 현재 인계와 개발 환경을 분산하지 않는다.
- **관문:** 아이폰·Mac·Unity 실행 증거가 없으면 1단계 실기기 통과를 선언하거나 2~4단계 실행 콘텐츠를 활성화하지 않는다. 독립적인 코드·첫 아트 세트·검증 도구는 준비한다.
- 공개 배포/결제/외부 모집은 이번 비공개 검증판 준비와 구분한다. 실제 프로필 파일은 검증에 사용하지 않는다.

## 구현 인계 상태

현재는 **1단계 코드 준비와 3단계의 대표 아트 제작**까지 반영한 상태다. 1단계의 실제 iPhone 통과는 아직 달성하지 않았으며, 따라서 2단계와 4단계 실행 콘텐츠를 활성화하지 않았다.

- Unity: 세로 UGUI, 안전 영역, 홈/프로필/무료 훈련/구역 선택/전투/고정 선택창/판매 확인/조립/강화/전술/파견/관전/결과/재도전과 개발 iOS 내보내기를 작성했다. iOS Keychain 플러그인과 개발 전용 빌드 제한을 포함한다.
- 통신: 서버 좌표 원본과 구역별 병합 규칙을 전달한다. 프로필·전투 자격을 분리하고, 미확인 행동은 같은 순번·본문으로 유지한다. 입장 요청은 서버 인스턴스 ID를 고정 저장하여 재시작 후 자동 새 입장을 막는다.
- 저장: LAN 개발 서버는 시험 데이터를 분리하고 파일 잠금을 취득한다. 이전 부팅의 신규 active 원정만 원자적으로 중단 처리·엔진 반환한다. 정상 정산·연습 종료·과거 입장을 중복 환급하지 않는다. 강제 종료 후 남는 잠금은 운영자가 소유 프로세스 종료를 확인한 뒤 제거해야 한다.
- 아트: 직접 작성한 SVG를 PNG 206개로 출력했다. 대표 로봇 7종·적 5종·초상/아이콘과 합성 WAV 10개, 기존 OFL 한글 폰트, 변환 코드·출처 대장을 제공한다. 나머지 현행 로봇은 속성색/이름 대체 표시다. 연락판은 Unity 실행 캡처가 아니다.
- 독립 QA: 무효 세션 뒤 홈 복귀, 입장 응답 유실+서버 재시작, AudioListener 누락을 발견해 수정했다. 첫 공격 누락·재료 이름·밝은 버튼 글자 대비·조립 성공음의 서버 확인 시점도 보완했다.
- 빌드 의존성: 공식 Newtonsoft 3.2.1 패키지를 직접 검사해 DLL 자동 참조로 수정했다. UGUI는 [공식 6.3 어셈블리 안내](https://docs.unity.com/en-us/engine/6000.3/manual/packages-list/cus-pkg-lp/cus-pkg-development/cus-asmdef)의 `UnityEngine.UI`를 참조한다. [6.3 Test Framework 1.6](https://docs.unity3d.com/6000.3/Documentation/Manual/com.unity.test-framework.html)은 Editor에 맞는 Core 패키지다. 패키지 확인을 Unity 컴파일로 간주하지 않는다.

## 검증 증거와 남은 관문

| 검사 | 결과 / 증거 |
| --- | --- |
| 전체 서버·콘텐츠 회귀 | `npm test`: 243/243 통과, `artifacts/mobile-integration-tests.log` |
| 기존 웹 입장·엔진·5맵 | `npm run test:chapter`: 360×640·390×844·667×375, 18개 통과, `artifacts/mobile-chapter-check.log` |
| 실제 C# 모델 + 서버 JSON/좌표 | `npm run test:mobile-contract`: 13/13 통과, `artifacts/mobile-contract/report.json`과 TRX 참조. Unity API와 플러그인 컴파일 제외 |
| 아트 파일 | PNG 206개 및 WAV 10개 재디코드·알파 경계·무음/클리핑 검사, `assets/mobile-art/export-report.json`. 연락판·모션판 직접 확인 |
| 도구 환경 | `npm run mobile:preflight`: Windows, Unity 미발견, Xcode 없음. `--require-ios`는 실패해야 정상 |
| Unity / iPhone / 인간 플레이 | 미수행. 실제 기기 0, 참여자 0 |

테스트 전용 HTTP 서버는 메모리 또는 임시 파일만 사용했다. 기존 `.towerdef-data/profiles.json`과 이전 실행 서버를 갱신하지 않았다. Windows 임시 포트가 fetch 금지 포트에 걸리는 간헐적 검사 실패는 신규 테스트의 `node:http` 사용과 종료 정리로 해결했다.

다음 실행은 [클라이언트 준비](../CLIENT_SETUP.md)와 [실기기 체크리스트](../MOBILE_DEVICE_CHECKLIST.md)의 고정 Editor 컴파일→Xcode 링크→iPhone 훈련/1구역/복귀/정산이다. 이 증거를 남긴 뒤 5종·동일 3기 조합과 8구역 이관을 진행한다. 18종 전체 아트, 15초 도입부, 실제 4인/32인 시험은 아직 수행하지 않았다.
