# JEV 파일럿 준비

게임의 Node/Playwright 환경은 유지한다. 이 폴더는 JEV를 게임 실행 의존성에 추가하지 않는다.

**현재 상태: 환경 점검과 독립 검증기 준비. JEV는 설치·실행하지 않았고 유료 API도 호출하지 않았다.** 아래 baseline은 사람이 정한 동작을 실행하는 Playwright 검사이며 자연어 에이전트 실험의 성공률이 아니다.

2026-09-22: 최신 화면에서 3과제×3회 baseline이 통과했고, 9회 모두 아무 동작 없이 완료하는 경우를 거부했다. 검사 전후 화면 소스 해시가 동일했다. 실제 JEV 실험은 0회다.

## 현재 실행 가능한 검사

저장소 루트에서:

```powershell
python tools/jev/preflight.py
npm.cmd run build
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tools/jev/baseline.mjs --baseline
```

- preflight는 설치 여부와 키 **존재 여부만** 출력하며 `.env` 내용이나 브라우저 프로필을 읽지 않는다.
- `pilot.json`의 3과제를 각각 3회 검증한다. 매번 새 Chrome 임시 프로필, 새 메모리 저장소, 별도 로컬 서버를 만들고 정리한다. 개인 Chrome, 실제 계정 및 저장 파일은 사용하지 않는다.
- 서버 시계는 멈춘 상태다. 움직임·타격감이나 전투 난이도를 평가하는 검사가 아니다.
- 설정 저장값, 배속 변경 기록·보상 안내, 방 생성 수, 실제 소환 응답·유닛 수·고철 차감을 확인한다. 아무 동작 없이 종료한 경우도 반드시 실패하는지 확인한다.
- 결과: 무시되는 `artifacts/jev/baseline-report.json`. `baselineStatus`와 `jevStatus: not_run`을 구분한다. 모델 호출은 0회이며 이후 JEV 실행 비용은 아직 알 수 없다.
- 기본 JEV와 비교할 데스크톱 1120×780 조건이다. 모바일 터치 또는 실제 iPhone 검사가 아니다.

## 유료 JEV 실험 전 남은 준비

1. `pilot.json`에 고정한 JEV 커밋 `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`을 별도 도구 폴더에 내려받는다. 그 커밋의 `uv.lock`을 유지해 별도 환경에서 `uv sync --frozen --no-dev`로 설치한다. Python 3.12 이상, Harness 0.1.13이 대상이며 전역 Python이나 게임의 npm 의존성을 바꾸지 않는다.
2. Harness가 **지정한 일회용 Chrome 프로필만** 사용하는지 먼저 검증한다. 기본 `Agent(...)`는 기존 Harness 연결을 사용하므로, 분리가 검증되기 전에는 호출하지 않는다. 기존 사용자 Chrome의 디버깅을 켜는 방식은 이 실험에 사용하지 않는다.
3. TypeSafe·텍스트 모델 설정과 키를 전용 프로세스 환경에 제공하고, 명시적인 모델 호출 수·금액 한도를 정한다. 한도를 승인받기 전에는 키가 있어도 실행하지 않는다. 키를 게임 클라이언트, JSON 보고서, Git에 넣지 않는다.
4. JEV가 동작시킨 **동일한 페이지**와 해당 메모리 서버에 `verifyTrial()`을 연결한다. 현재는 이 Harness 연결 어댑터를 구현·검증하지 않았으므로 라이브 runner가 준비됐다고 간주하지 않는다.
5. 자연어 목표만 전달하고 3과제×3회 실행한다. 각 회차의 시작 프로필·서버를 새로 만들며, 모델의 `DONE` 대신 별도 검증 결과로 성공을 판단한다. 사전에 정한 메뉴 순서를 JEV에 제공하지 않는다.

라이브 기록에는 고정 버전·모델, 결정/텍스트 호출 수, 수행 동작·재시도, 각 API의 확인 가능한 비용과 누락 항목, 독립 검증 결과를 남긴다. 전체 비용을 확인하지 못하면 `null`과 누락 사유로 남기고 0달러로 추정하지 않는다. 실패는 게임 기능 / 문구·탐색 후보 / 지원 범위 / 에이전트·서비스 문제로 사람이 재검토한다.

JEV의 기본 루프는 화면 이미지로 미술을 판단하지 않는다. Canvas와 내부 스크롤도 지원 범위 밖이다. 실행 시간은 사람의 사용 시간 지표가 아니며, 9회 또는 20회 실행은 실제 소비자 조사 인원으로 집계하지 않는다.

근거: [고정 JEV 소스](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46), [브라우저 연결](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/browser.py), [선행 검토](../../docs/plans/2026-09-22-jev-evaluation.md).
