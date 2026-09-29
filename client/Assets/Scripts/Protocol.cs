using System;

namespace TowerDef
{
    [Serializable]
    public sealed class Content
    {
        public string version, serverInstanceId;
        public UnitDefinition[] units = Array.Empty<UnitDefinition>();
        public Recipe[] recipes = Array.Empty<Recipe>();
        public FieldModDefinition[] fieldMods = Array.Empty<FieldModDefinition>();
        public Rules rules;
        public BattlefieldDefinition[] battlefields = Array.Empty<BattlefieldDefinition>();
        public BattlefieldLayout[] battlefieldLayouts = Array.Empty<BattlefieldLayout>();
    }

    [Serializable]
    public sealed class Rules
    {
        public int summonCost, maxUnits, maxUpgradeLevel, ticksPerSecond, waveTicks, totalWaves, bossTicks, maxDispatch, summonCooldownTicks, overcrowdCount, overcrowdTicks, tacticCooldownTicks, overdriveTicks, empTicks, empBossTicks;
        public int[] upgradeCosts = Array.Empty<int>();
        public float upgradeBonus, overdriveMultiplier;
    }

    [Serializable]
    public sealed class UnitDefinition
    {
        public string id, name, rarity, tier, faction, troop, trait, element, attackPattern;
        public float attack, attackRange;
        public int attackIntervalTicks;
    }

    [Serializable]
    public sealed class Recipe
    {
        public string id, result, unlockType, unlockLabel;
        public string[] ingredients = Array.Empty<string>();
        public int unlockBattlefield, researchCost;
    }

    [Serializable]
    public sealed class FieldModDefinition
    {
        public string id, name, description, condition;
        public float bonus;
    }

    [Serializable]
    public sealed class FieldModChoice
    {
        public string offerId, modId;
        public int tick;
    }

    [Serializable]
    public sealed class FieldModStats
    {
        public string modId;
        public int hits;
        public float bonusDamage;
    }

    [Serializable]
    public sealed class FieldModState
    {
        public string activeId, offerId;
        public bool available;
        public int? nextOfferTick;
        public string[] optionIds = Array.Empty<string>();
        public FieldModChoice[] history = Array.Empty<FieldModChoice>();
        public FieldModStats[] stats = Array.Empty<FieldModStats>();
    }

    [Serializable]
    public sealed class BattlefieldDefinition
    {
        public int id;
        public string name, description;
        public float? difficulty;
        public Objective objective;
        public Rules resolvedRules;
    }

    [Serializable]
    public sealed class Point
    {
        public float x, y;
        public Point()
        {
        }

        public Point(float x, float y)
        {
            this.x = x;
            this.y = y;
        }
    }

    [Serializable]
    public sealed class Route
    {
        public Point[] points = Array.Empty<Point>();
        public bool closed;
        public float length;
    }

    [Serializable]
    public sealed class BattlefieldLayout
    {
        public int battlefieldId;
        public float width, height;
        public bool rotateInPortrait, rotateInLandscape;
        public Route[] routes = Array.Empty<Route>();
        public Point[] slots = Array.Empty<Point>();
        public Point facility;
    }

    [Serializable]
    public sealed class Objective
    {
        public string kind, label;
        public float facilityHp, arrivalProgress, damage;
        public int attackIntervalTicks;
    }

    [Serializable]
    public sealed class GameState
    {
        public string protocolVersion, contentVersion, status, expeditionId;
        public string mode = "coop";
        public int tick, wave, battlefieldId;
        public int? bossRemainingTicks;
        public bool practice, combatPaused;
        public Player[] players = Array.Empty<Player>();
        public Story story;
        public StoryDefinition[] stories;
        public Rules rules;
        public Objective objective;
        public Tutorial tutorial;
        public Expedition expedition;
        public EncounterPreview encounter;
        public Profile profile;
    }

    [Serializable]
    public sealed class Player
    {
        public string id, status, defeatReason;
        public int gold, lastSeq, summonCooldownRemainingTicks, overcrowdedTicks, facilityAttackers;
        public bool connected;
        public float? facilityHp;
        public int? lastFacilityHitTick;
        public Unit[] units = Array.Empty<Unit>();
        public Enemy[] enemies = Array.Empty<Enemy>();
        public UpgradeLevels upgrades = new UpgradeLevels();
        public string[] unlockedRecipes = Array.Empty<string>();
        public ExpeditionResult result;
        public BattleStats battleStats;
        public Tactical tactical;
        public FieldModState fieldMod;
    }

    [Serializable]
    public sealed class Unit
    {
        public int id, slot, attackCooldownTicks, salvageGold;
        public string definitionId;
        public bool dispatched;
        public int? lastAttackTick;
        public object lastTargetId;
        public AttackHit[] lastAttackHits = Array.Empty<AttackHit>();
    }

    [Serializable]
    public sealed class AttackHit
    {
        public object targetId;
        public float? progress;
        public int? routeIndex;
        public float damage;
        public bool boss;
    }

    [Serializable]
    public sealed class Enemy
    {
        public int id, routeIndex;
        public float hp, maxHp, progress;
        public bool boss, stunned, slowed, attackingFacility;
        public string archetype;
    }

    [Serializable]
    public sealed class Story
    {
        public int wave, remainingTicks;
        public float hp, maxHp;
        public string status;
    }

    [Serializable]
    public sealed class StoryDefinition
    {
        public int wave, durationTicks, rewardGold;
        public float hp;
        public string name;
    }

    [Serializable]
    public sealed class Tutorial
    {
        public string step;
        public int drawCount;
        public int? anchorUnitId, saleUnitId, skirmishAtTick, bossAtTick;
    }

    [Serializable]
    public sealed class Expedition
    {
        public string phase;
        public float miningProgress;
        public int remainingTicks;
    }

    [Serializable]
    public sealed class Encounter
    {
        public int wave, count, startTick, spawnIntervalTicks, routeCount;
        public string label, description, archetype;
    }

    [Serializable]
    public sealed class EncounterPreview
    {
        public Encounter current, next;
        public int remainingTicks;
    }

    [Serializable]
    public sealed class Tactical
    {
        public int cooldownRemainingTicks, overdriveRemainingTicks;
        public int? lastUseTick;
        public string lastKind;
    }

    [Serializable]
    public sealed class TacticsUsed
    {
        public int overdrive, emp;
    }

    [Serializable]
    public sealed class BattleStats
    {
        public int kills, peakEnemies;
        public float damageDealt, facilityDamageTaken, biggestHit;
        public TacticsUsed tacticsUsed;
    }

    [Serializable]
    public sealed class ExpeditionResult
    {
        public int battlefieldId, researchCredits, wave, kills, elapsedTicks;
        public string status, reason, expeditionId;
        public bool cleared;
        public float miningProgress;
        public BattleStats battleStats;
        public FieldModState fieldMod;
    }

    [Serializable]
    public sealed class Engines
    {
        public int count, max;
        public long? nextRecoveryAt;
        public long serverTime, recoveryIntervalMs;
    }

    [Serializable]
    public sealed class Interruption
    {
        public string expeditionId, reason;
        public long at;
        public int enginesRefunded;
    }

    [Serializable]
    public sealed class Profile
    {
        public string id;
        public bool tutorialCompleted;
        public int researchCredits;
        public Engines engines;
        public string[] unlockedRecipes = Array.Empty<string>();
        public int[] clearedBattlefields = Array.Empty<int>(), unlockedBattlefields = Array.Empty<int>();
        public ExpeditionResult lastResult;
        public Interruption lastInterruption;
        public RosterMigration rosterMigration;
    }

    [Serializable]
    public sealed class RosterMigration
    {
        public string version;
        public int refundedCredits;
    }

    [Serializable]
    public sealed class ProfileResponse
    {
        public string profileToken, error;
        public Profile profile;
    }

    [Serializable]
    public sealed class UpgradeLevels
    {
        public int fire, water, frost, wind, electric, laser;
        public int Get(string tag)
        {
            switch (tag)
            {
                case "fire":
                    return fire;
                case "water":
                    return water;
                case "frost":
                    return frost;
                case "wind":
                    return wind;
                case "electric":
                    return electric;
                case "laser":
                    return laser;
                default:
                    return 0;
            }
        }

        public int Highest => Math.Max(Math.Max(fire, water), Math.Max(Math.Max(frost, wind), Math.Max(electric, laser)));
    }

    [Serializable]
    public sealed class SessionRequest
    {
        public string roomId, playerId, profileToken, protocolVersion = "1", contentVersion, expectedServerInstanceId;
        public string mode = "coop";
        public int battlefieldId = 1, speed = 1;
        public bool practice, tutorial;
    }

    [Serializable]
    public sealed class SessionResponse
    {
        public string token, playerId, error, profileToken;
        public GameState state;
        public Profile profile;
    }

    [Serializable]
    public sealed class ActionRequest
    {
        public int seq;
        public string type, recipeId, tag, tactic, offerId, modId;
        public int[] unitIds;
    }

    [Serializable]
    public sealed class ActionResponse
    {
        public bool ok;
        public string error;
        public GameState state;
        public Profile profile;
    }
}
