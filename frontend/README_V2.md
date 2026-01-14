# 🎨 LedWeb V2 Interface — Professionele LED Controller

## ✨ Nieuwe Features

### 📱 **Mobile-First Design**
- **Volledig responsive** — Perfect op telefoon, tablet én laptop
- **Touch-friendly buttons** — Grote knoppen voor makkelijke bediening
- **Bottom navigation** op mobiel — Makkelijk bereikbare tabs onderaan
- **Swipe-friendly** scrolling voor effectenlijst
- **Optimale spacing** — Geen meer mis-taps of kleine knoppen

### 🎯 **Tab-Gebaseerde Navigatie**

De interface is verdeeld in **5 hoofdtabs**:

#### 1. ⚡ **Effecten**
- LED preview (real-time visualisatie)
- Zoekfunctie voor effecten
- Filter op categorie (Basic, Rainbow, Ambient, Noise, Party, Music)
- Sorteren op naam of categorie
- Effect parameters (uitklapbaar)
- Preset-opslag per effect

#### 2. 🎛️ **Besturing**
- Power on/off met één klik
- Master brightness slider (0-255)
- Snelheid/tempo controle
- Kleurkiezer met presets
- Geavanceerde instellingen (FPS, Gamma, Smoothing, Richting)

#### 3. 💾 **Presets**
- Opslaan van volledige scene
- Laden met één klik
- Overzicht van alle opgeslagen presets
- Delete functie per preset

#### 4. 🎵 **Audio**
- Real-time audio spectrum visualizer
- Volume en BPM indicator
- Audio aan/uit schakelaar
- Gevoeligheid, smoothing en beat-drempel controls
- Audio presets (Rustig, Club, Live)

#### 5. 🗂️ **Zones**
- LED strip segmentatie
- Verschillende effecten per zone
- Zone editor (start, einde, effect)

---

## 🎨 Design Highlights

### **Dark Theme**
- Professionele donkere UI (minder oogvermoeidheid)
- Neon accenten (#00d9ff cyaan + #a855f7 paars)
- Glasmorphism effecten met backdrop blur
- Subtiele shadows en borders

### **Modern Components**
- ✅ **Gradient buttons** met hover effects
- ✅ **Smooth animations** (fade, slide, pulse)
- ✅ **Status badges** met real-time updates
- ✅ **Collapsible sections** (accordions)
- ✅ **Toast notifications** voor feedback
- ✅ **Canvas-based previews** (LED + Audio)

### **Typography & Spacing**
- System fonts voor snelheid en native look
- Monospace voor numerieke waarden
- Consistent spacing system (0.25rem tot 2rem)
- Responsive font sizes

---

## 🔧 Technische Verbeteringen

### **Performance**
- CSS variables voor snelle theme switching
- Hardware-accelerated transforms
- Minimal reflows met will-change hints
- Lazy-loaded canvas rendering

### **Accessibility**
- ✅ Toetsenbord navigatie support
- ✅ ARIA labels op alle interactieve elementen
- ✅ Focus states voor alle controls
- ✅ High contrast mode compatible
- ✅ Screen reader friendly

### **Mobile Optimalisatie**
- Viewport meta tag met proper scaling
- Touch events ipv clicks (sneller)
- Momentum scrolling op iOS
- No-bounce overscroll behavior
- PWA-ready (manifest support)

---

## 🚀 Hoe te Gebruiken

### **Installatie**

1. **Kopieer de nieuwe files naar je Pi:**
   ```bash
   cd ~/ledweb/frontend/
   # Backup oude files
   mv index.html index_old.html
   mv style.css style_old.css
   
   # Hernoem nieuwe files
   mv index_v2.html index.html
   mv style_v2.css style.css
   ```

2. **Herstart de service:**
   ```bash
   sudo systemctl restart ledweb
   ```

3. **Open in browser:**
   - Desktop: `http://raspberrypi.local:8000`
   - Mobiel: Verbind met zelfde WiFi en gebruik hetzelfde adres

### **Quick Start**

1. **Login** met je wachtwoord
2. **Kies een effect** in de Effecten tab
3. **Pas parameters aan** via de uitklapbare sectie
4. **Bewaar preset** voor later gebruik
5. **Wissel tussen tabs** met de navigatie

---

## 📱 Mobile vs Desktop

| Feature | Mobile | Desktop |
|---------|--------|----------|
| **Navigatie** | Bottom nav (5 iconen) | Top tabs (horizontaal) |
| **Layout** | Single column | Multi-column grid mogelijk |
| **Touch targets** | Min 44x44px | Normale size |
| **Font size** | 16px base | 16px base |
| **Spacing** | Compact maar touchable | Meer whitespace |
| **Modals** | Full screen | Centered overlay |

---

## 🎯 Top Features voor Jou

### **Quick Actions Bar**
Bovenaan staan je **5 favoriete effecten** voor snelle toegang:
- 🌈 Rainbow
- 🔥 Fire
- 🎧 Audio Bars
- ✨ Aurora
- 💡 Solid

### **Status Badges**
Altijd zichtbaar in de top bar:
- 🟢 Online status (met pulserende dot)
- 🎨 Huidig effect
- 🔆 Huidige helderheid
- 🎵 Audio status (on/off)

### **Emergency Stop**
"⚡ Alles uit" knop altijd bereikbaar in top-right corner

---

## 🐛 Bug Fixes & Improvements

### **Opgelost**
- ✅ **Mobile scroll issues** — Geen horizontale overflow meer
- ✅ **Small touch targets** — Alle knoppen nu minstens 44x44px
- ✅ **Onleesbare tekst** — Betere contrast ratios
- ✅ **Lange laadtijden** — Lazy loading van non-critical assets
- ✅ **Layout shifts** — Skeleton screens en fixed heights
- ✅ **Z-index conflicts** — Proper stacking context

### **Nieuw toegevoegd**
- ✅ **Toast notifications** voor user feedback
- ✅ **Loading states** op alle async actions
- ✅ **Error boundaries** voor graceful failures
- ✅ **Keyboard shortcuts** (Ctrl+K voor search, Space voor play/pause)
- ✅ **Expandable sections** om UI overzichtelijk te houden

---

## 🎨 Customization

### **Kleuren aanpassen**
Wijzig CSS variabelen in `style_v2.css`:

```css
:root {
  /* Verander deze waarden */
  --accent-primary: #00d9ff;  /* Hoofdkleur (cyaan) */
  --accent-secondary: #a855f7; /* Secundair (paars) */
  --bg-primary: #0f0f1e;      /* Donkerste achtergrond */
}
```

### **Spacing aanpassen**
```css
:root {
  --spacing-md: 1rem;    /* Base spacing */
  --spacing-lg: 1.5rem;  /* Large spacing */
}
```

---

## 🔮 Toekomstige Features

- [ ] **PWA installatie** — Add to homescreen functie
- [ ] **Offline mode** — Cache effecten en presets lokaal
- [ ] **Multi-user** — Verschillende accounts met eigen presets
- [ ] **Spotify integratie** — Sync met je muziek
- [ ] **Automation** — Tijd-gebaseerde scene switching
- [ ] **Color picker advanced** — Gradient builder
- [ ] **Effect previews** — Animated thumbnails per effect
- [ ] **Drag & drop zones** — Visuele zone editor

---

## 📊 Browser Support

| Browser | Support |
|---------|----------|
| **Chrome/Edge** | ✅ Full |
| **Safari (iOS)** | ✅ Full |
| **Firefox** | ✅ Full |
| **Samsung Internet** | ✅ Full |
| **Opera** | ✅ Full |
| **IE11** | ❌ Not supported |

---

## 💡 Tips & Tricks

### **Performance**
- Gebruik **60 FPS** voor smooth effecten, **30 FPS** voor minder CPU load
- **Smoothing 0.15** is optimaal voor responsive effecten
- Zet **audio uit** als je het niet gebruikt (bespaart CPU)

### **Visuele Tips**
- **Brightness 180-200** is ideaal voor indoor gebruik
- **Gamma 1.2** voor diepere kleuren
- **Direction "center"** voor symmetrische effecten

### **Mobile Tips**
- Voeg toe aan homescreen voor app-achtige ervaring
- Gebruik landscape mode voor meer ruimte op tablet
- Swipe left/right in effectenlijst voor snelle browse

---

## 🤝 Feedback

Probleem gevonden of suggestie? 
- Open een **issue** op [GitHub](https://github.com/D-flnt/ledweb/issues)
- Of pas de code direct aan en commit!

---

## 🎉 Geniet van je nieuwe interface!

Deze V2 interface is gemaakt met focus op:
- 📱 **Mobile-first** design
- ⚡ **Performance** optimalisatie
- 🎨 **Modern** UI/UX
- 🔧 **Maintainability** (clean code)

Heb plezier met je LED controller! 💡✨
