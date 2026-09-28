using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace TowerDef
{
    public sealed class NativeBattlefield : MaskableGraphic
    {
        public BattlefieldLayout Layout;
        public Player Player;
        public Content Content;
        public int? Focus;
        public int[] Consumed = Array.Empty<int>();
        public UnitDefinition Result;
        public bool Reduced;
        public Action<int> Select;
        public Action<string> PlaySound;
        readonly Dictionary<int, Token> units = new Dictionary<int, Token>(), enemies = new Dictionary<int, Token>();
        readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();
        readonly List<Token> deaths = new List<Token>();
        string boundPlayer;
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
                    token.button.onClick.AddListener(() => Select?.Invoke(id));
                    token.rect.anchoredPosition = Local(Slot(unit.slot));
                }

                token.definition = unit.definitionId;
                token.target = Local(Slot(unit.slot));
                token.rect.gameObject.SetActive(!unit.dispatched);
                token.button.interactable = !unit.dispatched;
                var definition = Array.Find(content.units, d => d.id == unit.definitionId);
                token.text.text = definition?.name ?? "로봇";
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
                    token.rect.anchoredPosition = Local(EnemyPoint(enemy));
                }

                if (existing && enemy.hp < token.hp)
                    token.hitAt = Time.unscaledTime;
                token.hp = enemy.hp;
                token.definition = enemy.boss ? "boss" : enemy.archetype == "plated" ? "siege" : enemy.archetype;
                token.target = Local(EnemyPoint(enemy));
                token.image.color = enemy.stunned ? new Color(.7f, .8f, 1) : enemy.slowed ? Color.cyan : Color.white;
                token.text.text = enemy.boss ? "보스 " + Mathf.CeilToInt(enemy.hp) : enemy.stunned ? "정지" : Mathf.CeilToInt(enemy.hp).ToString();
                token.rect.sizeDelta = Vector2.one * (enemy.boss ? 56 : 30);
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
            var image = rect.gameObject.AddComponent<Image>();
            image.raycastTarget = selectable;
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
                token.button = rect.gameObject.AddComponent<Button>();
            return token;
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
                    token.rect.localScale = Vector3.one * (Reduced || elapsed > .18f ? 1 : 1.08f);
                    token.text.color = Focus == unit.id ? MobileUI.Gold : Color.white;
                }

            foreach (var enemy in Player.enemies)
                if (enemies.TryGetValue(enemy.id, out var token))
                {
                    token.target = Local(EnemyPoint(enemy));
                    token.rect.anchoredPosition = Reduced ? token.target : Vector2.Lerp(token.rect.anchoredPosition, token.target, 1 - Mathf.Exp(-14 * Time.unscaledDeltaTime));
                    bool hit = Time.unscaledTime - token.hitAt < .18f;
                    int frame = Reduced ? 0 : hit ? Mathf.Clamp((int)((Time.unscaledTime - token.hitAt) / .045f), 0, 3) : (int)(Time.unscaledTime * 8) % 4;
                    token.image.sprite = Sprite("Enemies/" + token.definition + "/" + (hit ? "hit" : enemy.stunned ? "stop" : "move") + "_" + frame.ToString("00"));
                    if (!token.image.sprite)
                        token.image.color = new Color(1, .45f, .38f);
                }

            SetVerticesDirty();
        }

        Point Slot(int slot) => Layout.slots.Length > slot && slot >= 0 ? Layout.slots[slot] : new Point();
        Point EnemyPoint(Enemy enemy) => Layout.routes.Length == 0 ? new Point() : MobileModel.RoutePoint(Layout.routes[Mathf.Clamp(enemy.routeIndex, 0, Layout.routes.Length - 1)], enemy.progress);
        bool HorizontalMining => Layout != null && Layout.rotateInLandscape && rectTransform.rect.width >= rectTransform.rect.height;
        bool Rotate => Layout != null && (Layout.rotateInPortrait && rectTransform.rect.height > rectTransform.rect.width || HorizontalMining);

        float Scale => Mathf.Min((rectTransform.rect.width - 32) / (Rotate ? Layout.height : Layout.width), (rectTransform.rect.height - 32) / (Rotate ? Layout.width : Layout.height));

        Vector2 Local(Point point)
        {
            if (Layout == null)
                return Vector2.zero;
            if (HorizontalMining) return new Vector2(point.y - Layout.height / 2, Layout.width / 2 - point.x) * Scale;
            return Rotate ? new Vector2(point.y - Layout.height / 2, point.x - Layout.width / 2) * Scale : new Vector2(point.x - Layout.width / 2, Layout.height / 2 - point.y) * Scale;
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
                Ring(mesh, Local(slot), 17, 1.5f, new Color(.32f, .48f, .47f));
            if (Layout.facility != null)
                Ring(mesh, Local(Layout.facility), 23, 5, Color.cyan);
            if (Player == null)
                return;
            foreach (var unit in Player.units)
            {
                if (unit.dispatched)
                    continue;
                var at = Local(Slot(unit.slot));
                if (Focus == unit.id)
                {
                    Ring(mesh, at, 24, 4, Color.black);
                    Ring(mesh, at, 23, 2, MobileUI.Gold);
                    var definition = Result ?? Array.Find(Content.units, d => d.id == unit.definitionId);
                    if (definition != null)
                        Ring(mesh, at, definition.attackRange * Scale, 1, new Color(1, .8f, .3f, .7f));
                }

                if (Array.IndexOf(Consumed, unit.id) >= 0)
                    Ring(mesh, at, 26, 2, new Color(1, .42f, .35f));
                if (units.TryGetValue(unit.id, out var token) && Time.unscaledTime - token.attackAt < .16f)
                    foreach (var hit in unit.lastAttackHits)
                        if (hit.progress.HasValue && Layout.routes.Length > 0)
                        {
                            var route = Layout.routes[Mathf.Clamp(hit.routeIndex ?? 0, 0, Layout.routes.Length - 1)];
                            Line(mesh, at, Local(MobileModel.RoutePoint(route, hit.progress.Value)), Reduced ? 1 : 3, MobileUI.Gold);
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
