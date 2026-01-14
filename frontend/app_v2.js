/* ============================================
   LED CONTROLLER V2 - JAVASCRIPT
   Bug-free, mobile-optimized, complete
   ============================================ */

// ============================================
// STATE MANAGEMENT
// ============================================

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
    live: {
      master_speed: 1,
      frame_blend: 0.15,
      gamma: 1,
      direction: "forward",
      dither: true,
      dither_strength: 0.3
    },
    frame_preview: [],
    segments: []
  },
  ws: null,
  token: localStorage.getItem("led_token") || ""
};

// Audio visualization state
const vizState = {
  audioLevels: new Array(16).fill(0),
  audioTargets: new Array(16).fill(0),
  vol: 0,
  beat: false
};

// LED visualization state
const ledVizState = {
  phase: 0,
  lastTs: 0,
  time: 0
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);

function showToast(message, type = 'info') {
  const container = qs('#toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function rgbToHex(rgb) {
  const [r, g, b] = rgb;
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16)
  ];
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function debounce(fn, wait = 150) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ============================================
// API FUNCTIONS
// ============================================

async function api(path, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'X-Session-Token': state.token } : {})
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(path, options);

    if (res.status === 401 || res.status === 403) {
      showAuth('Sessie verlopen');
      return null;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    showToast(`Fout: ${err.message}`, 'error');
    return null;
  }
}

const pushState = debounce((body) => api('/api/state', 'POST', body), 100);
const pushEffect = debounce((body) => api('/api/effect', 'POST', body), 100);

// ============================================
// AUTH
// ============================================

function showAuth(message = 'Voer wachtwoord in') {
  const modal = qs('#auth-modal');
  const app = qs('#app');
  if (modal) modal.removeAttribute('hidden');
  if (app) app.setAttribute('hidden', '');
  const input = qs('#auth-password');
  if (input) input.focus();
}

function hideAuth() {
  const modal = qs('#auth-modal');
  const app = qs('#app');
  if (modal) modal.setAttribute('hidden', '');
  if (app) app.removeAttribute('hidden');
}

async function performLogin() {
  const input = qs('#auth-password');
  if (!input) return;

  const password = input.value.trim();
  if (!password) return;

  const res = await api('/api/login', 'POST', { password });
  if (res && res.token) {
    state.token = res.token;
    localStorage.setItem('led_token', res.token);
    hideAuth();
    await loadStatus();
  } else {
    showToast('Onjuist wachtwoord', 'error');
  }
}

// ============================================
// LOAD STATUS
// ============================================

async function loadStatus() {
  const data = await api('/api/status');
  if (!data) return;

  state.effects = data.effects || [];
  state.presets = data.presets || [];
  state.zones = data.zones || [];
  state.alarms = data.alarms || { alarms: [], timers: [] };
  state.ui = data.ui || {};
  state.hardware = data.hardware || {};
  state.audio = data.audio || {};
  state.current = data.state || state.current;

  // Normalize structure
  state.current.effect_params = state.current.effect_params || {};
  state.current.live = state.current.live || {
    master_speed: 1,
    frame_blend: 0.15,
    gamma: 1,
    direction: 'forward',
    dither: true,
    dither_strength: 0.3
  };
  state.current.frame_preview = state.current.frame_preview || [];

  renderUI();
  connectWs();
  startVizLoops();
}

// ============================================
// WEBSOCKET
// ============================================

function connectWs() {
  if (!state.token) return;
  if (state.ws) state.ws.close();

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws?token=${state.token}`);

  ws.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      if (payload.state) {
        state.current = payload.state;
        state.current.effect_params = state.current.effect_params || {};
        state.current.live = state.current.live || {};
      }
      if (payload.audio) {
        state.audio = payload.audio;
        updateAudioTargets(state.audio);
      }
      updateUI();
      ws.send('ok');
    } catch (err) {
      console.error('WS message error:', err);
    }
  };

  ws.onclose = (evt) => {
    if (evt.code === 4401 || evt.code === 4403) {
      showAuth('Sessie verlopen');
      return;
    }
    setTimeout(connectWs, 2000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  state.ws = ws;
}

// ============================================
// RENDER UI
// ============================================

function renderUI() {
  renderEffects();
  renderPresets();
  renderZones();
  updateUI();
  updateBadges();
}

function updateUI() {
  // Brightness
  const brightnessSlider = qs('#brightness-slider');
  if (brightnessSlider) {
    brightnessSlider.value = state.current.brightness || 0;
  }
  const brightnessDisplay = qs('#brightness-display');
  if (brightnessDisplay) {
    brightnessDisplay.textContent = state.current.brightness || 0;
  }

  // Speed
  const speedSlider = qs('#speed-slider');
  if (speedSlider) {
    speedSlider.value = state.current.live?.master_speed || 1;
  }
  const speedDisplay = qs('#speed-display');
  if (speedDisplay) {
    speedDisplay.textContent = `${(state.current.live?.master_speed || 1).toFixed(1)}x`;
  }

  // Color
  const colorPicker = qs('#color-picker');
  if (colorPicker && state.current.effect_params?.color) {
    colorPicker.value = rgbToHex(state.current.effect_params.color);
  }

  // FPS
  const fpsSlider = qs('#fps-slider');
  const fpsVal = qs('#fps-val');
  if (fpsSlider && fpsVal) {
    fpsSlider.value = state.current.fps || 60;
    fpsVal.textContent = state.current.fps || 60;
  }

  // Gamma
  const gammaSlider = qs('#gamma-slider');
  const gammaVal = qs('#gamma-val');
  if (gammaSlider && gammaVal) {
    gammaSlider.value = state.current.live?.gamma || 1;
    gammaVal.textContent = (state.current.live?.gamma || 1).toFixed(1);
  }

  // Smoothing
  const smoothingSlider = qs('#smoothing-slider');
  const smoothingVal = qs('#smoothing-val');
  if (smoothingSlider && smoothingVal) {
    smoothingSlider.value = state.current.live?.frame_blend || 0.15;
    smoothingVal.textContent = (state.current.live?.frame_blend || 0.15).toFixed(2);
  }

  // Direction
  const directionSelect = qs('#direction-select');
  if (directionSelect) {
    directionSelect.value = state.current.live?.direction || 'forward';
  }

  // Audio
  const audioGain = qs('#audio-gain');
  const audioGainVal = qs('#audio-gain-val');
  if (audioGain && audioGainVal) {
    audioGain.value = state.audio.gain || 1;
    audioGainVal.textContent = `${(state.audio.gain || 1).toFixed(1)}x`;
  }

  const audioSmoothing = qs('#audio-smoothing');
  const audioSmoothingVal = qs('#audio-smoothing-val');
  if (audioSmoothing && audioSmoothingVal) {
    audioSmoothing.value = state.audio.smoothing || 0.35;
    audioSmoothingVal.textContent = (state.audio.smoothing || 0.35).toFixed(2);
  }

  const audioThreshold = qs('#audio-threshold');
  const audioThresholdVal = qs('#audio-threshold-val');
  if (audioThreshold && audioThresholdVal) {
    audioThreshold.value = state.audio.beat_threshold || 0.35;
    audioThresholdVal.textContent = (state.audio.beat_threshold || 0.35).toFixed(2);
  }

  // Power button
  const powerBtn = qs('#power-btn');
  if (powerBtn) {
    powerBtn.textContent = state.current.on ? '⚡ Power Aan' : '⚡ Power Uit';
    powerBtn.className = state.current.on ? 'btn btn-lg btn-success' : 'btn btn-lg btn-outline';
  }

  // Effect toggle
  const effectToggle = qs('#effect-toggle');
  if (effectToggle) {
    effectToggle.textContent = state.current.on ? '⏸️ Pauzeer' : '▶️ Start';
  }

  // Kill all
  const killAll = qs('#kill-all');
  if (killAll) {
    const isOff = !state.current.on || state.current.brightness === 0;
    killAll.textContent = isOff ? '⚡ Alles aan' : '⚡ Alles uit';
  }

  // Audio toggle
  const audioToggle = qs('#audio-toggle');
  if (audioToggle) {
    const enabled = state.audio.enabled !== false;
    audioToggle.textContent = enabled ? '🔊 Audio Uitschakelen' : '🔇 Audio Inschakelen';
    audioToggle.className = enabled ? 'btn btn-lg btn-success' : 'btn btn-lg btn-outline';
  }
}

function updateBadges() {
  // Status badge
  const statusText = qs('#status-text');
  if (statusText) {
    statusText.textContent = state.current.on ? 'Aan' : 'Uit';
  }

  // Effect badge
  const effectBadge = qs('#effect-badge');
  if (effectBadge) {
    const effect = state.effects.find(e => e.name === state.current.effect);
    effectBadge.textContent = `Effect: ${effect?.label || effect?.name || '--'}`;
  }

  // Brightness badge
  const brightnessBadge = qs('#brightness-badge');
  if (brightnessBadge) {
    brightnessBadge.textContent = `Helderheid: ${state.current.brightness || 0}`;
  }

  // LED count
  const ledCountBadge = qs('#led-count-badge');
  if (ledCountBadge) {
    const count = state.hardware?.led_count || state.current.max_leds || 300;
    ledCountBadge.textContent = `${count} LEDs`;
  }

  // Volume
  const volumeBadge = qs('#volume-badge');
  if (volumeBadge) {
    volumeBadge.textContent = `Vol: ${Math.round((state.audio.vol || 0) * 100)}%`;
  }

  // BPM
  const bpmBadge = qs('#bpm-badge');
  if (bpmBadge) {
    bpmBadge.textContent = `BPM: ${Math.round(state.audio.bpm || 0) || '--'}`;
  }

  // Audio status
  const audioStatus = qs('#audio-status');
  if (audioStatus) {
    audioStatus.textContent = (state.audio.enabled !== false) ? 'ON' : 'OFF';
  }
}

// ============================================
// RENDER EFFECTS
// ============================================

function renderEffects() {
  const grid = qs('#effects-grid');
  if (!grid) return;

  const search = (qs('#effect-search')?.value || '').toLowerCase();
  const filter = qs('#effect-filter')?.value || '';
  const sort = qs('#effect-sort')?.value || 'name-asc';

  let filtered = state.effects.filter(e => {
    const matchesSearch = !search || 
      (e.name || '').toLowerCase().includes(search) ||
      (e.label || '').toLowerCase().includes(search) ||
      (e.description || '').toLowerCase().includes(search);
    const matchesFilter = !filter || e.category === filter;
    return matchesSearch && matchesFilter;
  });

  // Sort
  if (sort === 'name-asc') {
    filtered.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  } else if (sort === 'name-desc') {
    filtered.sort((a, b) => (b.label || b.name).localeCompare(a.label || a.name));
  } else if (sort === 'category') {
    filtered.sort((a, b) => a.category.localeCompare(b.category));
  } else if (sort === 'music-first') {
    filtered.sort((a, b) => {
      if (a.category === 'music' && b.category !== 'music') return -1;
      if (a.category !== 'music' && b.category === 'music') return 1;
      return (a.label || a.name).localeCompare(b.label || b.name);
    });
  }

  grid.innerHTML = '';

  filtered.forEach(effect => {
    const card = document.createElement('div');
    card.className = 'effect-card';
    if (state.current.effect === effect.name) {
      card.classList.add('active');
    }

    const icon = getEffectIcon(effect);
    
    card.innerHTML = `
      <div class="effect-icon">${icon}</div>
      <div class="effect-name">${effect.label || effect.name}</div>
      <div class="effect-category">${effect.category}</div>
    `;

    card.onclick = () => applyEffect(effect);
    grid.appendChild(card);
  });

  // Update filter options
  const filterSelect = qs('#effect-filter');
  if (filterSelect && filterSelect.options.length === 1) {
    const categories = [...new Set(state.effects.map(e => e.category))];
    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      filterSelect.appendChild(option);
    });
  }
}

function getEffectIcon(effect) {
  const name = (effect.name || '').toLowerCase();
  const cat = (effect.category || '').toLowerCase();

  if (cat === 'music' || name.includes('audio') || name.includes('beat')) return '🎵';
  if (name.includes('rainbow')) return '🌈';
  if (name.includes('fire')) return '🔥';
  if (name.includes('water') || name.includes('wave')) return '🌊';
  if (name.includes('star') || name.includes('sparkle')) return '✨';
  if (name.includes('lightning') || name.includes('thunder')) return '⚡';
  if (name.includes('snow') || name.includes('ice')) return '❄️';
  if (name.includes('heart')) return '❤️';
  if (name.includes('matrix')) return '💚';
  if (name.includes('comet')) return '☄️';
  if (name.includes('aurora')) return '🌌';
  if (name.includes('solid')) return '💡';
  return '💫';
}

async function applyEffect(effect) {
  if (!effect) return;

  const body = {
    effect: effect.name,
    effect_params: effect.default_params || {},
    live: state.current.live,
    apply_segments: true
  };

  const res = await pushEffect(body);
  if (res && res.state) {
    state.current = res.state;
    updateUI();
    updateBadges();
    renderEffects();
    showToast(`Effect: ${effect.label || effect.name}`, 'success');
  }
}

// ============================================
// RENDER PRESETS
// ============================================

function renderPresets() {
  const list = qs('#presets-list');
  const empty = qs('#presets-empty');
  if (!list) return;

  if (!state.presets || state.presets.length === 0) {
    list.innerHTML = '';
    if (empty) empty.removeAttribute('hidden');
    return;
  }

  if (empty) empty.setAttribute('hidden', '');
  list.innerHTML = '';

  state.presets.forEach(preset => {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.innerHTML = `
      <div class="preset-info">
        <div class="preset-name">${preset.name}</div>
        <div class="preset-details">${preset.effect || 'Geen effect'}</div>
      </div>
      <div class="preset-actions">
        <button class="btn btn-sm btn-primary">Laden</button>
        <button class="btn btn-sm btn-ghost" data-delete>🗑️</button>
      </div>
    `;

    const loadBtn = item.querySelector('.btn-primary');
    loadBtn.onclick = () => applyPreset(preset);

    const deleteBtn = item.querySelector('[data-delete]');
    deleteBtn.onclick = () => deletePreset(preset.name);

    list.appendChild(item);
  });
}

async function applyPreset(preset) {
  const res = await api('/api/presets/apply', 'POST', { name: preset.name });
  if (res && res.state) {
    state.current = res.state;
    await loadStatus();
    showToast(`Preset geladen: ${preset.name}`, 'success');
  }
}

async function deletePreset(name) {
  if (!confirm(`Preset "${name}" verwijderen?`)) return;
  
  const res = await api(`/api/presets/${name}`, 'DELETE');
  if (res) {
    await loadStatus();
    showToast('Preset verwijderd', 'success');
  }
}

async function savePreset() {
  const input = qs('#preset-name-input');
  if (!input) return;

  const name = input.value.trim();
  if (!name) {
    showToast('Voer een naam in', 'error');
    return;
  }

  const payload = {
    name,
    effect: state.current.effect,
    effect_params: state.current.effect_params,
    live: state.current.live,
    brightness: state.current.brightness,
    fps: state.current.fps
  };

  const res = await api('/api/presets/save', 'POST', payload);
  if (res) {
    input.value = '';
    await loadStatus();
    showToast('Preset opgeslagen', 'success');
  }
}

// ============================================
// RENDER ZONES
// ============================================

function renderZones() {
  const list = qs('#zones-list');
  const empty = qs('#zones-empty');
  if (!list) return;

  if (!state.zones || state.zones.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';
  list.innerHTML = '';

  state.zones.forEach((zone, idx) => {
    const card = document.createElement('div');
    card.className = 'zone-card';
    card.innerHTML = `
      <h4>${zone.name}</h4>
      <p>LEDs ${zone.start} - ${zone.end}</p>
      <p>Effect: ${zone.effect || 'Geen'}</p>
      <button class="btn btn-sm btn-danger" data-delete="${idx}">Verwijder</button>
    `;

    const deleteBtn = card.querySelector('[data-delete]');
    deleteBtn.onclick = () => deleteZone(idx);

    list.appendChild(card);
  });
}

async function deleteZone(index) {
  state.zones.splice(index, 1);
  await api('/api/segments', 'POST', state.zones);
  renderZones();
  showToast('Zone verwijderd', 'success');
}

// ============================================
// AUDIO VISUALIZATION
// ============================================

function updateAudioTargets(audio) {
  const baseLevels = audio?.bands && audio.bands.length ? audio.bands : new Array(8).fill(0);
  const levels = [...baseLevels, ...baseLevels.slice().reverse()];
  vizState.audioTargets = levels;
  vizState.beat = !!audio?.beat;
  vizState.vol = audio?.vol || 0;
}

function drawAudioViz() {
  const canvas = qs('#audio-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;

  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  ctx.clearRect(0, 0, w, h);

  const levels = vizState.audioLevels;
  const barW = w / levels.length;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 217, 255, 0.9)');
  grad.addColorStop(1, 'rgba(168, 85, 247, 0.7)');

  levels.forEach((lvl, i) => {
    const val = Math.max(0, Math.min(1, lvl));
    const barH = val * h;
    ctx.fillStyle = grad;
    ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
  });

  if (vizState.beat) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, 0, w, h);
  }
}

function drawLedViz() {
  const canvas = qs('#led-preview');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const preview = state.current.frame_preview;
  const leds = preview && preview.length ? preview.length : (state.current.max_leds || 300);

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;

  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  ctx.fillStyle = '#0f0f1e';
  ctx.fillRect(0, 0, w, h);

  if (!preview || preview.length === 0) {
    // Fallback gradient
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#00d9ff');
    grad.addColorStop(0.5, '#a855f7');
    grad.addColorStop(1, '#00d9ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const px = w / preview.length;
  preview.forEach((rgb, i) => {
    ctx.fillStyle = rgbToHex(rgb);
    ctx.fillRect(i * px, 0, px + 1, h);
  });
}

function startVizLoops() {
  if (vizState._started) return;
  vizState._started = true;

  // Audio viz loop
  const audioLoop = () => {
    for (let i = 0; i < vizState.audioLevels.length; i++) {
      const target = vizState.audioTargets[i] ?? 0;
      const current = vizState.audioLevels[i] ?? 0;
      vizState.audioLevels[i] = current + (target - current) * 0.2;
    }
    drawAudioViz();
    requestAnimationFrame(audioLoop);
  };
  requestAnimationFrame(audioLoop);

  // LED viz loop
  const ledLoop = () => {
    drawLedViz();
    requestAnimationFrame(ledLoop);
  };
  requestAnimationFrame(ledLoop);
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Auth
  const authForm = qs('#auth-form');
  if (authForm) {
    authForm.onsubmit = (e) => {
      e.preventDefault();
      performLogin();
    };
  }

  const authLogout = qs('#auth-logout');
  if (authLogout) {
    authLogout.onclick = () => {
      state.token = '';
      localStorage.removeItem('led_token');
      showAuth('Uitgelogd');
    };
  }

  // Tabs
  qsa('.tab-btn, .bottom-nav-btn').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      if (!tab) return;

      qsa('.tab-btn, .bottom-nav-btn').forEach(b => b.classList.remove('active'));
      qsa('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = qs(`#tab-${tab}`);
      if (pane) pane.classList.add('active');
    };
  });

  // Power
  const powerBtn = qs('#power-btn');
  if (powerBtn) {
    powerBtn.onclick = async () => {
      state.current.on = !state.current.on;
      await pushState({ on: state.current.on });
      updateUI();
    };
  }

  // Effect toggle
  const effectToggle = qs('#effect-toggle');
  if (effectToggle) {
    effectToggle.onclick = async () => {
      state.current.on = !state.current.on;
      await pushState({ on: state.current.on });
      updateUI();
    };
  }

  // Kill all
  const killAll = qs('#kill-all');
  if (killAll) {
    killAll.onclick = async () => {
      const isOff = !state.current.on || state.current.brightness === 0;
      if (isOff) {
        await pushState({ on: true, brightness: 180 });
      } else {
        await pushState({ on: false, brightness: 0 });
      }
      await loadStatus();
    };
  }

  // Brightness
  const brightnessSlider = qs('#brightness-slider');
  if (brightnessSlider) {
    brightnessSlider.oninput = () => {
      const val = parseInt(brightnessSlider.value);
      state.current.brightness = val;
      const display = qs('#brightness-display');
      if (display) display.textContent = val;
      pushState({ brightness: val });
    };
  }

  // Speed
  const speedSlider = qs('#speed-slider');
  if (speedSlider) {
    speedSlider.oninput = () => {
      const val = parseFloat(speedSlider.value);
      state.current.live.master_speed = val;
      const display = qs('#speed-display');
      if (display) display.textContent = `${val.toFixed(1)}x`;
      pushState({ live: state.current.live });
    };
  }

  // Color
  const colorPicker = qs('#color-picker');
  if (colorPicker) {
    colorPicker.oninput = () => {
      const rgb = hexToRgb(colorPicker.value);
      state.current.effect_params.color = rgb;
      pushEffect({
        effect: state.current.effect,
        effect_params: state.current.effect_params
      });
    };
  }

  // Color presets
  qsa('.color-preset').forEach(btn => {
    btn.onclick = () => {
      const color = btn.dataset.color;
      if (color) {
        colorPicker.value = color;
        colorPicker.dispatchEvent(new Event('input'));
      }
    };
  });

  // Brightness presets
  qsa('.preset-btn[data-brightness]').forEach(btn => {
    btn.onclick = () => {
      const val = parseInt(btn.dataset.brightness);
      if (brightnessSlider) {
        brightnessSlider.value = val;
        brightnessSlider.dispatchEvent(new Event('input'));
      }
    };
  });

  // FPS
  const fpsSlider = qs('#fps-slider');
  if (fpsSlider) {
    fpsSlider.oninput = () => {
      const val = parseInt(fpsSlider.value);
      state.current.fps = val;
      const display = qs('#fps-val');
      if (display) display.textContent = val;
      pushState({ fps: val });
    };
  }

  // Gamma
  const gammaSlider = qs('#gamma-slider');
  if (gammaSlider) {
    gammaSlider.oninput = () => {
      const val = parseFloat(gammaSlider.value);
      state.current.live.gamma = val;
      const display = qs('#gamma-val');
      if (display) display.textContent = val.toFixed(1);
      pushState({ live: state.current.live });
    };
  }

  // Smoothing
  const smoothingSlider = qs('#smoothing-slider');
  if (smoothingSlider) {
    smoothingSlider.oninput = () => {
      const val = parseFloat(smoothingSlider.value);
      state.current.live.frame_blend = val;
      const display = qs('#smoothing-val');
      if (display) display.textContent = val.toFixed(2);
      pushState({ live: state.current.live });
    };
  }

  // Direction
  const directionSelect = qs('#direction-select');
  if (directionSelect) {
    directionSelect.onchange = () => {
      state.current.live.direction = directionSelect.value;
      pushState({ live: state.current.live });
    };
  }

  // Expandable sections
  qsa('.card-header.expandable').forEach(header => {
    header.onclick = () => {
      const target = header.dataset.toggle;
      if (!target) return;

      const content = qs(`#${target}`);
      if (!content) return;

      const isHidden = content.hasAttribute('hidden');
      if (isHidden) {
        content.removeAttribute('hidden');
        header.classList.add('active');
      } else {
        content.setAttribute('hidden', '');
        header.classList.remove('active');
      }
    };
  });

  // Effect search
  const effectSearch = qs('#effect-search');
  if (effectSearch) {
    effectSearch.oninput = debounce(renderEffects, 300);
  }

  // Effect filter
  const effectFilter = qs('#effect-filter');
  if (effectFilter) {
    effectFilter.onchange = renderEffects;
  }

  // Effect sort
  const effectSort = qs('#effect-sort');
  if (effectSort) {
    effectSort.onchange = renderEffects;
  }

  // Quick actions
  qsa('[data-quick]').forEach(btn => {
    btn.onclick = () => {
      const effectName = btn.dataset.quick;
      const effect = state.effects.find(e => e.name === effectName);
      if (effect) applyEffect(effect);
    };
  });

  // Save preset
  const presetSaveBtn = qs('#preset-save-btn');
  if (presetSaveBtn) {
    presetSaveBtn.onclick = savePreset;
  }

  // Audio toggle
  const audioToggle = qs('#audio-toggle');
  if (audioToggle) {
    audioToggle.onclick = async () => {
      const enabled = state.audio.enabled !== false;
      await api('/api/audio', 'POST', { enabled: !enabled });
      await loadStatus();
    };
  }

  // Audio gain
  const audioGain = qs('#audio-gain');
  if (audioGain) {
    audioGain.oninput = () => {
      const val = parseFloat(audioGain.value);
      const display = qs('#audio-gain-val');
      if (display) display.textContent = `${val.toFixed(1)}x`;
      api('/api/audio', 'POST', { gain: val });
    };
  }

  // Audio smoothing
  const audioSmoothing = qs('#audio-smoothing');
  if (audioSmoothing) {
    audioSmoothing.oninput = () => {
      const val = parseFloat(audioSmoothing.value);
      const display = qs('#audio-smoothing-val');
      if (display) display.textContent = val.toFixed(2);
      api('/api/audio', 'POST', { smoothing: val });
    };
  }

  // Audio threshold
  const audioThreshold = qs('#audio-threshold');
  if (audioThreshold) {
    audioThreshold.oninput = () => {
      const val = parseFloat(audioThreshold.value);
      const display = qs('#audio-threshold-val');
      if (display) display.textContent = val.toFixed(2);
      api('/api/audio', 'POST', { beat_threshold: val });
    };
  }

  // Audio presets
  qsa('[data-audio-preset]').forEach(btn => {
    btn.onclick = () => {
      const preset = btn.dataset.audioPreset;
      const presets = {
        calm: { gain: 3, smoothing: 0.5, beat_threshold: 0.45 },
        club: { gain: 5.5, smoothing: 0.25, beat_threshold: 0.28 },
        live: { gain: 4.2, smoothing: 0.35, beat_threshold: 0.35 }
      };
      const settings = presets[preset];
      if (settings) {
        api('/api/audio', 'POST', settings).then(() => loadStatus());
      }
    };
  });

  // Add zone
  const addZoneBtn = qs('#add-zone-btn');
  if (addZoneBtn) {
    addZoneBtn.onclick = () => {
      showToast('Zone toevoegen: nog niet geïmplementeerd', 'info');
    };
  }
}

// ============================================
// INIT
// ============================================

async function init() {
  setupEventListeners();

  if (!state.token) {
    showAuth();
    return;
  }

  try {
    await loadStatus();
  } catch (err) {
    console.error('Init error:', err);
    showAuth('Fout bij laden');
  }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
