# 모바일 첫 세트 — 참고와 제작 기록

확인·제작일: 2026-09-27. 대상은 현재 `0.11.1-quick-start`를 보여줄 Unity 대표 7유닛·5적이다.
8구역·18유닛 개편이나 실기기 품질 통과를 주장하지 않는다. 실제 사람 시험 참가자 0명.

| 참고 | 공식 출처에서 확인한 내용 | 우리 적용 | 반입하지 않은 것 |
| --- | --- | --- | --- |
| Survivor.io | [Habby 공식 Google Play 설명](https://play.google.com/store/apps/details?id=com.dxx.firenow&hl=en): 한 손 조작, 스킬 조합 | 조작부를 가리지 않는 짧은 공격·조립 표현, 작은 화면의 역할 식별 우선 | 좀비·주인공·스킬 아이콘·배경·화면 배치·효과음·게임 수치 |
| Brawl Stars | [Supercell 공식 Google Play 설명](https://play.google.com/store/apps/details?id=com.supercell.brawlstars&hl=en): 캐릭터별 고유 공격과 능력 | 몸체·노즐·발사 표현·음색으로 로봇 역할 구별 | 캐릭터 외형·공격 모션 파일·음원·UI·PvP/시즌 시스템 |

공식 설명에서 도출한 우리 설계 해석이다. 최신 인기 순위를 주장하지 않는다.
공식 스크린샷 링크는 확인했지만 이미지가 도구에서 직접 표시되지 않아 시각 관찰의 근거로 쓰지 않았다.
제품용으로 외부 게임 그림·음원·코드·애니메이션을 다운로드하거나 가져오지 않았다.

## 실제 관찰과 이력 구분

기존 `artifacts/position-combat-390.png`, `combat-boss.png`, `operation-review-390-844.png`를 직접 열어 확인했다.
패널 대비 작은 로봇, 비슷한 몸체 반복, 조립 패널이 가리는 소비 위치를 개선 대상으로 삼았다.
보스 캡처의 8,000 HP는 이전 콘텐츠여서 최신 보스 수치 오류의 증거로 사용하지 않는다.
`docs/ART_PIPELINE.md`의 과거 삼국지·27종 지침은 역사 기록으로 분리하고 폐품로봇 첫 세트 계약을 우선시했다.

## 독자 제작·파생 관계

| 산출물 | 제작 방식·파생 원본 | 실제 파일 |
| --- | --- | --- |
| 7유닛·5적 벡터 | 직접 작성한 SVG 도형. `playtest/casual-art.js` 속성 팔레트와 기존 폐품로봇 방향을 이어받음. 새 토치 가족·냉각핀·송풍팬·코일·렌즈·적 차체를 원본 코드로 작성. 외부 그림/생성형 래스터 없음 | `assets/mobile-art/source.mjs`, `assets/mobile-art/svg/` |
| Unity PNG 206개 | Chromium Canvas에서 원본 SVG를 투명 PNG로 래스터화. 사진 편집·트레이싱 없음 | `client/Assets/Resources/MobileArt/Units`, `Enemies`, `Portraits`, `Icons` |
| 타격5+조립/경고/보스/EMP 9음 | 기존 저장소 작성 `playtest/combat-audio.js` 오실레이터·필터·결정적 노이즈를 OfflineAudioContext로 출력, 진폭 정규화·짧은 끝 페이드 | `MobileArt/Audio/*.wav` |
| 승리음 1개 | `tools/export-mobile-art.mjs`에서 삼각파 3음 직접 합성. 외부 음악·샘플 없음 | `Audio/victory.wav` |
| 한글 폰트 | 기존 번들 `DoHyeon-Regular.ttf` 수정 없이 복사. The Do Hyeon Project Authors, SIL OFL 1.1; 기존 대장의 공식 소스 URL과 동봉 라이선스 보존 | `MobileArt/Fonts/DoHyeon-Regular.ttf`, `DoHyeon-OFL.txt` |
| 연락판·모션판 | 위 실제 PNG를 비교용으로 배치. 제품 배경이나 외부 자산이 아님 | `assets/mobile-art/contact-sheet.png`, `motion-sheet.png` |

파일별 파생 SVG 경로·SHA-256·알파 경계는 `assets/mobile-art/export-report.json`과 Unity `contract.json`에 있다.
PNG Sprite Importer와 WAV Importer 설정을 `.meta`로 공급한다. 클라이언트에서 실제 import와 실행을 별도 확인한다.
서버 `plated`는 그림 키 `siege`에만 매핑한다. 외형이 실제 없는 방어력·속성 면역을 뜻하지 않는다.
단일 화염 가족의 그림은 현재 다른 재료를 요구하는 실제 조합식을 변경하지 않는다.

## 검증 범위

출력 도구는 실제 PNG 206개를 모두 디코딩하고 빈 그림/캔버스 잘림을 검사한다.
WAV 10개도 다시 디코딩하여 mono·48kHz·유한값·비무음·피크 1 미만을 확인한다.
연락판과 모션판을 직접 열어 가족·역할 구분, 프레임 잘림, 소형 표시를 검토했다.
이 검증은 Unity 엔진 반입·스마트폰 30fps·사람의 식별률·실제 청취를 대신하지 않는다.
모바일 30fps 및 보이스/FX 예산은 검증할 목표다. 전체 18종과 15초 인트로는 실기기 첫 품질 통과 전 제작하지 않는다.

이 문서는 출처 추적 기록이지 법적 권리 상태에 대한 보증이 아니다. 외부 자산 신규 취득 없음; 기존 폰트는 동봉 OFL 조건 유지.
