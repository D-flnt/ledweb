# 🎨 Verbeteringen voor V2 Interface

## ✅ Wat al werkt

### 1. LED Strip Preview (1:1)
- ✅ Canvas element aanwezig: `<canvas id="led-preview">`
- ✅ Real-time visualisatie van actuele LED output
- ✅ Gebruikt `frame_preview` data van server
- ✅ Animated loop update

### 2. Audio Spectrum
- ✅ Canvas element: `<canvas id="audio-canvas">`
- ✅ Real-time audio bands visualisatie
- ✅ Volume en BPM indicators

---

## ⚠️ Nog Toe Te Voegen

### Per-Effect Animated Thumbnails

In de **originele versie** heeft elk effect een kleine animated preview. Deze moet nog toegevoegd worden aan V2.

#### Wat nodig is:

**1. Update HTML (effect cards):**

Vervang de huidige effect cards in `index_v2.html` met:

```html
<!-- In renderEffects() functie, wijzig effect card HTML: -->
<div class="effect-card" data-effect="{effect.name}">
  <!-- Animated preview canvas -->
  <canvas class="effect-preview-mini" data-effect="{effect.name}" width="160" height="20"></canvas>
  
  <!-- Effect icon (optioneel, of vervang door canvas) -->
  <div class="effect-icon">{icon}</div>
  
  <!-- Effect info -->
  <div class="effect-name">{effect.label}</div>
  <div class="effect-category">{effect.category}</div>
</div>
```

**2. CSS Toevoegen (in style_v2.css):**

```css
.effect-preview-mini {
  width: 100%;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  margin-bottom: var(--spacing-sm);
  border: 1px solid var(--border-color);
}

.effect-card:hover .effect-preview-mini {
  border-color: var(--accent-primary);
  box-shadow: 0 0 8px rgba(0, 217, 255, 0.3);
}

.effect-card.active .effect-preview-mini {
  border-color: var(--accent-primary);
  box-shadow: 0 0 12px rgba(0, 217, 255, 0.5);
}
```

**3. JavaScript (kopieer uit app.js):**

De volgende functies uit `app.js` zijn nodig:

```javascript
// Effect preview registry
const effectPreviewRegistry = new Map(); // effectId -> { canvas, effect }

// Simulatie functie (verkort voorbeeld)
function simulateEffectPixels(effect, length, t) {
  // Simuleert effect output based op effect type
  // Retourneert array van hex colors
  // Zie originele app.js voor volledige implementatie
}

// Draw functie per canvas
function drawEffectPreview(canvas, effect, t) {
  const ctx = canvas.getContext('2d');
  const pixels = simulateEffectPixels(effect, 80, t);
  
  // Render pixels als colored bars
  const w = canvas.width;
  const h = canvas.height;
  const px = w / pixels.length;
  
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a111f';
  ctx.fillRect(0, 0, w, h);
  
  pixels.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * px, 0, px + 1, h);
  });
}

// Animation loop
function startEffectPreviewLoop() {
  const loop = (ts) => {
    const t = ts / 1000;
    effectPreviewRegistry.forEach(({ canvas, effect }) => {
      if (!canvas.isConnected) return;
      drawEffectPreview(canvas, effect, t);
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Registreer preview bij render
function renderEffects() {
  effectPreviewRegistry.clear();
  
  state.effects.forEach(effect => {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'effect-preview-mini';
    canvas.width = 160;
    canvas.height = 20;
    
    // Register for animation
    effectPreviewRegistry.set(effect.name, { canvas, effect });
    
    // Add to card
    // ...
  });
  
  // Start animation loop (één keer)
  if (!window._previewLoopStarted) {
    startEffectPreviewLoop();
    window._previewLoopStarted = true;
  }
}
```

---

## 🎯 Snelle Fix: Minimale Implementatie

Als je niet de volledige simulatie wilt implementeren, kun je een **eenvoudige gradient** tonen:

```javascript
function drawSimpleEffectPreview(canvas, effect) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  
  // Get effect colors
  const palette = getEffectPalette(effect); // ['#32ffe0', '#7c3aed', ...]
  
  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, w, 0);
  palette.forEach((color, i) => {
    gradient.addColorStop(i / (palette.length - 1), color);
  });
  
  // Draw
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  
  // Optional: add animation
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 1000);
  ctx.globalAlpha = pulse;
}

function getEffectPalette(effect) {
  const params = effect.default_params || {};
  
  if (params.palette === 'neon') return ['#32ffe0', '#7c3aed', '#ff61d6'];
  if (params.palette === 'fire') return ['#ff8b3d', '#ff3b1f', '#ffd86f'];
  if (params.palette === 'ocean') return ['#0087ff', '#00c6ff', '#7cf2c8'];
  if (params.color) return [rgbToHex(params.color)];
  
  return ['#32ffe0', '#7c3aed']; // default
}
```

---

## 📋 Implementatie Checklist

### Optie A: Volledige Animated Previews (zoals origineel)
- [ ] Kopieer `simulateEffectPixels()` uit app.js
- [ ] Kopieer `drawEffectPreview()` uit app.js  
- [ ] Voeg `effectPreviewRegistry` Map toe
- [ ] Start animation loop in `renderEffects()`
- [ ] Update HTML om canvas per effect toe te voegen
- [ ] Update CSS voor preview styling

### Optie B: Eenvoudige Static/Gradient Previews
- [ ] Implementeer `drawSimpleEffectPreview()`
- [ ] Implementeer `getEffectPalette()`
- [ ] Voeg canvas per effect toe in HTML
- [ ] (Optioneel) Voeg subtiele pulse animatie toe
- [ ] Update CSS

---

## 🔧 Aanbeveling

**Voor nu**: Start met **Optie B** (gradient previews)
- ✅ Sneller te implementeren
- ✅ Minder CPU intensief
- ✅ Nog steeds visueel aantrekkelijk
- ✅ Geeft goede indicatie van effect kleuren

**Later**: Upgrade naar **Optie A** (volledige simulatie)
- Als je meer tijd hebt
- Voor perfecte match met originele interface
- Voor accurate movement preview

---

## 🎨 Voorbeeld Output

### Met Gradient Previews:
```
┌────────────────────┐
│ ████████████████   │ ← Gradient van effect kleuren
│                    │
│   🌈 Rainbow       │
│   Basic            │
└────────────────────┘
```

### Met Animated Previews (zoals origineel):
```
┌────────────────────┐
│ ▓▒░▓▒░▓▒░▓▒░▓▒░   │ ← Animated pixels
│                    │
│   🔥 Fire Audio    │
│   Music            │
└────────────────────┘
```

---

## 💡 Bonus: Performance Tip

Als je veel effecten hebt (60+), gebruik dan **Intersection Observer** om alleen zichtbare previews te animeren:

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const canvas = entry.target;
    canvas.dataset.visible = entry.isIntersecting;
  });
});

// In animation loop:
effectPreviewRegistry.forEach(({ canvas, effect }) => {
  if (canvas.dataset.visible !== 'true') return; // Skip hidden
  drawEffectPreview(canvas, effect, t);
});
```

---

## 📦 Files om bij te werken

1. **frontend/index_v2.html** - Effect card HTML
2. **frontend/style_v2.css** - Preview canvas styling  
3. **frontend/app_v2.js** - Preview rendering logic

---

Wil je dat ik een **compleet werkend voorbeeld** maak met één van deze opties?
