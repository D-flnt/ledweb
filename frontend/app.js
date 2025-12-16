const state = {
  effects: [],
  presets: [],
  zones: [],
  alarms: { alarms: [], timers: [] },
  ui: {},
  hardware: {},
  audio: {},
  current: {
    on: true,
    brightness: 180,
    effect: "rainbow_cycle",
    fps: 60,
    intensity_boost: 1,
    max_leds: 300,
    effect_params: {},
    params: {},
    live: { master_speed: 1, frame_blend: 0.15, gamma: 1, direction: "forward", dither: true, dither_strength: 0.3 },
    frame_preview: [],
    segments: [],
  },
  ws: null,
  token: localStorage.getItem("led_token") || "",
};

// UI/themes/viz helpers
const defaultThemes = [
  {
    id: "neon-night",
    name: "Neon Night",
    palette: ["#32ffe0", "#7c3aed", "#ff61d6"],
    background: "#05070f",
    accent: "#32ffe0",
    panel: "rgba(16, 20, 35, 0.85)",
  },
  {
    id: "sunset",
    name: "Sunset Fade",
    palette: ["#ff8b5f", "#ff3f81", "#ffd86f"],
    background: "#0f0a1f",
    accent: "#ff8b5f",
    panel: "rgba(24, 16, 40, 0.9)",
  },
  {
    id: "glacier",
    name: "Glacier",
    palette: ["#7cd5ff", "#5cf2c8", "#c2e9ff"],
    background: "#031018",
    accent: "#7cd5ff",
    panel: "rgba(10, 24, 32, 0.9)",
  },
  {
    id: "amber-club",
    name: "Amber Club",
    palette: ["#ffb347", "#ff61d6", "#ffd700"],
    background: "#120800",
    accent: "#ffb347",
    panel: "rgba(34, 18, 8, 0.9)",
  },
];

function loadUserThemes() {
  try {
    return JSON.parse(localStorage.getItem("led_themes") || "[]");
  } catch (e) {
    console.warn("Kon user themes niet laden", e);
    return [];
  }
}

let userThemes = loadUserThemes();
const defaultLive = { master_speed: 1, frame_blend: 0.15, gamma: 1, direction: "forward", dither: true, dither_strength: 0.3 };
let lastBrightnessBeforeKill = null;
const audioPresets = {
  calm: { gain: 3, smoothing: 0.5, beat_threshold: 0.45 },
  club: { gain: 5.5, smoothing: 0.25, beat_threshold: 0.28 },
  live: { gain: 4.2, smoothing: 0.35, beat_threshold: 0.35 },
};
function ensureLive() {
  state.current.live = { ...defaultLive, ...(state.current.live || {}) };
  return state.current.live;
}

function getEffectParams() {
  const params = state.current.effect_params || state.current.params || {};
  state.current.effect_params = params;
  state.current.params = params;
  return params;
}

function setEffectParams(next) {
  state.current.effect_params = { ...next };
  state.current.params = state.current.effect_params;
  return state.current.effect_params;
}

function mergeEffectParams(extra) {
  return setEffectParams({ ...getEffectParams(), ...extra });
}

const vizState = {
  audioLevels: new Array(16).fill(0),
  audioTargets: new Array(16).fill(0),
  vol: 0,
  beat: false,
};
const ledVizState = { phase: 0, lastTs: 0, time: 0 };
const effectPreviewRegistry = new Map(); // effectId -> { canvas, effect }
const dragging = new Set(); // track sliders being dragged
const livePresets = {
  calm: {
    brightness: 140,
    intensity_boost: 1,
    fps: 60,
    live: { master_speed: 0.8, frame_blend: 0.6, gamma: 1.12, direction: "forward", dither_strength: 0.2 },
  },
  bright: {
    brightness: 200,
    intensity_boost: 1.2,
    fps: 75,
    live: { master_speed: 1.3, frame_blend: 0.35, gamma: 1.0, direction: "forward", dither_strength: 0.25 },
  },
  party: {
    brightness: 235,
    intensity_boost: 1.4,
    fps: 90,
    live: { master_speed: 1.9, frame_blend: 0.22, gamma: 0.95, direction: "forward", dither_strength: 0.35 },
  },
};
let liveDefaults = null;

function registerDragGuard(el) {
  if (!el) return;
  const id = "#" + (el.id || Math.random().toString(36).slice(2));
  const start = () => dragging.add(id);
  const stop = () => dragging.delete(id);
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("pointerleave", stop);
  // also on window to be safe
  window.addEventListener("pointerup", stop);
}

function sliderPercent(el) {
  if (!el) return 0;
  const min = parseFloat(el.min || 0);
  const max = parseFloat(el.max || 100);
  const val = parseFloat(el.value || min);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
  return ((val - min) / (max - min)) * 100;
}

function updateSliderFill(el) {
  if (!el) return;
  const pct = Math.max(0, Math.min(100, sliderPercent(el)));
  el.style.setProperty("--percent", pct);
}

function updateSliderTooltip(id, value) {
  const tip = document.querySelector(`.slider-tooltip[data-tooltip-for="${id.replace("#", "")}"]`);
  if (tip) tip.textContent = value;
}

function enhanceSlider(el) {
  if (!el || el.dataset.enhanced) return;
  registerDragGuard(el);
  const sync = () => updateSliderFill(el);
  el.addEventListener("input", sync);
  el.addEventListener("change", sync);
  el.addEventListener("pointerdown", () => el.classList.add("sliding"));
  const stop = () => el.classList.remove("sliding");
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("pointerleave", stop);
  sync();
  el.dataset.enhanced = "1";
}

const qs = (sel) => document.querySelector(sel);
function syncSliderNumber(sliderId, numberId, onChange) {
  const slider = qs(sliderId);
  const number = qs(numberId);
  if (!slider || !number) return;
  enhanceSlider(slider);
  const clampInput = (el, val) => {
    const min = parseFloat(el.min || "-Infinity");
    const max = parseFloat(el.max || "Infinity");
    const step = parseFloat(el.step || "0") || null;
    let v = Number(val);
    if (Number.isNaN(v)) v = min;
    v = Math.min(max, Math.max(min, v));
    if (step) v = Math.round(v / step) * step;
    return v;
  };
  const setBoth = (val, from) => {
    if (from !== "slider") slider.value = val;
    if (from !== "number") number.value = val;
    updateSliderFill(slider);
    updateSliderTooltip(sliderId, val);
    onChange(val);
  };
  slider.addEventListener("input", () => setBoth(clampInput(slider, slider.value), "slider"));
  number.addEventListener("input", () => setBoth(clampInput(number, number.value), "number"));
  setBoth(clampInput(slider, slider.value), null);
}
let playlistTimer = null;
let playlistActive = false;
let playlistBusy = false;
let beatFlashTimer = null;
const playlists = {
  party: ["rainbow_cycle", "matrix_rain", "warp_speed", "confetti", "strobe_on_beat"],
  smooth: ["sunrise", "soft_wave", "sparkle_wave", "breathing", "aurora", "super_smooth"],
  audio: ["audio_bars", "energy_wave", "bass_pulse", "fire_audio", "spectrum_stream", "beat_wave", "haze_pulse", "prism_bass"],
};

function getActiveEffect() {
  return state.effects.find((e) => e.name === state.current.effect);
}

function getEffectBaseSpeed() {
  const eff = getActiveEffect();
  const name = (eff?.name || "").toLowerCase();
  let base = eff?.default_params?.speed ?? 1;
  if (name.includes("wipe") || name.includes("colorwipe") || name.includes("color_wipe") || name.includes("comet") || name.includes("theater")) {
    base = Math.max(base, 1.2);
  }
  return Math.max(0.5, base);
}

function showAuth(message = "Voer je wachtwoord in om te verbinden.") {
  const modal = qs("#auth-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  const msg = qs("#auth-message");
  if (msg) msg.textContent = message;
  const input = qs("#auth-password");
  if (input) input.focus();
}

function hideAuth() {
  const modal = qs("#auth-modal");
  if (modal) modal.classList.add("hidden");
}

function forceReauth(message = "Sessie verlopen, log opnieuw in.") {
  state.token = "";
  localStorage.removeItem("led_token");
  showAuth(message);
}

async function api(path, method = "GET", body, opts = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.token && !opts.skipAuth ? { "X-Session-Token": state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    forceReauth("Sessie verlopen of ongeldig. Log opnieuw in.");
  }
  if (!res.ok) {
    const msg = await res.text();
    const err = new Error(msg || "Request failed");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadStatus() {
  const data = await api("/api/status");
  state.effects = data.effects;
  state.presets = data.presets;
  state.zones = data.zones;
  state.alarms = data.alarms;
  state.ui = data.ui;
  state.hardware = data.hardware || {};
  state.audio = data.audio || {};
  state.current = data.state;
  // normalise structure
  state.current.effect_params = state.current.effect_params || state.current.params || {};
  state.current.params = state.current.effect_params;
  state.current.live = { ...defaultLive, ...(state.current.live || {}) };
  state.current.frame_preview = state.current.frame_preview || [];
  state.current.fps = state.current.fps ?? 60;
  state.current.intensity_boost = state.current.intensity_boost ?? 1;
  const defaultMax = state.hardware?.led_count || ((state.current.segments?.[0]?.end ?? 299) + 1);
  state.current.max_leds = state.current.max_leds ?? defaultMax;
  captureLiveDefaults();
  state.ui.speed_multiplier = deriveSpeedMultiplier();
  renderThemeSelector();
  applyInitialTheme();
  renderEffects();
  renderAudioSelect();
  setUiValues();
  updateAudioTargets(state.audio || {});
  startVizLoops();
  connectWs();
  renderEffectPresets();
  renderAllPresets();
}

function connectWs() {
  if (!state.token) return;
  if (state.ws) state.ws.close();
  const ws = new WebSocket(`${location.origin.replace("http", "ws")}/ws?token=${state.token}`);
  ws.onmessage = (evt) => {
    const payload = JSON.parse(evt.data);
    state.current = payload.state;
    state.current.effect_params = state.current.effect_params || state.current.params || {};
    state.current.params = state.current.effect_params;
    state.current.live = { ...defaultLive, ...(state.current.live || {}) };
    state.current.frame_preview = state.current.frame_preview || [];
    state.current.fps = state.current.fps ?? 60;
    state.current.intensity_boost = state.current.intensity_boost ?? 1;
    const ledTotal = state.hardware?.led_count || ((state.current.segments?.[0]?.end ?? 299) + 1);
    state.current.max_leds = state.current.max_leds ?? ledTotal;
    captureLiveDefaults();
    state.ui.speed_multiplier = deriveSpeedMultiplier();
    state.audio = payload.audio;
    updateAudioTargets(state.audio);
    setUiValues();
    updateLive();
    renderEffectPresets();
    ws.send("ok");
  };
  ws.onclose = (evt) => {
    if (evt.code === 4401 || evt.code === 4403 || evt.code === 1008 || evt.code === 403) {
      forceReauth("Sessie verlopen, log opnieuw in.");
      return;
    }
    setTimeout(connectWs, 2000);
  };
  state.ws = ws;
}

function captureLiveDefaults() {
  if (liveDefaults) return;
  const live = ensureLive();
  const ledTotal = state.hardware?.led_count || ((state.current.segments?.[0]?.end ?? 299) + 1);
  liveDefaults = {
    brightness: clampNumber(state.current.brightness ?? 180, 0, 255),
    intensity_boost: clampNumber(state.current.intensity_boost ?? 1, 0.5, 3),
    fps: clampNumber(state.current.fps ?? 60, 20, 240),
    max_leds: clampNumber(state.current.max_leds ?? ledTotal, 1, ledTotal),
    live: {
      master_speed: live.master_speed ?? 1,
      frame_blend: live.frame_blend ?? live.smoothing ?? 0,
      gamma: live.gamma ?? 1.0,
      direction: live.direction ?? "forward",
      dither_strength: live.dither_strength ?? 0.3,
      dither: live.dither ?? false,
    },
  };
}

function deriveSpeedMultiplier() {
  const live = ensureLive();
  return clampNumber(live.master_speed ?? 1, 0, 8);
}

function resetControl(key) {
  if (!liveDefaults) captureLiveDefaults();
  const def = liveDefaults || {};
  const live = ensureLive();
  const ledTotal = state.hardware?.led_count || ((state.current.segments?.[0]?.end ?? 299) + 1);
  const applyDual = (id, val) => {
    const slider = qs(`#${id}`);
    const num = qs(`#${id}-num`);
    if (slider) {
      slider.value = val;
      updateSliderFill(slider);
    }
    if (num) num.value = val;
    updateSliderTooltip(`#${id}`, val);
  };
  switch (key) {
    case "brightness": {
      const val = clampNumber(def.brightness ?? 180, 0, 255);
      state.current.brightness = val;
      applyDual("brightness", val);
      qs("#brightness-val").textContent = val;
      pushState({ brightness: val });
      updateStats();
      break;
    }
    case "intensity-boost": {
      const val = clampNumber(def.intensity_boost ?? 1, 0.5, 3);
      state.current.intensity_boost = val;
      applyDual("intensity-boost", val);
      qs("#intensity-boost-val").textContent = `${val.toFixed(2)}x`;
      pushState({ intensity_boost: val });
      break;
    }
    case "max-leds": {
      const fallback = state.current.max_leds ?? ledTotal;
      const val = clampNumber(def.max_leds ?? fallback, 1, ledTotal);
      state.current.max_leds = val;
      const input = qs("#max-leds");
      if (input) input.value = val;
      qs("#max-leds-val").textContent = `${val} leds`;
      pushState({ max_leds: val });
      break;
    }
    case "fps": {
      const val = clampNumber(def.fps ?? 60, 20, 240);
      state.current.fps = val;
      applyDual("fps", val);
      qs("#fps-val").textContent = `${val} fps`;
      pushState({ fps: val });
      break;
    }
    case "live-speed": {
      const val = clampNumber(def.live?.master_speed ?? 1, 0, 8);
      live.master_speed = val;
      state.current.live = live;
      applyDual("live-speed", val);
      qs("#live-speed-val").textContent = `${val.toFixed(2)}x`;
      pushState({ live });
      break;
    }
    case "live-smoothing": {
      const val = clampNumber(def.live?.frame_blend ?? def.live?.smoothing ?? 0.15, 0, 1);
      live.frame_blend = val;
      live.smoothing = val;
      state.current.live = live;
      applyDual("live-smoothing", val);
      qs("#live-smoothing-val").textContent = val.toFixed(2);
      pushState({ live });
      break;
    }
    case "live-gamma": {
      const val = clampNumber(def.live?.gamma ?? 1, 0.3, 2.5);
      live.gamma = val;
      state.current.live = live;
      applyDual("live-gamma", val);
      qs("#live-gamma-val").textContent = val.toFixed(2);
      pushState({ live });
      break;
    }
    case "live-fade": {
      const val = clampNumber(def.live?.dither_strength ?? 0.3, 0, 1);
      live.dither_strength = val;
      live.dither = val > 0.05;
      state.current.live = live;
      applyDual("live-fade", val);
      qs("#live-fade-val").textContent = val.toFixed(2);
      pushState({ live });
      break;
    }
    default:
      break;
  }
}

function setUiValues() {
  if (!dragging.has("#brightness")) qs("#brightness").value = state.current.brightness ?? 180;
  qs("#brightness-val").textContent = state.current.brightness ?? 180;
  updateSliderTooltip("#brightness", state.current.brightness ?? 180);
  const brightNum = qs("#brightness-num");
  if (brightNum && !dragging.has("#brightness")) brightNum.value = state.current.brightness ?? 180;
  const ledTotal = state.hardware?.led_count || ((state.current.segments?.[0]?.end ?? 299) + 1);
  const maxLedInput = qs("#max-leds");
  if (maxLedInput) {
    maxLedInput.max = ledTotal;
    const val = clampNumber(state.current.max_leds ?? ledTotal, 1, ledTotal);
    maxLedInput.value = val;
    qs("#max-leds-val").textContent = `${val} leds`;
  }
  const boostInput = qs("#intensity-boost");
  const boostVal = state.current.intensity_boost ?? 1;
  if (boostInput) {
    if (!dragging.has("#intensity-boost")) boostInput.value = boostVal;
    qs("#intensity-boost-val").textContent = `${boostVal.toFixed(2)}x`;
    updateSliderTooltip("#intensity-boost", boostVal);
    const boostNum = qs("#intensity-boost-num");
    if (boostNum && !dragging.has("#intensity-boost")) boostNum.value = boostVal;
  }
  const fpsInput = qs("#fps");
  const fpsVal = state.current.fps ?? 60;
  if (fpsInput) {
    if (!dragging.has("#fps")) fpsInput.value = fpsVal;
    qs("#fps-val").textContent = `${fpsVal} fps`;
    updateSliderTooltip("#fps", fpsVal);
    const fpsNum = qs("#fps-num");
    if (fpsNum && !dragging.has("#fps")) fpsNum.value = fpsVal;
  }
  const live = ensureLive();
  const params = getEffectParams();
  const speedVal = live.master_speed ?? 1;
  const speedInput = qs("#live-speed");
  const minSpeed = speedInput ? parseFloat(speedInput.min) || 0 : 0;
  const maxSpeed = speedInput ? parseFloat(speedInput.max) || 8 : 8;
  const speedMult = clampNumber(speedVal, minSpeed, maxSpeed);
  state.ui.speed_multiplier = speedMult;
  const smoothingVal = live.frame_blend ?? live.smoothing ?? 0.0;
  const gammaVal = live.gamma ?? 1.0;
  const ditherVal = live.dither_strength ?? (live.dither ? 0.3 : 0);
  const dirVal = live.direction ?? "forward";
  if (speedInput) {
    if (!dragging.has("#live-speed")) speedInput.value = speedMult;
    qs("#live-speed-val").textContent = `${speedMult.toFixed(2)}x`;
    updateSliderTooltip("#live-speed", speedMult);
    const speedNum = qs("#live-speed-num");
    if (speedNum && !dragging.has("#live-speed")) speedNum.value = speedMult;
  }
  if (qs("#live-smoothing")) {
    if (!dragging.has("#live-smoothing")) qs("#live-smoothing").value = smoothingVal;
    qs("#live-smoothing-val").textContent = smoothingVal.toFixed(2);
    updateSliderTooltip("#live-smoothing", smoothingVal);
    const smNum = qs("#live-smoothing-num");
    if (smNum && !dragging.has("#live-smoothing")) smNum.value = smoothingVal;
  }
  if (qs("#live-gamma")) {
    if (!dragging.has("#live-gamma")) qs("#live-gamma").value = gammaVal;
    qs("#live-gamma-val").textContent = gammaVal.toFixed(2);
    updateSliderTooltip("#live-gamma", gammaVal);
    const gammaNum = qs("#live-gamma-num");
    if (gammaNum && !dragging.has("#live-gamma")) gammaNum.value = gammaVal;
  }
  if (qs("#live-fade")) {
    if (!dragging.has("#live-fade")) qs("#live-fade").value = ditherVal;
    qs("#live-fade-val").textContent = ditherVal.toFixed(2);
    updateSliderTooltip("#live-fade", ditherVal);
    const fadeNum = qs("#live-fade-num");
    if (fadeNum && !dragging.has("#live-fade")) fadeNum.value = ditherVal;
  }
  if (qs("#live-direction")) qs("#live-direction").value = dirVal;
  qs("#color").value = rgbToHex(params.color || [50, 255, 224]);
  const gain = state.audio.gain ?? state.audio.settings?.gain ?? 4;
  const smooth = state.audio.smoothing ?? state.audio.settings?.smoothing ?? 0.35;
  const beat = state.audio.beat_threshold ?? state.audio.settings?.beat_threshold ?? 0.35;
  const enabled = state.audio.enabled ?? true;
  if (qs("#audio-sens")) qs("#audio-sens").value = gain;
  if (qs("#audio-smooth")) qs("#audio-smooth").value = smooth;
  if (qs("#audio-beat")) qs("#audio-beat").value = beat;
  const audioToggle = qs("#audio-toggle");
  if (audioToggle) audioToggle.textContent = enabled ? "Uitschakelen" : "Inschakelen";
  const effToggle = qs("#effect-toggle");
  if (effToggle) effToggle.textContent = state.current.on ? "Stop effect" : "Start effect";
  syncColorEditors();
  document.querySelectorAll(".slider").forEach(updateSliderFill);
  updateStats();
}

function rgbToHex(rgb) {
  const [r, g, b] = rgb;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function rgbToHsv([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

function hsvToRgb(h, s, v) {
  h /= 360;
  s /= 100;
  v /= 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0:
      (r = v), (g = t), (b = p);
      break;
    case 1:
      (r = q), (g = v), (b = p);
      break;
    case 2:
      (r = p), (g = v), (b = t);
      break;
    case 3:
      (r = p), (g = q), (b = v);
      break;
    case 4:
      (r = t), (g = p), (b = v);
      break;
    default:
      (r = v), (g = p), (b = q);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function clampNumber(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function debounce(fn, wait = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const pushState = debounce((body) => api("/api/state", "POST", body), 80);
const pushEffectUpdate = debounce((body) => api("/api/effect", "POST", body).catch((err) => console.error("Effect update failed", err)), 90);
const pushUi = debounce((cfg) => api("/api/ui", "POST", cfg), 200);

function allThemes() {
  return [...defaultThemes, ...userThemes];
}

function applyTheme(id, persist = true) {
  const theme = allThemes().find((t) => t.id === id) || defaultThemes[0];
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--panel", theme.panel);
  root.style.setProperty("--panel-2", theme.panel);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-2", theme.palette[1] || theme.accent);
  if (persist) localStorage.setItem("led_theme_active", theme.id);
  pushUi({ ...(state.ui || {}), accent: theme.accent });
}

function renderThemeSelector() {
  const sel = qs("#theme-select");
  if (!sel) return;
  const options = allThemes()
    .map((t) => `<option value="${t.id}">${t.name}</option>`)
    .join("");
  const current = localStorage.getItem("led_theme_active") || defaultThemes[0].id;
  sel.innerHTML = options;
  sel.value = current;
  sel.onchange = () => applyTheme(sel.value);
}

function applyInitialTheme() {
  const saved = localStorage.getItem("led_theme_active");
  const fallback = defaultThemes[0]?.id;
  applyTheme(saved || fallback, false);
}

function persistThemes(newList) {
  userThemes = newList;
  localStorage.setItem("led_themes", JSON.stringify(userThemes));
  renderThemeSelector();
}

function duplicateTheme() {
  const sel = qs("#theme-select");
  if (!sel) return;
  const source = allThemes().find((t) => t.id === sel.value);
  if (!source) return;
  const id = `${source.id}-copy-${Date.now().toString(36)}`;
  const copy = { ...source, id, name: `${source.name} kopie` };
  persistThemes([...userThemes, copy]);
  sel.value = id;
  applyTheme(id);
}

function renameTheme() {
  const sel = qs("#theme-select");
  if (!sel) return;
  const currentId = sel.value;
  const existing = userThemes.find((t) => t.id === currentId);
  if (!existing) {
    alert("Alleen eigen thema's kunnen hernoemd worden.");
    return;
  }
  const name = prompt("Nieuwe naam voor thema:", existing.name);
  if (!name) return;
  persistThemes(userThemes.map((t) => (t.id === currentId ? { ...t, name } : t)));
  sel.value = currentId;
  applyTheme(currentId);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportBackup() {
  const snapshot = await api("/api/status");
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    themes: allThemes(),
    ui: snapshot.ui,
    presets: snapshot.presets,
    zones: snapshot.zones,
    hardware: snapshot.hardware,
  };
  downloadJson(`ledweb-backup-${Date.now()}.json`, payload);
}

async function importBackup(jsonText) {
  const payload = JSON.parse(jsonText);
  if (!payload) throw new Error("Ongeldige back-up");
  if (payload.themes) {
    const custom = payload.themes.filter((t) => !defaultThemes.find((d) => d.id === t.id));
    persistThemes(custom);
  }
  if (payload.ui) {
    await api("/api/ui", "POST", payload.ui);
  }
  if (payload.zones) {
    await api("/api/segments", "POST", payload.zones);
  }
  if (payload.presets) {
    for (const p of payload.presets) {
      await api("/api/presets/save", "POST", p);
    }
  }
  await loadStatus();
  renderEffectPresets();
}

function updateAudioTargets(audio) {
  const baseLevels = audio?.bands && audio.bands.length ? audio.bands : new Array(8).fill(0);
  const levels = [...baseLevels, ...baseLevels.slice().reverse()];
  vizState.audioTargets = levels;
  vizState.beat = !!audio?.beat;
  vizState.vol = audio?.vol || 0;
}

function startVizLoops() {
  if (vizState._started) return;
  vizState._started = true;
  const loop = () => {
    for (let i = 0; i < vizState.audioLevels.length; i++) {
      const target = vizState.audioTargets[i] ?? 0;
      const current = vizState.audioLevels[i] ?? 0;
      vizState.audioLevels[i] = current + (target - current) * 0.2;
    }
    drawAudioViz();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const ledLoop = (ts) => {
    if (!ledVizState.lastTs) ledVizState.lastTs = ts;
    const dt = (ts - ledVizState.lastTs) / 1000;
    ledVizState.lastTs = ts;
    const speed = Math.max(0.05, state.current.live?.master_speed || 1);
    ledVizState.phase = (ledVizState.phase + dt * (speed / 6)) % 1;
    ledVizState.time += dt;
    drawLedViz();
    requestAnimationFrame(ledLoop);
  };
  requestAnimationFrame(ledLoop);

  const effectLoop = (ts) => {
    const t = ts / 1000;
    effectPreviewRegistry.forEach(({ canvas, effect }) => {
      if (!canvas.isConnected) return;
      drawEffectPreview(canvas, effect, t);
    });
    requestAnimationFrame(effectLoop);
  };
  requestAnimationFrame(effectLoop);
}

function drawAudioViz() {
  const canvas = qs("#audio-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  const levels = vizState.audioLevels;
  const barW = w / levels.length;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(76,246,216,0.9)");
  grad.addColorStop(1, "rgba(124,58,237,0.7)");
  levels.forEach((lvl, i) => {
    const val = Math.max(0, Math.min(1, lvl));
    const barH = val * h;
    ctx.fillStyle = grad;
    ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
  });
  if (vizState.beat) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < levels.length; i++) {
    const x = (i / (levels.length - 1)) * w;
    const y = h / 2 - (levels[i] - 0.5) * (h * 0.4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function colorFromParams(params = {}) {
  if (params.color) return rgbToHex(params.color);
  if (params.colors && params.colors.length) return rgbToHex(params.colors[0]);
  if (params.palette === "neon") return "#7c3aed";
  return "#32ffe0";
}

function paletteColors(name = "neon") {
  const map = {
    neon: ["#32ffe0", "#7c3aed", "#ff61d6"],
    sunset: ["#ff8b5f", "#ff3f81", "#ffd86f"],
    ocean: ["#0087ff", "#00c6ff", "#7cf2c8"],
    fire: ["#ff8b3d", "#ff3b1f", "#ffd86f"],
    pastel: ["#ffe0f0", "#c8f5ff", "#d8ffd9"],
  };
  return map[name] || map.neon;
}

function adjustHex(hex, factor = 1) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.min(255, Math.max(0, Math.round(c * factor))));
  return rgbToHex([r, g, b]);
}

function effectPalette(effect) {
  const params = effect.default_params || {};
  if (params.color) return [rgbToHex(params.color)];
  if (params.colors && params.colors.length) return params.colors.map((c) => (Array.isArray(c) ? rgbToHex(c) : String(c)));
  if (params.palette) return paletteColors(params.palette);
  return paletteColors("neon");
}

function lerpColor(a, b, t) {
  const [r1, g1, b1] = Array.isArray(a) ? a : hexToRgb(a);
  const [r2, g2, b2] = Array.isArray(b) ? b : hexToRgb(b);
  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

function simulateEffectPixels(effect, length, t) {
  const name = (effect.name || "").toLowerCase();
  const paletteRaw = effectPalette(effect);
  const palette = (paletteRaw && paletteRaw.length) ? paletteRaw : paletteColors("neon");
  const speed = Math.max(0.2, effect.default_params?.speed || 1);
  const off = "#0a1220";
  const colors = new Array(length).fill(off);
  const pick = (idx) => palette[idx % palette.length] || palette[0] || "#32ffe0";

  const setPixel = (i, col) => {
    if (i >= 0 && i < length) colors[i] = Array.isArray(col) ? rgbToHex(col) : col;
  };

  if (name.includes("rainbow") || name.includes("gradient") || name === "palette_flow") {
    for (let i = 0; i < length; i++) {
      const phase = (t * speed * 0.5 + i / length) % 1;
      const idx = Math.floor(phase * palette.length);
      const next = palette[(idx + 1) % palette.length];
      const mix = lerpColor(pick(idx), next, (phase * palette.length) % 1);
      setPixel(i, mix);
    }
  } else if (name.includes("breath") || name.includes("pulse")) {
    const pulse = 0.35 + 0.65 * (Math.sin(t * speed * 2 * Math.PI) * 0.5 + 0.5);
    for (let i = 0; i < length; i++) setPixel(i, adjustHex(pick(0), pulse));
  } else if (name.includes("strobe") || name.includes("blink")) {
    const on = Math.sin(t * speed * 6) > 0;
    for (let i = 0; i < length; i++) setPixel(i, on ? pick(0) : adjustHex(pick(0), 0.15));
  } else if (name.includes("wipe") || name.includes("theater") || name.includes("knight")) {
    const head = Math.floor((t * speed * length) % length);
    const tail = Math.max(4, Math.floor(length * 0.05));
    for (let i = 0; i < length; i++) {
      const d = Math.abs(i - head);
      const fade = d <= tail ? Math.pow(1 - d / tail, 1.5) : 0;
      setPixel(i, adjustHex(pick(0), 0.25 + fade));
    }
  } else if (name.includes("comet")) {
    const head = Math.floor((t * speed * (length + 10)) % (length + 10));
    const tail = Math.max(6, Math.floor(length * 0.06));
    for (let i = 0; i < length; i++) {
      const d = head - i;
      const fade = d >= 0 && d <= tail ? Math.pow(1 - d / tail, 1.6) : 0;
      setPixel(i, adjustHex(pick(0), fade));
    }
  } else if (name.includes("matrix") || name.includes("confetti") || name.includes("twinkle")) {
    for (let i = 0; i < length; i++) {
      const noise = (Math.sin(i * 12.9898 + t * speed * 4) * 43758.5453) % 1;
      const on = Math.abs(noise) > 0.65;
      setPixel(i, on ? pick(i) : adjustHex(pick(0), 0.15));
    }
  } else if (name.includes("audio") || name.includes("spectrum") || name.includes("beat")) {
    const bars = 8;
    const seg = Math.floor(length / bars);
    for (let b = 0; b < bars; b++) {
      const level = (Math.sin(t * 2 + b) * 0.5 + 0.5) * 0.8 + 0.2;
      const col = pick(b);
      for (let i = 0; i < seg && b * seg + i < length; i++) {
        const idx = b * seg + i;
        const fill = i < level * seg;
        setPixel(idx, fill ? col : adjustHex(col, 0.12));
      }
    }
  } else if (name.includes("solid")) {
    const pulse = 0.7 + 0.3 * (Math.sin(t * speed * Math.PI) * 0.5 + 0.5);
    for (let i = 0; i < length; i++) setPixel(i, adjustHex(pick(0), pulse));
  } else {
    for (let i = 0; i < length; i++) {
      const phase = (t * speed * 0.4 + i / length) % 1;
      const idx = Math.floor(phase * palette.length);
      const next = palette[(idx + 1) % palette.length];
      const mix = lerpColor(pick(idx), next, (phase * palette.length) % 1);
      setPixel(i, mix);
    }
  }
  return colors;
}

function drawEffectPreview(canvas, effect, t) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 140;
  const cssH = canvas.clientHeight || 10;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW;
  const h = cssH;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0a111f";
  ctx.fillRect(0, 0, w, h);
  const leds = 80;
  const px = w / leds;
  const pixels = simulateEffectPixels(effect, leds, t);
  for (let i = 0; i < pixels.length; i++) {
    ctx.fillStyle = pixels[i];
    ctx.fillRect(i * px, 0, px + 1, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, h - 2, w, 2);
}

function effectGradient(effect) {
  const params = effect.default_params || {};
  const paletteMap = {
    neon: ["#32ffe0", "#7c3aed", "#ff61d6"],
    sunset: ["#ff8b5f", "#ff3f81", "#ffd86f"],
    ocean: ["#0087ff", "#00c6ff", "#7cf2c8"],
    fire: ["#ff8b3d", "#ff3b1f", "#ffd86f"],
    pastel: ["#ffe0f0", "#c8f5ff", "#d8ffd9"],
  };
  if (params.palette && paletteMap[params.palette]) {
    const colors = paletteMap[params.palette];
    return `linear-gradient(90deg, ${colors.join(", ")})`;
  }
  if (params.colors && params.colors.length) {
    const colors = params.colors.map((c) => rgbToHex(c));
    return `linear-gradient(90deg, ${colors.join(", ")})`;
  }
  if (params.color) {
    const col = rgbToHex(params.color);
    return `linear-gradient(90deg, ${col}, ${col})`;
  }
  return "linear-gradient(90deg, #4cf6d8, #7c3aed, #ff61d6)";
}

function drawLedViz() {
  const canvas = qs("#led-preview");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const preview = state.current.frame_preview && state.current.frame_preview.length ? state.current.frame_preview : null;
  const leds = preview ? preview.length : Math.max(1, state.current.max_leds || getStripLength());
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.fillStyle = "#05070f";
  ctx.fillRect(0, 0, w, h);
  let pixels;
  if (preview) {
    pixels = preview.map((p) => rgbToHex(p));
  } else {
    const effMeta = state.effects.find((e) => e.name === state.current.effect);
    const simEffect = effMeta
      ? { ...effMeta, default_params: { ...(effMeta.default_params || {}), ...(getEffectParams() || {}) } }
      : { name: "solid", default_params: { color: getEffectParams()?.color || [50, 255, 224] } };
    const t = ledVizState.time || performance.now() / 1000;
    pixels = simulateEffectPixels(simEffect, Math.min(leds, 300), t);
  }
  const px = w / pixels.length;
  for (let i = 0; i < pixels.length; i++) {
    ctx.fillStyle = pixels[i];
    ctx.fillRect(i * px, 0, px + 1, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, h - 3, w, 3);
}

function hookBackupAndThemes() {
  const themeDup = qs("#theme-duplicate");
  const themeRenameBtn = qs("#theme-rename");
  if (themeDup) themeDup.onclick = duplicateTheme;
  if (themeRenameBtn) themeRenameBtn.onclick = renameTheme;
  const themeExport = qs("#theme-export");
  if (themeExport) {
    themeExport.onclick = () => downloadJson("led-themes.json", allThemes());
  }
  const themeImport = qs("#theme-import");
  const themeImportBtn = qs("#theme-import-btn");
  if (themeImport && themeImportBtn) {
    themeImportBtn.onclick = () => themeImport.click();
  }
  if (themeImport) {
    themeImport.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const list = JSON.parse(text);
      if (!Array.isArray(list)) return alert("Ongeldige thema import");
      const custom = list.filter((t) => !defaultThemes.find((d) => d.id === t.id));
      persistThemes(custom);
      applyTheme(custom[0]?.id || defaultThemes[0].id);
    });
  }
  const backupExport = qs("#backup-export");
  if (backupExport) backupExport.onclick = exportBackup;
  const backupImport = qs("#backup-import");
  const backupImportBtn = qs("#backup-import-btn");
  if (backupImport && backupImportBtn) {
    backupImportBtn.onclick = () => backupImport.click();
  }
  if (backupImport) {
    backupImport.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importBackup(await file.text());
        alert("Back-up geïmporteerd");
      } catch (err) {
        console.error(err);
        alert("Import mislukt: " + err);
      }
    });
  }
}

function setCollapsed(target, btn, collapsed) {
  target.classList.toggle("collapsed", collapsed);
  const openLabel = btn.dataset.labelOpen || "Uitklappen";
  const closeLabel = btn.dataset.labelClose || "Inklappen";
  btn.textContent = collapsed ? openLabel : closeLabel;
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function effectTitle(input) {
  if (!input) return "";
  const eff = typeof input === "string" ? state.effects.find((e) => e.name === input) : input;
  const raw = eff?.label || eff?.name || input;
  return raw.replace(/_/g, " ");
}

function setupCollapsibles() {
  document.querySelectorAll("[data-collapse]").forEach((btn) => {
    const sel = btn.getAttribute("data-collapse");
    const target = qs(sel);
    if (!target) return;
    const startCollapsed = btn.dataset.default === "collapsed" || target.classList.contains("collapsed");
    setCollapsed(target, btn, startCollapsed);
    btn.addEventListener("click", () => setCollapsed(target, btn, !target.classList.contains("collapsed")));
  });
}

function updateLive() {
  qs("#brightness-val").textContent = state.current.brightness ?? 0;
  updateStats();
  updateAudioTargets(state.audio || {});
  drawAudioViz();
  drawLedViz();
  qs("#volume-chip").textContent = `Vol: ${Math.round((state.audio.vol || 0) * 100)}%`;
  qs("#bpm-chip").textContent = `BPM: ${Math.round(state.audio.bpm || 0) || "--"}`;
}

function updateStats() {
  const power = qs("#stat-power");
  if (power) power.textContent = `Status: ${state.current.on ? "Aan" : "Uit"}`;
  const eff = qs("#stat-effect");
  if (eff) eff.textContent = `Effect: ${effectTitle(state.current.effect) || "--"}`;
  const bright = qs("#stat-bright");
  if (bright) bright.textContent = `Helderheid: ${state.current.brightness ?? 0}`;
  const kill = qs("#kill-all");
  if (kill) kill.textContent = state.current.on && (state.current.brightness ?? 0) > 0 ? "Alles uit" : "Alles aan";
}

function sortEffects(list, mode) {
  const items = [...list];
  switch (mode) {
    case "name-desc":
      return items.sort((a, b) => (b.label || b.name).localeCompare(a.label || a.name));
    case "category":
      return items.sort((a, b) => a.category.localeCompare(b.category) || (a.label || a.name).localeCompare(b.label || b.name));
    case "music-first":
      return items.sort((a, b) => {
        const aMusic = a.category === "music" ? 0 : 1;
        const bMusic = b.category === "music" ? 0 : 1;
        if (aMusic !== bMusic) return aMusic - bMusic;
        return (a.label || a.name).localeCompare(b.label || b.name);
      });
    default:
      return items.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  }
}

function renderEffects() {
  effectPreviewRegistry.clear();
  const filter = qs("#effect-filter");
  const searchInput = qs("#effect-search");
  const cats = [...new Set(state.effects.map((e) => e.category))];
  const selectedBefore = filter.value;
  filter.innerHTML = `<option value="">Alle categorieën</option>` + cats.map((c) => `<option value="${c}">${c}</option>`).join("");
  if (selectedBefore && cats.includes(selectedBefore)) filter.value = selectedBefore;
  const list = qs("#effects-list");
  const selectedCat = filter.value;
  const sortMode = qs("#effect-sort")?.value || "name-asc";
  const search = (searchInput?.value || "").toLowerCase();
  list.innerHTML = "";

  const renderSection = (label, effects) => {
    if (!effects.length) return;
    const head = document.createElement("div");
    head.className = "effect-section-head";
    head.innerHTML = `<h4>${label}</h4><span class="muted">${effects.length} opties</span>`;
    list.appendChild(head);
    effects.forEach((eff) => {
      const row = document.createElement("div");
      row.className = "effect-row";
      if (state.current.effect === eff.name) row.classList.add("active");
      const display = effectTitle(eff);
      const preview = document.createElement("canvas");
      preview.className = "effect-preview";
      preview.width = 160;
      preview.height = 16;
      effectPreviewRegistry.set(eff.name, { canvas: preview, effect: eff });
      const meta = document.createElement("div");
      meta.className = "effect-meta";
      meta.innerHTML = `<div class="name">${display}</div><div class="cat">${eff.category}</div><div class="desc">${eff.description}</div>`;
      row.appendChild(preview);
      row.appendChild(meta);
      row.onclick = async () => {
        list.classList.add("loading");
        await applyEffect(eff);
        list.classList.remove("loading");
      };
      list.appendChild(row);
    });
  };

  const filtered = state.effects.filter((e) => {
    const inCat = !selectedCat || e.category === selectedCat;
    const match = !search || (e.label || e.name).toLowerCase().includes(search) || (e.description || "").toLowerCase().includes(search);
    return inCat && match;
  });
  const sorted = sortEffects(filtered, sortMode);
  if (selectedCat) {
    renderSection("Effecten", sorted);
  } else {
    const music = sorted.filter((e) => e.category === "music");
    const other = sorted.filter((e) => e.category !== "music");
    renderSection("Effecten", other);
    renderSection("Muziek-effecten", music);
  }
  renderEffectParams();
}

function renderAudioSelect() {
  const select = qs("#audio-effect");
  if (!select) return;
  const music = state.effects.filter((e) => e.category === "music");
  select.innerHTML = music.map((m) => `<option value="${m.name}">${effectTitle(m)}</option>`).join("");
  select.onchange = () => {
    const chosen = select.value;
    const eff = music.find((e) => e.name === chosen);
    if (eff) applyEffect(eff);
  };
}

function renderPresets() {
  const list = qs("#presets-list");
  list.innerHTML = "";
  state.presets.forEach((p) => {
    const div = document.createElement("div");
    div.className = "preset";
    div.innerHTML = `<strong>${p.name}</strong><br/><small>${effectTitle(p.effect)}</small>`;
    const btn = document.createElement("button");
    btn.className = "btn ghost";
    btn.textContent = "Activeren";
    btn.onclick = async () => {
      div.classList.add("loading");
      await api("/api/presets/apply", "POST", { name: p.name });
      setTimeout(() => div.classList.remove("loading"), 500);
    };
    div.appendChild(btn);
    list.appendChild(div);
  });
}

async function applyPreset(preset) {
  const chips = qs("#preset-chips");
  if (chips) chips.classList.add("loading");
  try {
    const res = await api("/api/presets/apply", "POST", { name: preset.name });
    if (res?.state) {
      state.current = res.state;
      state.current.effect_params = state.current.effect_params || state.current.params || {};
      state.current.params = state.current.effect_params;
      state.current.live = { ...defaultLive, ...(state.current.live || {}) };
      state.current.frame_preview = state.current.frame_preview || [];
      setUiValues();
      updateLive();
    } else {
      await loadStatus();
    }
    renderEffectPresets();
  } catch (err) {
    console.error(err);
    alert("Preset laden mislukt: " + err);
  } finally {
    if (chips) chips.classList.remove("loading");
  }
}

function renderEffectPresets() {
  const select = qs("#preset-effect-select");
  const chips = qs("#preset-chips");
  const hint = qs("#preset-hint");
  if (!select || !chips) return;

  const currentEffect = state.current.effect;
  const effects = [...new Set(state.presets.map((p) => p.effect).filter(Boolean))];
  const prev = select.value || currentEffect || "";
  const opts = [
    currentEffect ? `<option value="${currentEffect}">${effectTitle(currentEffect)} (actief)</option>` : "",
    `<option value="">Alle effecten</option>`,
    ...effects
      .filter((e) => e && e !== currentEffect)
      .map((e) => `<option value="${e}">${effectTitle(e)}</option>`),
  ].join("");
  select.innerHTML = opts;
  select.value = prev && (prev === "" || effects.includes(prev) || prev === currentEffect) ? prev : currentEffect || "";

  const filter = select.value;
  const filtered = state.presets.filter((p) => !filter || p.effect === filter);
  chips.innerHTML = "";

  if (!filtered.length) {
    chips.innerHTML = `<span class="muted">Geen presets gevonden voor dit filter.</span>`;
    if (hint) hint.textContent = "Maak of importeer presets om ze hier snel te laden.";
    return;
  }

  filtered
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "chip pill preset-chip";
      const effectLabel = effectTitle(p.effect || "");
      btn.innerHTML = `<strong>${p.name}</strong>${effectLabel ? `<span class="muted"> • ${effectLabel}</span>` : ""}`;
      btn.onclick = () => applyPreset(p);
      chips.appendChild(btn);
    });

  if (hint) {
    hint.textContent = filter ? "Laad presets die bij dit effect horen." : "Alle presets zichtbaar. Kies er één om te laden.";
  }
}

function renderAllPresets() {
  const wrap = qs("#all-presets");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!state.presets || !state.presets.length) {
    wrap.innerHTML = '<span class="muted">Nog geen presets opgeslagen.</span>';
    return;
  }
  state.presets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "chip pill preset-chip";
      const label = effectTitle(p.effect || "");
      btn.innerHTML = `<strong>${p.name}</strong>${label ? `<span class="muted"> • ${label}</span>` : ""}`;
      btn.onclick = () => applyPreset(p);
      wrap.appendChild(btn);
    });
}

function renderZones() {
  const list = qs("#zones-list");
  list.innerHTML = "";
  state.zones.forEach((z, idx) => {
    const div = document.createElement("div");
    div.className = "item";
    const zoneColor = rgbToHex(z.params?.color || [50, 255, 224]);
    div.innerHTML = `
      <strong>${z.name}</strong>
      <div class="muted">Leds ${z.start}-${z.end}</div>
      <label class="mini-label">Kleur</label>
      <input type="color" class="zone-color" data-idx="${idx}" value="${zoneColor}">
      <div class="zone-actions">
        <button class="btn ghost apply-zone" data-idx="${idx}">Effect & kleur toepassen</button>
      </div>
    `;
    div.querySelector(".apply-zone").onclick = () => {
      const colorEl = div.querySelector(".zone-color");
      const params = { ...buildParams(), color: hexToRgb(colorEl.value) };
      state.zones[idx].params = params;
      state.zones[idx].effect = state.current.effect;
      api("/api/segments", "POST", state.zones).then(() => renderZones());
    };
    list.appendChild(div);
  });
}

function renderAlarms() {
  const list = qs("#alarms-list");
  list.innerHTML = "<h3>Wekkers</h3>";
  state.alarms.alarms.forEach((a, idx) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<strong>${a.time}</strong><div>${a.effect}</div>`;
    const toggle = document.createElement("button");
    toggle.className = "btn ghost";
    toggle.textContent = a.enabled ? "Aan" : "Uit";
    toggle.onclick = () => {
      state.alarms.alarms[idx].enabled = !a.enabled;
      api("/api/alarms", "POST", state.alarms).then(() => renderAlarms());
    };
    row.appendChild(toggle);
    list.appendChild(row);
  });
  const timerHeader = document.createElement("h3");
  timerHeader.textContent = "Timers";
  list.appendChild(timerHeader);
  (state.alarms.timers || []).forEach((t, idx) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<strong>${Math.max(0, Math.round(t.seconds))}s</strong><div>${t.effect}</div>`;
    const toggle = document.createElement("button");
    toggle.className = "btn ghost";
    toggle.textContent = t.enabled ? "Aan" : "Uit";
    toggle.onclick = () => {
      state.alarms.timers[idx].enabled = !t.enabled;
      api("/api/alarms", "POST", state.alarms).then(() => renderAlarms());
    };
    row.appendChild(toggle);
    list.appendChild(row);
  });
}

async function applyEffect(effect) {
  const prevEffect = state.current.effect;
  const isSameEffect = prevEffect === effect.name;
  state.current.effect = effect.name;
  const baseParams = effect.default_params || {};
  const mergedParams = isSameEffect ? { ...baseParams, ...getEffectParams() } : { ...baseParams };
  setEffectParams(mergedParams);
  // reflect default color in UI
  if (mergedParams.color && qs("#color")) {
    qs("#color").value = rgbToHex(mergedParams.color);
  }
  // ensure output is on
  if (!state.current.on || (state.current.brightness ?? 0) === 0) {
    const restore = lastBrightnessBeforeKill ?? liveDefaults?.brightness ?? 180;
    state.current.on = true;
    state.current.brightness = restore;
    try {
      await api("/api/state", "POST", { on: true, brightness: restore });
    } catch (e) {
      console.error("Kon licht niet aanzetten", e);
    }
  }
  try {
    await api("/api/state", "POST", { on: true, brightness: state.current.brightness });
    const res = await api("/api/effect", "POST", { effect: effect.name, effect_params: state.current.effect_params, live: ensureLive(), apply_segments: true });
    if (res?.state) {
      state.current = res.state;
      state.current.effect_params = state.current.effect_params || state.current.params || {};
      state.current.params = state.current.effect_params;
      state.current.live = { ...defaultLive, ...(state.current.live || {}) };
      state.current.frame_preview = state.current.frame_preview || [];
      if (!state.current.on || (state.current.brightness ?? 0) <= 0) {
        const restore = lastBrightnessBeforeKill ?? liveDefaults?.brightness ?? 180;
        state.current.on = true;
        state.current.brightness = restore;
        await api("/api/state", "POST", { on: true, brightness: restore });
      }
      setUiValues();
      updateLive();
    }
    // Sync zones: apply new effect to all zones unless user explicitly set a different one earlier
    if (state.zones.length === 0 || state.zones.every((z) => !z.effect || z.effect === prevEffect)) {
      if (state.zones.length === 0) {
        state.zones = [{ name: "Volledige strip", start: 0, end: state.current.segments?.[0]?.end ?? 299, effect: effect.name, params: state.current.effect_params }];
      } else {
        state.zones = state.zones.map((z) => ({ ...z, effect: effect.name, params: { ...z.params, ...state.current.effect_params } }));
      }
      await api("/api/segments", "POST", state.zones);
    }
  } catch (err) {
    console.error(err);
    alert("Kon effect niet toepassen: " + err);
  }
  updateStats();
  renderEffects();
  renderEffectPresets();
}

function buildParams() {
  return buildParamsWithColors(true);
}

function buildPresetPayload(name) {
  return {
    name,
    effect: state.current.effect,
    effect_params: getEffectParams(),
    live: ensureLive(),
    brightness: state.current.brightness,
    intensity_boost: state.current.intensity_boost,
    fps: state.current.fps,
    max_leds: state.current.max_leds,
    segments: state.current.segments || [],
  };
}

function buildParamsWithColors(includeExisting) {
  const colorEl = qs("#color");
  const color2El = qs("#color2");
  const primary = colorEl ? hexToRgb(colorEl.value) : [50, 255, 224];
  const secondary = color2El ? hexToRgb(color2El.value) : [255, 79, 216];
  const colorParams = { color: primary, secondary_color: secondary };
  if (!includeExisting) return colorParams;
  return { ...getEffectParams(), color: primary, secondary_color: secondary };
}

function markActiveLivePreset(key) {
  document.querySelectorAll("[data-live-preset]").forEach((btn) => {
    const active = key && btn.dataset.livePreset === key;
    btn.classList.toggle("active", !!active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyLivePreset(key) {
  if (!liveDefaults) captureLiveDefaults();
  const preset = key === "reset" ? liveDefaults : livePresets[key];
  if (!preset) return;
  const ledTotal = state.hardware?.led_count || ((state.current.segments?.[0]?.end ?? 299) + 1);
  const live = ensureLive();
  const liveUpdate = { ...live, ...(preset.live || liveDefaults?.live || {}) };
  const newState = {
    brightness: clampNumber(preset.brightness ?? state.current.brightness ?? 0, 0, 255),
    intensity_boost: clampNumber(preset.intensity_boost ?? state.current.intensity_boost ?? 1, 0.5, 3),
    fps: clampNumber(preset.fps ?? state.current.fps ?? 60, 20, 240),
    max_leds: clampNumber(preset.max_leds ?? state.current.max_leds ?? ledTotal, 1, ledTotal),
  };
  state.current = {
    ...state.current,
    ...newState,
    live: liveUpdate,
  };
  setUiValues();
  updateLive();
  pushState({ ...newState, live: liveUpdate });
  renderEffectParams();
  markActiveLivePreset(key === "reset" ? null : key);
}

document.querySelectorAll(".slider").forEach(enhanceSlider);
document.querySelectorAll("[data-reset]").forEach((btn) => {
  btn.addEventListener("click", () => resetControl(btn.getAttribute("data-reset")));
});

const maxLedsInput = qs("#max-leds");
if (maxLedsInput) {
  maxLedsInput.addEventListener("change", (e) => {
    markActiveLivePreset(null);
    const val = clampNumber(parseInt(e.target.value, 10), 1, state.hardware?.led_count || 300);
    state.current.max_leds = val;
    qs("#max-leds-val").textContent = `${val} leds`;
    pushState({ max_leds: val });
  });
}

// Events
const brightnessEl = qs("#brightness");
syncSliderNumber("#brightness", "#brightness-num", (val) => {
  markActiveLivePreset(null);
  const v = parseInt(val, 10);
  qs("#brightness-val").textContent = v;
  state.current.brightness = v;
  pushState({ brightness: v });
});

syncSliderNumber("#intensity-boost", "#intensity-boost-num", (val) => {
  markActiveLivePreset(null);
  state.current.intensity_boost = parseFloat(val);
  qs("#intensity-boost-val").textContent = `${parseFloat(val).toFixed(2)}x`;
  pushState({ intensity_boost: parseFloat(val) });
});

const fpsEl = qs("#fps");
syncSliderNumber("#fps", "#fps-num", (val) => {
  markActiveLivePreset(null);
  const v = parseInt(val, 10);
  state.current.fps = v;
  qs("#fps-val").textContent = `${v} fps`;
  pushState({ fps: v });
});

const bindParamSlider = (id, key, formatter = (v) => v.toFixed(2)) => {
  const el = qs(id);
  if (!el) return;
  enhanceSlider(el);
  el.addEventListener("input", (e) => {
    markActiveLivePreset(null);
    const val = parseFloat(e.target.value);
    let finalVal = val;
    const label = qs(`${id}-val`);
    if (label) label.textContent = formatter(val);
    const live = ensureLive();
    if (key === "smoothing") {
      live.frame_blend = finalVal;
      live.smoothing = finalVal;
    } else if (key === "gamma") {
      live.gamma = finalVal;
    } else if (key === "fade") {
      live.dither_strength = finalVal;
      live.dither = finalVal > 0.05;
    } else {
      live[key] = finalVal;
    }
    state.current.live = live;
    pushState({ live });
  });
};

syncSliderNumber("#live-smoothing", "#live-smoothing-num", (val) => {
  markActiveLivePreset(null);
  const v = parseFloat(val);
  const live = ensureLive();
  live.frame_blend = v;
  live.smoothing = v;
  state.current.live = live;
  const label = qs("#live-smoothing-val");
  if (label) label.textContent = v.toFixed(2);
  pushState({ live });
});

syncSliderNumber("#live-gamma", "#live-gamma-num", (val) => {
  markActiveLivePreset(null);
  const v = parseFloat(val);
  const live = ensureLive();
  live.gamma = v;
  state.current.live = live;
  const label = qs("#live-gamma-val");
  if (label) label.textContent = v.toFixed(2);
  pushState({ live });
});

syncSliderNumber("#live-fade", "#live-fade-num", (val) => {
  markActiveLivePreset(null);
  const v = parseFloat(val);
  const live = ensureLive();
  live.dither_strength = v;
  live.dither = v > 0.05;
  state.current.live = live;
  const label = qs("#live-fade-val");
  if (label) label.textContent = v.toFixed(2);
  pushState({ live });
});

const liveReset = qs("#live-reset");
if (liveReset) {
  liveReset.addEventListener("click", () => applyLivePreset("reset"));
}

document.querySelectorAll("[data-live-preset]").forEach((btn) => {
  btn.addEventListener("click", () => applyLivePreset(btn.dataset.livePreset));
});

const speedEl = qs("#live-speed");
syncSliderNumber("#live-speed", "#live-speed-num", (val) => {
  markActiveLivePreset(null);
  const mult = parseFloat(val);
  state.ui.speed_multiplier = mult;
  const live = ensureLive();
  live.master_speed = mult;
  state.current.live = live;
  const label = qs("#live-speed-val");
  if (label) label.textContent = `${mult.toFixed(2)}x`;
  pushState({ live });
});

const dirSel = qs("#live-direction");
if (dirSel) {
  dirSel.addEventListener("change", (e) => {
    markActiveLivePreset(null);
    const val = e.target.value;
    const live = ensureLive();
    live.direction = val;
    state.current.live = live;
    pushState({ live });
  });
}

const colorInput = qs("#color");
if (colorInput) {
  colorInput.addEventListener("input", (e) => {
    markActiveLivePreset(null);
    const rgb = hexToRgb(e.target.value);
    syncColorEditors();
    const eff = state.effects.find((fx) => fx.name === state.current.effect);
    if (eff) updateParam("color", rgb);
  });
}

qs("#power-btn").onclick = () => {
  state.current.on = !state.current.on;
  let body = { on: state.current.on };
  if (state.current.on && (state.current.brightness ?? 0) === 0) {
    const restore = lastBrightnessBeforeKill ?? liveDefaults?.brightness ?? 180;
    state.current.brightness = restore;
    qs("#brightness").value = restore;
    const bnum = qs("#brightness-num");
    if (bnum) bnum.value = restore;
    qs("#brightness-val").textContent = restore;
    body = { ...body, brightness: restore };
  }
  api("/api/state", "POST", body);
  updateStats();
};

qs("#effect-toggle").onclick = () => {
  state.current.on = !state.current.on;
  let body = { on: state.current.on };
  if (state.current.on && (state.current.brightness ?? 0) === 0) {
    const restore = lastBrightnessBeforeKill ?? liveDefaults?.brightness ?? 180;
    state.current.brightness = restore;
    qs("#brightness").value = restore;
    const bnum = qs("#brightness-num");
    if (bnum) bnum.value = restore;
    qs("#brightness-val").textContent = restore;
    body = { ...body, brightness: restore };
  }
  api("/api/state", "POST", body);
  qs("#effect-toggle").textContent = state.current.on ? "Stop effect" : "Start effect";
  updateStats();
};

const killAllBtn = qs("#kill-all");
if (killAllBtn) {
  killAllBtn.addEventListener("click", async () => {
    if (state.current.on && (state.current.brightness ?? 0) > 0) {
      lastBrightnessBeforeKill = state.current.brightness;
      state.current.on = false;
      state.current.brightness = 0;
      qs("#brightness").value = 0;
      const bnum = qs("#brightness-num");
      if (bnum) bnum.value = 0;
      qs("#brightness-val").textContent = "0";
      await api("/api/state", "POST", { on: false, brightness: 0 });
    } else {
      const restore = lastBrightnessBeforeKill ?? liveDefaults?.brightness ?? 180;
      state.current.on = true;
      state.current.brightness = restore;
      qs("#brightness").value = restore;
      const bnum = qs("#brightness-num");
      if (bnum) bnum.value = restore;
      qs("#brightness-val").textContent = `${restore}`;
      await api("/api/state", "POST", { on: true, brightness: restore });
    }
    updateStats();
  });
}

qs("#effect-filter").addEventListener("change", renderEffects);
qs("#effect-sort").addEventListener("change", renderEffects);
qs("#effect-search")?.addEventListener("input", () => {
  renderEffects();
});

qs("#add-alarm")?.addEventListener("click", () => {
  const timeStr = prompt("Tijd (HH:MM)");
  if (!timeStr) return;
  state.alarms.alarms.push({ time: timeStr, effect: state.current.effect, params: buildParams(), enabled: true, days: [] });
  api("/api/alarms", "POST", state.alarms).then(() => renderAlarms());
});

qs("#add-timer")?.addEventListener("click", () => {
  const minutes = parseInt(prompt("Timer in minuten?"), 10);
  if (Number.isNaN(minutes)) return;
  const seconds = minutes * 60;
  state.alarms.timers = state.alarms.timers || [];
  state.alarms.timers.push({ seconds, effect: state.current.effect, params: buildParams(), enabled: true });
  api("/api/alarms", "POST", state.alarms).then(() => renderAlarms());
});

qs("#audio-sens")?.addEventListener("input", (e) => {
  const gain = parseFloat(e.target.value);
  api("/api/audio", "POST", { gain });
});

qs("#audio-smooth")?.addEventListener("input", (e) => {
  const smoothing = parseFloat(e.target.value);
  api("/api/audio", "POST", { smoothing });
});

qs("#audio-beat")?.addEventListener("input", (e) => {
  const beat_threshold = parseFloat(e.target.value);
  api("/api/audio", "POST", { beat_threshold });
});

function applyAudioPreset(key) {
  const preset = audioPresets[key];
  if (!preset) return;
  const { gain, smoothing, beat_threshold } = preset;
  const sens = qs("#audio-sens");
  const sm = qs("#audio-smooth");
  const beat = qs("#audio-beat");
  if (sens) sens.value = gain;
  if (sm) sm.value = smoothing;
  if (beat) beat.value = beat_threshold;
  api("/api/audio", "POST", { gain, smoothing, beat_threshold });
}

document.querySelectorAll("[data-audio-preset]").forEach((btn) => {
  btn.addEventListener("click", () => applyAudioPreset(btn.getAttribute("data-audio-preset")));
});

qs("#audio-toggle")?.addEventListener("click", () => {
  const enabled = !(state.audio.enabled ?? true);
  state.audio.enabled = enabled;
  api("/api/audio", "POST", { enabled });
  qs("#audio-toggle").textContent = enabled ? "Uitschakelen" : "Inschakelen";
});

document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.getAttribute("data-quick");
    const eff = state.effects.find((e) => e.name === name);
    if (eff) applyEffect(eff);
    else alert("Effect niet gevonden: " + name);
  });
});

document.querySelectorAll(".swatch").forEach((sw) => {
  sw.style.background = sw.getAttribute("data-color");
  sw.addEventListener("click", () => {
    markActiveLivePreset(null);
    const hex = sw.getAttribute("data-color");
    const colorEl = qs("#color");
    if (!colorEl || !hex) return;
    colorEl.value = hex;
    syncColorEditors();
    const eff = state.effects.find((e) => e.name === state.current.effect);
    if (eff) updateParam("color", hexToRgb(hex));
  });
});

// HSV/RGB inputs
["primary", "secondary"].forEach((tag) => {
  ["h", "s", "v"].forEach((k) => {
    const input = qs(`#${k}-${tag}`);
    if (!input) return;
    input.addEventListener("change", () => {
      markActiveLivePreset(null);
      const h = clampNumber(parseFloat(qs(`#h-${tag}`).value), 0, 360);
      const s = clampNumber(parseFloat(qs(`#s-${tag}`).value), 0, 100);
      const v = clampNumber(parseFloat(qs(`#v-${tag}`).value), 0, 100);
      const [r, g, b] = hsvToRgb(h, s, v);
      if (tag === "primary") {
        const colorEl = qs("#color");
        if (colorEl) colorEl.value = rgbToHex([r, g, b]);
      } else {
        const color2El = qs("#color2");
        if (color2El) color2El.value = rgbToHex([r, g, b]);
        else return; // skip if secondary not present
      }
      syncColorEditors();
      const eff = state.effects.find((e) => e.name === state.current.effect);
      if (eff) updateParam(tag === "primary" ? "color" : "secondary_color", [r, g, b]);
    });
  });
  ["r", "g", "b"].forEach((k) => {
    const input = qs(`#${k}-${tag}`);
    if (!input) return;
    input.addEventListener("change", () => {
      markActiveLivePreset(null);
      const r = clampNumber(parseInt(qs(`#r-${tag}`).value, 10), 0, 255);
      const g = clampNumber(parseInt(qs(`#g-${tag}`).value, 10), 0, 255);
      const b = clampNumber(parseInt(qs(`#b-${tag}`).value, 10), 0, 255);
      const hex = rgbToHex([r, g, b]);
      if (tag === "primary") {
        const colorEl = qs("#color");
        if (colorEl) colorEl.value = hex;
      } else {
        const color2El = qs("#color2");
        if (color2El) color2El.value = hex;
        else return;
      }
      syncColorEditors();
      const eff = state.effects.find((e) => e.name === state.current.effect);
      if (eff) updateParam(tag === "primary" ? "color" : "secondary_color", [r, g, b]);
    });
  });
});

async function savePreset(nameInput) {
  const input = typeof nameInput === "string" ? nameInput.trim() : "";
  const provided = input || qs("#preset-name-input")?.value?.trim() || "";
  const name = provided || prompt("Presetnaam");
  if (!name) return;
  const payload = buildPresetPayload(name);
  try {
    await api("/api/presets/save", "POST", payload);
    if (qs("#preset-name-input")) qs("#preset-name-input").value = "";
    await loadStatus();
    renderEffectPresets();
    renderAllPresets();
    alert("Preset opgeslagen");
  } catch (err) {
    console.error(err);
    alert("Kon preset niet opslaan: " + err);
  }
}

hookBackupAndThemes();
setupCollapsibles();
loadStatus().catch((err) => {
  console.error(err);
  if (err.status === 401) {
    showAuth("Log in om de LED controller te gebruiken.");
    return;
  }
  alert("Kon status niet laden: " + err.message);
});

const presetEffectSelect = qs("#preset-effect-select");
if (presetEffectSelect) {
  presetEffectSelect.addEventListener("change", renderEffectPresets);
}

function renderEffectParams() {
  const container = qs("#effect-params");
  if (!container) return;
  container.innerHTML = "";
  const eff = state.effects.find((e) => e.name === state.current.effect);
  if (!eff) return;
  const params = { ...(eff.default_params || {}), ...getEffectParams() };
  const globalKeys = ["gamma", "frame_blend", "smoothing", "master_speed", "brightness", "fps", "max_leds", "dither", "dither_strength"];
  Object.entries(params).forEach(([key, val]) => {
    if (globalKeys.includes(key)) return;
    const field = document.createElement("div");
    field.className = "param-field";
    if (Array.isArray(val) && val.length === 3) {
      const hex = rgbToHex(val);
      field.innerHTML = `<label>${key}</label><input type="color" data-param="${key}" value="${hex}">`;
      const input = field.querySelector("input");
      input.addEventListener("input", (e) => {
        markActiveLivePreset(null);
        updateParam(key, hexToRgb(e.target.value));
      });
    } else if (typeof val === "number") {
      const { min, max, step } = paramRange(key, val);
      field.innerHTML = `<label>${key} <span>${formatParamValue(val, step)}</span></label><input class="slider" type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-param="${key}">`;
      const span = field.querySelector("span");
      const input = field.querySelector("input");
      enhanceSlider(input);
      input.addEventListener("input", (e) => {
        markActiveLivePreset(null);
        const v = parseFloat(e.target.value);
        span.textContent = formatParamValue(v, step);
        updateParam(key, v);
      });
    } else if (typeof val === "string") {
      if (key.toLowerCase().includes("direction")) {
        field.innerHTML = `<label>${key}</label><select data-param="${key}"><option value="forward">vooruit</option><option value="reverse">achteruit</option><option value="center">midden</option></select>`;
        const sel = field.querySelector("select");
        sel.value = val;
        sel.addEventListener("change", () => {
          markActiveLivePreset(null);
          updateParam(key, sel.value);
        });
      } else {
        field.innerHTML = `<label>${key}</label><input type="text" data-param="${key}" value="${val}">`;
        field.querySelector("input").addEventListener("change", (e) => {
          markActiveLivePreset(null);
          updateParam(key, e.target.value);
        });
      }
    }
    container.appendChild(field);
  });
}

function getStripLength() {
  if (state.hardware?.led_count) return state.hardware.led_count;
  const segs = state.current.segments || [];
  if (segs.length) {
    return Math.max(...segs.map((s) => (s.end ?? 0))) + 1;
  }
  return 300;
}

function formatParamValue(v, step) {
  if (!Number.isFinite(v)) return v;
  if (step >= 1) return Math.round(v);
  if (step >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}

function paramRange(key, val) {
  const k = key.toLowerCase();
  if (k.includes("fps")) return { min: 20, max: 120, step: 1 };
  if (k.includes("speed")) return { min: 0, max: 3, step: 0.05 };
  if (k.includes("intensity") || k.includes("power")) return { min: 0, max: 3, step: 0.05 };
  if (k.includes("sensitivity") || k.includes("gain")) return { min: 0, max: 12, step: 0.1 };
  if (k.includes("frequency") || k.includes("rate")) return { min: 0, max: 90, step: 0.5 };
  if (k.includes("duty")) return { min: 0, max: 1, step: 0.02 };
  if (k.includes("trail") || k.includes("fade") || k.includes("density") || k.includes("sparkle") || k.includes("sparkles")) return { min: 0, max: 1, step: 0.01 };
  if (k.includes("flash")) return { min: 10, max: 500, step: 10 };
  if (k.includes("count") || k.includes("length") || k.includes("led") || k.includes("pixels") || k.includes("span")) {
    const maxLeds = getStripLength();
    return { min: 1, max: Math.max(maxLeds, 10), step: 1 };
  }
  return { min: 0, max: Math.max(1, val * 4), step: val >= 10 ? 1 : 0.05 };
}

function queueEffectUpdate() {
  const eff = state.effects.find((e) => e.name === state.current.effect);
  if (!eff) return;
  pushEffectUpdate({ effect: eff.name, effect_params: state.current.effect_params || getEffectParams(), apply_segments: true, live: ensureLive() });
}

function updateParam(key, value, opts = {}) {
  mergeEffectParams({ [key]: value });
  queueEffectUpdate();
  if (opts.refreshUi) renderEffectParams();
}
function syncColorEditors() {
  const colorEl = qs("#color");
  const color2El = qs("#color2");
  const primaryHex = colorEl ? colorEl.value : "#32ffe0";
  const [r1, g1, b1] = hexToRgb(primaryHex);
  const [h1, s1, v1] = rgbToHsv([r1, g1, b1]);
  qs("#r-primary").value = r1;
  qs("#g-primary").value = g1;
  qs("#b-primary").value = b1;
  qs("#h-primary").value = h1;
  qs("#s-primary").value = s1;
  qs("#v-primary").value = v1;

  if (color2El) {
    const [r2, g2, b2] = hexToRgb(color2El.value);
    const [h2, s2, v2] = rgbToHsv([r2, g2, b2]);
    qs("#r-secondary").value = r2;
    qs("#g-secondary").value = g2;
    qs("#b-secondary").value = b2;
    qs("#h-secondary").value = h2;
    qs("#s-secondary").value = s2;
    qs("#v-secondary").value = v2;
  }

  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.classList.remove("active");
    const hex = sw.getAttribute("data-color");
    if (hex && colorEl && hex.toLowerCase() === colorEl.value.toLowerCase()) {
      sw.classList.add("active");
    }
  });
}

async function performLogin() {
  const input = qs("#auth-password");
  const pw = input ? input.value.trim() : "";
  if (!pw) return;
  try {
    const res = await api("/api/login", "POST", { password: pw }, { skipAuth: true });
    state.token = res.token;
    localStorage.setItem("led_token", state.token);
    hideAuth();
    await loadStatus();
  } catch (err) {
    console.error(err);
    if (err.status === 401) {
      showAuth("Onjuist wachtwoord, probeer opnieuw.");
      if (input) input.focus();
    } else {
      alert("Login mislukt: " + (err?.message || err));
    }
  }
}

const authForm = qs("#auth-form");
if (authForm) {
  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    performLogin();
  });
}

const logoutBtn = qs("#auth-logout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    state.token = "";
    localStorage.removeItem("led_token");
    showAuth("Uitgelogd, log opnieuw in.");
  });
}

const savePresetBtn = qs("#save-effect-preset");
if (savePresetBtn) {
  savePresetBtn.addEventListener("click", () => savePreset());
}

const presetSaveBtn = qs("#preset-save-btn");
if (presetSaveBtn) {
  presetSaveBtn.addEventListener("click", () => savePreset(qs("#preset-name-input")?.value || ""));
}
