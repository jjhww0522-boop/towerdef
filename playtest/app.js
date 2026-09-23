import { Battlefield } from './battlefield.js';
import { unitSpriteUrl } from './casual-art.js';
import { mountHomeCrew } from './home-crew.js';
import { recipeMaterials, evolutionOptions, theoreticalDps } from './evolution-model.mjs';

const $ = selector => document.querySelector(selector);
const read = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (storage, key, value) => { try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const id = prefix => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const names = { shu: '리사이클', wei: '오비탈', wu: '스파크', infantry: '보행', archer: '포탑', cavalry: '궤도', might: '동력', strategy: '연산', command: '제어' };
const rarities = { basic: '기본', elite: '개조', hero: '특급', legend: '전설' };
const rarityName = definition => definition.tier === 'ultimate' ? '궁극' : rarities[definition.rarity];
const attackNames = { bolt: '집중 사격', blast: '범위 포격', arc: '연쇄 전격' };
const attackDescriptions = { bolt: '한 적에게 화력을 집중해요.', blast: '주 대상 80% · 가까운 적 최대 2기에 각각 45% 폭발 피해.', arc: '주 대상 100% · 가까운 적으로 최대 두 번 연결해 45%·25% 피해.' };
const elementNames = { fire: '화염', wind: '바람', frost: '냉동', laser: '레이저', electric: '전격' };
const attackName = definition => elementNames[definition.element] || attackNames[definition.attackPattern || 'bolt'];
const attackRole = definition => ({ fire: '화염 집중', wind: '바람 범위 공격', frost: '냉동 감속', laser: '레이저 단일 사격', electric: '연쇄 전격' })[definition.element] || attackNames[definition.attackPattern || 'bolt'];
const rangeName = definition => definition.attackRange <= 160 ? '짧음' : definition.attackRange >= 500 ? '김' : '중간';
const attackDescription = definition => ({ fire: '가까운 적에게 강한 화력을 집중해요.', wind: '주 대상 80% · 주변 최대 2기에 각각 45% 피해.',
  frost: `적을 ${content.rules.frostSlowTicks / content.rules.ticksPerSecond}초간 ${Math.round((1 - content.rules.frostSlowMultiplier) * 100)}% 감속해요. 보스는 ${Math.round((1 - content.rules.bossSlowMultiplier) * 100)}%.`,
  laser: '먼 거리의 적 한 기를 공격해요.' })[definition.element] || attackDescriptions[definition.attackPattern || 'bolt'];
const statuses = { active: '방어 중', defeated: '개인 패배', cleared: '클리어', left: '이탈' };
function portraitStyle(definition) {
  return `background-image:url(&quot;${unitSpriteUrl(definition)}&quot;);background-size:contain;background-position:center`;
}

const errors = { INSUFFICIENT_GOLD: '고철 부족 · 적 처치나 다음 웨이브에서 얻어요.', UNIT_CAP: '보유 한도에 도달했습니다. 재료를 조합해 자리를 만드세요.', INVALID_INGREDIENTS: '재료가 변경되었습니다. 현재 로봇을 확인하고 다시 조합하세요.', RECIPE_LOCKED: '이 전설은 영구 해금이 필요합니다. 이번 연습에서는 사용할 수 없습니다.', DISPATCH_CAP: '이미 파견한 로봇을 포함해 최대 2기까지 지원할 수 있습니다.', NO_ACTIVE_STORY: '지금은 진행 중인 스토리가 없습니다.', NOT_ACTIVE: '내 전투가 종료되었습니다. 동료를 관전하거나 새 연습을 시작하세요.', INVALID_UNITS: '선택한 로봇을 확인하세요. 이미 파견한 로봇은 다시 보낼 수 없습니다.', UPGRADE_CAP: '최대 강화 단계입니다.', room_full_or_finished: '가득 찼거나 참가 가능한 시간이 지난 방입니다. 새 방으로 시작하세요.', player_already_claimed: '참가 정보를 복구할 수 없습니다. 새 연습으로 시작하세요.', session_required: '서버가 재시작되었거나 세션이 만료되었습니다. 다시 연결하거나 새 연습을 시작하세요.', version_mismatch: '콘텐츠가 변경되었습니다. 페이지를 새로고침하세요.', invalid_room_or_player_id: '방 코드는 영문, 숫자, 밑줄, 하이픈 1~32자로 입력하세요.', local_room_limit_restart_server: '연습방 한도에 도달했습니다. 로컬 서버를 재시작하세요.', DISCONNECTED: '연결을 복구한 뒤 다시 시도하세요.' };
let content, definitions, state = null, session = read(sessionStorage, 'td.session', null), pending = read(sessionStorage, 'td.pending', null);
Object.assign(errors, {
  RECIPE_LOCKED: '아직 연구하지 않은 설계도예요. 귀환 후 연구소에서 해금하세요.',
  insufficient_research_credits: '연구 크레딧이 부족해요. 원정에서 더 모아보세요.',
  battlefield_locked: '아직 갈 수 없는 행성이에요. 이전 행성에서 먼저 탈출하세요.',
  profile_required: '원정 기록에 연결하지 못했어요. 새로고침해 다시 연결하세요.',
  profile_already_playing: '이 원정대가 이미 다른 전장에 있어요. 이전 전장으로 돌아가세요.',
  profile_in_active_expedition: '이미 진행 중인 원정이 있어요. 이전 전장으로 돌아가 먼저 마쳐주세요.',
  profile_already_in_room: '같은 원정대는 방에 한 자리만 참가할 수 있어요.',
  research_prerequisite: '연구에 필요한 행성 탈출 기록이 없어요.'
});
let playerId = read(sessionStorage, 'td.player', null) || id('p-'); save(sessionStorage, 'td.player', playerId);
let settings = read(localStorage, 'td.settings', { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, sound: true, guide: true });
let metrics = read(sessionStorage, 'td.metrics', null), pinned = read(localStorage, 'td.goal', null);
let focusedId = null, saleId = null, inspectedRecipe = null;
let profile = null, profileToken = read(localStorage, 'td.profile', null)?.token || null;
let selectedBattlefield = read(localStorage, 'td.battlefield', 1), researching = false, upgradeTag = null, blueprintId = null;
let selected = new Set(), watchedId = playerId, connected = false, actionBusy = false, joining = false, pollBusy = false, active = false, currentTab = 'army';
let requestTail = Promise.resolve(), nextPoll = 0, resultShown = false, audioContext, toastTimer, alertTimer;
let audioVoices = 0, alertPriority = 0, quietCombatUntil = 0, noiseBuffer;
const lastCombatSounds = {};
const field = new Battlefield($('#battlefield'), selectUnit, event => combatSound(event));
mountHomeCrew($('#hero-robots'));
const me = () => state?.players.find(p => p.id === playerId);
const watched = () => state?.players.find(p => p.id === watchedId) || me();
const name = value => definitions?.get(value)?.name || value;
const rules = () => state?.rules || content.rules;
const missions = () => state?.stories || content.stories;
const isUnlocked = recipe => recipe.unlockBattlefield === 0 || (me()?.unlockedRecipes || profile?.unlockedRecipes || []).includes(recipe.id);
const durationText = ticks => { const seconds = Math.ceil(ticks / content.rules.ticksPerSecond); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const expeditionTicks = (planet, r) => r.waveTicks * r.totalWaves + (planet.objective?.kind === 'mining' ? 0 : r.bossTicks);
function objectiveCopy(planet, r) {
  const kind = planet.objective?.kind || 'overcrowd';
  return kind === 'mining' ? { type: '시설 방어 · 채굴', win: '채굴 완료까지 채굴기 보호', loss: '채굴기 체력 0 · 도착한 적이 계속 공격' } :
    kind === 'engine' ? { type: '시설 방어 · 탈출', win: '엔진을 지키며 충전 후 보스 처치', loss: '엔진 체력 0 또는 보스 제한 시간 초과' } :
      { type: '순환 방어 · 첫 원정', win: '채굴 완료 후 최종 보스 처치', loss: `적 ${r.overcrowdCount}기 이상 ${r.overcrowdTicks / r.ticksPerSecond}초 유지 또는 보스 시간 초과` };
}
function showLobbyScreen(screen) {
  $('#home-screen').hidden = screen !== 'home'; $('#stage-screen').hidden = screen !== 'stages';
  $('#lobby').dataset.screen = screen;
  (screen === 'home' ? $('#home-play') : $('#stage-back')).focus({ preventScroll: true });
}
const renderedHTML = new WeakMap();
const html = (selector, value) => { const element = $(selector); if (renderedHTML.get(element) !== value) { element.innerHTML = value; renderedHTML.set(element, value); } };
const text = (selector, value) => { $(selector).textContent = value; };
function notice(message, kind = '') { text('#notice', message); $('#notice').className = kind; $('.game-footer').dataset.visible = String(kind === 'error' || !!pending || !connected); }
function toast(message) { text('#toast', message); $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3200); }
function combatAlert(title, subtitle = '', tone = 'wave', priority = 1) {
  if (!$('#combat-alert').hidden && alertPriority > priority) return;
  clearTimeout(alertTimer); alertPriority = priority;
  text('#combat-alert-title', title); text('#combat-alert-subtitle', subtitle);
  $('#combat-alert').dataset.tone = tone; $('#combat-alert').hidden = false;
  for (const animation of $('#combat-alert').getAnimations()) animation.cancel();
  if (!settings.reduced) $('#combat-alert').animate([{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
  alertTimer = setTimeout(() => { $('#combat-alert').hidden = true; alertPriority = 0; }, priority > 1 ? 1800 : 900);
}
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

function acceptProfile(next) {
  if (!next) return;
  profile = next;
  renderLobby();
  if ($('#research-dialog').open) renderResearch();
}

function renderLobby() {
  if (!content || !profile) return;
  if (!content.battlefields.some(planet => planet.id === selectedBattlefield)) selectedBattlefield = 1;
  html('#planet-list', content.battlefields.map(planet => {
    const available = profile.unlockedBattlefields.includes(planet.id);
    return `<button class="planet-card" data-battlefield="${planet.id}" aria-pressed="${planet.id === selectedBattlefield}"><span class="planet-orb planet-${planet.id}" aria-hidden="true"></span><span><strong>${escape(planet.name)}</strong><small>${profile.clearedBattlefields.includes(planet.id) ? '클리어' : available ? '원정 가능' : '이전 행성 클리어 후 개방'}</small></span><span class="planet-marker" aria-hidden="true">${available ? '›' : '잠김'}</span></button>`;
  }).join(''));
  const planet = content.battlefields.find(p => p.id === selectedBattlefield), r = { ...content.rules, ...planet.rules };
  const index = content.battlefields.indexOf(planet), available = profile.unlockedBattlefields.includes(planet.id);
  $('#destination-orb').className = `planet-orb planet-${planet.id}`;
  text('#planet-index', `${String(index + 1).padStart(2, '0')} / ${String(content.battlefields.length).padStart(2, '0')}`);
  text('#destination-lock', available ? '' : '이전 행성 클리어 후 개방');
  $('#planet-prev').disabled = index === 0; $('#planet-next').disabled = index === content.battlefields.length - 1;
  const speed = Number($('#speed-select').value);
  text('#run-mode-label', speed === 1 ? '일반 · 보상 저장' : `${speed}배속 연습 · 보상 없음`);
  text('#research-credits', profile.researchCredits.toLocaleString());
  const goal = objectiveCopy(planet, r);
  text('#destination-name', planet.name); text('#destination-type', goal.type); text('#destination-description', planet.description);
  text('#destination-win', goal.win); text('#destination-loss', goal.loss);
  text('#expedition-duration', `최대 ${durationText(expeditionTicks(planet, r))}`);
  text('#home-play', '행성 선택'); $('#home-play').disabled = joining;
  text('#quick-start', !available ? '아직 갈 수 없는 행성' : speed === 1 ? '출발' : '연습 출발');
  $('#quick-start').disabled = joining || !available;
  $('#join-form button').disabled = joining;
  $('#research-btn').disabled = false;
}

async function prepareLobby() {
  try {
    content = await api('/content', null, null); definitions = new Map(content.units.map(u => [u.id, u]));
    const result = profileToken ? await api('/profile', null, profileToken) : await api('/profile', {}, null);
    if (result.profileToken) {
      profileToken = result.profileToken;
      if (!save(localStorage, 'td.profile', { token: profileToken })) toast('브라우저 저장을 사용할 수 없어 창을 닫으면 원정 기록에 다시 연결하기 어렵습니다.');
    }
    acceptProfile(result.profile);
    text('#lobby-notice', '');
  } catch (error) {
    text('#lobby-notice', `${error.message} 새로고침하면 다시 연결합니다.`);
    text('#quick-start', '연결 확인 필요'); $('#quick-start').disabled = true;
  }
}

function renderResearch() {
  if (!profile || !content) return;
  text('#research-balance', profile.researchCredits.toLocaleString());
  html('#research-list', content.recipes.filter(recipe => recipe.unlockBattlefield > 0).map(recipe => {
    const d = definitions.get(recipe.result), unlocked = profile.unlockedRecipes.includes(recipe.id);
    const eligible = profile.clearedBattlefields.includes(recipe.unlockBattlefield), affordable = profile.researchCredits >= recipe.researchCost;
    const prerequisite = content.battlefields.find(p => p.id === recipe.unlockBattlefield)?.name || recipe.unlockBattlefield;
    return `<article class="research-card"><span class="recipe-portrait" style="${portraitStyle(d)}" aria-hidden="true"></span><div><h3>${escape(d.name)} <small>${rarityName(d)}</small></h3><p class="research-condition">${unlocked ? '다음 원정부터 조립 가능' : eligible ? '재료: ' + recipe.ingredients.map(name).map(escape).join(' + ') : escape(prerequisite) + ' 클리어 후 연구'}</p>${unlocked ? '' : `<p class="research-cost">${recipe.researchCost} 크레딧${eligible && !affordable ? ' · ' + (recipe.researchCost - profile.researchCredits) + ' 부족' : ''}</p>`}<button class="text-button" data-plan-recipe="${recipe.id}">조립 경로</button></div><button class="${unlocked ? 'secondary' : 'primary'}" data-research-recipe="${recipe.id}" aria-label="${escape(d.name)} ${unlocked ? '연구 완료' : '연구'}" ${researching || unlocked || !eligible || !affordable ? 'disabled' : ''}>${unlocked ? '연구 완료' : '연구'}</button></article>`;
  }).join(''));
}

async function researchRecipe(recipeId) {
  if (researching || !profileToken) return;
  researching = true; renderResearch();
  try {
    const result = await api('/research', { recipeId }, profileToken);
    acceptProfile(result.profile);
    text('#research-notice', `${name(content.recipes.find(recipe => recipe.id === recipeId).result)} 연구 완료. 다음 원정부터 조립할 수 있어요.`);
  } catch (error) { text('#research-notice', error.message); }
  finally { researching = false; renderResearch(); }
}

function openBlueprint(recipeId) {
  const recipe = content.recipes.find(recipe => recipe.id === recipeId); if (!recipe) return;
  blueprintId = recipeId;
  text('#blueprint-title', name(recipe.result));
  text('#blueprint-summary', '아래로 펼치면 필요한 재료가 보여요. 보유 로봇은 한 번씩만 배정해요. 부족한 재료는 직접 모아야 해요.');
  const stock = new Map();
  for (const unit of me()?.units || []) if (!unit.dispatched) stock.set(unit.definitionId, (stock.get(unit.definitionId) || 0) + 1);
  function branch(unitId, count, depth = 0) {
    const d = definitions.get(unitId), owned = Math.min(count, stock.get(unitId) || 0), missing = count - owned;
    stock.set(unitId, (stock.get(unitId) || 0) - owned);
    const assembly = content.recipes.find(r => r.result === unitId);
    const requirements = new Map();
    if (assembly && missing > 0) for (const ingredient of assembly.ingredients) requirements.set(ingredient, (requirements.get(ingredient) || 0) + missing);
    return `<li><div class="blueprint-node ${missing ? '' : 'available'}"><span class="recipe-portrait" style="${portraitStyle(d)}" aria-hidden="true"></span><div><strong>${escape(d.name)} ×${count}</strong><small>${rarityName(d)} · ${owned ? owned + '기 배정' : assembly ? '조립 필요' : '뽑기 필요'}${assembly && !isUnlocked(assembly) ? ' · 연구 잠김' : ''}</small></div></div>${requirements.size && depth < content.recipes.length ? '<ul>' + [...requirements].map(([id, need]) => branch(id, need, depth + 1)).join('') + '</ul>' : ''}</li>`;
  }
  html('#blueprint-tree', `<ul>${branch(recipe.result, 1)}</ul>`);
  text('#blueprint-pin', pinned === recipeId ? '이번 판 목표 해제' : '이번 판 목표로 지정');
  $('#blueprint-dialog').showModal();
}

async function joinRoom(roomId, resume = false) {
  if (joining || actionBusy) return;
  joining = true; active = false; $('#quick-start').disabled = true; $('#join-form button').disabled = true; text('#lobby-notice', '전장과 콘텐츠를 준비하고 있습니다…');
  try {
    content = await api('/content', null, null); definitions = new Map(content.units.map(u => [u.id, u]));
    const token = resume && session?.roomId === roomId ? session.token : null;
    const speed = Number($('#speed-select').value);
    const result = await api('/session', { roomId, playerId, protocolVersion: '1', contentVersion: content.version, speed, practice: speed !== 1, profileToken, battlefieldId: selectedBattlefield }, token);
    if (result.profileToken) { profileToken = result.profileToken; save(localStorage, 'td.profile', { token: profileToken }); }
    acceptProfile(result.profile);
    const fresh = !resume || result.token !== session?.token;
    if (fresh) { setPending(null); metrics = { startedAt: Date.now(), actionCounts: { summon: 0, combine: 0, upgrade: 0, dispatch: 0 }, milestones: {} }; persistMetrics(); }
    session = { roomId, token: result.token }; save(sessionStorage, 'td.session', session);
    state = null; selected.clear(); focusedId = null; for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); watchedId = playerId; resultShown = false; active = true; $('#lobby').hidden = true; $('#game').hidden = false; $('#resume-btn').hidden = false;
    clearTimeout(alertTimer); $('#combat-alert').hidden = true; alertPriority = 0;
    accept(result.state); notice('로봇을 뽑아 방어를 시작하세요.', 'success'); nextPoll = performance.now() + 200;
  } catch (error) { text('#lobby-notice', error.message); text('#join-notice', error.message); if (state) notice(error.message, 'error'); }
  finally { joining = false; $('#quick-start').disabled = !profile; $('#join-form button').disabled = !profile; }
}

function accept(next) {
  if (next.protocolVersion !== '1' || next.contentVersion !== content.version) { active = false; connected = false; notice(errors.version_mismatch, 'error'); return; }
  if (state && next.tick < state.tick) return;
  const previous = state; state = next; connected = true; acceptProfile(next.profile);
  const player = me(); if (!player) { active = false; notice('내 참가 정보를 찾을 수 없습니다. 새 연습으로 시작하세요.', 'error'); return; }
  selected = new Set([...selected].filter(unitId => player.units.some(u => u.id === unitId && !u.dispatched)));
  if (!player.units.some(u => u.id === focusedId && !u.dispatched) || player.status !== 'active') {
    const consumedFocus = focusedId; focusedId = null; saleId = null; $('#unit-dialog').close(); $('#unit-inspection-dialog').close();
    if (player.status === 'active' && pending?.type === 'combine' && pending.unitIds.includes(consumedFocus)) {
      const resultId = content.recipes.find(recipe => recipe.id === pending.recipeId)?.result;
      const oldIds = new Set(previous?.players.find(p => p.id === playerId)?.units.map(u => u.id) || []);
      focusedId = player.units.find(u => u.definitionId === resultId && !oldIds.has(u.id))?.id ?? null;
    }
  }
  if (player.units.length) mark('summon'); if (Object.values(player.upgrades).some(level => level > 0)) mark('upgrade'); if (player.units.some(u => u.dispatched)) mark('dispatch');
  if (pending && player.lastSeq >= pending.seq) { setPending(null); notice('서버에서 이전 요청 처리 상태를 확인했습니다.', 'success'); }
  if (previous?.story?.status === 'active' && state.story?.status !== 'active') { const mission = missions().find(s => s.wave === state.story.wave); toast(state.story.status === 'success' ? `스토리 성공! ${mission.rewardGold} 고철 · 파견 로봇 복귀` : '스토리 종료 · 로봇이 복귀했어요.'); }
  if (state.story?.status === 'active' && previous?.story?.wave !== state.story.wave) toast('공동 스토리 시작 · 여유 전력을 파견하세요.');
  if (previous) {
    const oldPlayer = previous.players.find(p => p.id === playerId), oldLane = previous.players.find(p => p.id === watchedId);
    if (state.wave > previous.wave && state.expedition?.phase === 'mining') {
      combatAlert(`${state.wave} 웨이브`, '', 'wave');
    }
    const oldIds = new Set(oldPlayer?.units.map(u => u.id) || []);
    const arrival = player.units.find(u => !oldIds.has(u.id) && ['hero', 'legend'].includes(definitions.get(u.definitionId).rarity));
    if (arrival) {
      const definition = definitions.get(arrival.definitionId);
      combatAlert(`${rarityName(definition)} 기동 · ${definition.name}`, attackName(definition), 'success', 2);
    }
    if (previous.expedition?.phase === 'mining' && state.expedition?.phase === 'evacuation') {
      combatAlert('마지막 위협 접근', '채굴 완료 · 보스를 막고 탈출하세요', 'danger', 3); sound('alarm');
    } else if (oldLane && oldLane.overcrowdedTicks === 0 && watched()?.overcrowdedTicks > 0) {
      combatAlert('방어선 과밀', `${rules().overcrowdTicks / rules().ticksPerSecond}초 안에 적의 수를 줄이세요`, 'danger', 3); sound('alarm');
    } else if (oldLane?.facilityHp > state.objective?.facilityHp * .3 && watched()?.facilityHp <= state.objective.facilityHp * .3) {
      combatAlert(`${state.objective.label} 위험`, '시설 앞에 쌓인 적을 제거하세요', 'danger', 3); sound('alarm');
    }
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
    const response = await api('/action', packet);
    if (response.ok && ['summon', 'combine'].includes(packet.type) && watchedId === playerId) {
      const oldIds = new Set(me().units.map(unit => unit.id));
      const arrival = response.state.players.find(player => player.id === playerId)?.units.find(unit => !oldIds.has(unit.id));
      if (arrival) field.markArrival(arrival.id, packet.type);
    }
    acceptProfile(response.profile); accept(response.state); setPending(null);
    if (response.ok) {
      if (metrics && Object.hasOwn(metrics.actionCounts, packet.type)) { metrics.actionCounts[packet.type]++; mark(packet.type); persistMetrics(); }
      const messages = { summon: '로봇 뽑기 완료!', combine: `${name(content.recipes.find(r => r.id === packet.recipeId)?.result)} 조립 완료!`, upgrade: `${names[packet.tag]} 강화 완료`, dispatch: '스토리에 파견했어요. 내 방어가 줄어들어요.', salvage: '판매 완료 · 고철을 회수했어요.', leave: '전장에서 나왔습니다.' };
      notice(messages[packet.type] || '요청이 반영되었습니다.', 'success'); if (packet.type !== 'leave') sound(packet.type); return true;
    }
    notice(errors[response.error] || `행동을 적용하지 못했습니다. (${response.error})`, 'error'); return false;
  } catch (error) { connected = false; notice(error.message + ' 같은 요청을 재시도하면 중복 실행되지 않습니다.', 'error'); return false; }
  finally { actionBusy = false; nextPoll = performance.now() + 200; render(); }
}

function materials(recipe, focus = null) { return recipeMaterials(recipe, me()?.units || [], focus, me()?.unlockedRecipes || []); }
function materialHTML(recipe) { return materials(recipe).entries.map(e => `<span class="material ${e.have >= e.need ? 'enough' : ''}">${escape(name(e.key))} <b>${e.have}/${e.need}</b></span>`).join(''); }
function assemblyStatus(recipe, stock) {
  const missing = stock.entries.filter(entry => entry.have < entry.need).map(entry => `${name(entry.key)} ${entry.need - entry.have}기`);
  return [isUnlocked(recipe) ? '' : '설계도 연구 필요', missing.length ? missing.join(' · ') + ' 부족' : isUnlocked(recipe) ? '조립 가능' : ''].filter(Boolean).join(' · ');
}
function controlsAvailable() { return connected && !actionBusy && !pending && me()?.status === 'active'; }
function dismissUnit() {
  if (!$('#unit-dialog').open && focusedId === null) return;
  focusedId = null; saleId = null; $('#unit-dialog').close(); $('#unit-inspection-dialog').close(); render();
}
function selectUnit(unitId) {
  if (unitId === null) { dismissUnit(); return; }
  const unit = me()?.units.find(u => u.id === unitId); if (!unit || unit.dispatched || watched()?.id !== playerId) return;
  const changed = focusedId !== unitId;
  if (changed) { saleId = null; inspectedRecipe = null; $('#unit-inspection-dialog').close(); }
  focusedId = unitId; $('#command-dialog').close();
  if (!$('#unit-dialog').open) $('#unit-dialog').show();
  render();
  if (changed) { $('#evolution-panel').scrollTop = 0; $('#evolution-panel').scrollLeft = 0; }
}
function renderEvolution() {
  const player = me(), unit = player.units.find(u => u.id === focusedId && !u.dispatched);
  const selling = !!unit && saleId === unit.id;
  $('#sale-inspection').hidden = !selling;
  if (!unit) { html('#evolution-panel', ''); return; }
  const definition = definitions.get(unit.definitionId), choices = evolutionOptions(content, player, focusedId);
  text('#unit-title', definition.name);
  $('#unit-title').title = definition.name;
  text('#unit-subtitle', ({ fire: '화염 · 근거리', wind: '바람 · 범위 공격', frost: '냉동 · 감속', laser: '레이저 · 원거리', electric: '전격 · 연쇄 공격' })[definition.element] || attackRole(definition));
  $('#unit-subtitle').title = attackDescription(definition);
  $('#unit-portrait').setAttribute('style', portraitStyle(definition).replaceAll('&quot;', '"'));
  const away = player.units.filter(u => u.dispatched).length;
  text('#queue-dispatch', selected.has(unit.id) ? '대기 해제' : '파견 대기');
  $('#queue-dispatch').setAttribute('aria-pressed', String(selected.has(unit.id)));
  $('#queue-dispatch').disabled = !controlsAvailable() || (!selected.has(unit.id) && selected.size + away >= rules().maxDispatch);
  text('#sell-unit', selling ? '취소' : '판매');
  $('#sell-unit').setAttribute('aria-expanded', String(selling));
  $('#sell-unit').disabled = !controlsAvailable();
  $('#confirm-sale').disabled = !controlsAvailable();
  if (selling) {
    text('#sale-description', `뽑기 비용 ${Math.round(rules().salvageRefundRatio * 100)}% 회수`);
    text('#confirm-sale', `판매 · +${unit.salvageGold || 0} 고철`);
    $('#confirm-sale').setAttribute('aria-label', `${definition.name} 1기 판매 · ${unit.salvageGold || 0} 고철 회수`);
  }
  renderUnitInspection(player, unit, definition);
  const options = choices.length ? choices.map(({ recipe, materials: m }, index) => {
    const result = definitions.get(recipe.result);
    return `<article class="evolution-card ${m.ready ? 'ready' : ''}" data-evolution-result="${result.id}">
      <div class="evolution-main"><div class="recipe-head"><div class="recipe-identity"><span class="recipe-portrait" style="${portraitStyle(result)}" aria-hidden="true"></span><h3>${escape(result.name)}</h3></div></div>
      <button class="primary evolve-button" data-evolve-recipe="${recipe.id}" aria-label="${escape(result.name)} ${m.ready ? '조립' : escape(assemblyStatus(recipe, m))}" ${!controlsAvailable() || !m.ready ? 'disabled' : ''}>조립</button>
      <p class="assembly-status">${escape(assemblyStatus(recipe, m))}</p></div>
      <div class="assembly-footer"><span class="assembly-consumption">${recipe.ingredients.length}기 소모 · 이 자리 조립</span><button class="text-button" data-evolution-detail="${recipe.id}">상세</button>${choices.length > 1 ? `<button class="text-button" data-evolution-next="${(index + 1) % choices.length}" aria-label="다음 조립 보기 · 현재 ${index + 1}/${choices.length}">${index + 1}/${choices.length} ›</button>` : ''}</div>
    </article>`;
  }).join('') : '<p class="empty-roster">최종 조립 완성</p>';
  html('#evolution-panel', options);
  if ($('#unit-dialog').open) {
    const dialog = $('#unit-dialog'), area = $('.canvas-wrap').getBoundingClientRect(), canvas = field.canvas.getBoundingClientRect();
    const position = field.position(unit.slot), robotHeight = field.unitHeight(definition) * field.scale;
    const center = canvas.top - area.top + field.oy + position.y * field.scale - robotHeight * .47;
    const top = Math.max(...['.canvas-wrap>.side-column', '.arena-panel>.panel-heading', '#boss-hud', '#threat-label']
      .map(selector => $(selector)).filter(element => element.getClientRects().length > 0)
      .map(element => element.getBoundingClientRect().bottom - area.top)) + 6;
    const bottom = Math.min($('.command-panel').getBoundingClientRect().top, $('#summon-btn').getBoundingClientRect().top) - area.top - 10;
    const height = dialog.getBoundingClientRect().height, lower = Math.max(top, bottom - height);
    const overlap = y => Math.max(0, Math.min(y + height, center + robotHeight / 2) - Math.max(y, center - robotHeight / 2));
    const above = overlap(top) < overlap(lower) || (overlap(top) === overlap(lower) && center > (top + bottom) / 2);
    dialog.dataset.placement = above ? 'top' : 'bottom';
    dialog.style.top = `${above ? top : lower}px`; dialog.style.bottom = 'auto';
  }
}
function renderUnitInspection(player, unit, definition) {
  text('#unit-inspection-title', definition.name);
  const recipe = content.recipes.find(recipe => recipe.id === inspectedRecipe && recipe.ingredients.includes(unit.definitionId));
  let detail = `<p class="inspection-role">${attackRole(definition)} · 사거리 ${rangeName(definition)}</p><p>${attackDescription(definition)}</p><p>${rarityName(definition)} · ${names[definition.faction]} / ${names[definition.troop]} / ${names[definition.trait]} 강화 적용</p><p>주 대상 ${theoreticalDps(definition, player, rules()).toFixed(1)} /초</p>`;
  if (recipe) {
    const result = definitions.get(recipe.result), m = materials(recipe, focusedId);
    const consumed = m.ids.map(id => player.units.find(unit => unit.id === id));
    const complete = m.ids.length === recipe.ingredients.length;
    const before = consumed.reduce((sum, unit) => sum + theoreticalDps(definitions.get(unit.definitionId), player, rules()), 0);
    const alternatives = content.recipes.filter(other => other.id !== recipe.id && other.ingredients.some(id => recipe.ingredients.includes(id)));
    detail += `<section class="assembly-inspection"><h3>${escape(result.name)} 조립</h3><p class="assembly-status">${escape(assemblyStatus(recipe, m))}</p><div class="materials" aria-label="소모할 재료와 보유 수">${materialHTML(recipe)}</div><p class="consumption">${complete ? '소모: ' + consumed.map(unit => escape(name(unit.definitionId)) + (unit.id === focusedId ? ' (선택)' : '')).join(' + ') : '표시된 재료가 모두 필요해요.'}</p><p>${recipe.ingredients.length}기 → 1기 · 선택한 자리 유지</p><p>${rarityName(result)} · ${names[result.faction]} / ${names[result.troop]} / ${names[result.trait]} 강화 적용</p><p>${complete ? before.toFixed(1) + ' → ' : ''}${theoreticalDps(result, player, rules()).toFixed(1)} /초</p><p>${attackRole(result)} · 사거리 ${rangeName(result)}<br>${attackDescription(result)}</p>${alternatives.length ? '<p>다른 사용처: ' + alternatives.map(recipe => escape(name(recipe.result))).join(', ') + '</p>' : ''}<button class="secondary" data-plan-recipe="${recipe.id}">전체 조립 경로</button><button class="text-button" data-pin="${recipe.id}" aria-pressed="${pinned === recipe.id}">${pinned === recipe.id ? '목표 해제' : '이번 판 목표 지정'}</button></section>`;
  }
  html('#unit-inspection-content', detail + '<small>피해량은 현재 강화가 반영된 주 대상 이론치예요. 범위·연쇄·초과 피해는 제외해요.</small>');
}
function switchTab(value) {
  currentTab = value; upgradeTag = null;
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-expanded', String(button.dataset.tab === value));
  for (const key of ['army', 'recipes', 'upgrades']) $('#' + key + '-panel').hidden = key !== value;
  text('#command-title', { army: '보유 로봇', recipes: '조립 설계도', upgrades: '로봇 강화' }[value]);
  $('#unit-dialog').close();
  if (!$('#command-dialog').open) $('#command-dialog').showModal();
  $('.command-content').scrollTop = 0; render();
}

function renderUpgrade() {
  $('#upgrade-list').hidden = !!upgradeTag; $('#upgrade-inspection').hidden = !upgradeTag;
  if (currentTab === 'upgrades') text('#command-title', upgradeTag ? `${names[upgradeTag]} 강화` : '로봇 강화');
  if (!upgradeTag) return;
  const player = me(), r = rules(), level = player.upgrades[upgradeTag], max = level >= r.maxUpgradeLevel;
  const affected = player.units.filter(u => { const d = definitions.get(u.definitionId); return [d.faction, d.troop, d.trait].includes(upgradeTag); }).length;
  text('#upgrade-title', `${names[upgradeTag]} · Lv.${level}${max ? ' 최대' : ' → ' + (level + 1)}`);
  text('#upgrade-effect', `공격력 +${Math.round(r.upgradeBonus * 100)}%`);
  text('#upgrade-applies', `이번 원정 · ${affected}기 + 새 로봇\n다른 분류 강화와 합산`);
  text('#upgrade-buy', max ? '강화 완료' : `${r.upgradeCosts[level]} 고철 · 강화`);
  $('#upgrade-buy').disabled = !controlsAvailable() || max || player.gold < r.upgradeCosts[level];
}

function render() {
  if (!state || !content || !me()) return;
  const player = me(), lane = watched(), r = rules(), can = controlsAvailable(), speed = state.playbackSpeed || 1;
  $('#game').dataset.stateStatus = player.status; $('#game').dataset.wave = state.wave;
  text('#room-label', '방 ' + session.roomId); html('#wave-value', `${String(state.wave).padStart(2, '0')} <small>/ ${r.totalWaves}</small>`); text('#gold-value', player.gold.toLocaleString()); html('#unit-value', `${player.units.length} <small>/ ${r.maxUnits}</small>`); text('#speed-label', speed + '배속' + (state.practice ? ' · 연습' : ' · 원정'));
  const planet = content.battlefields.find(p => p.id === state.battlefieldId);
  const expedition = state.expedition;
  text('#planet-title', planet?.name || '행성 원정');
  const facility = state.objective?.kind !== 'overcrowd' && lane.facilityHp != null;
  text('#expedition-phase', expedition?.phase === 'evacuation' ? '탈출 방어' : expedition?.phase === 'complete' ? '원정 종료' : `${state.objective?.kind === 'engine' ? '충전' : '채굴'} ${Math.floor((expedition?.miningProgress || 0) * 100)}%`);
  text('#command-wallet', `${player.gold.toLocaleString()} 고철`);
  text('#run-time', `${durationText(state.tick)} / ${durationText(expeditionTicks(planet, r))}`);
  const objective = objectiveCopy(planet, r);
  text('#rules-help', `목표: ${objective.win}. 패배: ${objective.loss}. ${facility ? '적은 시설 앞에 멈춰 계속 공격합니다. 냉동은 이동만 느리게 합니다. ' : ''}다른 구역의 적은 대신 공격할 수 없어요.`);
  $('.arena-panel').dataset.danger = String(facility ? lane.facilityHp <= state.objective.facilityHp * .3 : lane.overcrowdedTicks > 0);
  $('.game-footer').dataset.visible = String(!connected || !!pending || $('#notice').classList.contains('error'));
  if ($('#invite-room').textContent !== session.roomId) text('#copy-room', '복사');
  text('#invite-room', session.roomId);
  text('#connection-state', connected ? '● 연결됨' : '● 연결 확인 중'); $('#connection-state').className = connected ? 'connected' : 'disconnected'; $('#reconnect-btn').hidden = connected; $('#retry-action').hidden = !pending; $('#retry-action').disabled = actionBusy;
  text('#lane-title', lane.id === playerId ? '내 구역' : '동료 구역'); text('#lane-status', statuses[lane.status]);
  text('#enemy-count', facility ? `${state.objective.label} ${Math.ceil(lane.facilityHp / state.objective.facilityHp * 100)}% · 공격 ${lane.facilityAttackers}기` : `적 ${lane.enemies.length} / ${r.overcrowdCount}`);
  $('#threat-meter').value = facility ? lane.facilityHp / state.objective.facilityHp * 100 : Math.min(100, lane.enemies.length / r.overcrowdCount * 100);
  const overcrowded = !facility && lane.overcrowdedTicks > 0 && lane.status === 'active';
  const facilityDanger = facility && lane.facilityHp <= state.objective.facilityHp * .3 && lane.status === 'active';
  $('#threat-label').hidden = !overcrowded && !facilityDanger;
  text('#threat-label', overcrowded ? `과밀 · ${(Math.max(0, r.overcrowdTicks - lane.overcrowdedTicks) / r.ticksPerSecond).toFixed(1)}초` : facilityDanger ? `${state.objective.label} 위험` : '방어선');
  const boss = lane.enemies.find(enemy => enemy.boss);
  $('#boss-hud').hidden = !boss;
  if (boss) {
    text('#boss-label', '폭주 압축기'); $('#boss-health').value = Math.max(0, boss.hp / boss.maxHp * 100);
    text('#boss-hp', `${Math.ceil(boss.hp).toLocaleString()} / ${boss.maxHp.toLocaleString()}`);
    $('#boss-health').setAttribute('aria-valuetext', `체력 ${Math.ceil(boss.hp)} / ${boss.maxHp}`);
    text('#boss-deadline', state.bossRemainingTicks != null ? `제한 ${(Math.max(0, state.bossRemainingTicks) / r.ticksPerSecond).toFixed(1)}초` : '');
  }
  text('#battle-rule', lane.overcrowdedTicks > 0 ? `과밀! ${(Math.max(0, r.overcrowdTicks - lane.overcrowdedTicks) / r.ticksPerSecond).toFixed(1)}초` : `${planet?.name || '원정'}${state.practice ? ' · 연습' : ''}`);
  $('#next-wave').hidden = state.bossRemainingTicks != null;
  text('#next-wave', `다음 무리 ${Math.ceil((r.waveTicks - state.tick % r.waveTicks) / r.ticksPerSecond)}초`);
  $('#field-hint').hidden = lane.units.length > 0 && lane.status === 'active'; text('#field-hint', lane.status !== 'active' ? `${statuses[lane.status]} · 동료 카드를 눌러 다른 전장을 확인하세요.` : '로봇을 뽑아 방어를 시작하세요.');
  field.expedition = expedition; field.battlefieldId = state.battlefieldId; field.objective = state.objective;
  field.update(lane, definitions, lane.id === playerId ? new Set(focusedId === null ? [] : [focusedId]) : new Set(), speed, settings.reduced);
  text('#team-count', `${state.players.length} / 4`); html('#team-list', state.players.map((p, index) => `<button class="team-card ${p.id === lane.id ? 'active' : ''}" data-watch="${escape(p.id)}" aria-label="${p.id === playerId ? '내' : '동료 ' + (index + 1)} 전장 관전"><span class="team-badge">${p.id === playerId ? '나' : index + 1}</span><div><strong>${p.id === playerId ? '내 전장' : '동료 ' + (index + 1)} · ${statuses[p.status]}</strong><small>로봇 ${p.units.length} · 적 ${p.enemies.length} · ${p.connected ? '접속' : '연결 끊김'}</small></div><span aria-hidden="true">›</span></button>`).join(''));
  const story = state.story, mission = missions().find(s => s.wave === story?.wave) || missions().find(s => s.wave > state.wave) || missions().at(-1);
  text('#story-title', mission.name); text('#story-status', story?.status === 'active' ? '진행 중' : story?.status === 'success' ? '성공' : story?.status === 'failed' ? '종료' : '준비 중');
  text('#story-summary', story?.status === 'active' ? `${Math.ceil(story.remainingTicks / r.ticksPerSecond)}초 · 파견 ${selected.size}` : story?.status === 'success' ? '성공' : story?.status === 'failed' ? '종료' : `${mission.wave}웨이브`);
  $('#story-toggle').dataset.active = String(story?.status === 'active');
  text('#team-summary', `${state.players.filter(p => p.connected).length} / 4`);
  text('#story-description', story?.status === 'active' ? `남은 시간 ${(story.remainingTicks / r.ticksPerSecond).toFixed(1)}초 · 성공 보상 ${mission.rewardGold} 고철` : story?.status === 'success' ? `공동 목표 달성 · ${mission.rewardGold} 고철 지급` : story?.status === 'failed' ? '추가 보상 없음 · 개인 방어는 계속' : `${mission.wave} 웨이브에 시작해요.`);
  $('#story-health span').style.width = story ? `${Math.max(0, story.hp / story.maxHp) * 100}%` : '0%';
  const dispatching = player.units.filter(u => selected.has(u.id)), away = player.units.filter(u => u.dispatched).length;
  text('#story-detail', dispatching.length ? `${dispatching.map(u => name(u.definitionId)).join(' · ')} 파견 예정. 이 로봇은 내 방어에서 빠지고 종료 시 복귀합니다.` : `파견한 로봇은 내 방어에서 빠집니다. 스토리 종료 시 복귀합니다. 현재 지원 ${away}/${r.maxDispatch}기`);
  text('#dispatch-btn', dispatching.length ? `${dispatching.length}기 파견 · 현재 지원 ${away}/${r.maxDispatch}` : `로봇 상세에서 파견 대기 · ${away}/${r.maxDispatch}`); $('#dispatch-btn').disabled = !can || story?.status !== 'active' || !selected.size || selected.size + away > r.maxDispatch;
  text('#summon-cost', r.summonCost + ' 고철'); $('#summon-btn').disabled = !can || player.gold < r.summonCost || player.units.length >= r.maxUnits; text('#army-count', player.units.length);
  const ready = content.recipes.filter(recipe => materials(recipe).ready); text('#ready-count', ready.length); $('#recipes-tab').dataset.ready = String(ready.length > 0);
  const selectedDefinitions = player.units.filter(u => u.id === focusedId).map(u => definitions.get(u.definitionId));
  $('#clear-selection').hidden = selected.size === 0;
  text('#selection-info', selectedDefinitions.length ? `${selectedDefinitions[0].name} 선택 · 조립은 로봇을 누르세요` : '로봇을 눌러 조립 · 옆으로 넘겨 보기');
  html('#roster', player.units.length ? player.units.map(u => { const d = definitions.get(u.definitionId); return `<button class="unit-card ${u.dispatched ? 'dispatched' : ''}" data-unit-id="${u.id}" data-faction="${d.faction}" data-rarity="${d.rarity}" aria-pressed="${focusedId === u.id}" ${u.dispatched || player.status !== 'active' ? 'disabled' : ''} aria-label="${escape(d.name)} ${rarityName(d)} ${u.dispatched ? '파견 중' : '선택'}"><span class="unit-portrait" style="${portraitStyle(d)}" aria-hidden="true"></span><div><strong>${escape(d.name)}</strong><small>${u.dispatched ? '파견 중' : `${selected.has(u.id) ? '파견 대기 · ' : ''}${rarityName(d)} · ${names[d.trait]}`}</small></div></button>`; }).join('') : '<p class="empty-roster">로봇을 뽑아 방어를 시작하세요. 공격은 자동이에요.</p>');
  const recipes = content.recipes.filter(recipe => !$('#craftable-only').checked || materials(recipe).ready);
  html('#recipe-list', recipes.length ? recipes.map(recipe => { const m = materials(recipe), d = definitions.get(recipe.result); return `<article class="recipe-card ${m.ready ? 'ready' : ''} ${isUnlocked(recipe) ? '' : 'locked'}"><div class="recipe-head"><div class="recipe-identity"><span class="recipe-portrait" style="${portraitStyle(d)}" aria-hidden="true"></span><h3>${escape(d.name)}<small>${rarityName(d)}${isUnlocked(recipe) ? '' : ' · 연구 필요'}</small></h3></div><button class="pin-button" data-pin="${recipe.id}" aria-label="${escape(d.name)} 목표 ${pinned === recipe.id ? '해제' : '고정'}" aria-pressed="${pinned === recipe.id}">◇</button></div><div class="materials">${materialHTML(recipe)}</div><p class="assembly-status">${escape(assemblyStatus(recipe, m))}</p><div class="recipe-actions"><button class="text-button" data-plan-recipe="${recipe.id}">조립 경로</button><button class="secondary" data-combine-recipe="${recipe.id}" aria-label="${escape(d.name)} ${m.ready ? '조립할 위치 선택' : escape(assemblyStatus(recipe, m))}" ${can && m.ready ? '' : 'disabled'}>위치 선택</button></div></article>`; }).join('') : '<p class="empty-roster">지금 가능한 조립이 없어요. 재료를 더 모으거나 전체 조립표를 확인하세요.</p>');
  html('#upgrade-list', Object.keys(names).map(tag => { const level = player.upgrades[tag], max = level >= r.maxUpgradeLevel, cost = r.upgradeCosts[level], applies = selectedDefinitions.some(d => [d.faction, d.troop, d.trait].includes(tag)); return `<button class="upgrade-button ${applies ? 'applies' : ''}" data-upgrade-tag="${tag}"><span>${names[tag]}<span class="level">${level}/${r.maxUpgradeLevel}</span></span><small>${max ? '강화 완료' : cost + ' 고철 · 효과 보기'}</small></button>`; }).join(''));
  const goal = content.recipes.find(recipe => recipe.id === pinned); $('#pinned-goal').hidden = !goal;
  if (goal) html('#pinned-goal', `<span>◇ 이번 판의 목표</span><strong>${escape(name(goal.result))}</strong><div class="materials">${materialHTML(goal)}</div><button class="text-button" data-plan-recipe="${goal.id}">조립 경로 →</button>`);
  renderEvolution(); renderUpgrade(); renderGuide(ready); $('#leave-btn').disabled = actionBusy || joining; $('#new-game-btn').disabled = actionBusy || joining;
}

function renderGuide(ready) {
  $('#guide').hidden = !settings.guide; if (!settings.guide) return;
  const m = metrics?.milestones || {}, story = state.story;
  let step = '01 · 로봇 뽑기', title = '로봇을 뽑아 방어를 시작하세요.', description = '공격은 자동이에요.';
  if (m.summon && !m.combine) { step = '02 · 조립'; title = ready.length ? '조립 가능! 로봇을 눌러보세요.' : '로봇을 누르면 필요한 재료가 보여요.'; description = '조립하면 표시된 재료 로봇이 소모돼요.'; }
  else if (m.combine && !m.upgrade) { step = '03 · 강화'; title = '주력 로봇의 분류를 강화하세요.'; description = '같은 분류의 새 로봇에도 적용돼요.'; }
  else if (m.upgrade && !m.dispatch) { step = '04 · 협동'; title = story?.status === 'active' ? '스토리 진행 중! 최대 2기를 파견해요.' : missions().map(s => s.wave).join('·') + ' 웨이브에 스토리가 열려요.'; description = '파견한 로봇은 잠시 내 방어에서 빠져요.'; }
  else if (m.dispatch) { step = '준비 완료'; title = '로봇 뽑기 · 조립 · 강화, 이번엔 어떤 선택?'; description = '스토리 파견과 내 방어를 함께 챙겨요.'; }
  text('#guide-step', step); text('#guide-title', title); text('#guide-description', description);
}

function showResult() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  resultShown = true; const player = me(); mark('result');
  text('#result-title', player.status === 'cleared' ? '원정 성공' : '원정 실패');
  text('#result-description', player.status === 'cleared' ? (state.objective?.kind === 'mining' ? '채굴 완료. 자원을 싣고 귀환합니다.' : '최종 보스 처치. 자원을 싣고 귀환합니다.') : player.defeatReason === 'facility_destroyed' ? `${state.objective.label} 파괴. 시설 앞에 쌓인 적을 먼저 제거하세요.` : player.defeatReason === 'boss_timeout' ? '보스 처치 시간 초과. 조립과 강화 시점을 바꿔보세요.' : player.defeatReason === 'overcrowded' ? `적 ${rules().overcrowdCount}기 이상이 ${rules().overcrowdTicks / rules().ticksPerSecond}초 동안 쌓였어요. 중간 조립으로 방어를 보강하세요.` : '내 방어가 끝났어요. 동료의 전투는 계속됩니다.');
  html('#result-stats', `<div><strong>${state.wave}</strong><span>도달 웨이브</span></div><div><strong>${metrics?.actionCounts.combine || 0}</strong><span>확인된 조합</span></div><div><strong>${metrics?.actionCounts.dispatch || 0}</strong><span>확인된 파견</span></div>`);
  text('#result-research', state.practice ? '배속·연습 원정 · 연구 보상 없음' : `연구 크레딧 +${player.result?.researchCredits || 0}`);
  text('#result-save-note', state.practice ? '연습에서는 행성과 설계도가 해금되지 않아요.' : `보유 ${profile?.researchCredits || 0} 크레딧 · 원정 기록 저장됨`);
  $('#spectate-btn').hidden = !state.players.some(p => p.status === 'active');
  if (!$('#result-dialog').open) $('#result-dialog').showModal();
}
async function newGame() {
  if (actionBusy || joining || !profile) return;
  if (me()?.status === 'active' && (!connected || pending || !await sendAction('leave'))) return;
  active = false; state = null; connected = false; $('#game').hidden = true; $('#lobby').hidden = false; $('#result-dialog').close(); setPending(null); await joinRoom(id('war-'));
}
async function leave() {
  if (actionBusy || joining) return;
  if (me()?.status === 'active' && (!connected || pending || !await sendAction('leave'))) return;
  active = false; state = null; connected = false; setPending(null); $('#game').hidden = true; $('#lobby').hidden = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  text('#lobby-notice', ''); $('#resume-btn').hidden = true; renderLobby(); showLobbyScreen('home');
}
function applySettings() {
  document.body.classList.toggle('reduce-motion', settings.reduced); $('#reduced-motion').checked = settings.reduced; $('#sound-enabled').checked = settings.sound;
  if (!settings.sound && audioContext?.state === 'running') audioContext.suspend().catch(() => {});
  save(localStorage, 'td.settings', settings); render();
}
function audioVoice({ from, to = from, duration = .12, volume = .025, waveform = 'triangle', noise = false, delay = 0, cutoff = 1400 }) {
  if (audioVoices >= 12) return;
  const start = audioContext.currentTime + delay, gain = audioContext.createGain();
  let source;
  if (noise) {
    if (!noiseBuffer) {
      noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    source = audioContext.createBufferSource(); source.buffer = noiseBuffer;
  } else {
    source = audioContext.createOscillator(); source.type = waveform;
    source.frequency.setValueAtTime(from, start); source.frequency.exponentialRampToValueAtTime(to, start + duration);
  }
  const filter = noise ? audioContext.createBiquadFilter() : null;
  if (filter) { filter.type = 'lowpass'; filter.frequency.value = cutoff; source.connect(filter); filter.connect(gain); }
  else source.connect(gain);
  gain.connect(audioContext.destination);
  gain.gain.setValueAtTime(.0001, start); gain.gain.linearRampToValueAtTime(volume, start + .006);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  audioVoices++; source.onended = () => { audioVoices--; source.disconnect(); filter?.disconnect(); gain.disconnect(); };
  source.start(start); source.stop(start + duration + .01);
}
function combatSound(event) {
  if (event.type === 'assemble') return; // The acknowledged summon/combine owns its activation sound.
  const now = performance.now();
  const voice = event.element || event.type;
  if (now - (lastCombatSounds[voice] ?? -1000) < 120 || now < quietCombatUntil) return;
  lastCombatSounds[voice] = now; sound(event.type, event);
}
function sound(type, event = {}) {
  if (!settings.sound || audioContext?.state !== 'running' || document.hidden) return;
  const weight = .7 + (event.intensity ?? .5) * .6, delay = event.delay || 0;
  if (event.element === 'fire') {
    audioVoice({ from: 1600 / weight, to: 420, duration: .035, volume: .011, delay });
    audioVoice({ noise: true, cutoff: 900, duration: .12 * weight, volume: .019 * weight, delay: delay + .015 });
  } else if (event.element === 'wind') {
    audioVoice({ from: 130 / weight, to: 85, duration: .17, volume: .011 * weight, waveform: 'sine', delay });
    audioVoice({ noise: true, cutoff: 600, duration: .19 * weight, volume: .023, delay });
  } else if (event.element === 'laser') {
    audioVoice({ from: 1350 / weight, to: 420 / weight, duration: .065, volume: .016 * weight, waveform: 'sine', delay });
  } else if (event.element === 'frost') {
    audioVoice({ from: 1680 / weight, to: 1250, duration: .07, volume: .008, waveform: 'sine', delay });
    audioVoice({ noise: true, cutoff: 2600, duration: .055, volume: .008, delay: delay + .02 });
  } else if (type === 'bolt') audioVoice({ from: 650, to: 170, duration: .09, volume: .018, delay });
  else if (type === 'blast' || type === 'destroy') {
    audioVoice({ from: 115, to: 35, duration: .24, volume: .045, waveform: 'sine' });
    audioVoice({ noise: true, duration: type === 'blast' ? .15 : .07, volume: .023 });
  } else if (type === 'arc') {
    audioVoice({ from: 240, to: 70, duration: .15, volume: .009, waveform: 'sawtooth' });
    audioVoice({ from: 1200, to: 450, duration: .1, volume: .012 });
  } else if (type === 'combine' || type === 'upgrade') {
    quietCombatUntil = performance.now() + 450;
    audioVoice({ from: 1250, to: 520, duration: .05, volume: .022 });
    audioVoice({ from: 820, to: 400, duration: .05, volume: .018, delay: .075 });
    audioVoice({ from: 95, to: 210, duration: .24, volume: .026, waveform: 'sine', delay: .12 });
  } else if (type === 'summon') {
    audioVoice({ from: 120, to: 60, duration: .13, volume: .05 });
    audioVoice({ from: 440, to: 780, duration: .18, volume: .024, delay: .08 });
  } else if (type === 'alarm' || type === 'wave') {
    quietCombatUntil = performance.now() + 550;
    [0, .19].forEach(delay => audioVoice({ from: type === 'alarm' ? 430 : 330, to: type === 'alarm' ? 280 : 500, duration: .15, volume: .035, delay }));
  } else if (type === 'dispatch' || type === 'salvage') audioVoice({ from: 380, to: 140, duration: .2, volume: .025 });
}
function feedbackSnapshot() { return state && me() ? { contentVersion: state.contentVersion, playbackSpeed: state.playbackSpeed || 1, wave: state.wave, outcome: me().status, defeatReason: me().defeatReason || null, elapsedSeconds: metrics ? Math.round((Date.now() - metrics.startedAt) / 1000) : null, acknowledgedActions: metrics?.actionCounts || {}, milestones: metrics?.milestones || {} } : null; }
function openFeedback() { $('#result-dialog').close(); text('#feedback-count', `저장된 의견 ${read(localStorage, 'td.feedback', []).length}개`); $('#feedback-dialog').showModal(); }

$('#quick-start').addEventListener('click', newGame);
$('#home-play').addEventListener('click', () => { renderLobby(); showLobbyScreen('stages'); });
$('#stage-back').addEventListener('click', () => showLobbyScreen('home'));
$('#planet-picker').addEventListener('click', () => $('#planet-dialog').showModal());
for (const [selector, step] of [['#planet-prev', -1], ['#planet-next', 1]]) $(selector).addEventListener('click', () => {
  const index = content.battlefields.findIndex(planet => planet.id === selectedBattlefield);
  const next = content.battlefields[index + step];
  if (next) { selectedBattlefield = next.id; save(localStorage, 'td.battlefield', selectedBattlefield); $('#destination-details').open = false; renderLobby(); }
});
for (const selector of ['#join-open', '#home-join']) $(selector).addEventListener('click', () => { $('#planet-dialog').close(); text('#join-notice', ''); $('#join-dialog').showModal(); });
$('#speed-select').addEventListener('change', renderLobby);
$('#research-btn').addEventListener('click', () => { renderResearch(); $('#research-dialog').showModal(); });
$('#blueprint-pin').addEventListener('click', () => {
  pinned = pinned === blueprintId ? null : blueprintId; save(localStorage, 'td.goal', pinned);
  text('#blueprint-pin', pinned ? '이번 판 목표 해제' : '이번 판 목표로 지정'); render();
});
$('#upgrade-buy').addEventListener('click', () => { if (upgradeTag) sendAction('upgrade', { tag: upgradeTag }); });
$('#upgrade-back').addEventListener('click', () => { upgradeTag = null; renderUpgrade(); });
$('#join-form').addEventListener('submit', event => { event.preventDefault(); joinRoom($('#room-input').value.trim()); });
$('#resume-btn').hidden = !session; $('#resume-btn').addEventListener('click', () => joinRoom(session.roomId, true));
$('#summon-btn').addEventListener('click', () => sendAction('summon'));
$('#codex-toggle').addEventListener('click', () => { const panel = $('#codex-content'); panel.hidden = !panel.hidden; $('#codex-toggle').setAttribute('aria-expanded', String(!panel.hidden)); });
$('#queue-dispatch').addEventListener('click', () => {
  if (!controlsAvailable() || focusedId === null) return;
  if (selected.has(focusedId)) selected.delete(focusedId);
  else if (selected.size + me().units.filter(u => u.dispatched).length < rules().maxDispatch) selected.add(focusedId);
  render();
});
$('#dispatch-btn').addEventListener('click', async () => { if (await sendAction('dispatch', { unitIds: [...selected] })) $('#co-op-dialog').close(); });
for (const selector of ['#story-toggle', '#team-toggle']) $(selector).addEventListener('click', () => { text('#co-op-title', selector === '#story-toggle' ? '공동 스토리' : '원정대 상황'); $('#co-op-dialog').showModal(); $(selector === '#story-toggle' ? '.story-panel' : '.team-panel').scrollIntoView({ block: 'nearest' }); });
$('#copy-room').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(session.roomId); text('#copy-room', '복사됨'); }
  catch { text('#copy-room', '직접 복사'); toast('방 코드를 길게 누르거나 선택해 복사하세요.'); }
});
$('#retry-action').addEventListener('click', () => sendAction(null, {}, true));
$('#reconnect-btn').addEventListener('click', () => joinRoom(session.roomId, true));
$('#new-game-btn').addEventListener('click', newGame); $('#result-retry').addEventListener('click', newGame); $('#leave-btn').addEventListener('click', leave);
$('#result-lobby').addEventListener('click', async () => { await leave(); renderResearch(); $('#research-dialog').showModal(); });
$('#spectate-btn').addEventListener('click', () => $('#result-dialog').close());
$('#clear-selection').addEventListener('click', () => { selected.clear(); render(); });
$('#craftable-only').addEventListener('change', render);
$('#skip-guide').addEventListener('click', () => { settings.guide = false; applySettings(); });
$('#restore-guide').addEventListener('click', () => { settings.guide = true; applySettings(); $('#settings-dialog').close(); });
for (const selector of ['#settings-btn', '#battle-settings-btn']) $(selector).addEventListener('click', () => $('#settings-dialog').showModal());
$('#settings-feedback').addEventListener('click', () => { $('#settings-dialog').close(); openFeedback(); });
$('#reduced-motion').addEventListener('change', event => { settings.reduced = event.target.checked; applySettings(); });
$('#sound-enabled').addEventListener('change', async event => { settings.sound = event.target.checked; if (settings.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); } catch { settings.sound = false; toast('이 브라우저에서는 효과음을 사용할 수 없습니다.'); } } applySettings(); sound('summon'); });
document.addEventListener('click', event => {
  const unitDialog = $('#unit-dialog');
  if (unitDialog.open && !unitDialog.contains(event.target) && !event.target.closest('dialog:modal') && event.target !== $('#battlefield')) dismissUnit();
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.tab) switchTab(button.dataset.tab);
  if (button.dataset.unitId) { if (watchedId !== playerId) watchedId = playerId; selectUnit(Number(button.dataset.unitId)); }
  if (button.dataset.watch) { watchedId = button.dataset.watch; $('#co-op-dialog').close(); render(); }
  if (button.dataset.evolveRecipe && focusedId !== null) { const recipe = content.recipes.find(r => r.id === button.dataset.evolveRecipe), m = materials(recipe, focusedId); if (m.ready) sendAction('combine', { recipeId: recipe.id, unitIds: m.ids }); }
  if (button.dataset.upgradeTag) { upgradeTag = button.dataset.upgradeTag; renderUpgrade(); }
  if (button.dataset.evolutionNext !== undefined) {
    const card = $('#evolution-panel').children[Number(button.dataset.evolutionNext)];
    if (card) $('#evolution-panel').scrollTo({ left: card.offsetLeft - $('#evolution-panel').firstElementChild.offsetLeft, behavior: settings.reduced ? 'instant' : 'smooth' });
  }
  if ((button.id === 'unit-manage' || button.dataset.evolutionDetail) && focusedId !== null) {
    inspectedRecipe = button.dataset.evolutionDetail || null; saleId = null; renderEvolution();
    $('#unit-inspection-dialog').showModal(); $('#unit-inspection-dialog').scrollTop = 0;
  }
  if (button.id === 'sell-unit' && focusedId !== null) { saleId = saleId === focusedId ? null : focusedId; renderEvolution(); }
  if (button.id === 'confirm-sale' && saleId !== null && saleId === focusedId) sendAction('salvage', { unitIds: [saleId] });
  if (button.dataset.combineRecipe) { const recipe = content.recipes.find(r => r.id === button.dataset.combineRecipe), m = materials(recipe); if (m.ready) { selectUnit(m.ids[0]); toast('조립할 위치의 재료 로봇을 선택하세요.'); } }
  if (button.dataset.battlefield) { selectedBattlefield = Number(button.dataset.battlefield); save(localStorage, 'td.battlefield', selectedBattlefield); $('#destination-details').open = false; renderLobby(); $('#planet-dialog').close(); }
  if (button.dataset.researchRecipe) researchRecipe(button.dataset.researchRecipe);
  if (button.dataset.planRecipe) openBlueprint(button.dataset.planRecipe);
  if (button.dataset.pin) { pinned = pinned === button.dataset.pin ? null : button.dataset.pin; save(localStorage, 'td.goal', pinned); render(); }
  if (button.hasAttribute('data-open-recipes')) { switchTab('recipes'); $('#codex-content').hidden = false; $('#codex-toggle').setAttribute('aria-expanded', 'true'); }
  if (button.dataset.close === 'unit-dialog') dismissUnit();
  else if (button.dataset.close) $('#' + button.dataset.close).close();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#unit-dialog').open && !document.querySelector('dialog:modal')) {
    event.preventDefault(); dismissUnit();
  }
});
$('#command-dialog').addEventListener('close', () => {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-expanded', 'false');
});
for (const dialog of document.querySelectorAll('dialog')) {
  let backdropDown = false;
  const outside = event => { const rect = dialog.getBoundingClientRect(); return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; };
  dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => { if (backdropDown && event.target === dialog && outside(event)) { event.stopPropagation(); dialog.close(); } backdropDown = false; });
}
$('#result-feedback').addEventListener('click', openFeedback);
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
prepareLobby();
