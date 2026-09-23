# 자산 기록

제작 규격과 배포처 후보는 [아트·애니메이션 제작 기준](../docs/ART_PIPELINE.md)에 있다.

현재 게임은 **폐품로봇 원정대**의 밝고 귀여운 우주 폐품로봇을 기준으로 한다. 브라우저의 로봇 초상과 전장 캐릭터는 `playtest/casual-art.js`의 독자 작성 SVG를 공유하며, 전장 연출은 `playtest/battlefield.js`에서 처리한다. SVG 소스도 제작 경로를 확인할 수 있도록 자산 대장에 기록한다.

`manifest.json`에는 현재 사용하는 벡터 소스와 이전 생성 PNG의 이력이 있다. PNG 네 파일은 이전 삼국지 시안이며 보관 상태로 표시한다. 새 세계관에 맞춘 현재 아트나 출시 확정 자산으로 취급하지 않는다. `candidates`는 과거 조사 후보일 뿐 다운로드·사용·구매 완료 목록이 아니다. 아트 제작 기준 문서에 남은 이전 배경 설명은 과거 기록이며, 현재 콘셉트는 [게임 설계](../docs/GAME_DESIGN.md)를 따른다.

2026-09-22에는 기본 유닛 3종의 외형만 생활용품 몸체로 바꾼 대표 시안을 반영했다. 점화봇(`wu_archer`)은 라이터, 캔포봇(`shu_archer`)은 헤어드라이어, 렌즈봇(`wei_archer`)은 레이저포인터이며, 대기·공격 준비·공격 포즈를 같은 SVG 소스에서 제공한다. 이름·조합식·전투 규칙은 변경하지 않았다. 홈의 [원정대 갑판](../playtest/assets/crew-deck.svg)은 Codex와 함께 저장소에서 직접 작성한 벡터다. 외부 이미지 팩이나 CC0 자산으로 표시하지 않는다. 이 반영은 아트 품질이나 실제 이용자 평가의 완료를 뜻하지 않는다.

본문과 Canvas에는 수정하지 않은 **Pretendard Variable v1.3.9**를 로컬 파일로 배포한다. [원본·경로 기록](../playtest/assets/fonts/README.md)과 [저작권·SIL OFL 1.1 전문](../playtest/assets/fonts/OFL.txt)을 함께 보관한다. 폰트 제작자는 Kil Hyung-jin이며 Reserved Font Name은 Pretendard다. 폰트를 재배포할 때 저작권과 라이선스 고지를 함께 유지한다. 폰트와 갑판 SVG의 SHA-256은 `manifest.json`에 기록했다.

2026-09-23에는 제목·주요 버튼에 수정하지 않은 **도현체(Do Hyeon, weight 400)**를 추가했다. [원본 기록](../playtest/assets/fonts/README.md)과 [OFL 전문](../playtest/assets/fonts/DoHyeon-OFL.txt)을 함께 보관한다. 본문·숫자는 Pretendard를 유지한다. 라이터에는 불이 꺼지고 뚜껑이 열린 복귀 자세 하나를 추가했으며, 다른 유닛 전체의 포즈를 확장한 것은 아니다.

실제 자산을 추가할 때 `assets`에 다음을 기록한다.

- `id`, `path`, `kind`, `status`: 고유 ID, 저장소 기준 실제 경로, 종류, placeholder 또는 production
- `creator`, `sourceUrl`, `acquiredAt`, `version`: 제작자, 원본 출처, 입수일, 팩/파일 버전
- `license`, `licenseEvidencePath`, `credit`: 정확한 이용 조건과 보관한 증빙, 필요한 크레딧
- `repositoryRedistribution`: 원본을 저장소에 공개할 수 있는지 확인한 결과
- `modifications`, `sha256`: 수정 내역과 반입 파일의 해시

독자 제작도 원본·작업자·제작 경로를 남긴다. 상업 게임 포함 허용이 원본 자산의 공개 재배포까지 허용한다는 뜻은 아니다. 재배포가 제한된 구매 자산은 이 공개 가능 저장소에 원본을 넣지 않는다. 실제 게임 배포에 필요한 허용 경로를 따로 정한다.
