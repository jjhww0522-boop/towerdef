import { createDevServer } from './dev-server.mjs';
import { request as httpRequest } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const server = createDevServer({ automaticTicks: true });
const startedAt = Date.now();
const report = {
  kind: 'four-client-real-http-practice', startedAt: new Date(startedAt).toISOString(),
  playbackSpeed: 6, deadlineSeconds: 130,
  limitations: 'Automated clients on localhost using real HTTP and real wall time. One response is discarded after receipt of response headers; one client sends no traffic for 30 seconds. This is not consumer research, WAN packet-loss simulation, Nakama runtime testing, or iPhone validation.',
  assertions: [], events: [], errors: []
};
const elapsed = () => Math.round((Date.now() - startedAt) / 10) / 100;
const event = (type, detail = {}) => report.events.push({ wallSeconds: elapsed(), type, ...detail });
function check(name, condition, details = {}) {
  report.assertions.push({ name, passed: Boolean(condition), ...details });
  if (!condition) throw new Error('Assertion failed: ' + name);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = Array.from({ length: 4 }, (_, i) => ({ id: 'network-' + (i + 1), token: null, lastUpgradeWave: 0, actions: { summon: 0, combine: 0, upgrade: 0, dispatch: 0, leave: 0 } }));
let baseUrl, content, latest;
let pauseStartedAt = null, pauseBefore = null, pauseAfter = null;
let observedDisconnected = false, observedAutonomousCombat = false, previousOfflineEnemies = [];
let reconnected = false, left = false, leaveTick = null, continuationChecked = false;

function player(state, client) { return state.players.find(p => p.id === client.id); }
function describe(state, client) {
  const p = player(state, client);
  return { tick: state.tick, wave: state.wave, gameStatus: state.status, roster: state.players.map(p => p.id),
    player: { id: p.id, status: p.status, connected: p.connected, lastSeq: p.lastSeq,
      gold: p.gold, defeatReason: p.defeatReason, unitIds: p.units.map(u => u.id), enemyCount: p.enemies.length } };
}
async function api(path, client, body) {
  const response = await fetch(baseUrl + path, {
    method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(client?.token ? { Authorization: 'Bearer ' + client.token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' at ' + path);
  return response.json();
}
async function action(client, state, payload) {
  const result = await api('/action', client, { seq: player(state, client).lastSeq + 1, ...payload });
  latest = result.state;
  if (result.ok) client.actions[payload.type]++;
  else if (!['NOT_ACTIVE', 'NO_ACTIVE_STORY'].includes(result.error)) throw new Error('Unexpected action error ' + result.error + ' for ' + payload.type);
  return result;
}
function materials(p, recipe) {
  const available = p.units.filter(u => !u.dispatched), ids = [];
  for (const id of recipe.ingredients) {
    const index = available.findIndex(u => u.definitionId === id);
    if (index < 0) return null;
    ids.push(available[index].id); available.splice(index, 1);
  }
  return ids;
}
function definition(unit) { return content.units.find(d => d.id === unit.definitionId); }
function dps(p, unit) {
  const d = definition(unit);
  return d.attack * (1 + [d.faction, d.troop, d.trait].reduce((sum, tag) => sum + p.upgrades[tag], 0) * content.rules.upgradeBonus) / d.attackIntervalTicks;
}
function chooseAction(client, state) {
  const p = player(state, client);
  if (p.status !== 'active') return null;
  const recipe = content.recipes.find(r => r.unlockBattlefield === 0 && materials(p, r));
  if (recipe) return { type: 'combine', recipeId: recipe.id, unitIds: materials(p, recipe) };
  if (client.lastUpgradeWave < state.wave) {
    client.lastUpgradeWave = state.wave;
    if (p.units.length >= 8) {
      const value = tag => p.units.reduce((sum, u) => {
        const d = definition(u);
        return sum + ([d.faction, d.troop, d.trait].includes(tag) ? d.attack / d.attackIntervalTicks : 0);
      }, 0) / content.rules.upgradeCosts[p.upgrades[tag]];
      const tag = Object.keys(p.upgrades).filter(t => p.upgrades[t] < content.rules.maxUpgradeLevel).sort((a, b) => value(b) - value(a))[0];
      if (tag && p.gold >= content.rules.upgradeCosts[p.upgrades[tag]]) return { type: 'upgrade', tag };
    }
  }
  if (p.gold >= content.rules.summonCost && p.units.length < content.rules.maxUnits) return { type: 'summon' };
  if (state.story?.status === 'active' && p.units.length >= 5 && p.enemies.length < 40) {
    const available = content.rules.maxDispatch - p.units.filter(u => u.dispatched).length;
    const units = p.units.filter(u => !u.dispatched).sort((a, b) => dps(p, b) - dps(p, a)).slice(0, available);
    if (units.length) return { type: 'dispatch', unitIds: units.map(u => u.id) };
  }
  return null;
}

// Destroy the receiving socket after response headers prove the server handled the request.
// The client deliberately learns no response body, then retries the identical action sequence.
function discardActionResponse(client, body) {
  return new Promise((resolve, reject) => {
    let discarded = false;
    const request = httpRequest(baseUrl + '/action', { method: 'POST', headers: {
      Authorization: 'Bearer ' + client.token, 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(body))
    } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Dropped-response request status ' + response.statusCode)); return; }
      discarded = true;
      response.destroy(); request.destroy(); resolve();
    });
    request.on('error', error => { if (!discarded) reject(error); });
    request.setTimeout(5000, () => request.destroy(new Error('Dropped-response request timeout')));
    request.end(JSON.stringify(body));
  });
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  content = await api('/content');
  report.contentVersion = content.version;
  await Promise.all(clients.map(async client => {
    const joined = await api('/session', client, { roomId: 'network-playtest', playerId: client.id, speed: 6, contentVersion: content.version, protocolVersion: '1' });
    client.token = joined.token;
  }));
  const snapshots = await Promise.all(clients.map(client => api('/state', client)));
  latest = snapshots[0];
  const roster = clients.map(client => client.id).sort();
  check('four authenticated HTTP clients see the same four-seat roster', snapshots.every(state => JSON.stringify(state.players.map(p => p.id).sort()) === JSON.stringify(roster)));
  check('all clients see explicit six-speed practice', snapshots.every(state => state.practice && state.playbackSpeed === 6));
  check('public state does not reveal RNG or replay cache', snapshots.every(state => !('rngState' in state) && state.players.every(p => !('lastActionKey' in p))));
  event('four-clients-joined', { tick: latest.tick, roster });

  const first = clients[0];
  const duplicate = { seq: player(latest, first).lastSeq + 1, type: 'summon' };
  await discardActionResponse(first, duplicate);
  const observed = await api('/state', clients[1]);
  const afterLost = player(observed, first);
  check('response-discarded action was applied once by server', afterLost.lastSeq === duplicate.seq && afterLost.units.length === 1);
  const retried = await api('/action', first, duplicate);
  latest = retried.state;
  const afterRetry = player(latest, first);
  check('identical retry returns success without second unit or spend', retried.ok && afterRetry.lastSeq === duplicate.seq &&
    JSON.stringify(afterRetry.units.map(u => u.id)) === JSON.stringify(afterLost.units.map(u => u.id)) && afterRetry.gold >= afterLost.gold,
    { goldAfterLost: afterLost.gold, goldAfterRetry: afterRetry.gold, unitCount: afterRetry.units.length });
  first.actions.summon++;
  event('lost-response-retried', { seq: duplicate.seq, tickBefore: observed.tick, tickAfter: latest.tick });

  let nextProgress = 15;
  while (elapsed() < report.deadlineSeconds) {
    const loopStart = performance.now();
    latest = await api('/state', clients[0]);
    if (pauseStartedAt === null && elapsed() >= 15) {
      pauseStartedAt = Date.now(); pauseBefore = describe(latest, clients[3]);
      previousOfflineEnemies = player(latest, clients[3]).enemies;
      event('client-disconnect-begins', pauseBefore);
    }
    if (pauseStartedAt !== null && !reconnected) {
      const offline = player(latest, clients[3]);
      if (!offline.connected) observedDisconnected = true;
      if (previousOfflineEnemies.some(old => {
        const now = offline.enemies.find(e => e.id === old.id);
        return !now || now.hp < old.hp;
      })) observedAutonomousCombat = true;
      previousOfflineEnemies = offline.enemies;
      if (Date.now() - pauseStartedAt >= 30000) {
        pauseAfter = describe(latest, clients[3]);
        check('server marks silent client disconnected', observedDisconnected);
        check('disconnected units continue server combat', observedAutonomousCombat);
        check('30 wall seconds at six-speed exceed normal tick grace without leaving', pauseAfter.tick - pauseBefore.tick > content.rules.disconnectGraceTicks && pauseAfter.player.status !== 'left', { before: pauseBefore, after: pauseAfter });
        check('no actions or replacements were made for silent player', pauseAfter.player.lastSeq === pauseBefore.player.lastSeq &&
          JSON.stringify(pauseAfter.player.unitIds) === JSON.stringify(pauseBefore.player.unitIds));
        const resumed = await api('/session', clients[3], { roomId: 'network-playtest', playerId: clients[3].id, speed: 6 });
        const restored = describe(resumed.state, clients[3]);
        check('reconnect returns same token roster units and sequence', resumed.token === clients[3].token &&
          JSON.stringify(restored.roster.slice().sort()) === JSON.stringify(roster) &&
          JSON.stringify(restored.player.unitIds) === JSON.stringify(pauseAfter.player.unitIds) && restored.player.lastSeq === pauseAfter.player.lastSeq && restored.player.connected);
        check('reconnect preserves active or terminal personal outcome', restored.player.status === pauseAfter.player.status && restored.player.defeatReason === pauseAfter.player.defeatReason);
        event('client-reconnected', { disconnectedWallSeconds: Math.round((Date.now() - pauseStartedAt) / 10) / 100, before: pauseBefore, after: restored });
        reconnected = true; latest = resumed.state;
      }
    }
    if (!left && latest.wave >= 6) {
      check('third client reaches leave exercise active', player(latest, clients[2]).status === 'active');
      const departed = await action(clients[2], latest, { type: 'leave' });
      check('explicit departure retires only that seat', departed.ok && player(departed.state, clients[2]).status === 'left' && departed.state.status === 'playing' && departed.state.players.some(p => p.id !== clients[2].id && p.status === 'active'));
      leaveTick = departed.state.tick; left = true;
      event('third-client-left', { tick: leaveTick, wave: departed.state.wave });
    }
    if (left && !continuationChecked && latest.tick >= leaveTick + 60) {
      check('remaining match advances after explicit departure', latest.status === 'playing' && player(latest, clients[2]).status === 'left', { tickAfterLeave: latest.tick - leaveTick });
      continuationChecked = true;
    }
    for (const client of clients) {
      if ((client === clients[3] && pauseStartedAt !== null && !reconnected) || (client === clients[2] && left)) continue;
      let state = await api('/state', client);
      for (let command = 0; command < 3; command++) {
        const payload = chooseAction(client, state);
        if (!payload) break;
        const result = await action(client, state, payload);
        state = result.state;
        if (!result.ok) break;
      }
      latest = state;
    }
    if (elapsed() >= nextProgress) {
      console.log(JSON.stringify({ progressSeconds: elapsed(), wave: latest.wave, tick: latest.tick, statuses: latest.players.map(p => ({ id: p.id, status: p.status, connected: p.connected })) }));
      nextProgress += 15;
    }
    if (latest.status === 'finished' && reconnected && left) break;
    await delay(Math.max(0, 250 - (performance.now() - loopStart)));
  }
  check('disconnect reconnect and departure scenarios all completed', reconnected && left && continuationChecked);
  check('actual room finishes before 130 wall-second deadline', latest.status === 'finished' && elapsed() < report.deadlineSeconds);
  check('every remaining lane has a definite authoritative outcome', latest.players.filter(p => p.id !== clients[2].id).every(p =>
    p.status === 'cleared' || (p.status === 'defeated' && ['overcrowded', 'boss_timeout'].includes(p.defeatReason))));
  report.finalState = { tick: latest.tick, wave: latest.wave, status: latest.status,
    players: latest.players.map(p => ({ id: p.id, status: p.status, defeatReason: p.defeatReason, gold: p.gold, units: p.units.length, lastSeq: p.lastSeq })) };
  report.successfulActions = clients.map(client => ({ id: client.id, ...client.actions }));
} catch (error) {
  report.errors.push({ name: error.name, message: error.message });
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  report.completedAt = new Date().toISOString();
  report.wallSeconds = elapsed();
  report.passed = report.errors.length === 0 && report.assertions.every(assertion => assertion.passed);
  report.passCount = report.assertions.filter(assertion => assertion.passed).length;
  report.failCount = report.assertions.filter(assertion => !assertion.passed).length + report.errors.filter(error => !error.message.startsWith('Assertion failed:')).length;
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/network-playtest.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ result: report.passed ? 'pass' : 'fail', passCount: report.passCount, failCount: report.failCount, wallSeconds: report.wallSeconds, finalState: report.finalState, errors: report.errors, artifact: 'artifacts/network-playtest.json' }, null, 2));
}