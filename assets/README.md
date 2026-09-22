# 자산 기록

제작 규격과 배포처 후보는 [아트·애니메이션 제작 기준](../docs/ART_PIPELINE.md)에 있다.

현재 게임은 **폐품로봇 원정대**의 밝고 귀여운 우주 폐품로봇을 기준으로 한다. 브라우저의 로봇 초상과 전장 캐릭터는 `playtest/casual-art.js`의 독자 작성 SVG를 공유하며, 전장 연출은 `playtest/battlefield.js`에서 처리한다. SVG 소스도 제작 경로를 확인할 수 있도록 자산 대장에 기록한다.

`manifest.json`에는 현재 사용하는 벡터 소스와 이전 생성 PNG의 이력이 있다. PNG 네 파일은 이전 삼국지 시안이며 보관 상태로 표시한다. 새 세계관에 맞춘 현재 아트나 출시 확정 자산으로 취급하지 않는다. `candidates`는 과거 조사 후보일 뿐 다운로드·사용·구매 완료 목록이 아니다. 아트 제작 기준 문서에 남은 이전 배경 설명은 과거 기록이며, 현재 콘셉트는 [게임 설계](../docs/GAME_DESIGN.md)를 따른다.

실제 자산을 추가할 때 `assets`에 다음을 기록한다.

- `id`, `path`, `kind`, `status`: 고유 ID, 저장소 기준 실제 경로, 종류, placeholder 또는 production
- `creator`, `sourceUrl`, `acquiredAt`, `version`: 제작자, 원본 출처, 입수일, 팩/파일 버전
- `license`, `licenseEvidencePath`, `credit`: 정확한 이용 조건과 보관한 증빙, 필요한 크레딧
- `repositoryRedistribution`: 원본을 저장소에 공개할 수 있는지 확인한 결과
- `modifications`, `sha256`: 수정 내역과 반입 파일의 해시

독자 제작도 원본·작업자·제작 경로를 남긴다. 상업 게임 포함 허용이 원본 자산의 공개 재배포까지 허용한다는 뜻은 아니다. 재배포가 제한된 구매 자산은 이 공개 가능 저장소에 원본을 넣지 않는다. 실제 게임 배포에 필요한 허용 경로를 따로 정한다.
