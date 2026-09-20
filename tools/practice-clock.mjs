import core from '../dist/server/core/index.js';
const { tick, setConnection, content } = core;

// Validate elapsed wall time before refreshing activity, including requests between timer ticks.
export function resumePractice(room, session, now) {
  const player = room.game.players.find(item => item.id === session.playerId);
  if (player?.status === 'active' && now - session.lastSeen > 123000) {
    setConnection(room.game, session.playerId, false);
    player.disconnectedAtTick = room.game.tick - content.rules.disconnectGraceTicks - 1;
  }
  setConnection(room.game, session.playerId, true);
  session.lastSeen = now;
}

// Fast practice accelerates combat only; connection grace remains 120 wall-clock seconds.
export function advancePractice(room, sessions, now) {
  for (let step = 0; step < room.speed; step++) {
    for (const session of sessions) {
      if (now - session.lastSeen <= 3000) continue;
      setConnection(room.game, session.playerId, false);
      const player = room.game.players.find(item => item.id === session.playerId);
      if (player?.status === 'active') {
        const expired = now - session.lastSeen > 123000;
        player.disconnectedAtTick = room.game.tick - (expired ? content.rules.disconnectGraceTicks + 1 : 0);
      }
    }
    tick(room.game);
  }
}
