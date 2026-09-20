import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { advancePractice, resumePractice } from './practice-clock.mjs';
import core from '../dist/server/core/index.js';
import { publicState } from '../dist/server/protocol.js';

const { createGame, applyAction, content } = core;
const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/battlefield.js': ['battlefield.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
staticFiles['/assets/characters-v1.png'] = ['assets/characters-v1.png', 'image/png'];
staticFiles['/assets/battlefield-v1.png'] = ['assets/battlefield-v1.png', 'image/png'];
staticFiles['/assets/characters-cutout-v1.png'] = ['assets/characters-cutout-v1.png', 'image/png'];
staticFiles['/assets/enemies-walk-v1.png'] = ['assets/enemies-walk-v1.png', 'image/png'];
staticFiles['/casual-art.js'] = ['casual-art.js', 'text/javascript'];
staticFiles['/evolution-model.mjs'] = ['evolution-model.mjs', 'text/javascript'];
staticFiles['/casual-ui.css'] = ['casual-ui.css', 'text/css'];
const snapshot = room => ({ ...publicState(room.game), playbackSpeed: room.speed });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);

export function createDevServer({ automaticTicks = true } = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const send = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      const port = server.address().port;
      if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) return send(response, 403, { error: 'host_not_allowed' });
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
      if (request.method === 'GET' && path === '/content') return send(response, 200, content);
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
      if (request.method === 'POST' && path === '/session') {
        const { roomId, playerId } = body;
        if (body.speed !== undefined && ![1, 3, 6].includes(body.speed)) return send(response, 400, { error: 'invalid_speed' });
        if (!validId(roomId) || !validId(playerId)) return send(response, 400, { error: 'invalid_room_or_player_id' });
        let room = rooms.get(roomId);
        const initial = createGame({ playerIds: [playerId], seed: randomInt(1, 2147483647), practice: true });
        if ((body.protocolVersion && body.protocolVersion !== initial.protocolVersion) ||
            (body.contentVersion && body.contentVersion !== initial.contentVersion)) {
          return send(response, 409, { error: 'version_mismatch' });
        }
        if (!room) {
          if (rooms.size >= 32) return send(response, 409, { error: 'local_room_limit_restart_server' });
          room = { game: initial, speed: body.speed || 1 };
          rooms.set(roomId, room);
        } else {
          const existing = room.game.players.find(player => player.id === playerId);
          if (existing) {
            if (!session || session.roomId !== roomId || session.playerId !== playerId) return send(response, 409, { error: 'player_already_claimed' });
          } else {
            if (room.game.status !== 'playing' || room.game.players.length >= 4 || room.game.tick >= content.rules.waveTicks * content.rules.totalWaves) return send(response, 409, { error: 'room_full_or_finished' });
            room.game.players.push(initial.players[0]);
          }
        }
        if (!session || session.roomId !== roomId || session.playerId !== playerId) {
          session = { roomId, playerId, token: randomBytes(24).toString('hex'), lastSeen: Date.now() };
          sessions.set(session.token, session);
        }
        resumePractice(room, session, Date.now());
        return send(response, 200, { token: session.token, playerId, state: snapshot(room) });
      }
      if (!session) return send(response, 401, { error: 'session_required' });
      const room = rooms.get(session.roomId);
      resumePractice(room, session, Date.now());
      if (request.method === 'GET' && path === '/state') return send(response, 200, snapshot(room));
      if (request.method === 'POST' && path === '/action') {
        const result = applyAction(room.game, session.playerId, body);
        return send(response, 200, { ...result, state: snapshot(room) });
      }
      return send(response, 404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      if (!response.headersSent) send(response, 500, { error: 'internal_error' });
      else response.end();
    }
  });
  const timer = automaticTicks ? setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      advancePractice(room, [...sessions.values()].filter(session => session.roomId === roomId), now);
    }
  }, 100) : null;
  server.on('close', () => { if (timer) clearInterval(timer); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 7351);
  createDevServer().listen(port, '127.0.0.1', () => {
    console.log('Towerdef local practice: http://127.0.0.1:' + port);
    console.log('브라우저에서 위 주소를 열어 플레이하세요. 같은 방 코드로 최대 4명 접속. 종료: Ctrl+C');
  });
}
