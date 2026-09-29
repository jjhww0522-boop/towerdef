import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { advancePractice, resumePractice } from './practice-clock.mjs';
import { createProgressionStore, ProgressionError } from './progression.mjs';
import { mobileServerConfig, progressionFilePath } from './mobile-server-config.mjs';
import core from '../dist/server/core/index.js';
import { publicState, publicContent } from '../dist/server/protocol.js';

const { createGame, applyAction, content } = core;
const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/battlefield.js': ['battlefield.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
staticFiles['/assets/characters-v1.png'] = ['assets/characters-v1.png', 'image/png'];
staticFiles['/assets/battlefield-v1.png'] = ['assets/battlefield-v1.png', 'image/png'];
staticFiles['/assets/characters-cutout-v1.png'] = ['assets/characters-cutout-v1.png', 'image/png'];
staticFiles['/assets/enemies-walk-v1.png'] = ['assets/enemies-walk-v1.png', 'image/png'];
staticFiles['/casual-art.js'] = ['casual-art.js', 'text/javascript'];
staticFiles['/evolution-model.mjs'] = ['evolution-model.mjs', 'text/javascript'];
staticFiles['/casual-ui.css'] = ['casual-ui.css', 'text/css'];
staticFiles['/mobile-game.css'] = ['mobile-game.css', 'text/css'];
staticFiles['/home-crew.js'] = ['home-crew.js', 'text/javascript'];
staticFiles['/combat-audio.js'] = ['combat-audio.js', 'text/javascript'];
staticFiles['/mission-content.js'] = ['mission-content.js', 'text/javascript'];
staticFiles['/operation-model.mjs'] = ['operation-model.mjs', 'text/javascript'];
staticFiles['/operation-ui.css'] = ['operation-ui.css', 'text/css'];
staticFiles['/assets/crew-deck.svg'] = ['assets/crew-deck.svg', 'image/svg+xml'];
staticFiles['/assets/fonts/PretendardVariable.woff2'] = ['assets/fonts/PretendardVariable.woff2', 'font/woff2'];
staticFiles['/assets/fonts/DoHyeon-Regular.ttf'] = ['assets/fonts/DoHyeon-Regular.ttf', 'font/ttf'];
staticFiles['/assets/fonts/DoHyeon-OFL.txt'] = ['assets/fonts/DoHyeon-OFL.txt', 'text/plain'];
staticFiles['/assets/fonts/OFL.txt'] = ['assets/fonts/OFL.txt', 'text/plain'];
staticFiles['/shared/battle-geometry.js'] = ['../shared/battle-geometry.js', 'text/javascript'];
staticFiles['/shared/upgrade-model.js'] = ['../shared/upgrade-model.js', 'text/javascript'];
const snapshot = room => ({ ...publicState(room.game), playbackSpeed: room.speed });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);

export function createDevServer({ automaticTicks = true, progressionStore = createProgressionStore(), onRoomCreated = null, verifyEnginePurchase = null, lanHost = null } = {}) {
  const network = mobileServerConfig({ TOWERDEF_LAN_HOST: lanHost });
  const serverInstanceId = randomUUID();
  let ready = false;
  const rooms = new Map();
  const sessions = new Map();
  function settleRoom(room) {
    if (room.game.tutorial) {
      const player = room.game.players[0], profileId = room.profileIds.get(player.id);
      if (player.status === 'cleared' && profileId && !room.settledProfiles.has(profileId)) {
        progressionStore.completeTutorial(profileId); room.settledProfiles.add(profileId);
      }
      return;
    }
    for (const player of room.game.players) {
      const profileId = room.profileIds.get(player.id);
      if (!player.result || !profileId || room.settledProfiles.has(profileId)) continue;
      progressionStore.recordResult(profileId, room.expeditionId, room.game.practice ? { ...player.result, practice: true } : player.result);
      room.settledProfiles.add(profileId);
    }
  }
  function stateFor(room, session) {
    settleRoom(room);
    return { ...snapshot(room), expeditionId: room.expeditionId, profile: progressionStore.getProfile(session.profileId) };
  }
  const send = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const server = createServer(async (request, response) => {
    try {
      if (!ready) return send(response, 503, { error: 'server_starting' });
      const host = request.headers.host || '';
      const port = server.address().port;
      if (!network.allowedHosts.some(allowed => host === allowed + ':' + port)) return send(response, 403, { error: 'host_not_allowed' });
      if (request.headers.origin && request.headers.origin !== 'http://' + host) return send(response, 403, { error: 'browser_origin_not_allowed' });
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && Object.hasOwn(staticFiles, path)) {
        const [file, mime] = staticFiles[path];
        const data = await readFile(new URL('../playtest/' + file, import.meta.url));
        response.writeHead(200, {
          'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        });
        return response.end(data);
      }
      if (request.method === 'GET' && path === '/favicon.ico') { response.writeHead(204); return response.end(); }
      if (request.method === 'GET' && path === '/health') return send(response, 200, { ok: true, mode: 'local-practice' });
      if (request.method === 'GET' && path === '/content') return send(response, 200, { ...publicContent(), serverInstanceId });
      let body = {};
      if (request.method === 'POST') {
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 8192) return send(response, 413, { error: 'request_too_large' });
        }
        try { body = JSON.parse(raw); } catch { return send(response, 400, { error: 'invalid_json' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(response, 400, { error: 'invalid_body' });
      }
      const token = (request.headers.authorization || '').replace(/^Bearer /, '');
      let session = sessions.get(token);
      if (path === '/profile' && request.method === 'POST') {
        if (!token) return send(response, 200, progressionStore.createProfile());
        const profile = progressionStore.authenticate(token);
        if (!profile) return send(response, 401, { error: 'profile_required' });
        for (const room of rooms.values()) settleRoom(room);
        return send(response, 200, { profileToken: token, profile: progressionStore.getProfile(profile.id) });
      }
      if ((path === '/profile' && request.method === 'GET') || (path === '/research' && request.method === 'POST')) {
        const profile = session ? progressionStore.getProfile(session.profileId) : progressionStore.authenticate(token);
        if (!profile) return send(response, 401, { error: 'profile_required' });
        for (const room of rooms.values()) settleRoom(room);
        if (path === '/profile') return send(response, 200, { profile: progressionStore.getProfile(profile.id) });
        return send(response, 200, progressionStore.research(profile.id, body.recipeId));
      }
      if ((request.method === 'GET' && path === '/engine/store') || (request.method === 'POST' && path === '/engine/refill')) {
        const profile = session ? progressionStore.getProfile(session.profileId) : progressionStore.authenticate(token);
        if (!profile) return send(response, 401, { error: 'profile_required' });
        if (path === '/engine/store') return send(response, 200, {
          available: typeof verifyEnginePurchase === 'function', productId: 'engine_refill',
          kind: 'full_refill', reason: verifyEnginePurchase ? null : 'store_not_configured'
        });
        if (typeof verifyEnginePurchase !== 'function') return send(response, 503, { error: 'store_not_configured' });
        if (!['apple', 'google'].includes(body.platform) || typeof body.purchaseToken !== 'string' ||
            !body.purchaseToken.length || body.purchaseToken.length > 4096) return send(response, 400, { error: 'invalid_purchase' });
        let purchase;
        try { purchase = await verifyEnginePurchase({ platform: body.platform, purchaseToken: body.purchaseToken, profileId: profile.id }); }
        catch { return send(response, 503, { error: 'purchase_verification_failed' }); }
        if (!purchase || purchase.platform !== body.platform || purchase.profileId !== profile.id) {
          return send(response, 400, { error: 'purchase_not_verified' });
        }
        return send(response, 200, progressionStore.refillEngines(profile.id, purchase));
      }
      if (request.method === 'POST' && path === '/session') {
        if (body.expectedServerInstanceId !== undefined && body.expectedServerInstanceId !== serverInstanceId) {
          return send(response, 409, { error: 'server_restarted' });
        }
        const { roomId, playerId } = body;
        if (body.speed !== undefined && ![1, 3, 6].includes(body.speed)) return send(response, 400, { error: 'invalid_speed' });
        if (body.tutorial !== undefined && typeof body.tutorial !== 'boolean') return send(response, 400, { error: 'invalid_tutorial' });
        if (body.practice !== undefined && typeof body.practice !== 'boolean') return send(response, 400, { error: 'invalid_practice' });
        if (body.mode !== undefined && !['solo', 'coop'].includes(body.mode)) return send(response, 400, { error: 'invalid_mode' });
        if (!validId(roomId) || !validId(playerId)) return send(response, 400, { error: 'invalid_room_or_player_id' });
        if ((body.protocolVersion && body.protocolVersion !== '1') ||
            (body.contentVersion && body.contentVersion !== content.version)) return send(response, 409, { error: 'version_mismatch' });
        let room = rooms.get(roomId);
        const tutorial = room ? !!room.game.tutorial : body.tutorial === true;
        const mode = room ? room.game.mode : tutorial ? 'solo' : body.mode || 'coop';
        if (room && body.mode !== undefined && body.mode !== mode) return send(response, 409, { error: 'mode_mismatch' });
        let profileToken = body.profileToken;
        let profile = profileToken === undefined ? progressionStore.authenticate(token) : progressionStore.authenticate(profileToken);
        if (profileToken === undefined && profile) profileToken = token;
        if (profileToken !== undefined && !profile) return send(response, 401, { error: 'profile_required' });
        if (session) {
          if (profile && profile.id !== session.profileId) return send(response, 403, { error: 'profile_mismatch' });
          profile ||= progressionStore.getProfile(session.profileId);
          profileToken ||= session.profileToken;
        }
        const existing = room?.game.players.find(player => player.id === playerId);
        if (existing && (!profile || room.profileIds.get(playerId) !== profile.id)) return send(response, 409, { error: 'player_already_claimed' });
        if (profile) {
          for (const [otherRoomId, otherRoom] of rooms) {
            settleRoom(otherRoom);
            for (const otherPlayer of otherRoom.game.players) {
              if (otherRoom.profileIds.get(otherPlayer.id) !== profile.id) continue;
              if (otherRoomId === roomId && otherPlayer.id !== playerId) return send(response, 409, { error: 'profile_already_in_room' });
              if (otherRoomId !== roomId && otherPlayer.status === 'active') {
                return send(response, 409, { error: 'profile_in_active_expedition', roomId: otherRoomId, playerId: otherPlayer.id });
              }
            }
          }
        }
        if (room && tutorial && !existing) return send(response, 409, { error: 'tutorial_solo' });
        if (room && mode === 'solo' && !existing) return send(response, 409, { error: 'solo_only' });
        if (room && !existing && (room.game.status !== 'playing' || room.game.players.length >= 4 || room.game.tick >= (room.game.rules || content.rules).waveTicks * (room.game.rules || content.rules).totalWaves)) return send(response, 409, { error: 'room_full_or_finished' });
        if (!room && rooms.size >= 32) return send(response, 409, { error: 'local_room_limit_restart_server' });
        // An invitation chooses the room's battlefield, never the joiner's stale selection.
        const battlefieldId = tutorial ? 0 : room ? room.game.battlefieldId || 1 : body.battlefieldId ?? 1;
        if (!tutorial && (!Number.isInteger(battlefieldId) || !(content.battlefields || [{ id: 1 }]).some(field => field.id === battlefieldId))) return send(response, 400, { error: 'invalid_battlefield' });
        if (!profile) {
          const created = progressionStore.createProfile();
          profile = created.profile; profileToken = created.profileToken;
        }
        profile = progressionStore.getProfile(profile.id);
        if (!tutorial && !profile.unlockedBattlefields.includes(battlefieldId)) return send(response, 409, { error: 'battlefield_locked', battlefieldId });
        if (!existing) {
          const speed = tutorial ? 1 : room?.speed || body.speed || 1;
          const practice = tutorial || (room ? room.game.practice : speed !== 1 || body.practice === true);
          const initial = createGame({ playerIds: [playerId], seed: randomInt(1, 2147483647), mode, practice, tutorial,
            battlefieldId, unlockedRecipesByPlayer: { [playerId]: profile.unlockedRecipes } });
          const expeditionId = room?.expeditionId || randomUUID();
          if (!tutorial) progressionStore.consumeEngine(profile.id, expeditionId);
          if (!room) {
            room = { game: initial, speed, expeditionId, profileIds: new Map(), settledProfiles: new Set() };
            rooms.set(roomId, room);
            room.profileIds.set(playerId, profile.id);
            if (onRoomCreated) onRoomCreated(room);
          } else {
            room.game.players.push(initial.players[0]);
            room.profileIds.set(playerId, profile.id);
          }
        }
        if (!session || session.roomId !== roomId || session.playerId !== playerId) {
          for (const [oldToken, oldSession] of sessions) {
            if (oldSession.roomId === roomId && oldSession.playerId === playerId) sessions.delete(oldToken);
          }
          session = { roomId, playerId, profileId: profile.id, profileToken, token: randomBytes(24).toString('hex'), lastSeen: Date.now() };
          sessions.set(session.token, session);
        }
        resumePractice(room, session, Date.now());
        const state = stateFor(room, session);
        return send(response, 200, { token: session.token, playerId, profileToken: session.profileToken, profile: state.profile, state });
      }
      if (!session) return send(response, 401, { error: 'session_required' });
      const room = rooms.get(session.roomId);
      resumePractice(room, session, Date.now());
      if (request.method === 'GET' && path === '/state') return send(response, 200, stateFor(room, session));
      if (request.method === 'POST' && path === '/action') {
        const result = applyAction(room.game, session.playerId, body);
        const state = stateFor(room, session);
        return send(response, 200, { ...result, profile: state.profile, state });
      }
      return send(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof ProgressionError) return send(response, error.status, { error: error.code });
      console.error(error);
      if (!response.headersSent) send(response, 500, { error: 'internal_error' });
      else response.end();
    }
  });
  // Never mutate profiles for a server that fails to bind. Recovery is synchronous
  // and finishes before the event loop can accept the first request.
  server.prependOnceListener('listening', () => {
    try { progressionStore.migrateRoster(); progressionStore.recoverInterruptedExpeditions(); ready = true; }
    catch (error) { server.close(); server.emit('error', error); }
  });
  const timer = automaticTicks ? setInterval(() => {
    if (!ready) return;
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      advancePractice(room, [...sessions.values()].filter(session => session.roomId === roomId), now);
      try { settleRoom(room); } catch (error) { console.error('Progression settlement will retry:', error.message); }
    }
  }, 100) : null;
  server.on('close', () => { if (timer) clearInterval(timer); });
  server.once('error', () => { if (timer && !ready) clearInterval(timer); });
  return server;
}

// The CLI owns one file writer. Lock before reading so a competing process cannot
// load stale data or refund the live process's entries, even on a different port.
export async function startDevServer({ config = mobileServerConfig(), filePath = progressionFilePath(), automaticTicks = true } = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const lockPath = filePath + '.lock';
  let descriptor;
  try { descriptor = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Profile store already in use: ' + lockPath + '. If the owner crashed, confirm it has stopped before removing this lock.');
    throw error;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true; closeSync(descriptor); unlinkSync(lockPath);
  };
  let server;
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    server = createDevServer({ automaticTicks, progressionStore: createProgressionStore({ filePath }), lanHost: config.lanHost });
    server.once('close', release);
    await new Promise((resolve, reject) => {
      const failed = error => { server.removeListener('listening', listening); reject(error); };
      const listening = () => { server.removeListener('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', listening);
      server.listen(config.port, config.bindHost);
    });
    return server;
  } catch (error) {
    if (server?.listening) server.close();
    release();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = mobileServerConfig();
  const server = await startDevServer({ config });
  const shutdown = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  console.log('Towerdef development server: http://' + config.bindHost + ':' + config.port);
  console.log('브라우저에서 위 주소를 열어 플레이하세요. 같은 방 코드로 최대 4명 접속. 종료: Ctrl+C');
}
