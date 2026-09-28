# 첫 iPhone 실기기 검증

첫 목표는 현행 `0.12.0-field-mods` 코어·HTTP·세로 Unity 1구역이다. 1배속 일반 방어 120초+보스 최대 60초, 난이도 목표 1을 유지한다. **첫 실기기 통과 전에는 기본 5종·8맵 개편을 활성화하지 않는다.** 브라우저는 회귀 기준으로 남긴다.

현재 Unity Editor 컴파일·Xcode/Keychain 링크·iPhone 완주는 미검증이며 실제 기기 0, 실제 참여자 0이다. Mac mini는 보유하지만 사양·설치·접속 정보·서명 계정은 확인 전이다.

## 읽기 전용 준비 확인

저장소 루트에서 실행한다. OS 모사, Unity 실행·설치, 서명, 기기 검색, 프로필 변경을 하지 않는다. `.env`, Keychain, 토큰, 기기 UDID를 읽거나 출력하지 않는다.

```text
node tools/mobile-preflight.mjs
node tools/mobile-preflight.mjs --require-ios
```

`--require-ios`는 macOS·고정 Unity 설치 위치/버전 정보·iOS 모듈·Xcode를 찾지 못하면 종료 코드 1이다. 성공해도 프로젝트 컴파일·서명·기기 실행을 증명하지 않는다. 별도 위치는 `UNITY_EDITOR_PATH`에 실행 파일을 지정한다. 고정 Editor는 `6000.3.24f1`이다.

현재 Windows 검사: 표준 위치에 Unity 없음, Xcode 없음, `artifacts/mobile-sdk/dotnet` 실행 파일 있음. `npm run build` 후 `node tools/check-mobile-contract.mjs`는 실제 C# DTO/모델 계약 검사이며 **UGUI/Unity API 컴파일이나 iPhone 검증이 아니다.** 이 계약 도구는 산출물을 쓰므로 preflight와 달리 읽기 전용이 아니다.

Unity는 Xcode 프로젝트를 생성하고 Xcode가 앱을 빌드한다. 로컬 iOS 빌드는 macOS가 필요하다. [Unity 공식 절차](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/iphone/ios-building-and-delivering/build-process)

개인 iPhone 시험은 무료 Apple Account의 Xcode Personal Team으로 시작할 수 있다. 현재 공식 안내상 프로비저닝은 7일 후 만료되어 재빌드·재설치가 필요하다. TestFlight·앱 배포를 위한 Developer Program은 별도 단계다. 가입·결제·배포는 여기서 실행하지 않는다. [Apple 공식 안내](https://developer.apple.com/help/account/basics/about-your-developer-account)

## LAN 개발 서버와 프로필 분리

아래 IP를 실제 서버 컴퓨터의 사설 IPv4로 바꾸고 iPhone과 같은 시험 네트워크를 사용한다. 휴대폰의 localhost를 서버 주소로 사용하지 않는다. 공인 IP·wildcard 바인딩·인터넷 포트 공개는 범위 밖이다.

PowerShell, 저장소 루트:

```powershell
$env:TOWERDEF_LAN_HOST = '192.168.1.22'
$env:TOWERDEF_DATA_DIR = '.towerdef-data/mobile'
$env:PORT = '7351'
npm run dev
```

macOS 터미널, 저장소 루트:

```sh
TOWERDEF_LAN_HOST=192.168.1.22 TOWERDEF_DATA_DIR=.towerdef-data/mobile PORT=7351 npm run dev
```

앱 주소는 `http://192.168.1.22:7351`이다. 지정 NIC 바인딩·Host 허용과 기존 Origin 검사는 유지된다. 방화벽·네트워크 권한·개발용 HTTP 동작은 실기기에서 확인한다.

- LAN 기본 저장: `.towerdef-data/mobile/profiles.json`.
- LAN 설정 없는 로컬 기본 저장: `.towerdef-data/profiles.json`.
- `TOWERDEF_DATA_DIR`: 절대 경로 또는 **프로젝트 루트 기준** 상대 디렉터리.
- 기존 프로필을 복사·초기화하지 않는다. 시험은 분리 저장소를 쓴다. 토큰을 로그·문서에 붙이지 않는다.
- 같은 파일의 writer는 하나다. `profiles.json.lock`에 PID·시작 시각만 기록하며 다른 포트의 두 번째 writer도 거부한다.

원격 비공개 HTTPS는 **현재 미지원**이다. TLS·인증·배포 설정·운영 복구를 갖춘 별도 검증 단계를 거쳐야 한다. LAN 옵션은 공개 서비스 기능이 아니다.

## 종료와 잠금 복구

정상 종료는 서버 터미널의 Ctrl+C다. 정상 close/SIGINT/SIGTERM은 잠금을 해제한다. 강제 종료 후 잠금이 남으면 서버가 시작하지 않으며 **중단 원정 환급도 아직 실행되지 않는다.** 자동 잠금 탈취는 없다.

Windows에서 아래는 PID 확인만 한다. 실제 시험 디렉터리를 선택하고 PowerShell 예약 변수 `$PID`는 덮어쓰지 않는다.

```powershell
$mobileLockPath = [IO.Path]::GetFullPath((Join-Path $PWD '.towerdef-data/mobile/profiles.json.lock'))
$mobileLockInfo = Get-Content -LiteralPath $mobileLockPath -Raw | ConvertFrom-Json
$mobileOwner = Get-Process -Id ([int]$mobileLockInfo.pid) -ErrorAction SilentlyContinue
$mobileOwner | Select-Object Id, ProcessName, StartTime
```

프로세스가 있으면 잠금을 삭제하지 않는다. PID는 재사용될 수 있으므로 기록만 보고 자동 종료하지 않는다. 소유 서버를 정상 종료하고 다른 터미널·자동 재시작·동료의 동시 실행을 중지한다. 확인 권한이 없거나 소유자가 불명확하면 삭제하지 않는다.

**관련 서버가 모두 중지됐고 동시 재시작이 없음을 운영자가 확인한 경우에만** 확인한 잠금 파일 하나를 제거한다. 이 절차는 동시 실행을 자동 중재하지 않는다.

```powershell
Remove-Item -LiteralPath $mobileLockPath
```

`profiles.json`은 삭제하지 않는다. 실제 바인딩 성공 뒤 이전 부팅의 신규 active 원정만 한 번 중단 처리·엔진 반환한다. 최대 엔진 5를 넘지 않으며 과거 입장·정상 종료·개인 이탈/패배는 환급하지 않는다. `lastInterruption`으로 결과를 확인한다. 복구 쓰기가 실패하면 서버는 접속을 받지 않고 종료한다.

## 실제 기기 체크리스트

- [ ] 고정 Unity/iOS 모듈/Xcode 확인, 컴파일·설치 성공, 세로 화면·안전 영역·한글 확인.
- [ ] LAN 연결→프로필 생성→앱 종료 후 같은 프로필 복구. 토큰·UDID 기록 금지.
- [ ] 무료 훈련: 실제 전투→판매→기준 자리 조립→보스→완료. 엔진·연구 보상 변동 없음.
- [ ] 일반 1구역을 **1배속**으로 완주. 일반 120초·보스 최대 60초, 승리 또는 명확한 패배와 원인 확인.
- [ ] 뽑기 비용/0.7초 대기, 판매 취소/확정, 조립 재료·기준 자리, 강화·과부하/EMP를 서버 상태와 대조.
- [ ] 현장개조: 40초 선택·80초 유지/교체, 패널 스크롤 중 위협·지원·뽑기 접근, 중복 요청 후 효과 하나만 적용, 개인 종료 후 고정 결과 확인. 훈련에는 노출 없음.
- [ ] 임무 활성 시 최대 2기 파견, 본진 이탈·슬롯 예약·서버 복귀 확인.
- [ ] 별도 참가자 최대 4인 연결·관전, 개인 패배/이탈 뒤 다른 레인 계속 진행. 단독 시험을 4인 통과로 표시하지 않는다.
- [ ] 30초 백그라운드, 유예 초과, 재실행, 응답 유실 재전송에서 중복 지출·재료 소비 없음.
- [ ] 입장 응답 유실 뒤 서버를 재시작한다. 이전 입장 재전송은 `server_restarted`로 거절되고 엔진을 추가로 쓰지 않으며, 홈에서 새 출발을 직접 눌러야 다음 원정이 시작됨을 확인한다.
- [ ] 결과 정산 한 번, 프로필 재조회/재시작 뒤 엔진·클리어·해금 유지. 서버 중단 환급은 별도 시험 프로필로 확인.
- [ ] 한 판·반복 플레이의 프레임 지연·메모리·발열·가독성·터치 누락 기록. 체감과 계측 구분.

| 기록 | 현재 상태 |
| --- | --- |
| 앱 빌드 / 서버 커밋 / 콘텐츠 | 미기록 / 미기록 / `0.12.0-field-mods` |
| 기기 / iOS / Unity / Xcode | 미검증 / 미검증 / 고정 `6000.3.24f1` / 미검증 |
| 속도 / 결과 | 1× / 미수행 |
| 프레임 시간·최대 지연 / 메모리 / 발열·측정 방식 | 미측정 |
| 연결 환경 / 백그라운드 시간 / 재접속 | 미측정 |
| 실제 기기 / 실제 참여자 | 0 / 0 |
| 결함 / 수정 커밋 / 같은 조건 재시험 | 미기록 |

첫 시험 결함을 수정하고 같은 기기·조건으로 다시 확인한 뒤 관련 브라우저 회귀를 실행한다. 자동 C# 검사·모바일 크기 모사·봇 승률은 사람/iPhone 검증으로 합산하지 않는다.
