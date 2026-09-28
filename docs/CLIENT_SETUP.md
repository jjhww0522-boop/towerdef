# Unity 모바일 클라이언트 준비

첫 목표는 현행 서버 코어 `0.13.1-casual-pressure`·HTTP를 사용하는 **세로 iPhone 1구역**이다. 현재 콘텐츠는 6속성·25종·24식이며 모든 유닛의 Unity용 PNG를 출력했다. 물 표시·소리, 4칸/동일 3기 조합 훈련, 미래 해금 안내, 종료 연구 환급 안내를 클라이언트 소스에 반영했다. 브라우저는 회귀 기준이며 8스테이지와 Nakama 이관은 첫 실기기 범위 밖이다. 실제 기기 완주·Unity 컴파일·Xcode 빌드는 아직 미검증이다. C# DTO/모델 검사 19개 통과는 Unity UI 컴파일을 대신하지 않는다.

## 환경과 검증 범위

- 프로젝트는 저장소의 `client/` 폴더이며 고정 Unity는 `6000.3.24f1`이다.
- Mac mini는 보유하지만 사양·설치·접속 정보·서명 계정은 확인 전이다.
- 읽기 전용 준비 확인: `node tools/mobile-preflight.mjs`. iOS 도구 미준비 시 실패: `node tools/mobile-preflight.mjs --require-ios`.
- 별도 Unity 위치는 `UNITY_EDITOR_PATH`에 실행 파일을 지정한다. 도구 발견은 앱 빌드·서명·기기 실행 성공이 아니다.
- 계약 검사에는 .NET 8 SDK가 필요하다. 이 작업 컴퓨터의 `artifacts/mobile-sdk/dotnet` 설치는 Git에 포함되지 않는다. 다른 컴퓨터에서는 설치된 `dotnet` 또는 `TOWERDEF_DOTNET`으로 실행 파일을 지정한다. `npm run test:mobile-contract`는 실제 C# DTO/모델과 서버 응답을 검사한다. **UGUI/Unity API 컴파일이나 iOS 플러그인 링크 검사가 아니다.**

화면은 UGUI·2D 스프라이트·재사용 효과로 이식하는 범위다. 과거 1280×720 IMGUI 화면 안내와 실행 결과는 최신 세로 앱 검증으로 사용하지 않는다.

## Editor 인계 계약

아래 메뉴와 빌드 코드는 통합했다. 실제 Editor 실행·컴파일 검증은 남아 있다.

| 용도 | 메뉴 / API / 경로 |
| --- | --- |
| 장면 준비 | `Towerdef → 첫 실행 준비` / `TowerDef.Editor.ClientSetup.Prepare` |
| iOS 개발 프로젝트 | `Towerdef → iOS 개발 프로젝트 내보내기` / `TowerDef.Editor.ClientSetup.BuildIosDevelopment` |
| 장면 / 출력 | `Assets/Scenes/Mobile.unity` / `Builds/iOS` |

Unity Hub에서 `client/`를 열고 고정 Editor와 iOS 지원 모듈을 준비한다. Console 오류 없이 세로 장면을 확인한 뒤 개발 프로젝트를 내보내고 Xcode에서 개인 기기에 설치한다. 로컬 iOS 빌드는 macOS에서 수행한다. [Unity 공식 절차](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/iphone/ios-building-and-delivering/build-process)

## 서버와 계정

로컬 Editor는 `npm run dev`의 `http://127.0.0.1:7351`을 사용할 수 있다. iPhone은 컴퓨터의 사설 LAN 주소가 필요하다. 명시적 LAN 설정·분리 저장소·잠금 복구는 [실기기 체크리스트](MOBILE_DEVICE_CHECKLIST.md)를 따른다.

일반 1배속은 서버가 엔진·진행·해금을 저장한다. 무료 훈련은 완료 여부만 저장하며 배속/명시적 연습은 영구 전투 보상을 주지 않는다. 모든 방이 무보상이라는 과거 안내는 현재 HTTP에 해당하지 않는다.

| HTTP 계약 | 용도 |
| --- | --- |
| `GET /content` | 유닛·조합·규칙, 구역별 `resolvedRules`, 훈련을 포함한 맵 geometry, `serverInstanceId` |
| `POST /profile`, `GET /profile` | 프로필 발급/복구·진행 조회 |
| `POST /session` | 버전·프로필·구역 확인, 참가/기존 자리 복구. 네이티브의 `expectedServerInstanceId`가 다르면 입장 전에 거절 |
| `GET /state` | 전투·본인 프로필·실제 공격 적중·전술·예고·결과 |
| `POST /action` | 순번을 포함한 뽑기·조립·강화·판매·전술·파견·현장개조 판정 |

클라이언트는 전투·확률·재화·보상을 별도로 확정하지 않는다. 응답 유실 시 순번·본문을 보존해 재전송하고 서버 상태로 결과를 맞춘다. 프로필 자격과 전투 세션은 구분한다.

현장개조는 `fieldMods` 콘텐츠와 개인 `fieldMod` 상태를 사용한다. 상단 버튼에서 비모달 패널을 열어 하나의 효과를 선택하고, 후반 기회에 유지하거나 교체한다. `choose_mod` 재전송은 원래 `seq/offerId/modId`를 그대로 보낸다. 결과 화면은 개인 종료 시점의 `result.fieldMod`를 읽는다. [설계·시점·조건](design/FIELD_MODS.md)과 실제 기기에서 패널 스크롤·지원 버튼·일찍 종료한 뒤 관전을 함께 확인한다.

입장 요청도 전송 전에 서버 인스턴스 ID와 함께 저장한다. 같은 서버에서 응답을 놓쳤다면 기존 방으로 복구하고, 재시작한 서버는 이전 요청을 `409 server_restarted`로 거절한다. 이전 요청을 자동으로 새 원정 비용에 사용하지 않는다. 서버를 다시 조회한 뒤 사용자가 새 출발을 선택해야 한다.

iOS Keychain 플러그인 `Assets/Plugins/iOS/TowerdefKeychain.mm`와 `SecretStore.cs`가 있지만 Xcode 링크·잠금/복귀·실제 보존은 미검증이다. Editor의 PlayerPrefs 대체 경로는 iOS 보안 저장 검증이 아니다. 토큰을 로그·인계 문서에 복사하지 않는다.

서버 재시작은 전투 자체를 이어서 복원하지 않는다. 이전 부팅의 신규 원정을 한 번 중단 처리·엔진 반환하고 `profile.lastInterruption`으로 알린다. 강제 종료 후 잠금이 남으면 소유 서버 정지를 확인하고 제거해야 서버가 시작된다. 기존 프로필·과거 입장을 모두 환불하거나 초기화하지 않는다.

## 검증과 다음 단계

1. 서버 커밋·콘텐츠·앱 빌드와 관련 검사 결과를 묶는다.
2. Editor 컴파일→세로 장면→Xcode 프로젝트→iPhone 설치를 실제로 확인한다.
3. [기기 체크리스트](MOBILE_DEVICE_CHECKLIST.md)의 프로필→훈련→최대 180초 원정→재접속·정산을 수행한다. 4인 관전은 별도 참가자 접속으로 검증한다.
4. 첫 시험 결함을 수정하고 같은 기기에서 재검증한다. 관련 브라우저 회귀를 유지한다.

네이티브 자산 `Assets/Resources/MobileArt`는 제작 출처 대장과 연결해 전달한다. 실제 사용 파일의 출처·이용 조건·변환 기록을 유지한다. 브라우저 자산을 가져왔다는 사실만으로 네이티브 글꼴·렌더링·성능이 검증되지는 않는다.

첫 아트 세트는 대표 로봇 7종·적 5종의 PNG 206개와 WAV 10개다. 나머지 현행 로봇은 속성색과 이름으로 표시한다. `assets/mobile-art/contact-sheet.png`는 비교용 산출물이며 Unity 실행 화면이 아니다. `npm run assets:mobile`로 다시 생성할 수 있고, 별도 Chromium 위치는 `CHROME_PATH`로 지정한다.

원격 비공개 HTTPS·계정 분실 복구·공개 배포·스토어 결제는 별도 단계이며 현재 제공 기능으로 안내하지 않는다.
