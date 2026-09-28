using System;
using System.IO;
using Newtonsoft.Json;
using NUnit.Framework;
using TowerDef;

public class ServerFixturesTests
{
    public class RouteCase { public int routeIndex; public float progress, x, y; }
    public class StateCase { public int battlefieldId; public GameState state; public RouteCase[] points; }
    public class Fixtures { public Content content; public StateCase[] cases; public GameState[] fieldModStates; }

    Fixtures ReadFixtures()
    {
        return JsonConvert.DeserializeObject<Fixtures>(File.ReadAllText(Environment.GetEnvironmentVariable("TOWERDEF_CONTRACT_FIXTURES")));
    }

    [Test]
    public void ActualServerRoutesMatchNativeCoordinatesForAllMapsAndTutorial()
    {
        var fixtures = ReadFixtures();
        Assert.AreEqual(6, fixtures.cases.Length);
        foreach (var item in fixtures.cases)
        {
            var layout = Array.Find(fixtures.content.battlefieldLayouts, field => field.battlefieldId == item.battlefieldId);
            Assert.IsNotNull(layout);
            foreach (var expected in item.points)
            {
                var actual = MobileModel.RoutePoint(layout.routes[expected.routeIndex], expected.progress);
                Assert.AreEqual(expected.x, actual.x, .002f, "route x, map " + item.battlefieldId);
                Assert.AreEqual(expected.y, actual.y, .002f, "route y, map " + item.battlefieldId);
            }
            Assert.AreEqual(layout.slots.Length, item.state.rules.maxUnits);
        }
    }

    [Test]
    public void ServerSnapshotsPreserveNullableFieldsAndActualFirstStageDuration()
    {
        var fixtures = ReadFixtures();
        var tutorial = fixtures.cases[0].state;
        Assert.IsNotNull(tutorial.tutorial);
        Assert.IsNull(tutorial.encounter);
        Assert.IsNull(tutorial.players[0].facilityHp);
        var first = fixtures.cases[1].state;
        Assert.IsNull(first.tutorial);
        Assert.IsNull(first.bossRemainingTicks);
        Assert.IsNotNull(first.encounter.current);
        Assert.AreEqual(fixtures.content.version, first.contentVersion);
        Assert.AreEqual(180, MobileModel.DurationSeconds(first.rules, first.objective));
        var firstDefinition = Array.Find(fixtures.content.battlefields, field => field.id == 1);
        Assert.AreEqual(180, MobileModel.DurationSeconds(firstDefinition.resolvedRules, firstDefinition.objective));
        var mining = fixtures.cases[2].state;
        Assert.AreEqual(3500, mining.players[0].facilityHp);
        Assert.AreEqual(240, MobileModel.DurationSeconds(mining.rules, mining.objective));
        var miningDefinition = Array.Find(fixtures.content.battlefields, field => field.id == 2);
        Assert.AreEqual(240, MobileModel.DurationSeconds(miningDefinition.resolvedRules, miningDefinition.objective));
    }

    [Test]
    public void ActualServerModifierChoicesAndFrozenResultSurviveNativeDeserialization()
    {
        var fixtures = ReadFixtures();
        Assert.AreEqual(3, fixtures.content.fieldMods.Length);
        Assert.IsNull(fixtures.cases[0].state.players[0].fieldMod);
        Assert.AreEqual(400, fixtures.cases[1].state.players[0].fieldMod.nextOfferTick);
        Assert.AreEqual(800, fixtures.cases[2].state.players[0].fieldMod.nextOfferTick);
        Assert.IsNotNull(fixtures.fieldModStates);
        var states = fixtures.fieldModStates;
        var offer = states[0].players[0].fieldMod;
        Assert.AreEqual("survey", offer.offerId);
        Assert.IsTrue(offer.available);
        CollectionAssert.AreEquivalent(new[] { "tracker", "scatter", "opener" }, offer.optionIds);
        var first = states[1].players[0].fieldMod;
        Assert.AreEqual("tracker", first.activeId);
        Assert.IsFalse(first.available);
        Assert.AreEqual(800, first.nextOfferTick);
        var retune = states[2].players[0].fieldMod;
        Assert.AreEqual("retune", retune.offerId);
        Assert.IsTrue(retune.available);
        var result = states[3].players[0].result.fieldMod;
        Assert.AreEqual("opener", result.activeId);
        Assert.IsFalse(result.available);
        Assert.IsNull(result.nextOfferTick);
        Assert.AreEqual(2, result.history.Length);
        Assert.AreEqual(400, result.history[0].tick);
        Assert.AreEqual(800, result.history[1].tick);
        Assert.AreEqual("tracker", result.history[0].modId);
        Assert.AreEqual("opener", result.history[1].modId);
        Assert.AreEqual(3, result.stats.Length);
        Assert.AreEqual(0, result.stats[0].bonusDamage);
    }
}
