"use strict";

// =====================================================================
// SONIDO Y MÚSICA DE MARSHMALLOW PALS
// =====================================================================
// Todo el audio se genera aquí mismo con la Web Audio API del navegador:
// no hay archivos de sonido ni música de terceros. Los efectos son sintetizados
// y las melodías están compuestas para este juego (notas escritas abajo), así que
// son 100% originales y no tienen problemas de licencia.
//
// Uso desde script.js:
//   Sound.play("match", { combo: 2 })   efecto de sonido
//   Sound.music("pradera")              música de un mundo (o "menu"; null = silencio)
//   Sound.settings                      { music: true/false, sfx: true/false }
//   Sound.setMusic(bool) / Sound.setSfx(bool)

window.Sound = (() => {
  const SETTINGS_KEY = "marshmallowPals.sound.v1";

  // ---------- Volúmenes (0 a 1) ----------
  const VOLUME = {
    master: 0.9,
    music: 0.15,   // la música va bajita, de fondo
    sfx: 0.55,
  };

  // ---------- Preferencias guardadas ----------
  const settings = { music: true, sfx: true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved) Object.assign(settings, saved);
  } catch (e) { /* sin acceso a localStorage: se usan los valores por defecto */ }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* nada */ }
  }

  // ---------- Motor de audio ----------
  // Los navegadores no dejan sonar nada hasta que el jugador toca la pantalla,
  // así que el contexto se crea (o se reanuda) con el primer toque.
  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  let noiseBuffer = null;
  let unlocked = false;

  function setup() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // navegador sin Web Audio: el juego funciona en silencio
    ctx = new AC();

    // un compresor suave al final evita que las explosiones grandes "revienten"
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    const master = ctx.createGain();
    master.gain.value = VOLUME.master;
    master.connect(comp).connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = settings.music ? VOLUME.music : 0;
    musicBus.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? VOLUME.sfx : 0;
    sfxBus.connect(master);

    // ruido blanco (para olas, percusión, explosiones)
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function unlock() {
    setup();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (!unlocked) {
      unlocked = true;
      if (wantedTheme) startTheme(wantedTheme);
    }
  }
  for (const type of ["pointerdown", "keydown", "touchend"]) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  // Al salir de la app (otra pestaña, pantalla apagada) se pausa todo
  document.addEventListener("visibilitychange", () => {
    if (!ctx || !unlocked) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  const ready = () => ctx && unlocked && ctx.state === "running";
  const now = () => ctx.currentTime;
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- Bloques básicos de síntesis ----------

  // Envolvente: sube rápido, se sostiene y se apaga de forma natural
  function envelope(param, t, { attack = 0.005, peak = 1, hold = 0, decay = 0.3 }) {
    peak = Math.max(peak, 0.0002);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
    const end = t + attack + hold + decay;
    param.exponentialRampToValueAtTime(0.0001, end);
    return end;
  }

  // Un oscilador con su propia envolvente. freq puede ser un número o [desde, hasta]
  function osc(dest, t, { type = "sine", freq = 440, vol = 0.3, attack, hold, decay = 0.3,
                          detune = 0, glide = null, vibrato = 0 }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    if (Array.isArray(freq)) {
      o.frequency.setValueAtTime(freq[0], t);
      o.frequency.exponentialRampToValueAtTime(freq[1], t + (glide || decay));
    } else {
      o.frequency.setValueAtTime(freq, t);
    }
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(vibrato, t + 0.25);
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + (attack || 0.005) + (hold || 0) + decay + 0.05);
    }
    const end = envelope(g.gain, t, { attack, peak: vol, hold, decay });
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(end + 0.05);
    return end;
  }

  // Ráfaga de ruido filtrado (percusión, aire, chispas)
  function noise(dest, t, { vol = 0.3, attack = 0.002, hold = 0, decay = 0.1,
                            filter = "highpass", freq = 2000, freqTo = null, q = 0.7 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + attack + hold + decay);
    const g = ctx.createGain();
    const end = envelope(g.gain, t, { attack, peak: vol, hold, decay });
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(end + 0.05);
    return end;
  }

  // ---------- Instrumentos (los usan la música y algunos efectos) ----------
  const INSTRUMENTS = {
    // marimba de madera: golpe redondo y corto
    marimba(dest, t, f, len, v = 1) {
      osc(dest, t, { freq: f, vol: 0.32 * v, decay: Math.min(0.5, 0.25 + len * 0.3) });
      osc(dest, t, { freq: f * 4, vol: 0.05 * v, decay: 0.06 });
    },
    // cajita de música: campanita brillante que se queda sonando
    musicbox(dest, t, f, len, v = 1) {
      osc(dest, t, { freq: f, vol: 0.22 * v, decay: 1.1 });
      osc(dest, t, { freq: f * 2.76, vol: 0.06 * v, decay: 0.45 });
      osc(dest, t, { freq: f * 5.4, vol: 0.025 * v, decay: 0.15 });
    },
    // tambor metálico de playa
    steel(dest, t, f, len, v = 1) {
      osc(dest, t, { type: "triangle", freq: f, vol: 0.24 * v, decay: 0.45 });
      osc(dest, t, { freq: f * 2.01, vol: 0.09 * v, decay: 0.3 });
      osc(dest, t, { freq: f * 3.02, vol: 0.04 * v, decay: 0.18 });
    },
    // flauta suave con un poquito de vibrato
    flute(dest, t, f, len, v = 1) {
      osc(dest, t, { type: "triangle", freq: f, vol: 0.2 * v, attack: 0.05,
                     hold: Math.max(0, len - 0.12), decay: 0.18, vibrato: f * 0.012 });
      noise(dest, t, { vol: 0.012 * v, attack: 0.04, hold: Math.max(0, len - 0.1), decay: 0.1,
                       filter: "bandpass", freq: f * 2, q: 3 });
    },
    // kalimba (piano de pulgares): ataque con "clic" y cola dulce
    kalimba(dest, t, f, len, v = 1) {
      osc(dest, t, { freq: f, vol: 0.27 * v, decay: 0.7 });
      osc(dest, t, { freq: f * 5.95, vol: 0.06 * v, decay: 0.05 });
      osc(dest, t, { type: "triangle", freq: f * 2, vol: 0.04 * v, decay: 0.2 });
    },
    // acordes punteados
    pluck(dest, t, f, len, v = 1) {
      osc(dest, t, { type: "triangle", freq: f, vol: 0.09 * v, decay: 0.25 });
    },
    // colchón suave (acordes largos)
    pad(dest, t, f, len, v = 1) {
      osc(dest, t, { type: "triangle", freq: f, vol: 0.05 * v, attack: 0.25, hold: Math.max(0, len - 0.4), decay: 0.5, detune: -6 });
      osc(dest, t, { type: "sine", freq: f, vol: 0.05 * v, attack: 0.25, hold: Math.max(0, len - 0.4), decay: 0.5, detune: 6 });
    },
    // bajo redondito
    bass(dest, t, f, len, v = 1) {
      osc(dest, t, { type: "triangle", freq: f, vol: 0.3 * v, attack: 0.01, hold: Math.max(0, len * 0.6), decay: 0.15 });
      osc(dest, t, { freq: f, vol: 0.2 * v, attack: 0.01, hold: Math.max(0, len * 0.6), decay: 0.15 });
    },
  };

  const DRUMS = {
    kick: (d, t, v = 1) => osc(d, t, { freq: [130, 45], vol: 0.45 * v, decay: 0.16, glide: 0.12 }),
    snare: (d, t, v = 1) => noise(d, t, { vol: 0.08 * v, decay: 0.09, freq: 1800 }),
    hat: (d, t, v = 1) => noise(d, t, { vol: 0.035 * v, decay: 0.035, freq: 7000 }),
    shaker: (d, t, v = 1) => noise(d, t, { vol: 0.03 * v, attack: 0.02, decay: 0.05, filter: "bandpass", freq: 6000, q: 1 }),
    tom: (d, t, v = 1) => osc(d, t, { freq: [210, 120], vol: 0.25 * v, decay: 0.22 }),
    conga: (d, t, v = 1) => osc(d, t, { freq: [360, 250], vol: 0.18 * v, decay: 0.12 }),
    clap: (d, t, v = 1) => noise(d, t, { vol: 0.06 * v, decay: 0.08, filter: "bandpass", freq: 1500, q: 1.2 }),
  };

  // =====================================================================
  // EFECTOS DE SONIDO
  // =====================================================================

  // Escala pentatónica: suena alegre en cualquier orden (para las combinaciones)
  const PENTA = [0, 2, 4, 7, 9];
  const pentaFreq = (step, base = 72) =>
    midiToFreq(base + 12 * Math.floor(step / 5) + PENTA[((step % 5) + 5) % 5]);

  // Algunos efectos pueden dispararse muchas veces a la vez (por ejemplo 15 rayos):
  // se limitan para que no se amontonen
  const lastPlayed = {};
  const MIN_GAP = { beam: 0.06, special: 0.07, boom: 0.05, match: 0.03, click: 0.04, star: 0.1 };

  const SFX = {
    // tocar un animalito
    select(d, t) {
      osc(d, t, { freq: 880, vol: 0.22, decay: 0.07 });
      osc(d, t, { freq: 1320, vol: 0.05, decay: 0.04 });
    },
    // botones
    click(d, t) {
      osc(d, t, { freq: [520, 760], vol: 0.2, decay: 0.07, glide: 0.04 });
    },
    // intercambio: un "fiu" de aire
    swap(d, t) {
      noise(d, t, { vol: 0.25, attack: 0.03, decay: 0.12, filter: "bandpass", freq: 900, freqTo: 2600, q: 1.5 });
      osc(d, t, { freq: [330, 500], vol: 0.1, decay: 0.12 });
    },
    // jugada que no sirve: dos notitas hacia abajo
    invalid(d, t) {
      osc(d, t, { type: "triangle", freq: 392, vol: 0.14, decay: 0.09 });
      osc(d, t + 0.1, { type: "triangle", freq: 311, vol: 0.14, decay: 0.14 });
    },
    // combinación: notas que suben con cada cascada (combo)
    match(d, t, { combo = 1, count = 3 } = {}) {
      const step = Math.min(combo - 1, 9) * 2;
      const big = count >= 5;
      INSTRUMENTS.marimba(d, t, pentaFreq(step), 0.2, 1.1);
      INSTRUMENTS.marimba(d, t + 0.06, pentaFreq(step + 2), 0.2, 0.9);
      if (big) INSTRUMENTS.marimba(d, t + 0.12, pentaFreq(step + 4), 0.2, 0.8);
      noise(d, t, { vol: 0.04, decay: 0.05, filter: "bandpass", freq: 3000, q: 2 }); // el "pop"
    },
    // explosión de un especial
    boom(d, t, { count = 9 } = {}) {
      const v = Math.min(1, 0.55 + count / 40);
      osc(d, t, { freq: [160, 42], vol: 0.5 * v, decay: 0.3, glide: 0.25 });
      noise(d, t, { vol: 0.22 * v, decay: 0.35, filter: "lowpass", freq: 2500, freqTo: 200 });
      osc(d, t + 0.02, { type: "triangle", freq: [900, 300], vol: 0.05, decay: 0.2 });
    },
    // rayo de un animalito rayado
    beam(d, t) {
      osc(d, t, { type: "square", freq: [500, 1700], vol: 0.08, decay: 0.28, glide: 0.25 });
      osc(d, t, { freq: [1000, 3400], vol: 0.14, decay: 0.25, glide: 0.22 });
      noise(d, t, { vol: 0.16, attack: 0.01, decay: 0.3, filter: "bandpass", freq: 1500, freqTo: 6000, q: 1.2 });
    },
    // nace un especial: destellos
    special(d, t) {
      [84, 88, 91].forEach((m, i) => INSTRUMENTS.musicbox(d, t + i * 0.05, midiToFreq(m), 0.1, 0.7));
    },
    // bomba de color
    bomb(d, t) {
      noise(d, t, { vol: 0.16, attack: 0.25, decay: 0.3, filter: "bandpass", freq: 300, freqTo: 5000, q: 1 });
      osc(d, t, { type: "triangle", freq: [200, 1600], vol: 0.12, attack: 0.25, decay: 0.2, glide: 0.4 });
      [72, 76, 79, 84].forEach((m) => INSTRUMENTS.musicbox(d, t + 0.42, midiToFreq(m), 0.4, 0.8));
      SFX.boom(d, t + 0.4, { count: 30 });
    },
    // estrella ganada durante el nivel (1, 2 o 3)
    star(d, t, { n = 1 } = {}) {
      const base = [76, 79, 84][Math.min(2, Math.max(0, n - 1))];
      INSTRUMENTS.musicbox(d, t, midiToFreq(base), 0.3, 1.2);
      INSTRUMENTS.musicbox(d, t + 0.09, midiToFreq(base + 7), 0.3, 1);
    },
    // estrellas del mensaje final, una por una
    resultStar(d, t, { i = 0 } = {}) {
      const m = [79, 84, 88][i] || 88;
      INSTRUMENTS.musicbox(d, t, midiToFreq(m), 0.4, 1.3);
      osc(d, t, { freq: midiToFreq(m + 12), vol: 0.05, decay: 0.5 });
      noise(d, t, { vol: 0.03, decay: 0.25, freq: 8000 });
    },
    // ganaste el nivel: fanfarria corta
    win(d, t) {
      const notes = [[72, 0], [76, 0.11], [79, 0.22], [84, 0.33], [79, 0.5], [84, 0.62]];
      notes.forEach(([m, dt]) => INSTRUMENTS.marimba(d, t + dt, midiToFreq(m), 0.2, 1.2));
      [60, 64, 67, 72].forEach((m) => INSTRUMENTS.pad(d, t + 0.62, midiToFreq(m), 1.0, 2.5));
      INSTRUMENTS.musicbox(d, t + 0.62, midiToFreq(88), 0.5, 1);
    },
    // perdiste: notitas que bajan, tristes pero tiernas
    lose(d, t) {
      [[76, 0], [74, 0.22], [72, 0.44], [71, 0.66]].forEach(([m, dt], i) =>
        INSTRUMENTS.flute(d, t + dt, midiToFreq(m), i === 3 ? 0.6 : 0.2, 1.3));
      [57, 60, 64].forEach((m) => INSTRUMENTS.pad(d, t + 0.66, midiToFreq(m), 0.9, 2));
    },
    // empieza el Animal Rush
    rush(d, t) {
      for (let i = 0; i < 8; i++) INSTRUMENTS.marimba(d, t + i * 0.045, pentaFreq(i + 2), 0.1, 0.9);
      noise(d, t, { vol: 0.08, attack: 0.3, decay: 0.2, filter: "bandpass", freq: 800, freqTo: 6000, q: 1 });
    },
    // empieza un nivel
    levelStart(d, t) {
      INSTRUMENTS.marimba(d, t, midiToFreq(79), 0.1);
      INSTRUMENTS.marimba(d, t + 0.1, midiToFreq(84), 0.2, 1.1);
    },
    // 🔨 martillo
    hammer(d, t) {
      osc(d, t, { freq: [220, 70], vol: 0.45, decay: 0.18, glide: 0.12 });
      noise(d, t, { vol: 0.12, decay: 0.08, filter: "lowpass", freq: 1800 });
      osc(d, t + 0.02, { freq: 2200, vol: 0.05, decay: 0.12 }); // "clink"
    },
    // 🌀 mezclar
    shuffle(d, t) {
      noise(d, t, { vol: 0.12, attack: 0.15, hold: 0.1, decay: 0.25, filter: "bandpass", freq: 400, freqTo: 3000, q: 2 });
      for (let i = 0; i < 6; i++) INSTRUMENTS.kalimba(d, t + i * 0.06, pentaFreq(8 - i), 0.1, 0.6);
    },
    // +5 movimientos: monedita
    extraMoves(d, t) {
      osc(d, t, { type: "square", freq: midiToFreq(83), vol: 0.12, decay: 0.08 });
      osc(d, t + 0.08, { type: "square", freq: midiToFreq(88), vol: 0.12, decay: 0.3 });
    },
    // premio (power-ups regalados)
    reward(d, t) {
      [79, 83, 86, 91, 95].forEach((m, i) => INSTRUMENTS.musicbox(d, t + i * 0.07, midiToFreq(m), 0.2, 0.8));
    },
    // se pierde una vida
    lifeLost(d, t) {
      osc(d, t, { type: "triangle", freq: [440, 220], vol: 0.18, decay: 0.35, glide: 0.3 });
    },
  };

  function play(name, opts) {
    if (!settings.sfx || !ready() || !SFX[name]) return;
    const t = now() + 0.01;
    const gap = MIN_GAP[name];
    if (gap && lastPlayed[name] && t - lastPlayed[name] < gap) return;
    lastPlayed[name] = t;
    try { SFX[name](sfxBus, t, opts || {}); } catch (e) { /* un sonido nunca debe romper el juego */ }
  }

  // =====================================================================
  // MÚSICA (composiciones originales)
  // =====================================================================
  // Cada canción tiene 8 compases de 4 tiempos; cada compás se escribe en corcheas
  // (8 casillas). Las melodías usan grados de la escala mayor:
  //   "1".."7"  nota de la escala     "'" una octava arriba, "," una octava abajo
  //   "."       sigue sonando la nota anterior       "-"  silencio
  // Los acordes se escriben en números romanos (I, ii, iii, IV, V, vi).
  // Bajo: "R" fundamental, "5" quinta, "O" octava. Percusión: "x" golpe.
  // La canción se repite así: tema, tema, puente (arpegios sobre los mismos acordes).

  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const ROMAN = { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5 };

  const THEMES = {
    // Portada y mapa: vals de cajita de música (en 4/4, tranquilo)
    menu: {
      key: 65, bpm: 84, lead: "musicbox", chordInst: "pad", chordPattern: "x . . . . . . .",
      bass: "R . . . 5 . . .", drums: {},
      chords: ["I", "vi", "ii", "V", "I", "vi", "ii", "V"],
      melody: [
        "5 . 1' . 3' . 2' 1'",
        "1' . 6 . 3 . - .",
        "4 . 6 . 2' . 1' 6",
        "7 . 5 . 2' . - -",
        "5 . 1' . 3' . 5' .",
        "3' . 1' . 6 . 1' .",
        "2' . 4' . 6 . 7 .",
        "2' . . . 5 . 7 .",
      ],
    },
    // Pradera Verde: marimba saltarina
    pradera: {
      key: 60, bpm: 112, lead: "marimba", chordInst: "pluck", chordPattern: "- - x - - - x -",
      bass: "R . 5 . R . 5 .",
      drums: { kick: "x - - - x - - -", shaker: "- x - x - x - x" },
      chords: ["I", "vi", "IV", "V", "I", "vi", "IV", "V"],
      melody: [
        "3 5 1' . 5 . 3 .",
        "6 . 5 . 3 . 1 .",
        "4 6 1' . 6 . 4 .",
        "5 . 7 . 2' . - -",
        "3 5 1' . 5 . 3 5",
        "6 . 1' . 3' . 2' 1'",
        "6 . 4 . 6 . 7 .",
        "2' . 1' 7 5 . - -",
      ],
    },
    // Playa Soleada: tambor metálico con acordes a contratiempo
    playa: {
      key: 67, bpm: 100, lead: "steel", chordInst: "pluck", chordPattern: "- x - x - x - x",
      bass: "R . . 5 R . . 5",
      drums: { kick: "x - - - - - x -", shaker: "x x x x x x x x", conga: "- - - x - - x -" },
      chords: ["I", "V", "vi", "IV", "I", "V", "vi", "IV"],
      melody: [
        "5 . 5 6 5 . 3 .",
        "2 . 5 . 7 . 5 .",
        "6 . 1' . 6 5 3 .",
        "4 . 6 . 1' . . .",
        "3 5 5 . 1' . 5 .",
        "7 . 2' . 5 . 7 .",
        "1' . 6 . 3' . 1' .",
        "6 . 4 . 5 . - -",
      ],
    },
    // Bosque de Hongos: flauta misteriosa pero tierna
    bosque: {
      key: 72, bpm: 90, lead: "flute", chordInst: "pad", chordPattern: "x . . . . . . .",
      bass: "R . . . 5 . . .",
      drums: { hat: "- - x - - - x -" },
      chords: ["vi", "IV", "I", "V", "vi", "IV", "I", "V"],
      melody: [
        "3 . 2 1 6, . 1 .",
        "4 . 3 . 1 . 6, .",
        "5 . 3 . 1 . 3 .",
        "2 . . 5, 7, . - -",
        "3 . 2 1 6, . 3 .",
        "4 . 6 . 1' . 6 .",
        "5 . 3 . 2 . 1 .",
        "7, . 2 . 5 . - -",
      ],
    },
    // Selva Tropical: kalimba con tambores
    selva: {
      key: 65, bpm: 120, lead: "kalimba", chordInst: "pluck", chordPattern: "- - x - - x - -",
      bass: "R - R 5 - R 5 -",
      drums: { kick: "x - - x - - x -", conga: "- x - - x - x x", shaker: "x - x - x - x -" },
      chords: ["I", "IV", "vi", "V", "I", "IV", "vi", "V"],
      melody: [
        "1' 1' 5 . 6 5 3 .",
        "4 . 6 . 1' . 6 .",
        "3' . 1' . 6 . 1' .",
        "7 . 5 . 2' . - .",
        "1' 1' 5 . 6 5 3 5",
        "6 . 1' . 4' . 3' 2'",
        "1' . 6 . 3 . 6 .",
        "5 . 7 . 2' . 1' .",
      ],
    },
  };
  // Los mundos que todavía no tienen canción propia usan otra con otro tono e instrumento
  THEMES.desierto = { ...THEMES.selva, key: 62, bpm: 108, lead: "steel" };
  THEMES.nieve = { ...THEMES.menu, key: 70, bpm: 92, chordInst: "pluck", chordPattern: "x - x - x - x -" };
  THEMES.nubes = { ...THEMES.pradera, key: 65, bpm: 104, lead: "musicbox" };

  // Convierte "5 . 1' -" en notas con duración (en corcheas)
  function parseLine(line) {
    const tokens = line.trim().split(/\s+/);
    const notes = [];
    tokens.forEach((tok, i) => {
      if (tok === "." || tok === "-") return;
      let len = 1;
      while (tokens[i + len] === ".") len++;
      notes.push({ step: i, len, tok });
    });
    return notes;
  }

  // Grado de la escala (con octavas) a nota MIDI
  function degreeToMidi(tok, key) {
    const m = tok.match(/^(\d)([',]*)$/);
    if (!m) return null;
    const deg = Number(m[1]) - 1;
    let octave = 0;
    for (const c of m[2]) octave += c === "'" ? 1 : -1;
    return key + SCALE[deg] + 12 * octave;
  }

  // Notas del acorde (fundamental, tercera, quinta) en MIDI
  function chordMidi(roman, key) {
    const d = ROMAN[roman];
    return [0, 2, 4].map((k) => {
      const idx = d + k;
      return key + SCALE[idx % 7] + 12 * Math.floor(idx / 7);
    });
  }

  // Prepara una canción: precalcula todas las notas de cada compás
  function compile(theme) {
    const bars = theme.chords.map((roman, b) => {
      let chord = chordMidi(roman, theme.key - 12);
      while (chord[0] < 52) chord = chord.map((m) => m + 12); // que no quede muy grave
      while (chord[0] > 63) chord = chord.map((m) => m - 12);
      const root = chord[0] - 12; // bajo una octava más abajo
      return {
        chord,
        melody: parseLine(theme.melody[b]).map((n) => ({ ...n, midi: degreeToMidi(n.tok, theme.key) })),
        bass: parseLine(theme.bass).map((n) => ({
          ...n, midi: n.tok === "5" ? root + 7 : n.tok === "O" ? root + 12 : root,
        })),
        chords: parseLine(theme.chordPattern),
        // puente: arpegio de corcheas sobre el acorde
        arp: [0, 1, 2, 1, 2, 0, 1, 2].map((k, i) => ({
          step: i, len: 1, midi: chord[k] + 12 + (i === 4 ? 12 : 0),
        })),
      };
    });
    const drums = Object.entries(theme.drums || {}).map(([name, pattern]) => ({
      name, hits: pattern.trim().split(/\s+/).map((x) => x === "x"),
    }));
    return { ...theme, bars, drums };
  }

  const compiled = {};
  const themeFor = (id) => (compiled[id] = compiled[id] || compile(THEMES[id] || THEMES.pradera));

  // ---------- Reproductor con "mirada hacia adelante" ----------
  // Cada 25 ms se programan las notas de los próximos 120 ms: así el ritmo
  // queda exacto aunque el navegador esté ocupado animando el tablero.
  const LOOKAHEAD = 0.12;
  const SECTIONS = ["melody", "melody", "arp"]; // tema, tema, puente

  let wantedTheme = null; // la canción que debería sonar (aunque aún no se pueda)
  let current = null;     // { id, theme, out, step, next, timer }

  function scheduleStep(song, t) {
    const { theme } = song;
    const barCount = theme.bars.length;
    const totalSteps = barCount * 8;
    const sectionIdx = Math.floor(song.step / totalSteps) % SECTIONS.length;
    const section = SECTIONS[sectionIdx];
    const barIdx = Math.floor(song.step / 8) % barCount;
    const pos = song.step % 8;
    const bar = theme.bars[barIdx];
    const eighth = 60 / theme.bpm / 2;
    const out = song.out;
    const lead = INSTRUMENTS[theme.lead];

    const lineNotes = section === "arp" ? bar.arp : bar.melody;
    for (const n of lineNotes) {
      if (n.step === pos && n.midi != null) {
        lead(out, t, midiToFreq(n.midi), n.len * eighth, section === "arp" ? 0.55 : 1);
      }
    }
    for (const n of bar.bass) {
      if (n.step === pos) INSTRUMENTS.bass(out, t, midiToFreq(n.midi), n.len * eighth);
    }
    for (const n of bar.chords) {
      if (n.step === pos) {
        for (const m of bar.chord) INSTRUMENTS[theme.chordInst](out, t, midiToFreq(m), n.len * eighth);
      }
    }
    for (const d of theme.drums) {
      if (d.hits[pos]) DRUMS[d.name](out, t);
    }
  }

  function tick(song) {
    if (current !== song || !ctx) return;
    while (song.next < now() + LOOKAHEAD) {
      if (song.next < now() - 0.2) song.next = now() + 0.05; // se atrasó (pestaña dormida)
      scheduleStep(song, song.next);
      song.next += 60 / song.theme.bpm / 2;
      song.step++;
    }
  }

  function stopCurrent(fade = 0.6) {
    if (!current) return;
    const song = current;
    current = null;
    clearInterval(song.timer);
    const t = now();
    song.out.gain.cancelScheduledValues(t);
    song.out.gain.setValueAtTime(song.out.gain.value, t);
    song.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => song.out.disconnect(), (fade + 1.5) * 1000);
  }

  function startTheme(id) {
    if (!ctx || !unlocked) return;
    if (current && current.id === id) return;
    stopCurrent();
    const theme = themeFor(id);
    const out = ctx.createGain();
    const t = now();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(1, t + 1.2);
    out.connect(musicBus);
    const song = { id, theme, out, step: 0, next: t + 0.15 };
    song.timer = setInterval(() => tick(song), 25);
    current = song;
    tick(song);
  }

  // Cambia la canción. null = silencio (con un desvanecido corto)
  function music(id) {
    wantedTheme = id;
    if (!ctx || !unlocked) return;
    if (id) startTheme(id);
    else stopCurrent(0.5);
  }

  // ---------- Preferencias ----------
  function fadeBus(bus, on, vol) {
    if (!ctx) return;
    const t = now();
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(on ? vol : 0, t + 0.25);
  }

  function setMusic(on) {
    settings.music = !!on;
    saveSettings();
    fadeBus(musicBus, settings.music, VOLUME.music);
  }

  function setSfx(on) {
    settings.sfx = !!on;
    saveSettings();
    fadeBus(sfxBus, settings.sfx, VOLUME.sfx);
  }

  return { play, music, settings, setMusic, setSfx, themes: Object.keys(THEMES) };
})();
