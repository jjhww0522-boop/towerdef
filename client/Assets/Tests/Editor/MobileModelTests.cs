using NUnit.Framework;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TowerDef;

public class MobileModelTests
{
    [Test]
    public void ExplicitModeSurvivesSerializationAndLegacySnapshotsRemainCoop()
    {
        var solo = JsonConvert.DeserializeObject<GameState>("{\"mode\":\"solo\"}");
        var coop = JsonConvert.DeserializeObject<GameState>("{\"mode\":\"coop\",\"players\":[]}");
        Assert.IsFalse(MobileModel.IsCoop(solo));
        Assert.IsTrue(MobileModel.IsCoop(coop));
        Assert.IsTrue(MobileModel.IsCoop(JsonConvert.DeserializeObject<GameState>("{}")));
        coop.tutorial = new Tutorial();
        Assert.IsFalse(MobileModel.IsCoop(coop));
        var request = new SessionRequest { mode = "solo", roomId = "saved-room" };
        Assert.AreEqual("solo", JsonConvert.DeserializeObject<SessionRequest>(JsonConvert.SerializeObject(request)).mode);
        Assert.AreEqual("coop", JsonConvert.DeserializeObject<SessionRequest>("{}").mode);
    }

    [Test]
    public void UpgradeSnapshotReadsOnlyTheSixElementLevels()
    {
        var levels = JsonConvert.DeserializeObject<UpgradeLevels>("{\"fire\":3,\"water\":2,\"frost\":1,\"wind\":4,\"electric\":5,\"laser\":2,\"shu\":5}");
        Assert.AreEqual(3, levels.Get("fire"));
        Assert.AreEqual(2, levels.Get("water"));
        Assert.AreEqual(1, levels.Get("frost"));
        Assert.AreEqual(4, levels.Get("wind"));
        Assert.AreEqual(5, levels.Get("electric"));
        Assert.AreEqual(2, levels.Get("laser"));
        Assert.AreEqual(0, levels.Get("shu"));
    }

    [Test]
    public void ElementUpgradeChangesOnlyItsFamilyAndTheHighestLevelForCommonS()
    {
        var levels = new UpgradeLevels { fire = 3, water = 2, laser = 1 };
        var fire = new UnitDefinition { element = "fire", attack = 10, attackIntervalTicks = 10 };
        var water = new UnitDefinition { element = "water", attack = 10, attackIntervalTicks = 10 };
        var guardian = new UnitDefinition { element = "laser", tier = "ultimate", attack = 10, attackIntervalTicks = 10 };
        var rules = new Rules { ticksPerSecond = 10, upgradeBonus = .1f };
        Assert.AreEqual(13, MobileModel.PrimaryDps(fire, levels, rules), .001);
        Assert.AreEqual(12, MobileModel.PrimaryDps(water, levels, rules), .001);
        Assert.AreEqual(13, MobileModel.PrimaryDps(guardian, levels, rules), .001);
        levels.fire = 4;
        Assert.AreEqual(14, MobileModel.PrimaryDps(fire, levels, rules), .001);
        Assert.AreEqual(12, MobileModel.PrimaryDps(water, levels, rules), .001);
        Assert.AreEqual(14, MobileModel.PrimaryDps(guardian, levels, rules), .001);
        Assert.AreEqual("화염 강화 적용", MobileModel.UpgradeDescription(fire));
        Assert.That(MobileModel.UpgradeDescription(guardian), Does.Contain("합산 안 함"));
    }

    [Test]
    public void FutureRecipesRemainLockedAndPreserveTheirUpdateLabel()
    {
        var recipe = JsonConvert.DeserializeObject<Recipe>("{\"id\":\"make_fire_4\",\"unlockType\":\"future\",\"unlockBattlefield\":6,\"unlockLabel\":\"챕터 2 업데이트에서 개방\"}");
        var player = new Player { unlockedRecipes = new[] { "make_fire_4" } };
        Assert.IsFalse(MobileModel.Unlocked(recipe, player));
        Assert.AreEqual("챕터 2 업데이트에서 개방", recipe.unlockLabel);
        Assert.AreEqual("물 · 연속 분사", MobileModel.Element("water"));
    }

    [Test]
    public void PersistedModifierRetryKeepsOriginalOpportunityAndChoice()
    {
        var original = JsonConvert.DeserializeObject<ActionRequest>("{\"seq\":7,\"type\":\"choose_mod\",\"offerId\":\"survey\",\"modId\":\"tracker\"}");
        var ledger = new ActionLedger();
        ledger.Restore(JsonConvert.DeserializeObject<ActionRequest>(JsonConvert.SerializeObject(original)));
        Assert.IsFalse(ledger.Acknowledge(6));
        var payload = JObject.FromObject(ledger.Pending);
        Assert.AreEqual("survey", (string)payload["offerId"]);
        Assert.AreEqual("tracker", (string)payload["modId"]);
        Assert.IsTrue(ledger.Acknowledge(7));
    }

    [Test]
    public void PersonalResultPreservesRecordedModifierInsteadOfLiveChoice()
    {
        var player = JsonConvert.DeserializeObject<Player>("{\"fieldMod\":{\"activeId\":\"scatter\"},\"result\":{\"fieldMod\":{\"activeId\":\"tracker\",\"nextOfferTick\":null,\"stats\":[{\"modId\":\"tracker\",\"hits\":2,\"bonusDamage\":1.5}]}}}");
        var result = JObject.FromObject(player.result);
        Assert.AreEqual("tracker", (string)result["fieldMod"]?["activeId"]);
        Assert.AreEqual(1.5, (double? )result["fieldMod"]?["stats"]?[0]?["bonusDamage"]);
        Assert.IsNotNull(JsonConvert.DeserializeObject<ExpeditionResult>("{\"status\":\"cleared\"}"));
    }

    [Test]
    public void SameTickStaleAcknowledgmentCannotReplaceNewerAction()
    {
        Assert.IsFalse(MobileModel.IsMonotonic(40, 2, 40, 1));
    }

    [Test]
    public void IdenticalTickAndAcknowledgmentRemainAcceptable()
    {
        Assert.IsTrue(MobileModel.IsMonotonic(40, 2, 40, 2));
    }

    [Test]
    public void NullAttackAndTickZeroRemainDistinct()
    {
        var state = JsonConvert.DeserializeObject<GameState>("{\"bossRemainingTicks\":null,\"players\":[{\"units\":[{\"lastAttackTick\":null},{\"lastAttackTick\":0}]}]}");
        Assert.IsNull(state.bossRemainingTicks);
        Assert.IsNull(state.players[0].units[0].lastAttackTick);
        Assert.AreEqual(0, state.players[0].units[1].lastAttackTick);
    }

    [Test]
    public void RouteUsesSegmentLengthsNotVertexCount()
    {
        var route = new Route
        {
            points = new[]
            {
                new Point(0, 0),
                new Point(30, 0),
                new Point(30, 70)
            },
            closed = false
        };
        var point = MobileModel.RoutePoint(route, .5f);
        Assert.AreEqual(30, point.x, .001f);
        Assert.AreEqual(20, point.y, .001f);
        Assert.AreEqual(70, MobileModel.RoutePoint(route, 1).y, .001f);
    }

    [Test]
    public void ClosedRouteWrapsAtOne()
    {
        var route = new Route
        {
            points = new[]
            {
                new Point(0, 0),
                new Point(10, 0),
                new Point(10, 10)
            },
            closed = true
        };
        var point = MobileModel.RoutePoint(route, 1);
        Assert.AreEqual(0, point.x, .001f);
        Assert.AreEqual(0, point.y, .001f);
    }

    [Test]
    public void MaterialSelectionKeepsExactAnchorFirstAndExcludesDispatch()
    {
        var recipe = new Recipe
        {
            ingredients = new[]
            {
                "a",
                "a",
                "b"
            }
        };
        var player = new Player
        {
            units = new[]
            {
                new Unit
                {
                    id = 1,
                    definitionId = "a",
                    dispatched = true
                },
                new Unit
                {
                    id = 2,
                    definitionId = "a"
                },
                new Unit
                {
                    id = 3,
                    definitionId = "b"
                },
                new Unit
                {
                    id = 4,
                    definitionId = "a"
                }
            }
        };
        CollectionAssert.AreEqual(new[] { 4, 2, 3 }, MobileModel.Materials(recipe, player, 4));
        Assert.IsNull(MobileModel.Materials(recipe, player, 1));
    }

    [Test]
    public void InsufficientCopiesCannotReuseOneUnit()
    {
        Assert.IsNull(MobileModel.Materials(new Recipe { ingredients = new[] { "a", "a" } }, new Player { units = new[] { new Unit { id = 1, definitionId = "a" } } }, 1));
    }

    [Test]
    public void AttackTargetMayBeStoryOrEnemy()
    {
        var unit = JsonConvert.DeserializeObject<Unit>("{\"lastTargetId\":\"story\",\"lastAttackHits\":[{\"targetId\":42,\"damage\":2}]} ");
        Assert.AreEqual("story", unit.lastTargetId.ToString());
        Assert.AreEqual("42", unit.lastAttackHits[0].targetId.ToString());
    }

    [Test]
    public void PendingActionKeepsPayloadUntilAuthoritativeAck()
    {
        var ledger = new ActionLedger();
        var action = new ActionRequest
        {
            seq = 4,
            type = "combine",
            unitIds = new[]
            {
                7,
                9
            }
        };
        ledger.Begin(action);
        Assert.IsFalse(ledger.Acknowledge(3));
        Assert.AreSame(action, ledger.Pending);
        Assert.IsTrue(ledger.Acknowledge(4));
        Assert.IsNull(ledger.Pending);
    }

    [Test]
    public void OpenLayoutPortraitFitPreservesWorldDistance()
    {
        var layout = new BattlefieldLayout
        {
            width = 720,
            height = 720
        };
        var size = MobileModel.Fit(layout, 360, 600);
        Assert.AreEqual(360, size.x);
        Assert.AreEqual(360, size.y);
    }

    [Test]
    public void CurrentFirstStageAndMiningDurationDifferByBoss()
    {
        var rules = new Rules
        {
            ticksPerSecond = 10,
            waveTicks = 100,
            totalWaves = 12,
            bossTicks = 600
        };
        Assert.AreEqual(180, MobileModel.DurationSeconds(rules, new Objective { kind = "overcrowd" }));
        rules.waveTicks = 160;
        rules.totalWaves = 15;
        Assert.AreEqual(240, MobileModel.DurationSeconds(rules, new Objective { kind = "mining" }));
    }
}
