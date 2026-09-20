# 자산 기록

제작 규격과 배포처 후보는 [아트·애니메이션 제작 기준](../docs/ART_PIPELINE.md)에 있다.

현재 이 폴더에는 반입한 그림·애니메이션·음향 파일이 없다. `manifest.json`의 `assets`가 비어 있는 것은 누락이 아니라 미반입 상태다. `candidates`는 조사한 후보일 뿐 다운로드·사용·구매 완료 목록이 아니다. 코드가 런타임에 그리는 도형은 이 폴더의 이미지 파일로 간주하지 않는다.

실제 자산을 추가할 때 `assets`에 다음을 기록한다.

- `id`, `path`, `kind`, `status`: 고유 ID, 저장소 기준 실제 경로, 종류, placeholder 또는 production
- `creator`, `sourceUrl`, `acquiredAt`, `version`: 제작자, 원본 출처, 입수일, 팩/파일 버전
- `license`, `licenseEvidencePath`, `credit`: 정확한 이용 조건과 보관한 증빙, 필요한 크레딧
- `repositoryRedistribution`: 원본을 저장소에 공개할 수 있는지 확인한 결과
- `modifications`, `sha256`: 수정 내역과 반입 파일의 해시

독자 제작도 원본·작업자·제작 경로를 남긴다. 상업 게임 포함 허용이 원본 자산의 공개 재배포까지 허용한다는 뜻은 아니다. 재배포가 제한된 구매 자산은 이 공개 가능 저장소에 원본을 넣지 않는다. 실제 게임 배포에 필요한 허용 경로를 따로 정한다.
