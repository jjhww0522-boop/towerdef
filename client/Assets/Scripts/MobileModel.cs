using System;
using System.Collections.Generic;

namespace TowerDef
{
    // Pure presentation helpers: no economy, movement, damage or reward authority.
    public static class MobileModel
    {
        public static bool IsCoop(GameState state) => state != null && state.tutorial == null && state.mode != "solo";
        public static int UpgradeLevel(UnitDefinition definition, UpgradeLevels levels) => definition.tier == "ultimate" ? levels.Highest : levels.Get(definition.element);
        public static float PrimaryDps(UnitDefinition definition, UpgradeLevels levels, Rules rules) => definition.attack * (definition.attackPattern == "blast" ? .8f : 1) * (1 + UpgradeLevel(definition, levels) * rules.upgradeBonus) * rules.ticksPerSecond / definition.attackIntervalTicks;
        public static string UpgradeDescription(UnitDefinition definition) => definition.tier == "ultimate" ? "공통 S · 가장 높은 속성 강화 1개만 적용 (합산 안 함)" : ElementName(definition.element) + " 강화 적용";
        public static string ElementName(string element)
        {
            switch (element)
            {
                case "fire": return "화염";
                case "water": return "물";
                case "frost": return "냉기";
                case "wind": return "바람";
                case "electric": return "전기";
                case "laser": return "레이저";
                default: return "로봇";
            }
        }

        public static bool IsMonotonic(int currentTick, int currentSequence, int nextTick, int nextSequence)
        {
            return nextTick >= currentTick && nextSequence >= currentSequence;
        }

        public static Point RoutePoint(Route route, float progress)
        {
            var points = route.points;
            if (points.Length == 0)
                return new Point();
            if (points.Length == 1)
                return points[0];
            int count = route.closed ? points.Length : points.Length - 1;
            float total = 0;
            for (int i = 0; i < count; i++)
                total += Distance(points[i], points[(i + 1) % points.Length]);
            float p = route.closed ? progress - (float)Math.Floor(progress) : Math.Max(0, Math.Min(1, progress));
            float remaining = p * total;
            for (int i = 0; i < count; i++)
            {
                var a = points[i];
                var b = points[(i + 1) % points.Length];
                float length = Distance(a, b);
                if (remaining <= length || i == count - 1)
                {
                    float t = length > 0 ? remaining / length : 0;
                    return new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                }

                remaining -= length;
            }

            return points[0];
        }

        public static float Distance(Point a, Point b) => (float)Math.Sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        public static Point Fit(BattlefieldLayout layout, float width, float height)
        {
            float scale = Math.Min(width / layout.width, height / layout.height);
            return new Point(layout.width * scale, layout.height * scale);
        }

        public static int DurationSeconds(Rules rules, Objective objective) => (rules.waveTicks * rules.totalWaves + (objective.kind == "mining" ? 0 : rules.bossTicks)) / Math.Max(1, rules.ticksPerSecond);
        public static int[] Materials(Recipe recipe, Player player, int anchor)
        {
            var ids = new List<int>();
            var need = new List<string>(recipe.ingredients);
            var first = Array.Find(player.units, u => u.id == anchor && !u.dispatched);
            if (first == null || !need.Remove(first.definitionId))
                return null;
            ids.Add(first.id);
            foreach (var definition in need)
            {
                var unit = Array.Find(player.units, u => !u.dispatched && u.definitionId == definition && !ids.Contains(u.id));
                if (unit == null)
                    return null;
                ids.Add(unit.id);
            }

            return ids.ToArray();
        }

        public static bool Unlocked(Recipe recipe, Player player) => recipe.unlockType != "future" && (recipe.unlockBattlefield == 0 || Array.IndexOf(player.unlockedRecipes, recipe.id) >= 0);
        public static string Element(string value)
        {
            switch (value)
            {
                case "fire":
                    return "화염 · 근거리";
                case "water":
                    return "물 · 연속 분사";
                case "frost":
                    return "냉기 · 감속";
                case "wind":
                    return "바람 · 범위";
                case "electric":
                    return "전기";
                case "laser":
                    return "레이저 · 원거리";
                default:
                    return "로봇";
            }
        }

        public static string Failure(string value)
        {
            switch (value)
            {
                case "boss_timeout":
                    return "보스 제한 시간 초과";
                case "overcrowded":
                    return "적 과밀 지속";
                case "facility_destroyed":
                    return "시설 파괴";
                default:
                    return "원정 종료";
            }
        }
    }

    public sealed class ActionLedger
    {
        public ActionRequest Pending { get; private set; }

        public void Begin(ActionRequest action)
        {
            if (Pending != null)
                throw new InvalidOperationException("An action is awaiting acknowledgment.");
            Pending = action;
        }

        public void Restore(ActionRequest action)
        {
            Pending = action;
        }

        public bool Acknowledge(int seq)
        {
            if (Pending == null || seq < Pending.seq)
                return false;
            Pending = null;
            return true;
        }

        public void Clear()
        {
            Pending = null;
        }
    }
}
