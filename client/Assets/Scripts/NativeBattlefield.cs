using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

namespace TowerDef
{
    public sealed class NativeBattlefield : MaskableGraphic
    {
        public BattlefieldLayout Layout;
        public Player Player;
        public Content Content;
        public int? Focus;
        public int[] Consumed = Array.Empty<int>();
        public bool Reduced;
        public Action<int> Select;
        public Action<string> PlaySound;
        readonly Dictionary<int, Token> units = new Dictionary<int, Token>(), enemies = new Dictionary<int, Token>();
        readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();
        readonly List<Token> deaths = new List<Token>();
        string boundPlayer;
        BattlefieldLayout measuredLayout;
        Vector2 measuredSize;
        float slotGap = 60;
        Text facilityPressure;
        sealed class Token
        {
            public RectTransform rect;
            public Image image;
            public Text text;
            public Button button;
            public Vector2 target;
            public int? attackTick;
            public float attackAt = -10, hitAt = -10, hp;
            public string definition;
        }

        public void Bind(Content content, BattlefieldLayout layout, Player player)
        {
            if (player != null && boundPlayer != player.id)
            {
                foreach (var token in units.Values)
                    Destroy(token.rect.gameObject);
                foreach (var token in enemies.Values)
                    Destroy(token.rect.gameObject);
                foreach (var token in deaths)
                    Destroy(token.rect.gameObject);
                units.Clear();
                enemies.Clear();
                deaths.Clear();
                boundPlayer = player.id;
            }

            Content = content;
            Layout = layout;
            Player = player;
            if (layout == null || player == null)
                return;
            RefreshGeometry();
            var ids = new HashSet<int>();
            foreach (var unit in player.units)
            {
                ids.Add(unit.id);
                bool existing = units.TryGetValue(unit.id, out var token);
                if (!existing)
                {
                    token = Make(true);
                    units[unit.id] = token;
                    var id = unit.id;
                    BindSelection(token, id);
                    token.rect.anchoredPosition = Local(Slot(unit.slot));
                }

                token.definition = unit.definitionId;
                token.target = Local(Slot(unit.slot));
                token.rect.gameObject.SetActive(!unit.dispatched);
                token.button.interactable = !unit.dispatched;
                var definition = Array.Find(content.units, d => d.id == unit.definitionId);
                token.text.text = Focus == unit.id ? definition?.name ?? "로봇" : "";
                if (existing && unit.lastAttackTick.HasValue && unit.lastAttackTick != token.attackTick)
                {
                    token.attackAt = Time.unscaledTime;
                    PlaySound?.Invoke(definition?.element ?? "laser");
                }

                token.attackTick = unit.lastAttackTick;
            }

            RemoveMissing(units, ids);
            ids.Clear();
            foreach (var enemy in player.enemies)
            {
                ids.Add(enemy.id);
                bool existing = enemies.TryGetValue(enemy.id, out var token);
                if (!existing)
                {
                    token = Make(false);
                    enemies[enemy.id] = token;
                    token.rect.anchoredPosition = EnemyPosition(enemy);
                }

                if (existing && enemy.hp < token.hp)
                    token.hitAt = Time.unscaledTime;
                token.hp = enemy.hp;
                token.definition = enemy.boss ? "boss" : enemy.archetype == "plated" ? "siege" : enemy.archetype;
                token.target = EnemyPosition(enemy);
                token.image.color = enemy.stunned ? new Color(.7f, .8f, 1) : enemy.slowed ? Color.cyan : Color.white;
                token.text.text = enemy.boss ? "보스 " + Mathf.CeilToInt(enemy.hp) : enemy.stunned ? "정지" : "";
                token.rect.sizeDelta = Vector2.one * EnemySize(enemy);
            }

            RemoveMissing(enemies, ids, true);
            SetVerticesDirty();
        }

        void RemoveMissing(Dictionary<int, Token> items, HashSet<int> ids, bool animate = false)
        {
            foreach (var id in new List<int>(items.Keys))
                if (!ids.Contains(id))
                {
                    if (animate && !Reduced)
                    {
                        var token = items[id];
                        token.hitAt = Time.unscaledTime;
                        token.text.text = "";
                        deaths.Add(token);
                    }
                    else
                        Destroy(items[id].rect.gameObject);
                    items.Remove(id);
                }
        }

        Token Make(bool selectable)
        {
            var rect = MobileUI.Box(transform, selectable ? "Robot" : "Enemy");
            rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(.5f, .5f);
            rect.sizeDelta = Vector2.one * 44;
            var visual = selectable ? MobileUI.Box(rect, "Sprite") : rect;
            if (selectable)
            {
                var hit = rect.gameObject.AddComponent<Image>();
                hit.color = Color.clear;
                hit.raycastTarget = true;
                visual.anchorMin = visual.anchorMax = visual.pivot = new Vector2(.5f, .5f);
            }
            var image = visual.gameObject.AddComponent<Image>();
            image.raycastTarget = false;
            image.preserveAspect = true;
            var text = MobileUI.Label(rect, "", 11, 18);
            text.alignment = TextAnchor.MiddleCenter;
            text.rectTransform.anchorMin = new Vector2(-.5f, 0);
            text.rectTransform.anchorMax = new Vector2(1.5f, 0);
            text.rectTransform.offsetMin = new Vector2(0, -17);
            text.rectTransform.offsetMax = new Vector2(0, 0);
            var token = new Token
            {
                rect = rect,
                image = image,
                text = text
            };
            if (selectable)
            {
                token.button = rect.gameObject.AddComponent<Button>();
                token.button.targetGraphic = image;
            }
            return token;
        }

        void BindSelection(Token token, int id)
        {
            // Each button retains keyboard submission. Pointer selection chooses the
            // nearest actual center, independently of overlapping 44-unit hit boxes.
            var events = token.rect.gameObject.AddComponent<EventTrigger>();
            var pointer = new EventTrigger.Entry { eventID = EventTriggerType.PointerClick };
            pointer.callback.AddListener(data =>
            {
                if (!(data is PointerEventData click) || click.button != PointerEventData.InputButton.Left ||
                    !RectTransformUtility.ScreenPointToLocalPointInRectangle(rectTransform, click.position, click.pressEventCamera, out var point)) return;
                int? nearest = null;
                float distance = float.PositiveInfinity;
                foreach (var unit in Player.units)
                {
                    if (unit.dispatched || !units.TryGetValue(unit.id, out var candidate)) continue;
                    var delta = point - candidate.rect.anchoredPosition;
                    if (Mathf.Abs(delta.x) > candidate.rect.rect.width / 2 || Mathf.Abs(delta.y) > candidate.rect.rect.height / 2) continue;
                    float squared = delta.sqrMagnitude;
                    if (squared < distance || Mathf.Approximately(squared, distance) && (!nearest.HasValue || unit.id < nearest.Value))
                    { nearest = unit.id; distance = squared; }
                }
                if (nearest.HasValue) Select?.Invoke(nearest.Value);
            });
            events.triggers.Add(pointer);
            var submit = new EventTrigger.Entry { eventID = EventTriggerType.Submit };
            submit.callback.AddListener(data => Select?.Invoke(id));
            events.triggers.Add(submit);
        }

        void RefreshGeometry()
        {
            var size = rectTransform.rect.size;
            if (Layout == null || Layout == measuredLayout && size == measuredSize) return;
            measuredLayout = Layout; measuredSize = size;
            slotGap = float.PositiveInfinity;
            for (int i = 0; i < Layout.slots.Length; i++)
                for (int j = i + 1; j < Layout.slots.Length; j++)
                    slotGap = Mathf.Min(slotGap, Vector2.Distance(Local(Layout.slots[i]), Local(Layout.slots[j])));
            if (float.IsInfinity(slotGap)) slotGap = 60;
        }

        float UnitSize(UnitDefinition definition)
        {
            float natural = definition?.rarity == "legend" ? 56 : definition?.rarity == "hero" ? 52 : definition?.rarity == "elite" ? 48 : 44;
            return Mathf.Max(1, Mathf.Min(natural, slotGap * .86f));
        }

        float EnemySize(Enemy enemy) => (enemy.boss ? 56 : enemy.archetype == "plated" ? 36 : 30) * Mathf.Min(1, slotGap / 60);

        Vector2 EnemyPosition(Enemy enemy) => VisualRoutePoint(enemy.progress, enemy.routeIndex, enemy.id);

        Vector2 VisualRoutePoint(float progress, int routeIndex, int id)
        {
            if (Layout.routes.Length == 0) return Vector2.zero;
            var route = Layout.routes[Mathf.Clamp(routeIndex, 0, Layout.routes.Length - 1)];
            var position = Local(MobileModel.RoutePoint(route, progress));
            var before = Local(MobileModel.RoutePoint(route, Mathf.Clamp(progress - .001f, 0, .999f)));
            var after = Local(MobileModel.RoutePoint(route, Mathf.Clamp(progress + .001f, .001f, 1)));
            var direction = (after - before).normalized;
            float size = 30 * Mathf.Min(1, slotGap / 60), lane = (id % 3 - 1) * Mathf.Min(8, size * .42f);
            float queue = !route.closed && progress >= 1 ? id % 9 / 3 * size * .3f : 0;
            return position + new Vector2(-direction.y, direction.x) * lane - direction * queue;
        }

        Sprite Sprite(string path)
        {
            if (!sprites.TryGetValue(path, out var result))
            {
                result = Resources.Load<Sprite>("MobileArt/" + path);
                sprites[path] = result;
            }

            return result;
        }

        void Update()
        {
            for (int i = deaths.Count - 1; i >= 0; i--)
            {
                var token = deaths[i];
                float elapsed = Time.unscaledTime - token.hitAt;
                if (Reduced || elapsed >= .24f)
                {
                    Destroy(token.rect.gameObject);
                    deaths.RemoveAt(i);
                    continue;
                }

                token.image.sprite = Sprite("Enemies/" + token.definition + "/destroy_" + Mathf.Clamp((int)(elapsed / .06f), 0, 3).ToString("00"));
                token.image.color = new Color(1, 1, 1, 1 - elapsed / .24f);
            }

            if (Player == null || Layout == null)
                return;
            RefreshGeometry();
            foreach (var unit in Player.units)
                if (units.TryGetValue(unit.id, out var token))
                {
                    token.target = Local(Slot(unit.slot));
                    token.rect.anchoredPosition = Reduced ? token.target : Vector2.Lerp(token.rect.anchoredPosition, token.target, 1 - Mathf.Exp(-16 * Time.unscaledDeltaTime));
                    float elapsed = Time.unscaledTime - token.attackAt;
                    string pose = elapsed < .12f ? "fire" : elapsed < .3f ? "recover" : "idle";
                    int frame = Reduced ? 0 : pose == "idle" ? (int)(Time.unscaledTime * 7) % 4 : Mathf.Clamp((int)((pose == "fire" ? elapsed : elapsed - .12f) / .04f), 0, 3);
                    token.image.sprite = Sprite("Units/" + unit.definitionId + "/" + pose + "_" + frame.ToString("00"));
                    var definition = Array.Find(Content.units, d => d.id == unit.definitionId);
                    token.image.color = token.image.sprite ? Color.white : ElementColor(definition?.element);
                    float size = UnitSize(definition);
                    token.rect.sizeDelta = Vector2.one * Mathf.Max(44, size);
                    token.image.rectTransform.sizeDelta = Vector2.one * size;
                    token.image.rectTransform.localScale = Vector3.one * (Reduced || elapsed > .18f ? 1 : 1.08f);
                    token.text.text = Focus == unit.id ? definition?.name ?? "로봇" : "";
                    token.text.color = MobileUI.Gold;
                }

            foreach (var enemy in Player.enemies)
                if (enemies.TryGetValue(enemy.id, out var token))
                {
                    token.target = EnemyPosition(enemy);
                    token.rect.anchoredPosition = Reduced ? token.target : Vector2.Lerp(token.rect.anchoredPosition, token.target, 1 - Mathf.Exp(-14 * Time.unscaledDeltaTime));
                    token.rect.sizeDelta = Vector2.one * EnemySize(enemy);
                    bool hit = Time.unscaledTime - token.hitAt < .18f;
                    int frame = Reduced ? 0 : hit ? Mathf.Clamp((int)((Time.unscaledTime - token.hitAt) / .045f), 0, 3) : (int)(Time.unscaledTime * 8) % 4;
                    token.image.sprite = Sprite("Enemies/" + token.definition + "/" + (hit ? "hit" : enemy.stunned ? "stop" : "move") + "_" + frame.ToString("00"));
                    if (!token.image.sprite)
                        token.image.color = new Color(1, .45f, .38f);
                }

            if (Layout.facility != null)
            {
                if (facilityPressure == null)
                {
                    facilityPressure = MobileUI.Label(transform, "", 14, 24);
                    facilityPressure.alignment = TextAnchor.MiddleCenter;
                    facilityPressure.rectTransform.anchorMin = facilityPressure.rectTransform.anchorMax = new Vector2(.5f, .5f);
                    facilityPressure.rectTransform.sizeDelta = new Vector2(150, 24);
                }
                var badge = Local(Layout.facility) + new Vector2(0, -Mathf.Min(23, slotGap * .35f) - 18);
                badge.x = Mathf.Clamp(badge.x, -rectTransform.rect.width / 2 + 75, rectTransform.rect.width / 2 - 75);
                badge.y = Mathf.Clamp(badge.y, -rectTransform.rect.height / 2 + 14, rectTransform.rect.height / 2 - 14);
                facilityPressure.rectTransform.anchoredPosition = badge;
                facilityPressure.text = Player.facilityAttackers > 0 ? "시설 공격 " + Player.facilityAttackers + "기" : "";
            }
            else if (facilityPressure != null) facilityPressure.text = "";
            SetVerticesDirty();
        }

        Point Slot(int slot) => Layout.slots.Length > slot && slot >= 0 ? Layout.slots[slot] : new Point();
        bool HorizontalMining => Layout != null && Layout.rotateInLandscape && rectTransform.rect.width >= rectTransform.rect.height;
        bool Rotate => Layout != null && (Layout.rotateInPortrait && rectTransform.rect.height > rectTransform.rect.width || HorizontalMining);

        float Scale => Mathf.Min((rectTransform.rect.width - 32) / (Rotate ? Layout.height : Layout.width), (rectTransform.rect.height - 32) / (Rotate ? Layout.width : Layout.height));

        Vector2 Local(Point point)
        {
            if (Layout == null)
                return Vector2.zero;
            if (HorizontalMining) return new Vector2(point.y - Layout.height / 2, Layout.width / 2 - point.x) * Scale;
            return Rotate ? new Vector2(Layout.height / 2 - point.y, Layout.width / 2 - point.x) * Scale : new Vector2(point.x - Layout.width / 2, Layout.height / 2 - point.y) * Scale;
        }

        protected override void OnPopulateMesh(VertexHelper mesh)
        {
            mesh.Clear();
            if (Layout == null)
                return;
            foreach (var route in Layout.routes)
            {
                for (int i = 0; i < route.points.Length - 1; i++)
                    Line(mesh, Local(route.points[i]), Local(route.points[i + 1]), 15, new Color(.24f, .3f, .3f));
                if (route.closed)
                    Line(mesh, Local(route.points[route.points.Length - 1]), Local(route.points[0]), 15, new Color(.24f, .3f, .3f));
            }

            foreach (var slot in Layout.slots)
                Ring(mesh, Local(slot), Mathf.Min(17, slotGap * .34f), 1.5f, new Color(.32f, .48f, .47f));
            if (Layout.facility != null)
                Ring(mesh, Local(Layout.facility), Mathf.Min(23, slotGap * .35f), 5, Color.cyan);
            if (Player == null)
                return;
            foreach (var unit in Player.units)
            {
                if (unit.dispatched)
                    continue;
                var at = Local(Slot(unit.slot));
                if (Focus == unit.id)
                {
                    var definition = Array.Find(Content.units, d => d.id == unit.definitionId);
                    float radius = UnitSize(definition) * .52f;
                    Ring(mesh, at, radius + 1, 4, Color.black);
                    Ring(mesh, at, radius, 2, MobileUI.Gold);
                    if (definition != null)
                        Ring(mesh, at, definition.attackRange * Scale, 1, new Color(1, .8f, .3f, .7f));
                }

                if (Array.IndexOf(Consumed, unit.id) >= 0)
                    Ring(mesh, at, Mathf.Min(26, slotGap * .46f), 2, new Color(1, .42f, .35f));
                if (units.TryGetValue(unit.id, out var token) && Time.unscaledTime - token.attackAt < .16f)
                    foreach (var hit in unit.lastAttackHits)
                        if (hit.progress.HasValue && Layout.routes.Length > 0)
                        {
                            var route = Layout.routes[Mathf.Clamp(hit.routeIndex ?? 0, 0, Layout.routes.Length - 1)];
                            int targetId;
                            var target = int.TryParse(Convert.ToString(hit.targetId), out targetId) ?
                                VisualRoutePoint(hit.progress.Value, hit.routeIndex ?? 0, targetId) : Local(MobileModel.RoutePoint(route, hit.progress.Value));
                            Line(mesh, at, target, Reduced ? 1 : 3, MobileUI.Gold);
                        }
            }
        }

        static void Line(VertexHelper mesh, Vector2 a, Vector2 b, float width, Color color)
        {
            var n = (b - a).normalized;
            var normal = new Vector2(-n.y, n.x) * width / 2;
            int start = mesh.currentVertCount;
            mesh.AddVert(a - normal, color, Vector2.zero);
            mesh.AddVert(a + normal, color, Vector2.zero);
            mesh.AddVert(b + normal, color, Vector2.zero);
            mesh.AddVert(b - normal, color, Vector2.zero);
            mesh.AddTriangle(start, start + 1, start + 2);
            mesh.AddTriangle(start, start + 2, start + 3);
        }

        static void Ring(VertexHelper mesh, Vector2 at, float radius, float width, Color color)
        {
            for (int i = 0; i < 48; i++)
            {
                float a = i * Mathf.PI / 24, b = (i + 1) * Mathf.PI / 24;
                Line(mesh, at + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius, at + new Vector2(Mathf.Cos(b), Mathf.Sin(b)) * radius, width, color);
            }
        }

        public static Color ElementColor(string value)
        {
            switch (value)
            {
                case "fire":
                    return new Color(1, .4f, .2f);
                case "water":
                    return new Color(.41f, .69f, 1);
                case "frost":
                    return Color.cyan;
                case "wind":
                    return new Color(.35f, 1, .7f);
                case "electric":
                    return Color.yellow;
                case "laser":
                    return new Color(.8f, .4f, 1);
                default:
                    return Color.white;
            }
        }
    }
}
