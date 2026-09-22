using System;
using System.Collections.Generic;
using UnityEngine;

namespace TowerDef
{
    // Presentation only: no local combat, economy or reward authority.
    public sealed class BattleClient : MonoBehaviour
    {
        LocalSession session;
        readonly HashSet<int> selected = new HashSet<int>();
        readonly Dictionary<int, EnemyView> enemies = new Dictionary<int, EnemyView>();
        readonly Dictionary<int, UnitView> units = new Dictionary<int, UnitView>();
        readonly List<Popup> popups = new List<Popup>();
        readonly string[] tags = { "shu", "wei", "wu", "infantry", "archer", "cavalry", "might", "strategy", "command" };
        string watchedId, tab = "로봇 뽑기";
        Vector2 scroll;
        Texture2D circle;
        Font font;
        GUIStyle text, small, title, button, field;
        readonly Color ink = new Color(.88f, .92f, .94f), gold = new Color(1f, .76f, .34f), muted = new Color(.53f, .64f, .7f);
        sealed class EnemyView { public float from, to, received, hp; }
        sealed class UnitView { public Vector2 position; public float appeared; }
        sealed class Popup { public string text; public Vector2 at; public float time; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            if (FindFirstObjectByType<BattleClient>() == null)
                new GameObject("폐품로봇 원정대 클라이언트").AddComponent<BattleClient>();
        }

        void Awake()
        {
            session = gameObject.AddComponent<LocalSession>();
            session.Snapshot += OnSnapshot;
            Application.targetFrameRate = 60;
            Screen.orientation = ScreenOrientation.LandscapeLeft;
            if (Camera.main == null)
            {
                var camera = new GameObject("Main Camera").AddComponent<Camera>();
                camera.tag = "MainCamera";
                camera.orthographic = true;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(.035f, .055f, .075f);
            }
            font = Font.CreateDynamicFontFromOSFont(new[] { "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", "Arial" }, 18);
            circle = new Texture2D(64, 64, TextureFormat.RGBA32, false);
            var pixels = new Color[4096];
            for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++)
                pixels[y * 64 + x] = new Color(1, 1, 1, Mathf.Clamp01(32 - Vector2.Distance(new Vector2(x + .5f, y + .5f), new Vector2(32, 32))));
            circle.SetPixels(pixels);
            circle.Apply();
        }

        void OnDestroy()
        {
            if (session != null) session.Snapshot -= OnSnapshot;
            if (circle != null) Destroy(circle);
            if (font != null) Destroy(font);
        }

        Player Watched()
        {
            if (session.State?.players == null) return null;
            foreach (var player in session.State.players) if (player.id == watchedId) return player;
            return session.Me();
        }

        void Watch(string id)
        {
            watchedId = id;
            enemies.Clear(); units.Clear(); selected.Clear(); popups.Clear();
            OnSnapshot(session.State);
        }

        void OnSnapshot(GameState state)
        {
            var player = Watched();
            if (player == null) return;
            var present = new HashSet<int>();
            foreach (var enemy in player.enemies)
            {
                present.Add(enemy.id);
                if (!enemies.TryGetValue(enemy.id, out var view))
                    enemies[enemy.id] = view = new EnemyView { from = enemy.progress, to = enemy.progress, hp = enemy.hp };
                else
                {
                    if (view.hp > enemy.hp) popups.Add(new Popup { text = "−" + Mathf.RoundToInt(view.hp - enemy.hp), at = Path(enemy.progress), time = Time.unscaledTime });
                    view.from = enemy.progress < view.to ? enemy.progress : Interpolate(view);
                    view.to = enemy.progress;
                    view.hp = enemy.hp;
                }
                view.received = Time.unscaledTime;
            }
            foreach (var id in new List<int>(enemies.Keys)) if (!present.Contains(id)) enemies.Remove(id);
            present.Clear();
            foreach (var unit in player.units)
            {
                present.Add(unit.id);
                if (!units.ContainsKey(unit.id))
                {
                    units[unit.id] = new UnitView { position = Slot(unit.slot) + new Vector2(0, -35), appeared = Time.unscaledTime };
                    var definition = Definition(unit.definitionId);
                    if (definition != null && (definition.rarity == "hero" || definition.rarity == "legend"))
                        popups.Add(new Popup { text = "등장! " + definition.name, at = Slot(unit.slot), time = Time.unscaledTime });
                }
            }
            foreach (var id in new List<int>(units.Keys)) if (!present.Contains(id)) units.Remove(id);
            selected.RemoveWhere(id => !present.Contains(id) || Array.Exists(player.units, u => u.id == id && u.dispatched));
            if (popups.Count > 100) popups.RemoveRange(0, popups.Count - 100);
        }

        void Update()
        {
            var player = Watched();
            if (player?.units != null) foreach (var unit in player.units)
                if (units.TryGetValue(unit.id, out var view))
                    view.position = Vector2.Lerp(view.position, unit.dispatched ? new Vector2(867, 186 + (unit.id % 2) * 60) : Slot(unit.slot), 1 - Mathf.Exp(-8 * Time.unscaledDeltaTime));
            popups.RemoveAll(p => Time.unscaledTime - p.time > 1.2f);
        }

        void OnGUI()
        {
            if (text == null)
            {
                text = new GUIStyle(GUI.skin.label) { font = font, fontSize = 17, wordWrap = true };
                text.normal.textColor = Color.white;
                small = new GUIStyle(text) { fontSize = 14 };
                title = new GUIStyle(text) { fontSize = 26, fontStyle = FontStyle.Bold };
                button = new GUIStyle(GUI.skin.button) { font = font, fontSize = 16, wordWrap = true };
                field = new GUIStyle(GUI.skin.textField) { font = font, fontSize = 18 };
            }
            Rect safe = Screen.safeArea;
            float scale = Mathf.Min(safe.width / 1280, safe.height / 720);
            GUI.matrix = Matrix4x4.TRS(new Vector3(safe.x + (safe.width - 1280 * scale) / 2, Screen.height - safe.yMax + (safe.height - 720 * scale) / 2, 0), Quaternion.identity, Vector3.one * scale);
            Fill(new Rect(0, 0, 1280, 720), new Color(.035f, .055f, .075f));
            Label(new Rect(26, 17, 680, 40), "폐품로봇 원정대", title, ink);
            Label(new Rect(910, 24, 350, 28), "개발용 연습 · 영구 보상 없음", small, gold);
            if (session.State == null) DrawConnection(); else DrawGame();
            Fill(new Rect(16, 675, 1248, 33), new Color(.065f, .10f, .14f));
            Label(new Rect(28, 679, 1040, 27), session.Notice, small, session.Connected ? muted : gold);
            if (session.HasPendingAction && Click(new Rect(1080, 676, 173, 30), "같은 요청 재시도", !session.Busy)) session.RetryPending();
            GUI.matrix = Matrix4x4.identity;
        }

        void DrawConnection()
        {
            Fill(new Rect(110, 115, 1060, 500), new Color(.065f, .10f, .14f));
            Label(new Rect(155, 147, 920, 42), "내 정거장을 지키고, 함께 구조 작전에 나서세요.", title, ink);
            Label(new Rect(155, 210, 890, 48), "로봇 뽑기 → 확정 조립 → 태그 강화. 스토리가 열리면 로봇 최대 2기를 파견할 수 있습니다.", text, muted);
            Label(new Rect(155, 280, 220, 30), "로컬 서버 주소", text, ink);
            Label(new Rect(155, 335, 220, 30), "방 이름", text, ink);
            Label(new Rect(155, 390, 220, 30), "내 참가자 ID", text, ink);
            GUI.enabled = !session.Busy;
            session.ServerUrl = GUI.TextField(new Rect(375, 275, 630, 40), session.ServerUrl, field);
            session.RoomId = GUI.TextField(new Rect(375, 330, 630, 40), session.RoomId, field);
            session.PlayerId = GUI.TextField(new Rect(375, 385, 630, 40), session.PlayerId, field);
            GUI.enabled = true;
            if (Click(new Rect(375, 450, 630, 55), session.Busy ? "연결 중…" : "연습방 연결 / 재접속", !session.Busy)) session.Connect();
            Label(new Rect(155, 535, 935, 54), "같은 방 이름과 서로 다른 참가자 ID로 최대 4명이 접속합니다. 첫 참가부터 진행되며 빈자리는 봇으로 채우지 않습니다.", small, muted);
        }

        void DrawGame()
        {
            var me = session.Me(); var player = Watched();
            if (player == null || me == null) return;
            bool own = player.id == me.id;
            Label(new Rect(28, 64, 780, 32), "웨이브 " + session.State.wave + "   ·   고철 " + me.gold + "   ·   " + (own ? "내 정거장" : player.id + " 관전") + "   ·   " + Status(player.status), text, gold);
            DrawLane(player, own); DrawTeam(me); DrawControls(me);
            if (Click(new Rect(1002, 622, 244, 40), "방 설정으로 / 나가기", !session.Busy)) session.LeaveRoom();
        }

        void DrawLane(Player player, bool own)
        {
            Fill(new Rect(24, 105, 950, 332), new Color(.08f, .15f, .17f));
            var road = new Color(.19f, .24f, .22f);
            Fill(new Rect(77, 132, 731, 35), road); Fill(new Rect(773, 132, 35, 264), road);
            Fill(new Rect(77, 361, 731, 35), road); Fill(new Rect(77, 132, 35, 264), road);
            Label(new Rect(36, 407, 700, 28), "적 " + player.enemies.Length + " / 70  ·  70마리 이상이 5초 유지되면 개인 패배", small, muted);
            Label(new Rect(818, 115, 145, 28), "스토리 파견", small, gold);
            Disc(new Vector2(866, 214), 49, new Color(.15f, .31f, .39f));
            for (int slot = 0; slot < session.Content.rules.maxUnits; slot++) Disc(Slot(slot) + new Vector2(0, 12), 15, new Color(.11f, .22f, .24f));
            foreach (var enemy in player.enemies)
            {
                Vector2 at = Path(enemies.TryGetValue(enemy.id, out var view) ? Interpolate(view) : enemy.progress);
                float radius = enemy.boss ? 16 : 8;
                Disc(at + new Vector2(1, 4), radius, new Color(0, 0, 0, .4f));
                Disc(at, radius, enemy.boss ? new Color(.86f, .39f, .63f) : new Color(.82f, .34f, .29f));
                Fill(new Rect(at.x - radius, at.y - radius - 7, radius * 2, 3), new Color(.2f, .12f, .14f));
                Fill(new Rect(at.x - radius, at.y - radius - 7, radius * 2 * Mathf.Clamp01(enemy.hp / Mathf.Max(1, enemy.maxHp)), 3), gold);
            }
            foreach (var unit in player.units)
            {
                if (!units.TryGetValue(unit.id, out var visual)) continue;
                var definition = Definition(unit.definitionId); var at = visual.position;
                float idle = Mathf.Sin(Time.unscaledTime * 3 + unit.id) * 1.3f;
                var color = Faction(definition?.faction);
                if (selected.Contains(unit.id)) Disc(at + new Vector2(0, 5), 22, gold);
                float arrival = Mathf.Clamp01(1 - (Time.unscaledTime - visual.appeared));
                if (arrival > 0) Disc(at, 22 + (1 - arrival) * 18, new Color(color.r, color.g, color.b, arrival * .4f));
                Disc(at + new Vector2(0, 13), 17, new Color(0, 0, 0, .35f));
                Fill(new Rect(at.x - 11, at.y - 2 + idle, 22, 23), color);
                Disc(at + new Vector2(0, -7 + idle), 10, new Color(.9f, .77f, .59f));
                Fill(new Rect(at.x - 10, at.y - 15 + idle, 20, 6), color);
                Fill(new Rect(at.x + 14, at.y - 12 + idle, 3, 29), gold);
                if (!unit.dispatched && player.enemies.Length > 0 && definition != null)
                {
                    float cadence = Mathf.Max(.1f, definition.attackIntervalTicks * .1f);
                    float pulse = Mathf.Repeat(Time.unscaledTime + unit.id * .071f, cadence) / cadence;
                    if (pulse < .18f) Disc(at + new Vector2(16, -15), 5 * (1 - pulse / .18f), gold);
                }
                Label(new Rect(at.x - 30, at.y + 22, 64, 20), unit.dispatched ? "파견 중" : ShortName(definition?.name ?? unit.definitionId), small, unit.dispatched ? gold : ink);
                if (own && !unit.dispatched && Click(new Rect(at.x - 25, at.y - 22, 50, 47), "", player.status == "active", true))
                    if (!selected.Remove(unit.id) && selected.Count < 2) selected.Add(unit.id);
            }
            foreach (var popup in popups)
            {
                float age = Time.unscaledTime - popup.time; var color = gold; color.a = 1 - age / 1.2f;
                Label(new Rect(popup.at.x - 20, popup.at.y - 35 - age * 28, 230, 30), popup.text, small, color);
            }
            if (player.status != "active")
            {
                Fill(new Rect(260, 216, 430, 70), new Color(.02f, .04f, .07f, .93f));
                Label(new Rect(280, 231, 400, 48), Status(player.status) + " · 동료 전장을 관전할 수 있습니다", text, gold);
            }
        }

        void DrawTeam(Player me)
        {
            var state = session.State;
            Label(new Rect(1000, 72, 240, 30), "함께하는 전장  " + state.players.Length + "/4", text, ink);
            for (int i = 0; i < state.players.Length; i++)
            {
                var player = state.players[i];
                string lead = player.units.Length > 0 ? Name(player.units[player.units.Length - 1].definitionId) : "로봇 뽑기 대기";
                string caption = (player.id == me.id ? "나" : player.id) + " · " + Status(player.status) + "\n적 " + player.enemies.Length + " · 유닛 " + player.units.Length + " · " + (player.connected ? "접속" : "단절") + "\n" + lead;
                if (Click(new Rect(1000, 110 + i * 81, 248, 73), caption)) Watch(player.id);
            }
            var story = state.story;
            Fill(new Rect(997, 445, 254, 168), new Color(.09f, .15f, .20f));
            Label(new Rect(1010, 456, 227, 29), story == null ? "공동 스토리 준비" : "공동 스토리 · " + Status(story.status), text, gold);
            if (story == null) Label(new Rect(1010, 495, 225, 90), "6 · 12 · 18 웨이브에 개방\n내 유닛 최대 2기를 파견합니다. 파견 중 개인 방어에서 빠집니다.", small, muted);
            else
            {
                Label(new Rect(1010, 493, 220, 26), "남은 시간 " + Mathf.CeilToInt(story.remainingTicks * .1f) + "초", small, ink);
                Fill(new Rect(1010, 526, 225, 12), new Color(.15f, .2f, .24f));
                Fill(new Rect(1010, 526, 225 * Mathf.Clamp01(story.hp / Mathf.Max(1, story.maxHp)), 12), gold);
                Label(new Rect(1010, 551, 225, 58), "체력 " + Mathf.CeilToInt(story.hp) + " / " + Mathf.CeilToInt(story.maxHp) + "\n종료 시 원래 자리로 복귀", small, muted);
            }
        }

        void DrawControls(Player me)
        {
            Fill(new Rect(24, 450, 950, 211), new Color(.065f, .10f, .14f));
            var tabs = new[] { "로봇 뽑기", "조립", "강화" };
            for (int i = 0; i < tabs.Length; i++) if (Click(new Rect(37 + i * 135, 460, 125, 37), (tab == tabs[i] ? "● " : "") + tabs[i])) tab = tabs[i];
            bool active = me.status == "active" && session.Connected && !session.Busy && !session.HasPendingAction;
            bool storyActive = session.State.story != null && session.State.story.status == "active";
            if (Click(new Rect(676, 460, 282, 37), "선택 " + selected.Count + "/2 · 스토리 파견", active && storyActive && selected.Count > 0))
            {
                var ids = new int[selected.Count]; selected.CopyTo(ids); session.Send("dispatch", unitIds: ids);
            }
            if (tab == "로봇 뽑기")
            {
                int cost = session.Content.rules?.summonCost ?? 0;
                if (Click(new Rect(41, 520, 245, 92), "로봇 뽑기\n" + cost + " 고철", active && me.gold >= cost && me.units.Length < session.Content.rules.maxUnits)) session.Send("summon");
                Label(new Rect(318, 521, 620, 40), "재료를 모아 더 강한 로봇으로 확정 조립하세요.", text, ink);
                Label(new Rect(318, 565, 615, 78), "로봇을 눌러 파견할 대원을 선택합니다.\n강화는 계열 · 형태 · 특성이 같은 모든 보유 로봇에 적용됩니다.\n뽑기와 조립으로 얻은 같은 로봇의 성능은 같습니다.", small, muted);
            }
            else if (tab == "조립") DrawRecipes(me, active); else DrawUpgrades(me, active);
        }

        void DrawRecipes(Player me, bool active)
        {
            var recipes = session.Content.recipes;
            scroll = GUI.BeginScrollView(new Rect(39, 507, 917, 146), scroll, new Rect(0, 0, 889, recipes.Length * 51));
            for (int i = 0; i < recipes.Length; i++)
            {
                var recipe = recipes[i]; var needed = new Dictionary<string, int>();
                foreach (var ingredient in recipe.ingredients) needed[ingredient] = needed.TryGetValue(ingredient, out var count) ? count + 1 : 1;
                bool ready = recipe.unlockBattlefield == 0; var parts = new List<string>();
                foreach (var entry in needed)
                {
                    int have = Array.FindAll(me.units, unit => !unit.dispatched && unit.definitionId == entry.Key).Length;
                    ready &= have >= entry.Value;
                    parts.Add(Name(entry.Key) + " " + have + "/" + entry.Value);
                }
                Label(new Rect(0, i * 51, 715, 47), Name(recipe.result) + (recipe.unlockBattlefield > 0 ? " [영구 해금 필요]" : "") + "\n" + string.Join(" + ", parts), small, ready ? ink : muted);
                if (Click(new Rect(759, i * 51 + 4, 110, 39), "확정 조립", active && ready))
                {
                    var materialIds = new List<int>();
                    foreach (var ingredient in recipe.ingredients)
                    {
                        var material = Array.Find(me.units, unit => !unit.dispatched && unit.definitionId == ingredient && !materialIds.Contains(unit.id));
                        if (material != null) materialIds.Add(material.id);
                    }
                    session.Send("combine", recipeId: recipe.id, unitIds: materialIds.ToArray());
                }
            }
            GUI.EndScrollView();
        }

        void DrawUpgrades(Player me, bool active)
        {
            for (int i = 0; i < tags.Length; i++)
            {
                string tag = tags[i]; int level = me.upgrades?.Get(tag) ?? 0;
                bool applies = Array.Exists(me.units, unit => selected.Contains(unit.id) && HasTag(Definition(unit.definitionId), tag));
                int max = session.Content.rules.maxUpgradeLevel;
                int cost = level < max ? session.Content.rules.upgradeCosts[level] : 0;
                string caption = (applies ? "★ " : "") + TagName(tag) + "  " + level + "/" + max + (level < max ? "  ·  " + cost + " 고철" : "  ·  완료");
                if (Click(new Rect(40 + (i % 3) * 304, 511 + (i / 3) * 46, 289, 39), caption, active && level < max && me.gold >= cost)) session.Send("upgrade", tag: tag);
            }
        }

        static bool HasTag(UnitDefinition unit, string tag) => unit != null && (unit.faction == tag || unit.troop == tag || unit.trait == tag);
        UnitDefinition Definition(string id) => session.Content?.units == null ? null : Array.Find(session.Content.units, unit => unit.id == id);
        string Name(string id) => Definition(id)?.name ?? id;
        static string ShortName(string name) => name.Length > 4 ? name.Substring(0, 4) : name;
        static Vector2 Slot(int slot) => new Vector2(152 + (slot % 10) * 65, 205 + (slot / 10) * 65);
        static float Interpolate(EnemyView view) => Mathf.Lerp(view.from, view.to, Mathf.Clamp01((Time.unscaledTime - view.received) / .2f));
        static Vector2 Path(float progress)
        {
            float distance = Mathf.Repeat(progress, 1) * 1880;
            if (distance < 700) return new Vector2(94 + distance, 150);
            if (distance < 940) return new Vector2(794, 150 + distance - 700);
            if (distance < 1640) return new Vector2(794 - (distance - 940), 390);
            return new Vector2(94, 390 - (distance - 1640));
        }
        static Color Faction(string faction) => faction == "shu" ? new Color(.24f, .67f, .45f) : faction == "wei" ? new Color(.32f, .55f, .89f) : new Color(.88f, .39f, .3f);
        static string Status(string status)
        { switch (status) { case "active": return "진행 중"; case "cleared": return "개인 클리어"; case "defeated": return "개인 패배"; case "left": return "이탈"; case "success": return "성공"; case "failed": return "실패"; default: return status; } }
        static string TagName(string tag)
        { switch (tag) { case "shu": return "리사이클"; case "wei": return "오비탈"; case "wu": return "스파크"; case "infantry": return "보행"; case "archer": return "포탑"; case "cavalry": return "궤도"; case "might": return "동력"; case "strategy": return "연산"; case "command": return "제어"; default: return tag; } }
        void Label(Rect rect, string value, GUIStyle style, Color color)
        { var previous = GUI.color; GUI.color = color; GUI.Label(rect, value, style); GUI.color = previous; }
        void Fill(Rect rect, Color color)
        { var previous = GUI.color; GUI.color = color; GUI.DrawTexture(rect, Texture2D.whiteTexture); GUI.color = previous; }
        void Disc(Vector2 at, float radius, Color color)
        { var previous = GUI.color; GUI.color = color; GUI.DrawTexture(new Rect(at.x - radius, at.y - radius, radius * 2, radius * 2), circle); GUI.color = previous; }
        bool Click(Rect rect, string caption, bool enabled = true, bool invisible = false)
        {
            bool previous = GUI.enabled; GUI.enabled = enabled;
            bool clicked = GUI.Button(rect, caption, invisible ? GUIStyle.none : button);
            GUI.enabled = previous; return clicked;
        }
    }
}
