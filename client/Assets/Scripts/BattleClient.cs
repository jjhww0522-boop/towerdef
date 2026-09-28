using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace TowerDef
{
    // Native UGUI presentation. Server snapshots remain the only gameplay authority.
    public sealed class BattleClient : MonoBehaviour
    {
        LocalSession session;
        RectTransform safe, page, inspector, modal, modPanel;
        NativeBattlefield field;
        Text status, hud, threat, tutorialText, unitTitle, recipeText;
        Button summon, tutorialNext, overdrive, emp, combine, sell, modEntry;
        Text modSchedule, modSummary;
        string modSignature;
        readonly Dictionary<string, Button> modButtons = new Dictionary<string, Button>();
        readonly Dictionary<string, Text> modContexts = new Dictionary<string, Text>();
        string screen = "home", watchedId, modalKind, inspectorSignature;
        int? focusedId;
        int recipeIndex;
        int followSlot = -1;
        string followDefinition;
        bool reduced, sound, resultShown;
        readonly HashSet<int> dispatch = new HashSet<int>();
        readonly List<AudioSource> voices = new List<AudioSource>();
        readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        static readonly string[] Tags =
        {
            "fire",
            "water",
            "frost",
            "wind",
            "electric",
            "laser"
        };
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            if (FindFirstObjectByType<BattleClient>() == null)
                new GameObject("Towerdef Mobile").AddComponent<BattleClient>();
        }

        void Awake()
        {
            Application.targetFrameRate = 60;
            Screen.orientation = ScreenOrientation.Portrait;
            reduced = PlayerPrefs.GetInt("td.mobile.reduced", 0) == 1;
            sound = PlayerPrefs.GetInt("td.mobile.sound", 1) == 1;
            session = gameObject.AddComponent<LocalSession>();
            session.Snapshot += OnSnapshot;
            session.Changed += Refresh;
            var canvasObject = new GameObject("Mobile Canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            canvasObject.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(390, 844);
            scaler.matchWidthOrHeight = 0;
            var background = MobileUI.Box(canvasObject.transform, "Background", MobileUI.Background);
            MobileUI.Stretch(background);
            safe = MobileUI.Box(canvasObject.transform, "Safe area");
            MobileUI.Stretch(safe);
            safe.gameObject.AddComponent<SafeAreaPanel>();
            if (FindFirstObjectByType<EventSystem>() == null)
                new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            if (FindFirstObjectByType<AudioListener>() == null)
                gameObject.AddComponent<AudioListener>();
            for (int i = 0; i < 12; i++)
            {
                var voice = gameObject.AddComponent<AudioSource>();
                voice.playOnAwake = false;
                voice.spatialBlend = 0;
                voice.volume = .2f;
                voices.Add(voice);
            }

            Home();
        }

        void OnDestroy()
        {
            session.Snapshot -= OnSnapshot;
            session.Changed -= Refresh;
        }

        UnitDefinition Definition(string id) => Array.Find(session.Content.units, d => d.id == id);
        Player Watched() => session.State == null ? null : Array.Find(session.State.players, p => p.id == watchedId) ?? session.Me();
        bool CanAct => session.Connected && !session.Busy && !session.HasPendingAction && session.Me()?.status == "active";

        void NewPage(string name)
        {
            MobileUI.Clear(safe);
            screen = name;
            modal = null;
            modalKind = null;
            field = null;
            inspector = null;
            inspectorSignature = null;
            modPanel = null;
            modEntry = null;
            modSignature = null;
            modButtons.Clear();
            modContexts.Clear();
            page = MobileUI.Box(safe, name, MobileUI.Background);
            MobileUI.Stretch(page);
        }

        void Home()
        {
            NewPage("home");
            var content = MobileUI.Scroll(page);
            MobileUI.Label(content, "폐품로봇 원정대", 32, 80);
            MobileUI.Label(content, "행성의 자원을 모으고\n로봇을 조립해 함께 돌아오세요.", 20, 70);
            status = MobileUI.Label(content, session.Notice, 16, 64);
            if (!session.Ready)
            {
                MobileUI.Label(content, "개발 서버 주소", 18);
                var input = MobileUI.Input(content, session.ServerUrl, "http://내 컴퓨터 IP:7351");
                MobileUI.Button(content, "연결", () =>
                {
                    session.ServerUrl = input.text;
                    session.Connect();
                });
                MobileUI.Label(content, "실제 iPhone은 같은 Wi-Fi의 서버 IP를 사용하세요.\n이 화면은 비공개 개발 빌드입니다.", 16, 80);
                return;
            }

            var profile = session.Profile;
            MobileUI.Label(content, $"엔진 {profile.engines.count}/{profile.engines.max} · 연구 {profile.researchCredits}", 22);
            if (profile.lastInterruption != null)
                MobileUI.Label(content, "이전 원정 중단 · 엔진 반환 " + profile.lastInterruption.enginesRefunded + "개", 16, 48);
            if (session.HasSavedSession)
                MobileUI.Button(content, "기존 원정 이어하기 · 추가 입장 비용 없음", session.Resume, 58, MobileUI.Gold);
            MobileUI.Button(content, profile.tutorialCompleted ? "기동 훈련 다시 하기 · 무료" : "기동 훈련 · 무료", () => session.StartExpedition(1, true)).interactable = !session.HasSavedSession;
            MobileUI.Button(content, "스테이지 선택", Stages, 58, MobileUI.Gold);
            MobileUI.Button(content, "설계도 연구", Research);
            MobileUI.Button(content, "소리·움직임 설정", Settings);
        }

        void Stages()
        {
            NewPage("stages");
            var content = MobileUI.Scroll(page);
            MobileUI.Button(content, "‹ 홈", Home);
            MobileUI.Label(content, "챕터 1 · 고물 행성", 26);
            foreach (var stage in session.Content.battlefields)
            {
                var item = stage;
                bool unlocked = Array.IndexOf(session.Profile.unlockedBattlefields, item.id) >= 0;
                int seconds = item.resolvedRules == null ? 0 : MobileModel.DurationSeconds(item.resolvedRules, item.objective);
                MobileUI.Label(content, $"1-{item.id} {item.name}" + (item.difficulty.HasValue ? $" · 난이도 {item.difficulty}/10" : ""), 21, 48);
                MobileUI.Label(content, item.description + (seconds > 0 ? $"\n최대 {seconds / 60}:{seconds % 60:00}" : ""), 16, 72);
                MobileUI.Button(content, unlocked ? "출발 · 엔진 1" : "이전 구역 클리어 후 입장", () => session.StartExpedition(item.id, false), 50, MobileUI.Gold).interactable = unlocked && !session.HasSavedSession && session.Profile.engines.count > 0;
            }

            MobileUI.Label(content, "함께하기 · 최대 4명", 22);
            var room = MobileUI.Input(content, "", "동료와 같은 방 코드");
            MobileUI.Button(content, "1구역 협동 참가 · 엔진 1", () =>
            {
                if (!string.IsNullOrWhiteSpace(room.text))
                    session.StartExpedition(1, false, room.text.Trim());
            }).interactable = !session.HasSavedSession && session.Profile.engines.count > 0;
        }

        void Research()
        {
            NewPage("research");
            var content = MobileUI.Scroll(page);
            MobileUI.Button(content, "‹ 홈", Home);
            MobileUI.Label(content, "설계도 · 연구 " + session.Profile.researchCredits, 24);
            if (session.Profile.rosterMigration != null && session.Profile.rosterMigration.refundedCredits > 0)
                MobileUI.Label(content, $"유닛 개편으로 종료된 연구 비용 {session.Profile.rosterMigration.refundedCredits} 연구 크레딧을 돌려드렸어요.", 16, 64);
            foreach (var recipe in session.Content.recipes.Where(r => r.unlockBattlefield > 0))
            {
                var item = recipe;
                bool owned = Array.IndexOf(session.Profile.unlockedRecipes, item.id) >= 0;
                MobileUI.Label(content, Definition(item.result).name + "\n" + (owned ? "해금 완료" : item.unlockType == "future" ? item.unlockLabel : $"1-{item.unlockBattlefield} 클리어"), 18, 60);
                if (Definition(item.result).tier == "ultimate")
                    MobileUI.Label(content, Definition(item.ingredients[0]).name + " ×3 경로", 16, 32);
                if (item.unlockType != "clear" && item.unlockType != "future")
                    MobileUI.Button(content, owned ? "연구 완료" : $"연구 · {item.researchCost} 크레딧", () => session.Research(item.id)).interactable = !owned && Array.IndexOf(session.Profile.clearedBattlefields, item.unlockBattlefield) >= 0 && session.Profile.researchCredits >= item.researchCost;
            }
        }

        void BuildBattle()
        {
            NewPage("battle");
            resultShown = false;
            var header = MobileUI.Box(page, "HUD", MobileUI.Panel);
            header.anchorMin = new Vector2(0, 1);
            header.anchorMax = Vector2.one;
            header.pivot = new Vector2(.5f, 1);
            header.sizeDelta = new Vector2(0, 138);
            MobileUI.Vertical(header, 8, 0);
            hud = MobileUI.Label(header, "", 20, 35);
            threat = MobileUI.Label(header, "", 16, 40);
            var row = MobileUI.Row(header, 44);
            MobileUI.Button(row, "원정대", Team, 44);
            modEntry = MobileUI.Button(row, "현장개조", OpenFieldMods, 44);
            modEntry.GetComponentInChildren<Text>().fontSize = 15;
            MobileUI.Button(row, "설정", Settings, 44);
            MobileUI.Button(row, "귀환", () => Confirm("귀환하면 진행 중 원정에서 이탈합니다.", () => session.ReturnHome()), 44);
            var board = MobileUI.Box(page, "Battlefield");
            MobileUI.Stretch(board, 4, 170, 4, 144);
            field = board.gameObject.AddComponent<NativeBattlefield>();
            field.color = Color.white;
            field.raycastTarget = false;
            field.Select = Select;
            field.PlaySound = PlaySound;
            field.Reduced = reduced;
            var controls = MobileUI.Box(page, "Controls", MobileUI.Panel);
            MobileUI.Fixed(controls, 6, 5, 6, 160);
            MobileUI.Vertical(controls, 5, 3);
            var supports = MobileUI.Row(controls, 46);
            overdrive = MobileUI.Button(supports, "과부하", () => session.Send("tactic", tactic: "overdrive"), 46);
            emp = MobileUI.Button(supports, "EMP", () => session.Send("tactic", tactic: "emp"), 46);
            var actions = MobileUI.Row(controls, 50);
            summon = MobileUI.Button(actions, "로봇 뽑기", () => session.Send("summon"), 50, MobileUI.Gold);
            MobileUI.Button(actions, "보유", Roster, 50);
            MobileUI.Button(actions, "강화", Upgrades, 50);
            status = MobileUI.Label(controls, "", 14, 42);
            var guide = MobileUI.Box(page, "Tutorial", MobileUI.Panel);
            guide.anchorMin = new Vector2(0, 1);
            guide.anchorMax = Vector2.one;
            guide.pivot = new Vector2(.5f, 1);
            guide.anchoredPosition = new Vector2(0, -142);
            guide.sizeDelta = new Vector2(-12, 100);
            MobileUI.Vertical(guide, 6, 2);
            tutorialText = MobileUI.Label(guide, "", 16, 40);
            tutorialNext = MobileUI.Button(guide, "다음", TutorialNext, 46);
            guide.gameObject.SetActive(session.State.tutorial != null);
            RefreshBattle();
        }

        void OnSnapshot(GameState state)
        {
            if (watchedId == null || !state.players.Any(p => p.id == watchedId))
                watchedId = session.PlayerId;
            dispatch.RemoveWhere(id => !session.Me().units.Any(u => u.id == id && !u.dispatched));
            if (focusedId.HasValue && !session.Me().units.Any(u => u.id == focusedId.Value && !u.dispatched))
            {
                focusedId = session.Me().units.FirstOrDefault(u => u.slot == followSlot && u.definitionId == followDefinition)?.id;
                if (focusedId.HasValue)
                    PlaySound("assemble");
                followSlot = -1;
                followDefinition = null;
                CloseModal();
            }

            if (screen != "battle")
                BuildBattle();
            RefreshBattle();
            if (session.Me().status != "active" && !resultShown)
                Result();
        }

        void Refresh()
        {
            if (session.State != null)
            {
                if (screen != "battle")
                    BuildBattle();
                RefreshBattle();
                return;
            }

            if (screen == "research" && session.Ready)
                Research();
            else if (screen != "stages" || !session.Ready)
                Home();
        }

        void Update()
        {
            if (screen == "battle" && session.State != null)
                RefreshControls();
        }

        void RefreshBattle()
        {
            if (field == null || session.State == null)
                return;
            var state = session.State;
            var player = Watched();
            var r = state.rules;
            hud.text = $"{state.wave}/{r.totalWaves} · 고철 {session.Me().gold} · {player.units.Length}/{r.maxUnits}" + (player.id == session.PlayerId ? "" : " · 관전");
            string danger = player.facilityHp.HasValue ? $"{state.objective.label} {Mathf.CeilToInt(player.facilityHp.Value)}" : "적 " + player.enemies.Length + "/" + r.overcrowdCount;
            threat.text = state.bossRemainingTicks.HasValue ? danger + $" · 보스 {state.bossRemainingTicks.Value / (float)r.ticksPerSecond:0.0}초" : danger + "\n" + (state.encounter?.next?.label ?? state.encounter?.current?.label ?? "방어 중");
            if (player.overcrowdedTicks > 0)
                threat.text += $" · 과밀 {(r.overcrowdTicks - player.overcrowdedTicks) / (float)r.ticksPerSecond:0.0}초";
            threat.color = player.overcrowdedTicks > 0 || player.facilityHp < state.objective.facilityHp * .3f ? new Color(1, .5f, .4f) : Color.white;
            field.Bind(session.Content, Array.Find(session.Content.battlefieldLayouts, l => l.battlefieldId == (state.tutorial == null ? state.battlefieldId : 0)), player);
            field.Focus = player.id == session.PlayerId ? focusedId : null;
            status.text = session.Notice;
            UpdateTutorial();
            RenderInspector();
            RefreshFieldMods();
            RefreshControls();
        }

        void RefreshControls()
        {
            if (summon == null)
                return;
            var state = session.State;
            var me = session.Me();
            var r = state.rules;
            var t = state.tutorial;
            summon.interactable = CanAct && me.gold >= r.summonCost && me.units.Length < r.maxUnits && me.summonCooldownRemainingTicks == 0 && (t == null || new[]
            {
                "summon",
                "fill",
                "replacement"
            }.Contains(t.step));
            MobileUI.SetText(summon, me.units.Length >= r.maxUnits ? "자리 가득 참" : $"로봇 뽑기\n{r.summonCost} 고철");
            bool ready = CanAct && t == null && (me.tactical?.cooldownRemainingTicks ?? 1) == 0;
            overdrive.interactable = ready && me.units.Any(u => !u.dispatched);
            emp.interactable = ready && me.enemies.Length > 0;
            var cooldown = (me.tactical?.cooldownRemainingTicks ?? 0) / (float)r.ticksPerSecond;
            MobileUI.SetText(overdrive, cooldown > 0 ? $"지원 {cooldown:0}초" : "과부하 · 6초");
            MobileUI.SetText(emp, cooldown > 0 ? $"지원 {cooldown:0}초" : "EMP · 정지");
            tutorialNext.interactable = CanAct;
            if (combine != null)
            {
                var recipe = CurrentRecipe();
                combine.interactable = CanAct && recipe != null && MobileModel.Unlocked(recipe, me) && MobileModel.Materials(recipe, me, focusedId ?? -1) != null && (t == null || t.step == "combine" && focusedId == t.anchorUnitId);
            }

            if (sell != null)
                sell.interactable = CanAct && (t == null || t.step == "sell" && focusedId == t.saleUnitId);
            if (session.HasPendingAction)
                status.text = "응답 확인 필요 · 설정에서 같은 요청 재시도";
            foreach (var button in modButtons.Values)
                button.interactable = CanAct && me.fieldMod?.available == true;
        }

        void Select(int id)
        {
            if (Watched()?.id != session.PlayerId)
                return;
            CloseFieldMods(false);
            focusedId = id;
            recipeIndex = 0;
            inspectorSignature = null;
            CloseModal();
            RenderInspector();
        }

        Recipe[] Choices() => focusedId.HasValue ? session.Content.recipes.Where(r => r.ingredients.Contains(session.Me().units.FirstOrDefault(u => u.id == focusedId)?.definitionId) && (session.State.tutorial == null || r.id == "make_laser_2")).ToArray() : Array.Empty<Recipe>();
        Recipe CurrentRecipe()
        {
            var options = Choices();
            return options.Length == 0 ? null : options[recipeIndex % options.Length];
        }

        void RenderInspector()
        {
            if (field == null)
                return;
            field.Consumed = Array.Empty<int>();
            field.Result = null;
            if (modPanel != null)
            {
                if (inspector)
                    inspector.gameObject.SetActive(false);
                return;
            }

            if (inspector)
                inspector.gameObject.SetActive(true);
            var unit = session.Me().units.FirstOrDefault(u => u.id == focusedId && !u.dispatched);
            if (unit == null)
            {
                if (inspector)
                    Destroy(inspector.gameObject);
                inspector = null;
                combine = null;
                sell = null;
                return;
            }

            var recipe = CurrentRecipe();
            var material = recipe == null ? null : MobileModel.Materials(recipe, session.Me(), unit.id);
            field.Consumed = material ?? Array.Empty<int>();
            field.Result = recipe == null ? null : Definition(recipe.result);
            field.Focus = focusedId;
            string signature = unit.id + ":" + (recipe?.id ?? "") + ":" + string.Join(",", material ?? Array.Empty<int>());
            if (inspector && signature == inspectorSignature)
                return;
            inspectorSignature = signature;
            if (inspector)
                Destroy(inspector.gameObject);
            inspector = MobileUI.Box(page, "Selected robot", MobileUI.Panel);
            MobileUI.Fixed(inspector, 8, 172, 8, 220);
            MobileUI.Vertical(inspector, 7, 3);
            var heading = MobileUI.Row(inspector, 44);
            unitTitle = MobileUI.Label(heading, Definition(unit.definitionId).name, 20, 44);
            MobileUI.Button(heading, "닫기", () =>
            {
                focusedId = null;
                RenderInspector();
            }, 44);
            string materials = recipe == null ? "" : string.Join(" + ", recipe.ingredients.GroupBy(id => id).Select(group => Definition(group.Key).name + "×" + group.Count()));
            var body = MobileUI.Label(inspector, MobileModel.Element(Definition(unit.definitionId).element) + $" · 자리 {unit.slot + 1}" + (recipe == null ? "\n사용 가능한 조립 없음" : "\n→ " + Definition(recipe.result).name + " · " + (!MobileModel.Unlocked(recipe, session.Me()) ? (recipe.unlockType == "future" ? recipe.unlockLabel : $"1-{recipe.unlockBattlefield} 클리어 시 해금") : (material == null ? "부족: " : "소모: ") + materials)), 15, 60);
            var row = MobileUI.Row(inspector, 46);
            combine = MobileUI.Button(row, "이 자리 조립", () =>
            {
                var current = CurrentRecipe();
                var ids = MobileModel.Materials(current, session.Me(), unit.id);
                if (ids != null && MobileModel.Unlocked(current, session.Me()))
                {
                    followSlot = unit.slot;
                    followDefinition = current.result;
                    session.Send("combine", current.id, unitIds: ids);
                }
            }, 46, MobileUI.Gold);
            MobileUI.Button(row, "다른 결과", () =>
            {
                recipeIndex++;
                inspectorSignature = null;
                RenderInspector();
            }, 46).interactable = Choices().Length > 1;
            var management = MobileUI.Row(inspector, 44);
            sell = MobileUI.Button(management, "판매", () => Confirm(Definition(unit.definitionId).name + $"은 사라집니다.\n+{unit.salvageGold} 고철", () => session.Send("salvage", unitIds: new[] { unit.id })), 44);
            MobileUI.Button(management, "상세·파견", () => Inspection(unit.id), 44);
            RefreshControls();
        }

        string ModName(string id) => Array.Find(session.Content.fieldMods, mod => mod.id == id)?.name ?? "선택 없음";
        string ModContext(string id)
        {
            var home = session.Me().units.Where(unit => !unit.dispatched).Select(unit => Definition(unit.definitionId)).ToArray();
            if (id == "tracker")
                return $"본진 냉동 {home.Count(unit => unit?.element == "frost")}기 · EMP와도 연계";
            if (id == "scatter")
                return $"본진 범위·연쇄 {home.Count(unit => unit?.attackPattern == "blast" || unit?.attackPattern == "arc")}기 · 후속 적중 강화";
            return $"본진 {home.Length}기 · 새로 진입한 적에게 유리";
        }

        void OpenFieldMods()
        {
            var mods = session.Me()?.fieldMod;
            if (mods == null)
                return;
            if (modPanel)
            {
                CloseFieldMods();
                return;
            }

            CloseModal();
            if (inspector)
                inspector.gameObject.SetActive(false);
            modPanel = MobileUI.Box(page, "Field modifications", MobileUI.Panel);
            MobileUI.Fixed(modPanel, 8, 172, 8, Mathf.Min(370, Mathf.Max(160, safe.rect.height - 324)));
            var heading = MobileUI.Box(modPanel, "Heading");
            heading.anchorMin = new Vector2(0, 1);
            heading.anchorMax = Vector2.one;
            heading.pivot = new Vector2(.5f, 1);
            heading.sizeDelta = new Vector2(0, 48);
            MobileUI.Vertical(heading, 2, 0);
            var row = MobileUI.Row(heading, 44);
            MobileUI.Label(row, "현장개조 · 내 원정", 19, 44);
            MobileUI.Button(row, "닫기", () => CloseFieldMods(), 44);
            modSignature = null;
            RefreshFieldMods();
            RenderInspector();
        }

        void CloseFieldMods(bool restoreInspector = true)
        {
            if (modPanel)
            {
                modPanel.gameObject.SetActive(false);
                Destroy(modPanel.gameObject);
            }

            modPanel = null;
            modSignature = null;
            modButtons.Clear();
            modContexts.Clear();
            if (restoreInspector && field)
                RenderInspector();
        }

        void RefreshFieldMods()
        {
            if (modEntry == null)
                return;
            var mods = session.Me()?.fieldMod;
            modEntry.gameObject.SetActive(mods != null);
            if (mods == null)
            {
                CloseFieldMods(false);
                return;
            }

            MobileUI.SetText(modEntry, mods.available ? (mods.activeId == null ? "개조 선택" : "개조 조정") : "현장개조");
            if (!modPanel)
                return;
            var signature = (mods.offerId ?? "") + ":" + mods.activeId + ":" + mods.available;
            if (signature != modSignature)
            {
                modSignature = signature;
                var previous = modPanel.Find("Body");
                if (previous)
                {
                    previous.gameObject.SetActive(false);
                    Destroy(previous.gameObject);
                }

                modButtons.Clear();
                modContexts.Clear();
                var area = MobileUI.Box(modPanel, "Body");
                MobileUI.Stretch(area, 0, 0, 0, 50);
                var content = MobileUI.Scroll(area);
                modSchedule = MobileUI.Label(content, "", 16, 66);
                modSummary = MobileUI.Label(content, "", 16, 52);
                foreach (var id in mods.optionIds)
                {
                    var definition = Array.Find(session.Content.fieldMods, mod => mod.id == id);
                    if (definition == null)
                        continue;
                    var offerId = mods.offerId;
                    var modId = id;
                    var choice = MobileUI.Button(content, (id == mods.activeId ? "유지 · " : "선택 · ") + definition.name, () => session.Send("choose_mod", offerId: offerId, modId: modId), 48, id == mods.activeId ? MobileUI.Gold : (Color? )null);
                    modButtons[id] = choice;
                    MobileUI.Label(content, definition.description, 16, 65);
                    modContexts[id] = MobileUI.Label(content, "", 14, 42);
                }

                MobileUI.Label(content, "한 효과만 적용 · 일반 전투는 계속됩니다.\n첫 선택 이후 한 번 더 유지하거나 교체할 수 있어요.", 15, 64);
            }

            string next = mods.nextOfferTick.HasValue ? $"다음 기회 {Mathf.Max(0, Mathf.CeilToInt((mods.nextOfferTick.Value - session.State.tick) / (float)session.State.rules.ticksPerSecond))}초 후" : "이번 원정의 마지막 조정";
            bool ended = session.Me().status != "active" || session.State.status != "playing";
            modSchedule.text = ended ? "내 원정 종료 · 개조 기록" : (mods.available ? "무료 선택 가능 · " : "현재 설정 · ") + next;
            if (!ended && session.HasPendingAction)
                modSchedule.text = "서버 확인 중 · 설정에서 같은 요청을 재시도할 수 있어요.";
            var total = mods.stats.Sum(item => item.bonusDamage);
            modSummary.text = "현재 " + ModName(mods.activeId) + $"\n누적 추가 피해 {total:0.#} · 유효 적중 {mods.stats.Sum(item => item.hits)}회";
            foreach (var pair in modContexts)
                pair.Value.text = ModContext(pair.Key);
            foreach (var button in modButtons.Values)
                button.interactable = CanAct && mods.available;
        }

        void AddFieldModRecap(Transform parent, FieldModState mods)
        {
            MobileUI.Label(parent, "이번 원정의 현장개조", 20, 42);
            if (mods == null || mods.history.Length == 0)
            {
                MobileUI.Label(parent, "현장개조를 선택하지 않았어요. 다음 원정에서는 병력과 적 예고에 맞춰 선택해 보세요.", 16, 75);
                return;
            }

            MobileUI.Label(parent, string.Join(" → ", mods.history.Select(choice => ModName(choice.modId))), 18, 58);
            foreach (var stat in mods.stats.Where(item => mods.history.Any(choice => choice.modId == item.modId)))
                MobileUI.Label(parent, ModName(stat.modId) + $" · 추가 피해 {stat.bonusDamage:0.#}\n유효 적중 {stat.hits}회", 16, 64);
            MobileUI.Label(parent, "추가 피해는 해당 타격에서 적의 남은 체력만큼만 집계합니다. 개조는 다음 원정에 이어지지 않아요.", 14, 70);
        }

        RectTransform OpenModal(string kind, string title)
        {
            CloseFieldMods(false);
            CloseModal();
            modalKind = kind;
            modal = MobileUI.Box(page, "Overlay", new Color(.025f, .07f, .1f, .98f));
            MobileUI.Stretch(modal, 6, 8, 6, 130);
            var heading = MobileUI.Box(modal, "Heading");
            heading.anchorMin = new Vector2(0, 1);
            heading.anchorMax = Vector2.one;
            heading.pivot = new Vector2(.5f, 1);
            heading.sizeDelta = new Vector2(0, 50);
            MobileUI.Vertical(heading, 0, 0);
            var row = MobileUI.Row(heading, 48);
            MobileUI.Label(row, title, 21, 48);
            MobileUI.Button(row, "닫기", CloseModal, 48);
            var area = MobileUI.Box(modal, "Body");
            MobileUI.Stretch(area, 0, 0, 0, 54);
            return MobileUI.Scroll(area);
        }

        void CloseModal()
        {
            if (modal)
                Destroy(modal.gameObject);
            modal = null;
            modalKind = null;
        }

        void Confirm(string message, Action action)
        {
            var body = OpenModal("confirm", "확인");
            MobileUI.Label(body, message, 22, 100);
            var cancel = MobileUI.Button(body, "취소", CloseModal);
            MobileUI.Button(body, "확인", () =>
            {
                CloseModal();
                action();
            }, 50, MobileUI.Gold);
            EventSystem.current.SetSelectedGameObject(cancel.gameObject);
        }

        void Roster()
        {
            var body = OpenModal("roster", "보유 로봇 · 전투는 계속됩니다");
            foreach (var unit in session.Me().units)
            {
                var item = unit;
                MobileUI.Button(body, $"{Definition(item.definitionId).name} · 자리 {item.slot + 1}" + (item.dispatched ? " · 파견 중" : ""), () => Select(item.id)).interactable = !item.dispatched;
            }
        }

        void Inspection(int id)
        {
            var unit = session.Me().units.FirstOrDefault(u => u.id == id);
            if (unit == null)
                return;
            var definition = Definition(unit.definitionId);
            var body = OpenModal("inspect", definition.name);
            MobileUI.Label(body, MobileModel.Element(definition.element) + $"\n사거리 {definition.attackRange} · 기본 공격 {definition.attack}", 18, 75);
            MobileUI.Label(body, MobileModel.UpgradeDescription(definition) + $"\nLv.{MobileModel.UpgradeLevel(definition, session.Me().upgrades)} · 주 대상 {MobileModel.PrimaryDps(definition, session.Me().upgrades, session.State.rules):0.0} /초", 16, 70);
            var recipe = CurrentRecipe();
            if (recipe != null)
            {
                var result = Definition(recipe.result);
                MobileUI.Label(body, $"{recipe.ingredients.Length}기 → 1기 · 자리 {unit.slot + 1} 유지\n결과 {result.name} · 사거리 {result.attackRange}", 18, 90);
                MobileUI.Label(body, MobileModel.UpgradeDescription(result), 16, 60);
            }

            MobileUI.Label(body, "파견하면 본진 방어에서 빠집니다.\n스토리 종료 시 원래 자리로 복귀합니다.", 17, 70);
            MobileUI.Button(body, dispatch.Contains(id) ? "파견 대기 해제" : "파견 대기", () =>
            {
                if (dispatch.Contains(id))
                    dispatch.Remove(id);
                else if (dispatch.Count + session.Me().units.Count(u => u.dispatched) < session.State.rules.maxDispatch)
                    dispatch.Add(id);
                Inspection(id);
            }).interactable = session.State.tutorial == null;
        }

        void Upgrades()
        {
            var body = OpenModal("upgrades", "강화 · 이번 원정에 적용");
            MobileUI.Label(body, "같은 속성의 현재·새 로봇에 적용돼요.\n공통 S는 가장 높은 속성 강화 1개만 적용해요.", 16, 64);
            for (int i = 0; i < Tags.Length; i++)
            {
                var tag = Tags[i];
                var level = session.Me().upgrades.Get(tag);
                var r = session.State.rules;
                int count = session.Me().units.Count(u =>
                {
                    var d = Definition(u.definitionId);
                    return level < r.maxUpgradeLevel && (d.tier == "ultimate" ? level + 1 > session.Me().upgrades.Highest : d.element == tag);
                });
                MobileUI.Button(body, $"{MobileModel.ElementName(tag)} 강화 {level}/{r.maxUpgradeLevel} · 지금 {count}기\n" + (level >= r.maxUpgradeLevel ? "최대" : $"{r.upgradeCosts[level]} 고철 · 기본 공격의 +{r.upgradeBonus * 100:0}%"), () =>
                {
                    session.Send("upgrade", tag: tag);
                    CloseModal();
                }, 66).interactable = CanAct && level < r.maxUpgradeLevel && session.Me().gold >= r.upgradeCosts[Math.Min(level, r.maxUpgradeLevel - 1)];
            }
        }

        void Team()
        {
            var body = OpenModal("team", "원정대 · 방 " + session.RoomId);
            foreach (var player in session.State.players)
            {
                var id = player.id;
                MobileUI.Button(body, (id == session.PlayerId ? "내 전장" : id) + " · " + player.status, () =>
                {
                    watchedId = id;
                    focusedId = null;
                    CloseModal();
                    RefreshBattle();
                });
            }

            var story = session.State.story;
            MobileUI.Label(body, story == null ? "스토리 시작을 기다리고 있어요." : $"공동 스토리 {story.status}\n체력 {story.hp:0}/{story.maxHp:0} · {story.remainingTicks / session.State.rules.ticksPerSecond}초", 18, 85);
            MobileUI.Label(body, "파견 대기 " + dispatch.Count + "기 · 종료 시 복귀", 17, 50);
            MobileUI.Button(body, "선택한 로봇 파견", () =>
            {
                session.Send("dispatch", unitIds: dispatch.ToArray());
                CloseModal();
            }).interactable = CanAct && story?.status == "active" && dispatch.Count > 0;
        }

        void Settings()
        {
            var body = OpenModal("settings", "설정 · 일반 전투는 계속됩니다");
            MobileUI.Button(body, "효과음 " + (sound ? "켜짐" : "꺼짐"), () =>
            {
                sound = !sound;
                PlayerPrefs.SetInt("td.mobile.sound", sound ? 1 : 0);
                if (!sound)
                    foreach (var voice in voices)
                        voice.Stop();
                Settings();
            });
            MobileUI.Button(body, "움직임 줄이기 " + (reduced ? "켜짐" : "꺼짐"), () =>
            {
                reduced = !reduced;
                PlayerPrefs.SetInt("td.mobile.reduced", reduced ? 1 : 0);
                if (field)
                    field.Reduced = reduced;
                Settings();
            });
            MobileUI.Label(body, session.Notice, 17, 80);
            MobileUI.Button(body, "같은 요청 재시도", () =>
            {
                session.RetryPending();
                CloseModal();
            }).interactable = session.HasPendingAction;
            MobileUI.Button(body, "현재 원정 재연결", () =>
            {
                session.Resume();
                CloseModal();
            }).interactable = session.HasSavedSession;
            PlayerPrefs.Save();
        }

        void UpdateTutorial()
        {
            var t = session.State.tutorial;
            if (t == null)
                return;
            string copy;
            bool next = false;
            switch (t.step)
            {
                case "intro":
                    copy = "지구를 위한 첫 원정! 로봇을 뽑아 방어해 봅시다.";
                    next = true;
                    break;
                case "summon":
                    copy = "로봇 뽑기를 눌러 두 기를 깨우세요.";
                    break;
                case "skirmish":
                    copy = "첫 방어! 로봇은 자동으로 공격합니다.";
                    break;
                case "inspect":
                    copy = "레이저 포인터를 선택하면 같은 재료 3기가 필요한 것을 볼 수 있어요.";
                    next = true;
                    break;
                case "fill":
                    copy = "훈련장은 4칸이에요. 재료를 더 뽑으세요.";
                    break;
                case "sell":
                    copy = "라이터를 선택해 판매하고 자리를 만드세요.";
                    next = true;
                    break;
                case "replacement":
                    copy = "빈자리에 마지막 레이저 포인터를 뽑으세요.";
                    break;
                case "combine":
                    copy = "처음 레이저 포인터를 선택해 3기를 레이저 조각기로 조립하세요.";
                    next = true;
                    break;
                case "counterattack":
                    copy = "조립한 로봇이 남은 적에게 반격합니다.";
                    break;
                case "boss_ready":
                    copy = "준비 완료! 보스전을 시작하세요.";
                    next = true;
                    break;
                case "countdown":
                    copy = "보스 접근! 자동 공격으로 막으세요.";
                    break;
                case "boss":
                    copy = "제한 시간 안에 보스를 처치하세요.";
                    break;
                default:
                    copy = "훈련 완료!";
                    break;
            }

            tutorialText.text = (session.State.combatPaused ? "설명 중 · 전투 멈춤\n" : "") + copy;
            if (t.step == "sell" && focusedId == t.saleUnitId || t.step == "combine" && focusedId == t.anchorUnitId)
                next = false;
            tutorialNext.gameObject.SetActive(next);
            MobileUI.SetText(tutorialNext, t.step == "inspect" && focusedId == t.anchorUnitId ? "재료 찾기" : "다음 / 대상 선택");
        }

        void TutorialNext()
        {
            var t = session.State.tutorial;
            if (t == null)
                return;
            if (new[]
            {
                "inspect",
                "sell",
                "combine"
            }.Contains(t.step))
            {
                int? target = t.step == "sell" ? t.saleUnitId : t.anchorUnitId;
                if (focusedId != target && target.HasValue)
                {
                    Select(target.Value);
                    return;
                }

                if (t.step != "inspect")
                    return;
            }

            session.Send("tutorial_next", unitIds: t.step == "inspect" && t.anchorUnitId.HasValue ? new[] { t.anchorUnitId.Value } : null);
        }

        void Result()
        {
            resultShown = true;
            var player = session.Me();
            var result = player.result;
            var body = OpenModal("result", player.status == "cleared" ? "원정 성공" : "원정 종료");
            MobileUI.Label(body, player.status == "cleared" ? "자원을 싣고 귀환합니다." : MobileModel.Failure(player.defeatReason), 22, 65);
            MobileUI.Label(body, $"연구 크레딧 +{result?.researchCredits ?? 0}\n처치 {result?.kills ?? 0} · 도달 {result?.wave ?? session.State.wave}웨이브", 20, 90);
            MobileUI.Label(body, session.State.tutorial != null ? "무료 훈련 완료 · 보상과 엔진 소비 없음" : "서버 원정 기록을 확인하고 다음 준비를 하세요.", 16, 70);
            if (session.State.tutorial == null)
                AddFieldModRecap(body, result?.fieldMod);
            MobileUI.Button(body, "귀환 · 다음 구역 준비", () => session.ReturnHome(), 54, MobileUI.Gold);
            MobileUI.Button(body, session.State.tutorial != null ? "훈련 다시 하기 · 무료" : "다시 도전 · 엔진 1", () => StartCoroutine(Retry()));
            if (session.State.players.Any(p => p.status == "active"))
                MobileUI.Button(body, "동료 관전", () =>
                {
                    watchedId = session.State.players.First(p => p.status == "active").id;
                    CloseModal();
                    RefreshBattle();
                });
        }

        IEnumerator Retry()
        {
            int stage = session.State.battlefieldId;
            bool training = session.State.tutorial != null;
            session.ReturnHome();
            while (session.Busy)
                yield return null;
            if (session.State == null)
                session.StartExpedition(stage, training);
        }

        void PlaySound(string kind)
        {
            if (!sound || !Application.isFocused)
                return;
            if (!clips.TryGetValue(kind, out var clip))
            {
                clip = Resources.Load<AudioClip>("MobileArt/Audio/" + kind);
                clips[kind] = clip;
            }

            if (!clip)
                return;
            var voice = voices.FirstOrDefault(v => !v.isPlaying);
            if (voice)
            {
                voice.clip = clip;
                voice.Play();
            }
        }

        void OnApplicationPause(bool paused)
        {
            if (paused)
                foreach (var voice in voices)
                    voice.Stop();
        }
    }
}
