import { GameState, expeditionProgress } from './core';

// Keep future random results and replay bookkeeping on the authoritative server.
export function publicState(game: GameState): object {
  return {
    protocolVersion: game.protocolVersion,
    contentVersion: game.contentVersion,
    tick: game.tick,
    wave: game.wave,
    status: game.status,
    practice: game.practice,
    battlefieldId: game.battlefieldId,
    rules: game.rules,
    stories: game.stories,
    expedition: expeditionProgress(game),
    story: game.story,
    bossRemainingTicks: game.tick >= game.rules.waveTicks * game.rules.totalWaves ? Math.max(0, game.rules.waveTicks * game.rules.totalWaves + game.rules.bossTicks - game.tick) : null,
    players: game.players.map(function (player) {
      return {
        id: player.id, gold: player.gold, status: player.status,
        connected: player.connected, lastSeq: player.lastSeq,
        overcrowdedTicks: player.overcrowdedTicks, defeatReason: player.defeatReason,
        upgrades: player.upgrades,
        unlockedRecipes: player.unlockedRecipes,
        result: player.result,
        units: player.units.map(function (unit) {
          return {
            id: unit.id, definitionId: unit.definitionId, slot: unit.slot, dispatched: unit.dispatched,
            attackCooldownTicks: unit.attackCooldownTicks, lastAttackTick: unit.lastAttackTick, lastTargetId: unit.lastTargetId,
            lastAttackHits: unit.lastAttackHits || [],
            salvageGold: Math.floor((unit.investedGold || game.rules.summonCost) * game.rules.salvageRefundRatio)
          };
        }),
        enemies: player.enemies.map(function (enemy) {
          return { id: enemy.id, hp: enemy.hp, maxHp: enemy.maxHp, progress: enemy.progress, boss: enemy.boss,
            slowed: (enemy.slowUntilTick || 0) > game.tick };
        })
      };
    })
  };
}
