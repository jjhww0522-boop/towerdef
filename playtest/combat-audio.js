// Original procedural foley. The application owns user gestures, mute and context lifetime.
// Keep short, individually releasable voices so leaving a battle cannot replay queued sounds.
export function createCombatAudio(context) {
  const active = new Set(), last = new Map();
  const master = context.createGain(); master.gain.value = .68; master.connect(context.destination);
  let noiseBuffer, duckUntil = 0;
  const known = new Set(['bolt', 'blast', 'arc', 'destroy', 'combine', 'upgrade', 'summon',
    'alarm', 'wave', 'dispatch', 'salvage', 'facility-hit', 'boss-entry', 'emp', 'overdrive']);
  const warnings = new Set(['alarm', 'boss-entry', 'facility-hit', 'emp', 'overdrive']);
  const weapons = new Set(['bolt', 'blast', 'arc', 'destroy']);

  function release(voice, cancel = false) {
    if (!active.delete(voice)) return;
    if (cancel) {
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setValueAtTime(0, context.currentTime);
      try { voice.source.stop(context.currentTime); } catch { /* already ended */ }
    }
    voice.source.disconnect(); voice.filter?.disconnect(); voice.gain.disconnect(); voice.pan?.disconnect();
  }

  function voice(spec, event, priority) {
    if (active.size >= 12) return;
    const start = context.currentTime + Math.max(0, Math.min(.35, event.delay || 0)) + (spec.delay || 0);
    const duration = spec.duration || .12, gain = context.createGain();
    const weight = .7 + Math.max(0, Math.min(1, event.intensity ?? .5)) * .3;
    let source, filter;
    if (spec.noise) {
      if (!noiseBuffer) {
        noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * .6), context.sampleRate);
        const samples = noiseBuffer.getChannelData(0); let seed = 73;
        for (let i = 0; i < samples.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; samples[i] = seed / 2147483648 - 1; }
      }
      source = context.createBufferSource(); source.buffer = noiseBuffer;
      filter = context.createBiquadFilter(); filter.type = spec.filter || 'bandpass';
      filter.frequency.value = spec.cutoff || 1200; filter.Q.value = .65;
      source.connect(filter); filter.connect(gain);
    } else {
      source = context.createOscillator(); source.type = spec.waveform || 'sine';
      source.frequency.setValueAtTime(spec.from, start);
      source.frequency.exponentialRampToValueAtTime(spec.to || spec.from, start + duration);
      source.connect(gain);
    }
    const pan = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.max(-.7, Math.min(.7, event.pan || 0)); gain.connect(pan); pan.connect(master); }
    else gain.connect(master);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime((spec.volume || .02) * weight, start + (spec.attack || .006));
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    const item = { source, gain, filter, pan, priority }; active.add(item);
    source.onended = () => release(item);
    source.start(start); source.stop(start + duration + .012);
  }

  function play(type, event = {}) {
    if (context.state !== 'running' || !known.has(type)) return;
    const now = context.currentTime, weapon = weapons.has(type), priority = warnings.has(type);
    const key = weapon ? event.element || type : type;
    const gap = priority ? .24 : weapon ? .09 : .06;
    if (now - (last.get(key) ?? -Infinity) < gap || weapon && now < duckUntil) return;
    last.set(key, now);
    if (priority) {
      for (const item of [...active]) if (!item.priority) release(item, true);
      duckUntil = now + (type === 'facility-hit' ? .18 : .42);
    }
    const emit = spec => voice(spec, event, priority);
    if (weapon && type !== 'destroy') {
      if (event.element === 'fire') {
        emit({ from: 170, to: 68, duration: .13, volume: .027 });
        emit({ noise: true, cutoff: 1200, duration: .13, volume: .034, delay: .012 });
        emit({ from: 1600, to: 470, duration: .025, volume: .009, waveform: 'triangle' });
      } else if (event.element === 'wind') {
        emit({ noise: true, cutoff: 760, duration: .23, volume: .033, attack: .024 });
        emit({ from: 140, to: 65, duration: .2, volume: .017 });
      } else if (event.element === 'frost') {
        emit({ from: 1840, to: 1360, duration: .075, volume: .011 });
        emit({ from: 2720, to: 2070, duration: .09, volume: .006, delay: .022 });
        emit({ noise: true, filter: 'highpass', cutoff: 3100, duration: .055, volume: .006 });
      } else if (event.element === 'laser') {
        emit({ from: 1280, to: 410, duration: .09, volume: .018 });
        emit({ from: 230, to: 150, duration: .11, volume: .013, waveform: 'triangle' });
      } else if (event.element === 'electric' || type === 'arc') {
        emit({ from: 185, to: 62, duration: .13, volume: .014, waveform: 'sawtooth' });
        emit({ noise: true, cutoff: 2400, duration: .055, volume: .02 });
        emit({ from: 1040, to: 420, duration: .065, volume: .009, delay: .03 });
      } else {
        emit({ from: type === 'blast' ? 110 : 600, to: 55, duration: .14, volume: .025 });
        emit({ noise: true, cutoff: 1100, duration: .08, volume: .015 });
      }
    } else if (type === 'destroy' || type === 'facility-hit') {
      emit({ from: type === 'facility-hit' ? 78 : 150, to: 35, duration: .23, volume: .038 });
      emit({ noise: true, cutoff: 680, duration: .15, volume: .027 });
      emit({ from: 460, to: 220, duration: .05, waveform: 'triangle', volume: .011, delay: .04 });
    } else if (type === 'emp') {
      emit({ from: 1550, to: 95, duration: .28, volume: .032, waveform: 'triangle' });
      emit({ noise: true, cutoff: 1800, duration: .3, volume: .022, attack: .018 });
      emit({ from: 80, to: 40, duration: .32, volume: .03, delay: .04 });
    } else if (type === 'overdrive' || type === 'combine' || type === 'upgrade') {
      [220, 330, 440].forEach((from, index) => emit({ from, to: from * 1.05, duration: .18,
        waveform: 'triangle', volume: .018, delay: index * .075 }));
      emit({ from: 85, to: 170, duration: .25, volume: .025 });
    } else if (type === 'alarm' || type === 'boss-entry' || type === 'wave') {
      const boss = type === 'boss-entry';
      [0, .18].forEach(delay => emit({ from: boss ? 195 : 420, to: boss ? 105 : type === 'wave' ? 560 : 290,
        duration: .16, waveform: 'triangle', volume: .028, delay }));
      if (boss) emit({ noise: true, cutoff: 480, duration: .3, volume: .022 });
    } else if (type === 'summon') {
      emit({ from: 130, to: 55, duration: .13, volume: .032 });
      emit({ from: 470, to: 880, duration: .16, volume: .018, delay: .06, waveform: 'triangle' });
    } else {
      emit({ from: type === 'dispatch' ? 340 : 540, to: 160, duration: .15, volume: .02 });
      emit({ noise: true, cutoff: 1400, duration: .04, volume: .008 });
    }
  }

  function stop() {
    for (const item of [...active]) release(item, true);
    last.clear(); duckUntil = 0;
  }
  return { play, stop };
}
