# 화면 품질 개선 — 2026-09-19

사용자는 탕탕특공대 수준의 가독성, 캐릭터 표현, 애니메이션과 UI/UX를 최소 기대치로 제시했다. 해당 게임의 캐릭터·화면·자산을 복제하지 않고 독자적인 삼국지 SD 스타일로 개선한다. 이 문서는 상용 게임과 동등한 품질을 달성했다는 인증이 아니다.

## 이번 구현

- 비취색 전장과 성문을 직접 생성한 배경으로 교체.
- 촉·위·오의 보병, 궁병, 지휘관, 책사 12개 시각 유형을 원화 아틀라스로 제작. 27개 게임 유닛은 아직 이 12개 유형을 공유한다.
- 투명 PNG 캐릭터를 Canvas 전장에 렌더링하고 병력·조합 카드에 별도 초상을 사용.
- 서버의 실제 공격 틱과 대상 ID를 화면으로 전달. 공격 예비동작·반동, 화살·검광, 피격·처치, 소환·파견 연출을 연결.
- 큰 소환 버튼, 등급 테두리, 모바일 고정 조작부와 44px 주요 터치 영역 적용.
- 움직임 줄이기 설정과 동시 효과 수 제한 적용.

전투 표현은 현재 브라우저 플레이테스트에 구현되었다. Unity/iPhone 화면에는 아직 이 아트와 연출을 이식하지 않았다. 아군 캐릭터는 원화의 이동·회전·크기 변형과 별도 효과를 사용한다. 적 2종과 보스는 각 4프레임 걷기 원화를 순환한다. 관절 리깅과 아군의 개별 프레임 공격 포즈는 아직 없다. 이를 완성된 상용 애니메이션으로 보고하지 않는다.

## 자산과 생성 기록

외부 게임 자산을 내려받지 않았다. 내장 이미지 생성 도구로 아래 독자 자산을 만들었으며 별도 유료 API나 외부 서비스 계정을 연결하지 않았다.

| 파일 | 형식 | 사용 |
| --- | --- | --- |
| `playtest/assets/characters-v1.png` | 1536×1024, 4열×3행 | 불투명 초상 카드 |
| `playtest/assets/characters-cutout-v1.png` | 1448×1086, 4열×3행, 각 362×362 | 투명 전투 캐릭터 |
| `playtest/assets/battlefield-v1.png` | 1536×1024 | 전장 배경 |
| `playtest/assets/enemies-walk-v1.png` | 1448×1086, 4열×3행 | 도적·중갑병·보스 각 4프레임 걷기 |

캐릭터 행 순서는 촉(비취), 위(파랑), 오(주황); 열 순서는 창·방패 보병, 궁병, 검 지휘관, 부채 책사다. 투명 파일의 32비트 ARGB와 모서리 alpha=0을 확인했다. 초상용 첫 원화에는 불투명 배경이 남아 용도를 분리했다.

투명 원화 생성 프롬프트:

> Create a GAME SPRITE ATLAS on a TRANSPARENT ALPHA BACKGROUND. Absolutely no colored background, no gradient, no card frames, no landscape, no ground planes. The empty space MUST be transparent. 4 columns by 3 rows of full body original chibi Chinese Three Kingdoms fantasy soldiers, each in separate equal sized cell, no overlap, clear margins, consistent front three-quarter camera, readable 64px silhouettes, professional polished mobile action game quality, cel shaded thick dark outlines, round chunky proportions big head small body, glossy illustrated armor. Each character occupies about 75 percent of its cell height, centered horizontally, feet at 87 percent of cell. Row1 jade green armor: column1 shield spearman, column2 bow archer, column3 sword captain, column4 fan tactician. Row2 cobalt blue armor same four roles. Row3 warm orange armor same four roles. All ORIGINAL characters, no text no logos no existing franchise. Render ONLY the 12 isolated character cutouts. Transparent canvas between all characters, transparent canvas around characters. No opaque backdrop anywhere.

## 다음 품질 관문

1. 27개 유닛 고유 실루엣, 적·보스 원화와 전용 공격 포즈를 제작한다.
2. Unity에 스프라이트/애니메이션을 이식하고 실제 iPhone에서 가독성·발열·프레임을 측정한다.
3. 실사용자에게 첫 조합, 강화, 파견을 설명 없이 수행하게 하고 실패 지점을 기록한다.

자동 브라우저 및 내부 에이전트 검토는 실제 소비자 반응으로 계산하지 않는다. 현재 실제 참가자 모집·테스트 결과는 없다.

적 걷기 생성 지시 요약: transparent alpha 4 columns by 3 rows; each row four consecutive walking-right frames of the same original chibi character; red-scarf bandit, purple armored raider, red-horned warlord boss; thick dark outlines, cel shading, consistent scale and clear margins. 실제 프레임은 AI 생성 원화이며 일부 포즈·크기 편차가 남아 있다.
