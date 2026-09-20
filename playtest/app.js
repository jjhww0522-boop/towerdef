import { Battlefield } from './battlefield.js';
import { unitSpriteUrl } from './casual-art.js';
import { recipeMaterials, evolutionOptions, theoreticalDps } from './evolution-model.mjs';

const $ = selector => document.querySelector(selector);
const read = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (storage, key, value) => { try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const id = prefix => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const names = { shu: '촉', wei: '위', wu: '오', infantry: '보병', archer: '궁병', cavalry: '기병', might: '무력', strategy: '지략', command: '통솔' };
const rarities = { basic: '기본', elite: '정예', hero: '영웅', legend: '전설' };
const statuses = { active: '방어 중', defeated: '개인 패배', cleared: '클리어', left: '이탈' };
function portraitStyle(definition) {
  return `background-image:url(&quot;${unitSpriteUrl(definition)}&quot;);background-size:contain;background-position:center`;
}

const errors = { INSUFFICIENT_GOLD: '금화가 부족합니다. 적을 처치하거나 다음 웨이브를 기다려 보세요.', UNIT_CAP: '보유 한도에 도달했습니다. 재료를 조합해 자리를 만드세요.', INVALID_INGREDIENTS: '재료가 변경되었습니다. 현재 병력을 확인하고 다시 조합하세요.', RECIPE_LOCKED: '이 전설은 영구 해금이 필요합니다. 이번 연습에서는 사용할 수 없습니다.', DISPATCH_CAP: '이미 파견한 병력을 포함해 최대 2기까지 지원할 수 있습니다.', NO_ACTIVE_STORY: '지금은 진행 중인 스토리가 없습니다.', NOT_ACTIVE: '내 전투가 종료되었습니다. 동료를 관전하거나 새 연습을 시작하세요.', INVALID_UNITS: '선택한 병력을 확인하세요. 이미 파견한 병력은 다시 보낼 수 없습니다.', UPGRADE_CAP: '최대 강화 단계입니다.', room_full_or_finished: '가득 찼거나 참가 가능한 시간이 지난 방입니다. 새 방으로 시작하세요.', player_already_claimed: '참가 정보를 복구할 수 없습니다. 새 연습으로 시작하세요.', session_required: '서버가 재시작되었거나 세션이 만료되었습니다. 다시 연결하거나 새 연습을 시작하세요.', version_mismatch: '콘텐츠가 변경되었습니다. 페이지를 새로고침하세요.', invalid_room_or_player_id: '방 코드는 영문, 숫자, 밑줄, 하이픈 1~32자로 입력하세요.', local_room_limit_restart_server: '연습방 한도에 도달했습니다. 로컬 서버를 재시작하세요.', DISCONNECTED: '연결을 복구한 뒤 다시 시도하세요.' };
let content, definitions, state = null, session = read(sessionStorage, 'td.session', null), pending = read(sessionStorage, 'td.pending', null);
let playerId = read(sessionStorage, 'td.player', null) || id('p-'); save(sessionStorage, 'td.player', playerId);
let settings = read(localStorage, 'td.settings', { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, sound: false, guide: true });
let metrics = read(sessionStorage, 'td.metrics', null), pinned = read(localStorage, 'td.goal', 'make_zhuge_liang');
let focusedId = null;
let selected = new Set(), watchedId = playerId, connected = false, actionBusy = false, joining = false, pollBusy = false, active = false, currentTab = 'army';
let requestTail = Promise.resolve(), nextPoll = 0, resultShown = false, audioContext, toastTimer, jackpotTimer;
const field = new Battlefield($('#battlefield'), selectUnit);
const me = () => state?.players.find(p => p.id === playerId);
const watched = () => state?.players.find(p => p.id === watchedId) || me();
const name = value => definitions?.get(value)?.name || value;
const renderedHTML = new WeakMap();
const html = (selector, value) => { const element = $(selector); if (renderedHTML.get(element) !== value) { element.innerHTML = value; renderedHTML.set(element, value); } };
const text = (selector, value) => { $(selector).textContent = value; };
function notice(message, kind = '') { text('#notice', message); $('#notice').className = kind; }
function toast(message) { text('#toast', message); $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3200); }
function setPending(value) { pending = value; save(sessionStorage, 'td.pending', pending); $('#retry-action').hidden = !pending; }
function persistMetrics() { save(sessionStorage, 'td.metrics', metrics); }
function mark(milestone) { if (metrics && !metrics.milestones[milestone]) { metrics.milestones[milestone] = { wave: state.wave, tick: state.tick, elapsedSeconds: Math.round((Date.now() - metrics.startedAt) / 1000) }; persistMetrics(); } }
function api(path, body, token = session?.token) {
  const perform = async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) { const error = new Error(errors[data.error] || '서버가 요청을 처리하지 못했습니다. (' + response.status + ')'); error.status = response.status; throw error; }
      return data;
    } catch (error) { if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('서버 응답을 기다리지 못했습니다. 연결을 확인하고 다시 시도하세요.'); throw error; }
    finally { clearTimeout(timer); }
  };
  const result = requestTail.then(perform); requestTail = result.catch(() => {}); return result;
}

async function joinRoom(roomId, resume = false) {
  if (joining || actionBusy) return;
  joining = true; active = false; $('#quick-start').disabled = true; $('#join-form button').disabled = true; text('#lobby-notice', '전장과 콘텐츠를 준비하고 있습니다…');
  try {
    content = await api('/content', null, null); definitions = new Map(content.units.map(u => [u.id, u]));
    const token = resume && session?.roomId === roomId ? session.token : null;
    const result = await api('/session', { roomId, playerId, protocolVersion: '1', contentVersion: content.version, speed: Number($('#speed-select').value) }, token);
    const fresh = !resume || result.token !== session?.token;
    if (fresh) { setPending(null); metrics = { startedAt: Date.now(), actionCounts: { summon: 0, combine: 0, upgrade: 0, dispatch: 0 }, milestones: {} }; persistMetrics(); }
    session = { roomId, token: result.token }; save(sessionStorage, 'td.session', session);
    state = null; selected.clear(); focusedId = null; $('#unit-dialog').close(); watchedId = playerId; resultShown = false; active = true; $('#lobby').hidden = true; $('#game').hidden = false; $('#resume-btn').hidden = false;
    accept(result.state); notice('연습 전장에 연결되었습니다. 첫 병사를 소환하세요.', 'success'); nextPoll = performance.now() + 200;
  } catch (error) { text('#lobby-notice', error.message); if (state) notice(error.message, 'error'); }
  finally { joining = false; $('#quick-start').disabled = false; $('#join-form button').disabled = false; }
}

function accept(next) {
  if (next.protocolVersion !== '1' || next.contentVersion !== content.version) { active = false; connected = false; notice(errors.version_mismatch, 'error'); return; }
  if (state && next.tick < state.tick) return;
  const previous = state; state = next; connected = true;
  const player = me(); if (!player) { active = false; notice('내 참가 정보를 찾을 수 없습니다. 새 연습으로 시작하세요.', 'error'); return; }
  selected = new Set([...selected].filter(unitId => player.units.some(u => u.id === unitId && !u.dispatched)));
  if (!player.units.some(u => u.id === focusedId && !u.dispatched) || player.status !== 'active') {
    const consumedFocus = focusedId; focusedId = null; $('#unit-dialog').close();
    if (player.status === 'active' && pending?.type === 'combine' && pending.unitIds.includes(consumedFocus)) {
      const resultId = content.recipes.find(recipe => recipe.id === pending.recipeId)?.result;
      const oldIds = new Set(previous?.players.find(p => p.id === playerId)?.units.map(u => u.id) || []);
      focusedId = player.units.find(u => u.definitionId === resultId && !oldIds.has(u.id))?.id ?? null;
    }
  }
  if (player.units.length) mark('summon'); if (Object.values(player.upgrades).some(level => level > 0)) mark('upgrade'); if (player.units.some(u => u.dispatched)) mark('dispatch');
  if (pending && player.lastSeq >= pending.seq) { setPending(null); notice('서버에서 이전 요청 처리 상태를 확인했습니다.', 'success'); }
  if (previous?.story?.status === 'active' && state.story?.status !== 'active') { const mission = content.stories.find(s => s.wave === state.story.wave); toast(state.story.status === 'success' ? `스토리 성공! 진행 중인 전장에 ${mission.rewardGold} 금화 · 파견 병력 복귀` : '스토리 종료 · 추가 보상 없이 병력이 복귀했습니다. 내 방어를 이어가세요.'); }
  if (previous) {
    const oldIds = new Set(previous.players.flatMap(p => p.units.map(u => u.id)));
    for (const p of state.players) for (const u of p.units) if (!oldIds.has(u.id) && definitions.get(u.definitionId).rarity === 'hero') { text('#jackpot', `${p.id === playerId ? '나의' : '동료의'} 영웅 등장 · ${name(u.definitionId)}`); $('#jackpot').hidden = false; clearTimeout(jackpotTimer); jackpotTimer = setTimeout(() => $('#jackpot').hidden = true, 2500); }
  }
  render();
  if (player.status !== 'active' && player.status !== 'left' && !resultShown) showResult();
}

async function poll() {
  if (!active || joining || actionBusy || pollBusy || performance.now() < nextPoll) return;
  pollBusy = true;
  try { accept(await api('/state')); }
  catch (error) { connected = false; notice(error.message, 'error'); if (error.status === 401 || error.status === 403) active = false; render(); }
  finally { pollBusy = false; nextPoll = performance.now() + (connected ? 190 : 1800); }
}
setInterval(poll, 100);

async function sendAction(type, extra = {}, retry = false) {
  if (actionBusy || joining || (!retry && (!connected || pending || me()?.status !== 'active'))) return false;
  const packet = retry ? pending : { seq: me().lastSeq + 1, type, ...extra }; if (!packet) return false;
  setPending(packet); actionBusy = true; render();
  try {
    const response = await api('/action', packet); accept(response.state); setPending(null);
    if (response.ok) {
      if (metrics && Object.hasOwn(metrics.actionCounts, packet.type)) { metrics.actionCounts[packet.type]++; mark(packet.type); persistMetrics(); }
      const messages = { summon: '새 병력이 도착했습니다.', combine: `${name(content.recipes.find(r => r.id === packet.recipeId)?.result)} 조합 완료!`, upgrade: `${names[packet.tag]} 강화가 모든 해당 병력에 적용되었습니다.`, dispatch: '선택 병력이 스토리로 이동합니다. 내 전장의 방어가 줄어듭니다.', leave: '전장에서 나왔습니다.' };
      notice(messages[packet.type] || '요청이 반영되었습니다.', 'success'); if (packet.type !== 'leave') sound(packet.type); return true;
    }
    notice(errors[response.error] || `행동을 적용하지 못했습니다. (${response.error})`, 'error'); return false;
  } catch (error) { connected = false; notice(error.message + ' 같은 요청을 재시도하면 중복 실행되지 않습니다.', 'error'); return false; }
  finally { actionBusy = false; nextPoll = performance.now() + 200; render(); }
}

function materials(recipe, focus = null) { return recipeMaterials(recipe, me()?.units || [], focus); }
function materialHTML(recipe) { return materials(recipe).entries.map(e => `<span class="material ${e.have >= e.need ? 'enough' : ''}">${escape(name(e.key))} <b>${e.have}/${e.need}</b></span>`).join(''); }
function controlsAvailable() { return connected && !actionBusy && !pending && me()?.status === 'active'; }
function selectUnit(unitId) {
  const unit = me()?.units.find(u => u.id === unitId); if (!unit || unit.dispatched || watched()?.id !== playerId) return;
  focusedId = unitId; render();
  if (!$('#unit-dialog').open) $('#unit-dialog').showModal();
}
function renderEvolution() {
  const player = me(), unit = player.units.find(u => u.id === focusedId && !u.dispatched);
  if (!unit) { html('#evolution-panel', ''); return; }
  const definition = definitions.get(unit.definitionId), choices = evolutionOptions(content, player, focusedId);
  text('#unit-title', definition.name);
  text('#unit-subtitle', `${rarities[definition.rarity]} · ${names[definition.faction]} / ${names[definition.troop]} / ${names[definition.trait]}`);
  $('#unit-portrait').setAttribute('style', portraitStyle(definition).replaceAll('&quot;', '"'));
  const away = player.units.filter(u => u.dispatched).length;
  text('#queue-dispatch', selected.has(unit.id) ? '파견 대기에서 빼기' : '이 병력을 파견 대기에 추가');
  $('#queue-dispatch').disabled = !controlsAvailable() || (!selected.has(unit.id) && selected.size + away >= content.rules.maxDispatch);
  html('#evolution-panel', choices.length ? choices.map(({ recipe, materials: m }) => {
    const result = definitions.get(recipe.result), consumed = m.ids.map(id => player.units.find(u => u.id === id));
    const before = consumed.reduce((sum, u) => sum + theoreticalDps(definitions.get(u.definitionId), player, content.rules), 0);
    const after = theoreticalDps(result, player, content.rules);
    const alternatives = content.recipes.filter(other => other.id !== recipe.id && other.ingredients.some(id => recipe.ingredients.includes(id)));
    const complete = m.ids.length === recipe.ingredients.length;
    return `<article class="evolution-card ${m.ready ? 'ready' : ''}" data-evolution-result="${result.id}">
      <div class="recipe-head"><div class="recipe-identity"><span class="recipe-portrait" style="${portraitStyle(result)}" aria-hidden="true"></span><h3>${escape(result.name)}<small>${rarities[result.rarity]} · ${names[result.faction]}/${names[result.troop]}/${names[result.trait]}</small></h3></div><button class="pin-button" data-pin="${recipe.id}" aria-label="${escape(result.name)} 목표 지정" aria-pressed="${pinned === recipe.id}">☆</button></div>
      <div class="materials">${materialHTML(recipe)}</div>
      <p class="consumption">${complete ? '소모: ' + consumed.map(u => escape(name(u.definitionId)) + (u.id === focusedId ? ' (선택)' : '')).join(' + ') : '부족한 재료를 모으면 진화할 수 있습니다.'}</p>
      <p class="evolution-change">병력 ${recipe.ingredients.length}기 → 1기 · 결과 장수의 태그로 강화 적용</p>
      <details class="evolution-detail"><summary>공격 기여${alternatives.length ? ' · 다른 재료 사용처' : ''}</summary><p>${complete ? '소모 병력 합 ' + before.toFixed(1) + ' → ' : '결과 장수 '}${after.toFixed(1)} /초 · 현재 강화 반영</p><small>단일 대상 이론치입니다. 대상 전환·초과 피해는 제외합니다.</small>${alternatives.length ? '<p>같은 재료를 쓰는 다른 진화: ' + alternatives.map(r => escape(name(r.result))).join(', ') + '</p>' : ''}</details>
      <button class="primary evolve-button" data-evolve-recipe="${recipe.id}" ${!controlsAvailable() || !m.ready ? 'disabled' : ''}>${recipe.unlockBattlefield ? '영구 해금 필요 · 연습에서 잠김' : m.ready ? result.name + ' 진화' : '재료 부족'}</button>
    </article>`;
  }).join('') : '<p class="empty-roster">이 병력의 다음 진화는 없습니다. 태그 강화로 전력을 높여보세요.</p>');
}
function switchTab(value) { currentTab = value; for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === value)); for (const key of ['army', 'recipes', 'upgrades']) $('#' + (key === 'army' ? 'army' : key) + '-panel').hidden = key !== value; render(); if (matchMedia('(max-width:800px)').matches) $('.command-panel').scrollIntoView({ behavior: settings.reduced ? 'instant' : 'smooth', block: 'start' }); }
function render() {
  if (!state || !content || !me()) return;
  const player = me(), lane = watched(), r = content.rules, can = controlsAvailable(), speed = state.playbackSpeed || 1;
  $('#game').dataset.stateStatus = player.status; $('#game').dataset.wave = state.wave;
  text('#room-label', '방 ' + session.roomId); html('#wave-value', `${String(state.wave).padStart(2, '0')} <small>/ ${r.totalWaves}</small>`); text('#gold-value', player.gold.toLocaleString()); html('#unit-value', `${player.units.length} <small>/ ${r.maxUnits}</small>`); text('#speed-label', speed + '배속 · 연습');
  text('#connection-state', connected ? '● 연결됨' : '● 연결 확인 중'); $('#connection-state').className = connected ? 'connected' : 'disconnected'; $('#reconnect-btn').hidden = connected; $('#retry-action').hidden = !pending; $('#retry-action').disabled = actionBusy;
  text('#lane-title', lane.id === playerId ? '내 전장' : '동료 전장 관전'); text('#lane-status', statuses[lane.status]); text('#enemy-count', `적 ${lane.enemies.length} / ${r.overcrowdCount}`);
  text('#battle-rule', lane.overcrowdedTicks > 0 ? `과밀 경고 · ${(Math.max(0, r.overcrowdTicks - lane.overcrowdedTicks) / r.ticksPerSecond).toFixed(1)}초 뒤 개인 패배` : `적 ${r.overcrowdCount}마리 이상이 ${r.overcrowdTicks / r.ticksPerSecond}초 유지되면 개인 패배`);
  text('#next-wave', state.bossRemainingTicks != null ? `보스 제한 ${(state.bossRemainingTicks / r.ticksPerSecond).toFixed(1)}초` : `다음 웨이브 ${Math.ceil((r.waveTicks - state.tick % r.waveTicks) / r.ticksPerSecond)}초`);
  $('#field-hint').hidden = lane.units.length > 0 && lane.status === 'active'; text('#field-hint', lane.status !== 'active' ? `${statuses[lane.status]} · 동료 카드를 눌러 다른 전장을 확인하세요.` : '아직 병력이 없습니다. 아래에서 첫 병사를 소환하세요.');
  field.update(lane, definitions, lane.id === playerId ? new Set(focusedId === null ? [] : [focusedId]) : new Set(), speed, settings.reduced);
  text('#team-count', `${state.players.length} / 4`); html('#team-list', state.players.map((p, index) => `<button class="team-card ${p.id === lane.id ? 'active' : ''}" data-watch="${escape(p.id)}" aria-label="${p.id === playerId ? '내' : '동료 ' + (index + 1)} 전장 관전"><span class="team-badge">${p.id === playerId ? '나' : index + 1}</span><div><strong>${p.id === playerId ? '내 전장' : '동료 ' + (index + 1)} · ${statuses[p.status]}</strong><small>병력 ${p.units.length} · 적 ${p.enemies.length} · ${p.connected ? '접속' : '연결 끊김'}</small></div><span aria-hidden="true">›</span></button>`).join(''));
  const story = state.story, mission = content.stories.find(s => s.wave === story?.wave) || content.stories.find(s => s.wave > state.wave) || content.stories.at(-1);
  text('#story-title', mission.name); text('#story-status', story?.status === 'active' ? '진행 중' : story?.status === 'success' ? '성공' : story?.status === 'failed' ? '종료' : '준비 중');
  text('#story-description', story?.status === 'active' ? `남은 시간 ${(story.remainingTicks / r.ticksPerSecond).toFixed(1)}초 · 성공 보상 ${mission.rewardGold}금` : story?.status === 'success' ? `공동 목표 달성 · ${mission.rewardGold}금 지급` : story?.status === 'failed' ? '추가 보상 없음 · 개인 방어는 계속' : `${mission.wave} 웨이브에 봉화가 오릅니다.`);
  $('#story-health span').style.width = story ? `${Math.max(0, story.hp / story.maxHp) * 100}%` : '0%';
  const dispatching = player.units.filter(u => selected.has(u.id)), away = player.units.filter(u => u.dispatched).length;
  text('#story-detail', dispatching.length ? `${dispatching.map(u => name(u.definitionId)).join(' · ')} 파견 예정. 이 병력은 내 방어에서 빠지고 종료 시 복귀합니다.` : `파견한 병력은 내 방어에서 빠집니다. 스토리 종료 시 복귀합니다. 현재 지원 ${away}/${r.maxDispatch}기`);
  text('#dispatch-btn', dispatching.length ? `${dispatching.length}기 파견 · 현재 지원 ${away}/${r.maxDispatch}` : `상세에서 파견 대기 지정 · ${away}/${r.maxDispatch}`); $('#dispatch-btn').disabled = !can || story?.status !== 'active' || !selected.size || selected.size + away > r.maxDispatch;
  text('#summon-cost', r.summonCost + ' 금화'); $('#summon-btn').disabled = !can || player.gold < r.summonCost || player.units.length >= r.maxUnits; text('#army-count', player.units.length);
  const ready = content.recipes.filter(recipe => materials(recipe).ready); text('#ready-count', ready.length);
  const selectedDefinitions = player.units.filter(u => u.id === focusedId).map(u => definitions.get(u.definitionId));
  text('#selection-info', selectedDefinitions.length ? selectedDefinitions.map(d => `${d.name} [${rarities[d.rarity]}] · ${names[d.faction]}/${names[d.troop]}/${names[d.trait]} · 강화 +${Math.round((player.upgrades[d.faction] + player.upgrades[d.troop] + player.upgrades[d.trait]) * r.upgradeBonus * 100)}%`).join('  |  ') : '병력을 누르면 진화 경로가 열립니다. 파견 대기는 병력 상세에서 별도로 지정하세요.');
  html('#roster', player.units.length ? player.units.map(u => { const d = definitions.get(u.definitionId); return `<button class="unit-card ${u.dispatched ? 'dispatched' : ''}" data-unit-id="${u.id}" data-faction="${d.faction}" data-rarity="${d.rarity}" aria-pressed="${focusedId === u.id}" ${u.dispatched || player.status !== 'active' ? 'disabled' : ''} aria-label="${escape(d.name)} ${rarities[d.rarity]} ${u.dispatched ? '파견 중' : '선택'}"><span class="unit-portrait" style="${portraitStyle(d)}" aria-hidden="true"></span><div><strong>${escape(d.name)}</strong><small>${u.dispatched ? '파견 중' : `${selected.has(u.id) ? '파견 대기 · ' : ''}${rarities[d.rarity]} · ${names[d.trait]}`}</small></div></button>`; }).join('') : '<p class="empty-roster">첫 병사를 소환해 전장을 채워보세요. 병사들은 자동으로 적을 공격합니다.</p>');
  const recipes = content.recipes.filter(recipe => !$('#craftable-only').checked || materials(recipe).ready);
  html('#recipe-list', recipes.length ? recipes.map(recipe => { const m = materials(recipe), d = definitions.get(recipe.result); return `<article class="recipe-card ${m.ready ? 'ready' : ''} ${recipe.unlockBattlefield ? 'locked' : ''}"><div class="recipe-head"><div class="recipe-identity"><span class="recipe-portrait" style="${portraitStyle(d)}" aria-hidden="true"></span><h3>${escape(d.name)}<small>${rarities[d.rarity]}</small></h3></div><button class="pin-button" data-pin="${recipe.id}" aria-label="${escape(d.name)} 목표 ${pinned === recipe.id ? '해제' : '고정'}" aria-pressed="${pinned === recipe.id}">◇</button></div><div class="materials">${materialHTML(recipe)}</div><p class="codex-instruction">${recipe.unlockBattlefield ? '영구 해금 필요' : '재료 병력을 눌러 진화하세요'}</p></article>`; }).join('') : '<p class="empty-roster">지금 가능한 조합이 없습니다. 재료를 더 모으거나 전체 조합을 확인하세요.</p>');
  html('#upgrade-list', Object.keys(names).map(tag => { const level = player.upgrades[tag], max = level >= r.maxUpgradeLevel, cost = r.upgradeCosts[level], applies = selectedDefinitions.some(d => [d.faction, d.troop, d.trait].includes(tag)); return `<button class="upgrade-button ${applies ? 'applies' : ''}" data-upgrade-tag="${tag}" ${!can || max || player.gold < cost ? 'disabled' : ''}><span>${names[tag]}<span class="level">${level}/${r.maxUpgradeLevel}</span></span><small>${max ? '강화 완료' : cost + ' 금화'}</small></button>`; }).join(''));
  const goal = content.recipes.find(recipe => recipe.id === pinned); $('#pinned-goal').hidden = !goal;
  if (goal) html('#pinned-goal', `<span>◇ 이번 판의 목표</span><strong>${escape(name(goal.result))}</strong><div class="materials">${materialHTML(goal)}</div><button class="text-button" data-open-recipes>조합 보기 →</button>`);
  renderEvolution(); renderGuide(ready); $('#leave-btn').disabled = actionBusy || joining; $('#new-game-btn').disabled = actionBusy || joining;
}

function renderGuide(ready) {
  $('#guide').hidden = !settings.guide; if (!settings.guide) return;
  const m = metrics?.milestones || {}, story = state.story;
  let step = '01 · 소환', title = '병사부터 모아볼까요?', description = '소환으로 병력을 모으면 자동 공격이 시작됩니다. 소환과 강화는 같은 금화를 사용합니다.';
  if (m.summon && !m.combine) { step = '02 · 조합'; title = ready.length ? '지금 완성할 수 있는 장수가 있습니다.' : '흩어진 재료를 모아 장수를 완성하세요.'; description = ready.length ? '병력을 누르고 진화할 장수를 고르세요. 선택 병력과 표시된 동료 재료가 함께 소모됩니다.' : '병력을 누르면 가능한 진화와 부족한 재료가 보입니다. 원하는 경로를 목표로 지정해 보세요.'; }
  else if (m.combine && !m.upgrade) { step = '03 · 강화'; title = '완성한 장수의 태그에 투자해 보세요.'; description = '병력을 선택하고 태그 강화 탭을 여세요. 같은 태그의 현재·미래 병력이 모두 혜택을 받습니다.'; }
  else if (m.upgrade && !m.dispatch) { step = '04 · 협동'; title = story?.status === 'active' ? '스토리가 열렸습니다. 누구를 보낼까요?' : '방어를 다지고 스토리를 준비하세요.'; description = '6·12·18 웨이브에 공동 임무가 열립니다. 최대 2기를 실제 파견하므로 내 방어가 약해집니다.'; }
  else if (m.dispatch) { step = '준비 완료'; title = '이제 이번 판의 선택은 당신의 몫입니다.'; description = '목표 장수, 강화, 스토리 지원 사이에서 금화와 병력을 나누세요. 영구 해금은 이 연습에 포함되지 않습니다.'; }
  text('#guide-step', step); text('#guide-title', title); text('#guide-description', description);
}

function showResult() {
  $('#unit-dialog').close();
  resultShown = true; const player = me(); mark('result');
  text('#result-title', player.status === 'cleared' ? '관문을 지켜냈습니다.' : '이번 방어는 여기까지.');
  text('#result-description', player.status === 'cleared' ? '마지막 웨이브를 견디고 최종 보스를 쓰러뜨렸습니다. 이번 판을 만든 선택을 돌아보세요.' : player.defeatReason === 'boss_timeout' ? '제한 시간 안에 최종 보스를 처치하지 못했습니다. 다음 판에는 상위 조합과 태그 강화의 시점을 바꿔 보세요.' : player.defeatReason === 'overcrowded' ? `적이 ${content.rules.overcrowdCount}마리 이상인 상태가 ${content.rules.overcrowdTicks / content.rules.ticksPerSecond}초 유지되었습니다. 소환·조합·강화로 처리 속도를 높여 보세요.` : '개인 방어가 종료되었습니다. 동료의 전투는 계속됩니다.');
  html('#result-stats', `<div><strong>${state.wave}</strong><span>도달 웨이브</span></div><div><strong>${metrics?.actionCounts.combine || 0}</strong><span>확인된 조합</span></div><div><strong>${metrics?.actionCounts.dispatch || 0}</strong><span>확인된 파견</span></div>`);
  if (!$('#result-dialog').open) $('#result-dialog').showModal();
}
async function newGame() {
  if (actionBusy || joining) return;
  if (me()?.status === 'active' && connected && !pending) await sendAction('leave');
  active = false; state = null; connected = false; $('#game').hidden = true; $('#lobby').hidden = false; $('#result-dialog').close(); setPending(null); await joinRoom(id('war-'));
}
async function leave() {
  if (actionBusy || joining) return;
  if (me()?.status === 'active' && connected && !pending) await sendAction('leave');
  active = false; state = null; connected = false; setPending(null); $('#game').hidden = true; $('#lobby').hidden = false; $('#result-dialog').close(); text('#lobby-notice', '전장에서 나왔습니다. 새 연습을 시작하거나 다른 방에 참가하세요.');
}
function applySettings() { document.body.classList.toggle('reduce-motion', settings.reduced); $('#reduced-motion').checked = settings.reduced; $('#sound-enabled').checked = settings.sound; save(localStorage, 'td.settings', settings); render(); }
function sound(type) {
  if (!settings.sound || !audioContext) return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.type = 'sine'; oscillator.frequency.value = type === 'combine' ? 660 : type === 'summon' ? 440 : 520; gain.gain.setValueAtTime(.035, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .18); oscillator.start(); oscillator.stop(audioContext.currentTime + .2);
}
function feedbackSnapshot() { return state && me() ? { contentVersion: state.contentVersion, playbackSpeed: state.playbackSpeed || 1, wave: state.wave, outcome: me().status, defeatReason: me().defeatReason || null, elapsedSeconds: metrics ? Math.round((Date.now() - metrics.startedAt) / 1000) : null, acknowledgedActions: metrics?.actionCounts || {}, milestones: metrics?.milestones || {} } : null; }
function openFeedback() { $('#result-dialog').close(); text('#feedback-count', `저장된 의견 ${read(localStorage, 'td.feedback', []).length}개`); $('#feedback-dialog').showModal(); }

$('#quick-start').addEventListener('click', newGame);
$('#join-form').addEventListener('submit', event => { event.preventDefault(); joinRoom($('#room-input').value.trim()); });
$('#resume-btn').hidden = !session; $('#resume-btn').addEventListener('click', () => joinRoom(session.roomId, true));
$('#summon-btn').addEventListener('click', () => sendAction('summon'));
$('#codex-toggle').addEventListener('click', () => { const panel = $('#codex-content'); panel.hidden = !panel.hidden; $('#codex-toggle').setAttribute('aria-expanded', String(!panel.hidden)); });
$('#queue-dispatch').addEventListener('click', () => {
  if (!controlsAvailable() || focusedId === null) return;
  if (selected.has(focusedId)) selected.delete(focusedId);
  else if (selected.size + me().units.filter(u => u.dispatched).length < content.rules.maxDispatch) selected.add(focusedId);
  render();
});
$('#dispatch-btn').addEventListener('click', () => sendAction('dispatch', { unitIds: [...selected] }));
$('#retry-action').addEventListener('click', () => sendAction(null, {}, true));
$('#reconnect-btn').addEventListener('click', () => joinRoom(session.roomId, true));
$('#new-game-btn').addEventListener('click', newGame); $('#result-retry').addEventListener('click', newGame); $('#leave-btn').addEventListener('click', leave);
$('#spectate-btn').addEventListener('click', () => $('#result-dialog').close());
$('#clear-selection').addEventListener('click', () => { selected.clear(); render(); });
$('#craftable-only').addEventListener('change', render);
$('#skip-guide').addEventListener('click', () => { settings.guide = false; applySettings(); });
$('#restore-guide').addEventListener('click', () => { settings.guide = true; applySettings(); $('#settings-dialog').close(); });
$('#settings-btn').addEventListener('click', () => $('#settings-dialog').showModal());
$('#reduced-motion').addEventListener('change', event => { settings.reduced = event.target.checked; applySettings(); });
$('#sound-enabled').addEventListener('change', async event => { settings.sound = event.target.checked; if (settings.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); } catch { settings.sound = false; toast('이 브라우저에서는 효과음을 사용할 수 없습니다.'); } } applySettings(); sound('summon'); });
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.tab) switchTab(button.dataset.tab);
  if (button.dataset.unitId) { if (watchedId !== playerId) watchedId = playerId; selectUnit(Number(button.dataset.unitId)); }
  if (button.dataset.watch) { watchedId = button.dataset.watch; render(); }
  if (button.dataset.evolveRecipe && focusedId !== null) { const recipe = content.recipes.find(r => r.id === button.dataset.evolveRecipe), m = materials(recipe, focusedId); if (m.ready) sendAction('combine', { recipeId: recipe.id, unitIds: m.ids }); }
  if (button.dataset.upgradeTag) sendAction('upgrade', { tag: button.dataset.upgradeTag });
  if (button.dataset.pin) { pinned = pinned === button.dataset.pin ? null : button.dataset.pin; save(localStorage, 'td.goal', pinned); render(); }
  if (button.hasAttribute('data-open-recipes')) { switchTab('recipes'); $('#codex-content').hidden = false; $('#codex-toggle').setAttribute('aria-expanded', 'true'); }
  if (button.dataset.close) $('#' + button.dataset.close).close();
});
$('#feedback-btn').addEventListener('click', openFeedback); $('#result-feedback').addEventListener('click', openFeedback);
$('#feedback-form').addEventListener('submit', event => {
  event.preventDefault(); const form = new FormData(event.target), records = read(localStorage, 'td.feedback', []);
  records.push({ recordedAt: new Date().toISOString(), fun: Number(form.get('fun')), clarity: Number(form.get('clarity')), retryIntent: form.get('retry'), comment: String(form.get('comment')).slice(0, 2000), gameplay: feedbackSnapshot() });
  if (!save(localStorage, 'td.feedback', records)) { text('#feedback-notice', '브라우저 저장 공간을 사용할 수 없습니다. 저장되지 않았습니다. 입력 내용을 복사해 보관하세요.'); return; }
  text('#feedback-count', `저장된 의견 ${records.length}개`); text('#feedback-notice', '이 브라우저에 저장했습니다. 필요하면 JSON 파일로 직접 내보내세요.'); event.target.reset();
});
$('#export-feedback').addEventListener('click', () => {
  const records = read(localStorage, 'td.feedback', []); if (!records.length) { text('#feedback-notice', '아직 저장한 의견이 없습니다. 실제 플레이 의견을 먼저 남겨주세요.'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ formatVersion: 1, source: 'local-form-entry-unverified', records }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'towerdef-playtest-feedback.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('pointerdown', async () => {
  if (settings.sound && !audioContext) { try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); } catch { settings.sound = false; applySettings(); } }
}, { once: true });
applySettings();
