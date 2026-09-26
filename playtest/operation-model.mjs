// Pure presentation of authoritative progress; no local rewards or combat decisions.
export function missionBeats(state, player, story) {
  if (!story || state.tutorial) return [];
  const milestoneTick = fraction => Math.ceil(state.rules.totalWaves * fraction) * state.rules.waveTicks;
  const progress = player.result?.miningProgress ?? state.expedition?.miningProgress ?? 0;
  const elapsed = player.result?.elapsedTicks ?? state.tick;
  const beats = [{ key: 'opening', tick: 0, speaker: story.speaker, text: story.opening }];
  if (progress >= .5) beats.push({ key: 'midpoint', tick: milestoneTick(.5), speaker: story.speaker, text: story.midpoint });
  if (progress >= .85) beats.push({ key: 'warning', tick: milestoneTick(.85), speaker: story.speaker, text: story.warning });
  if (['cleared', 'defeated'].includes(player.status)) beats.push({ key: 'result', tick: elapsed, speaker: story.speaker, text: player.status === 'cleared' ? story.victory : story.defeat });
  return beats;
}

export function debriefAdvice(player) {
  if (player.defeatReason === 'facility_destroyed') return '시설에 닿은 적은 멈춰서 계속 공격해요. 시설 가까운 로봇의 자리를 조립으로 유지하고, EMP로 공성을 끊어보세요.';
  if (player.defeatReason === 'boss_timeout') return '보스는 제한 시간 안에 쓰러뜨려야 해요. 마지막 웨이브 전에 단일 화력 로봇을 조립하고, 과부하를 보스에게 맞춰보세요.';
  if (player.defeatReason === 'overcrowded') return '군집은 범위·연쇄 공격으로 줄여보세요. 조립할 때 남길 자리를 고르면 같은 로봇도 더 오래 적을 공격할 수 있어요.';
  const uses = player.battleStats?.tacticsUsed;
  if (player.status === 'cleared' && uses && uses.overdrive + uses.emp === 0) return '전술 지원 없이 원정을 완수했어요. 다음 구역에서는 적 예고를 보고 과부하와 EMP의 사용 시점을 시험해보세요.';
  return '다음 무리의 특징을 보고 준비해보세요. 침투형은 냉동, 군집형은 범위·연쇄, 공성형은 가까운 집중 화력이 도움이 돼요.';
}
