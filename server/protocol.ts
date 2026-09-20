import { GameState, content } from './core';

// Keep future random results and replay bookkeeping on the authoritative server.
export function publicState(game: GameState): object {
  return {
    protocolVersion: game.protocolVersion,
    contentVersion: game.contentVersion,
    tick: game.tick,
    wave: game.wave,
    status: game.status,
    practice: game.practice,
    story: game.story,
    bossRemainingTicks: game.tick >= content.rules.waveTicks * content.rules.totalWaves ? Math.max(0, content.rules.waveTicks * content.rules.totalWaves + content.rules.bossTicks - game.tick) : null,
    players: game.players.map(function (player) {
      return {
        id: player.id, gold: player.gold, status: player.status,
        connected: player.connected, lastSeq: player.lastSeq,
        overcrowdedTicks: player.overcrowdedTicks, defeatReason: player.defeatReason,
        upgrades: player.upgrades,
        units: player.units.map(function (unit) {
          return {
            id: unit.id, definitionId: unit.definitionId, slot: unit.slot, dispatched: unit.dispatched,
            attackCooldownTicks: unit.attackCooldownTicks, lastAttackTick: unit.lastAttackTick, lastTargetId: unit.lastTargetId
          };
        }),
        enemies: player.enemies.map(function (enemy) {
          return { id: enemy.id, hp: enemy.hp, maxHp: enemy.maxHp, progress: enemy.progress, boss: enemy.boss };
        })
      };
    })
  };
}
