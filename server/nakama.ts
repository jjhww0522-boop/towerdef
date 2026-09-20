import { createGame, applyAction, tick as advance, setConnection, content, GameState } from './core';
import { publicState } from './protocol';

interface RoomState {
  [key: string]: any;
  game: GameState | null;
  presences: { [userId: string]: nkruntime.Presence };
  contentVersion: string;
  pending: { [userId: string]: { sessionId: string; expiresAt: number } };
  emptyTicks: number;
  seed: number;
}

function broadcast(state: RoomState, dispatcher: nkruntime.MatchDispatcher): void {
  if (state.game) dispatcher.broadcastMessage(2, JSON.stringify(publicState(state.game)));
  else dispatcher.broadcastMessage(4, JSON.stringify({ status: 'waiting', players: Object.keys(state.presences), requiredPlayers: 4 }));
}

const handler: nkruntime.MatchHandler<RoomState> = {
  matchInit: function () {
    return { state: { game: null, presences: {}, pending: {}, contentVersion: content.version, emptyTicks: 0, seed: Math.floor(Math.random() * 2147483646) + 1 }, tickRate: 10, label: JSON.stringify({ mode: 'practice', players: 0 }) };
  },
  matchJoinAttempt: function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    if (!metadata || metadata.protocolVersion !== '1' || metadata.contentVersion !== content.version) return { state: state, accept: false, rejectMessage: 'version_mismatch' };
    const connected = state.presences[presence.userId];
    const pending = state.pending[presence.userId];
    if (pending && pending.sessionId !== presence.sessionId) return { state: state, accept: false, rejectMessage: 'already_joining' };
    if (connected && connected.sessionId !== presence.sessionId) return { state: state, accept: false, rejectMessage: 'already_connected' };
    if (state.game) {
      const player = state.game.players.filter(function (item) { return item.id === presence.userId; })[0];
      if (!player || player.status === 'left') return { state: state, accept: false, rejectMessage: 'match_started_or_left' };
    } else if (!connected && !pending && Object.keys(state.presences).length + Object.keys(state.pending).length >= 4) {
      return { state: state, accept: false, rejectMessage: 'room_full' };
    }
    if (!connected) state.pending[presence.userId] = { sessionId: presence.sessionId, expiresAt: tick + 50 };
    return { state: state, accept: true };
  },
  matchJoin: function (ctx, logger, nk, dispatcher, tick, state, presences) {
    presences.forEach(function (presence) {
      const reservation = state.pending[presence.userId];
      const connected = state.presences[presence.userId];
      const knownPlayer = state.game && state.game.players.filter(function (player) { return player.id === presence.userId; })[0];
      const sameConnection = connected && connected.sessionId === presence.sessionId;
      if ((!sameConnection && (!reservation || reservation.sessionId !== presence.sessionId || reservation.expiresAt < tick)) ||
          (connected && !sameConnection) ||
          (!connected && Object.keys(state.presences).length >= 4) ||
          (state.game && (!knownPlayer || knownPlayer.status === 'left'))) {
        dispatcher.matchKick([presence]);
        return;
      }
      delete state.pending[presence.userId];
      state.presences[presence.userId] = presence;
      if (state.game) setConnection(state.game, presence.userId, true);
    });
    if (!state.game && Object.keys(state.presences).length === 4) {
      state.game = createGame({ playerIds: Object.keys(state.presences).sort(), seed: state.seed, practice: true });
    }
    broadcast(state, dispatcher);
    return { state: state };
  },
  matchLeave: function (ctx, logger, nk, dispatcher, tick, state, presences) {
    presences.forEach(function (presence) {
      if (state.presences[presence.userId] && state.presences[presence.userId].sessionId === presence.sessionId) {
        delete state.presences[presence.userId];
        if (state.game) setConnection(state.game, presence.userId, false);
      }
    });
    return { state: state };
  },
  matchLoop: function (ctx, logger, nk, dispatcher, tick, state, messages) {
    Object.keys(state.pending).forEach(function (userId) {
      if (state.pending[userId].expiresAt < tick) delete state.pending[userId];
    });
    state.emptyTicks = Object.keys(state.presences).length ? 0 : state.emptyTicks + 1;
    if (state.emptyTicks > 1200) return null;
    if (state.game) {
      const game = state.game;
      messages.forEach(function (message) {
        const presence = state.presences[message.sender.userId];
        if (message.opCode !== 1 || !presence || presence.sessionId !== message.sender.sessionId) return;
        let result;
        try {
          const data = nk.binaryToString(message.data);
          result = data.length > 4096 ? { ok: false, error: 'request_too_large' } : applyAction(game, message.sender.userId, JSON.parse(data));
        } catch (error) { result = { ok: false, error: 'invalid_action' }; }
        dispatcher.broadcastMessage(3, JSON.stringify(result), [message.sender]);
      });
      advance(game);
      if (tick % 2 === 0) broadcast(state, dispatcher);
    }
    return { state: state };
  },
  matchTerminate: function (ctx, logger, nk, dispatcher, tick, state) { return { state: state }; },
  matchSignal: function (ctx, logger, nk, dispatcher, tick, state) { return { state: state, data: '' }; }
};

export const InitModule: nkruntime.InitModule = function (ctx, logger, nk, initializer) {
  initializer.registerMatch('towerdef', handler);
  initializer.registerRpc('create_practice', function (ctx, logger, nk, payload) {
    if (!ctx.userId) throw new Error('authentication_required');
    const request = JSON.parse(payload || '{}');
    if (request.protocolVersion !== '1' || request.contentVersion !== content.version) throw new Error('version_mismatch');
    return JSON.stringify({ matchId: nk.matchCreate('towerdef', {}) });
  });
  initializer.registerMatchmakerMatched(function (ctx, logger, nk, entries) {
    if (entries.length !== 4) throw new Error('four_players_required');
    return nk.matchCreate('towerdef', {});
  });
  logger.info('Towerdef practice runtime loaded; protocol 1, content %s', content.version);
};
