using System;

namespace TowerDef
{
    [Serializable] public sealed class Content
    {
        public string version;
        public UnitDefinition[] units;
        public Recipe[] recipes;
        public Rules rules;
    }
    [Serializable] public sealed class Rules
    {
        public int summonCost;
        public int maxUnits;
        public int[] upgradeCosts;
        public int maxUpgradeLevel;
    }
    [Serializable] public sealed class UnitDefinition
    {
        public string id, name, rarity, faction, troop, trait;
        public float attack;
        public int attackIntervalTicks;
    }
    [Serializable] public sealed class Recipe
    {
        public string id, result;
        public string[] ingredients;
        public int unlockBattlefield;
    }
    [Serializable] public sealed class GameState
    {
        public string protocolVersion, contentVersion, status;
        public int tick, wave;
        public bool practice;
        public Player[] players;
        public Story story;
    }
    [Serializable] public sealed class Player
    {
        public string id, status;
        public int gold, lastSeq;
        public bool connected;
        public Unit[] units;
        public Enemy[] enemies;
        public UpgradeLevels upgrades;
    }
    [Serializable] public sealed class Unit
    {
        public int id, slot;
        public string definitionId;
        public bool dispatched;
    }
    [Serializable] public sealed class Enemy
    {
        public int id;
        public float hp, maxHp, progress;
        public bool boss;
    }
    [Serializable] public sealed class Story
    {
        public int wave, remainingTicks;
        public float hp, maxHp;
        public string status;
    }
    // Explicit known fields let JsonUtility read the server's JSON object directly.
    [Serializable] public sealed class UpgradeLevels
    {
        public int shu, wei, wu, infantry, archer, cavalry, might, strategy, command;
        public int Get(string tag)
        {
            switch (tag)
            {
                case "shu": return shu; case "wei": return wei; case "wu": return wu;
                case "infantry": return infantry; case "archer": return archer; case "cavalry": return cavalry;
                case "might": return might; case "strategy": return strategy; case "command": return command;
                default: return 0;
            }
        }
    }
    [Serializable] public sealed class SessionRequest
    {
        public string roomId, playerId, protocolVersion = "1", contentVersion;
    }
    [Serializable] public sealed class SessionResponse
    {
        public string token, playerId, error;
        public GameState state;
    }
    [Serializable] public sealed class ActionRequest
    {
        public int seq;
        public string type, recipeId, tag;
        public int[] unitIds;
    }
    [Serializable] public sealed class ActionResponse
    {
        public bool ok;
        public string error;
        public GameState state;
    }
}
