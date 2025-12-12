import math
import random
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple

RGB = Tuple[int, int, int]


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(a: RGB, b: RGB, t: float) -> RGB:
    return (
        int(lerp(a[0], b[0], t)),
        int(lerp(a[1], b[1], t)),
        int(lerp(a[2], b[2], t)),
    )


def hsv_to_rgb(h: float, s: float, v: float) -> RGB:
    h = h % 1.0
    i = int(h * 6)
    f = h * 6 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    i = i % 6
    if i == 0:
        r, g, b = v, t, p
    elif i == 1:
        r, g, b = q, v, p
    elif i == 2:
        r, g, b = p, v, t
    elif i == 3:
        r, g, b = p, q, v
    elif i == 4:
        r, g, b = t, p, v
    else:
        r, g, b = v, p, q
    return int(r * 255), int(g * 255), int(b * 255)


def palette_color(palette: List[RGB], pos: float) -> RGB:
    if not palette:
        return (0, 0, 0)
    pos = pos % 1.0
    scaled = pos * (len(palette) - 1)
    i = int(scaled)
    frac = scaled - i
    c1 = palette[i]
    c2 = palette[min(i + 1, len(palette) - 1)]
    return lerp_color(c1, c2, frac)


def make_palette(name: str) -> List[RGB]:
    palettes = {
        "sunset": [(255, 94, 19), (255, 149, 5), (252, 201, 64), (255, 235, 191)],
        "ocean": [(0, 78, 146), (0, 155, 199), (0, 216, 199), (160, 255, 255)],
        "fire": [(30, 6, 0), (180, 40, 0), (255, 120, 10), (255, 220, 70)],
        "pastel": [(255, 183, 213), (202, 236, 255), (178, 255, 227), (255, 245, 196)],
        "neon": [(41, 255, 229), (117, 101, 255), (255, 94, 247), (255, 255, 255)],
    }
    return palettes.get(name, palettes["neon"])


_noise_cache: Dict[int, float] = {}


def value_noise(x: float, seed: int = 0) -> float:
    xi = int(math.floor(x))
    xf = x - xi
    random.seed(xi + seed * 1013)
    v1 = random.random()
    random.seed(xi + 1 + seed * 1013)
    v2 = random.random()
    return lerp(v1, v2, xf)


def smooth_noise(x: float, seed: int = 0) -> float:
    return (value_noise(x - 1, seed) + value_noise(x, seed) + value_noise(x + 1, seed)) / 3.0


def fractal_noise(x: float, octaves: int = 4, seed: int = 0) -> float:
    total = 0.0
    freq = 1.0
    amp = 1.0
    max_amp = 0.0
    for _ in range(octaves):
        total += smooth_noise(x * freq, seed) * amp
        max_amp += amp
        amp *= 0.5
        freq *= 2.0
    return total / max_amp if max_amp else 0.0


@dataclass
class EffectContext:
    time: float
    dt: float
    length: int
    params: Dict
    audio: Dict
    global_state: Dict
    segment: Dict
    timeline: float = 0.0
    master_speed: float = 1.0
    live: Dict = None


class Effect:
    name: str = "effect"
    label: str = "Effect"
    category: str = "misc"
    description: str = ""
    default_params: Dict = {}

    def render(self, ctx: EffectContext) -> List[RGB]:  # pragma: no cover - override
        raise NotImplementedError


EFFECTS: Dict[str, type] = {}


def register(effect_cls: type) -> None:
    EFFECTS[effect_cls.name] = effect_cls


# --- Basic Effects ---

class SolidColor(Effect):
    name = "solid"
    label = "Solid Color"
    category = "basic"
    description = "Volledig effen kleur (constant licht)"
    default_params = {"color": [255, 255, 255]}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 255, 255]))  # type: ignore
        return [color] * ctx.length


class ColorWipe(Effect):
    name = "color_wipe"
    label = "Color Wipe"
    category = "basic"
    description = "Kleur veegt in gekozen richting over de strip"
    default_params = {"color": [255, 50, 120], "direction": "forward", "speed": 2.2}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 50, 120]))  # type: ignore
        speed = ctx.params.get("speed", 1.0)
        direction = ctx.params.get("direction", "forward")
        phase = (ctx.time * speed) % ctx.length
        res = []
        for i in range(ctx.length):
            idx = i
            if direction == "reverse":
                idx = ctx.length - 1 - i
            elif direction == "center":
                idx = abs((ctx.length // 2) - i)
            lit = 1.0 if idx <= phase else 0.0
            res.append(tuple(int(c * lit) for c in color))  # type: ignore
        return res


class TheaterChase(Effect):
    name = "theater_chase"
    label = "Theater Chase"
    category = "basic"
    description = "Marquee-stijl pulses om en om"
    default_params = {"color": [255, 255, 255], "gap": 3, "speed": 1.0}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 255, 255]))  # type: ignore
        gap = max(1, int(ctx.params.get("gap", 3)))
        speed = ctx.params.get("speed", 1.0)
        offset = int((ctx.time * 20 * speed)) % gap
        res = []
        for i in range(ctx.length):
            res.append(color if (i + offset) % gap == 0 else (0, 0, 0))
        return res


class Strobe(Effect):
    name = "strobe"
    label = "Strobe Flash"
    category = "basic"
    description = "Snelle flitsen met instelbare duty/freq"
    default_params = {"color": [255, 255, 255], "frequency": 8.0, "duty_cycle": 0.2}

    def render(self, ctx: EffectContext) -> List[RGB]:
        freq = ctx.params.get("frequency", 8.0)
        duty = ctx.params.get("duty_cycle", 0.2)
        color = tuple(ctx.params.get("color", [255, 255, 255]))  # type: ignore
        phase = (ctx.time * freq) % 1.0
        on = phase < duty
        return [color if on else (0, 0, 0)] * ctx.length


class BlinkPattern(Effect):
    name = "blink_pattern"
    label = "Blink Pattern"
    category = "basic"
    description = "Herhalend knipperpatroon met pauze"
    default_params = {"color": [255, 120, 0], "interval": 0.7, "pause": 0.4}

    def render(self, ctx: EffectContext) -> List[RGB]:
        interval = ctx.params.get("interval", 0.7)
        pause = ctx.params.get("pause", 0.4)
        color = tuple(ctx.params.get("color", [255, 120, 0]))  # type: ignore
        cycle = interval + pause
        on = (ctx.time % cycle) < interval
        return [color if on else (0, 0, 0)] * ctx.length


class GradientScroll(Effect):
    name = "gradient_scroll"
    label = "Gradient Scroll"
    category = "basic"
    description = "Lopend kleurverloop over de strip"
    default_params = {"colors": [[255, 0, 120], [0, 180, 255]], "speed": 0.2}

    def render(self, ctx: EffectContext) -> List[RGB]:
        colors = ctx.params.get("colors", [[255, 0, 120], [0, 180, 255]])
        palette = [tuple(c) for c in colors]  # type: ignore
        speed = ctx.params.get("speed", 0.2)
        offset = ctx.time * speed
        res = []
        for i in range(ctx.length):
            res.append(palette_color(palette, (i / ctx.length) + offset))
        return res


# --- Rainbow & Palettes ---

class Rainbow(Effect):
    name = "rainbow"
    label = "Soft Rainbow"
    category = "rainbow"
    description = "Zachte regenboog die langzaam schuift"
    default_params = {"speed": 0.3}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.3)
        base = ctx.time * speed
        return [hsv_to_rgb((base + i / ctx.length) % 1.0, 1.0, 1.0) for i in range(ctx.length)]


class RainbowCycle(Effect):
    name = "rainbow_cycle"
    label = "Rainbow Cycle"
    category = "rainbow"
    description = "Volledige regenboog die rondloopt"
    default_params = {"speed": 0.5}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.5)
        return [hsv_to_rgb((i / ctx.length) + ctx.time * speed, 1.0, 1.0) for i in range(ctx.length)]


class RainbowWhite(Effect):
    name = "rainbow_white"
    label = "Rainbow + White"
    category = "rainbow"
    description = "Regenboog met witte accenten en pulses"
    default_params = {"speed": 0.4, "pulse": 0.4}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.4)
        pulse = ctx.params.get("pulse", 0.4)
        base = ctx.time * speed
        res = []
        for i in range(ctx.length):
            color = hsv_to_rgb((base + i / ctx.length) % 1.0, 1.0, 1.0)
            accent = (math.sin((ctx.time + i * 0.05) * 10) * 0.5 + 0.5) * pulse
            res.append(tuple(int(c + 255 * accent) if j < 3 else 0 for j, c in enumerate(color)))
        return res


class PaletteEffect(Effect):
    name = "palette_flow"
    label = "Palette Flow"
    category = "rainbow"
    description = "Scrollt een gekozen kleurenpalet gelijkmatig"
    default_params = {"palette": "sunset", "speed": 0.2}

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "sunset"))
        speed = ctx.params.get("speed", 0.2)
        offset = ctx.time * speed
        return [palette_color(palette, offset + (i / ctx.length)) for i in range(ctx.length)]


# --- Ambient / Smooth ---

class Breathing(Effect):
    name = "breathing"
    label = "Breathing"
    category = "ambient"
    description = "Zachte in- en uitfade zoals ademhaling"
    default_params = {"color": [80, 180, 255], "speed": 0.5, "intensity": 0.7}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [80, 180, 255]))  # type: ignore
        speed = ctx.params.get("speed", 0.5)
        intensity = ctx.params.get("intensity", 0.7)
        t = (math.sin(ctx.time * speed * math.pi * 2) * 0.5 + 0.5) * intensity
        return [tuple(int(c * t) for c in color)] * ctx.length


class SoftWave(Effect):
    name = "soft_wave"
    label = "Soft Wave"
    category = "ambient"
    description = "Langzame golfbeweging met één kleur"
    default_params = {"color": [0, 200, 255], "speed": 0.4, "wavelength": 24}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [0, 200, 255]))  # type: ignore
        speed = ctx.params.get("speed", 0.4)
        wavelength = ctx.params.get("wavelength", 24)
        res = []
        for i in range(ctx.length):
            t = (math.sin((i / wavelength) + ctx.time * speed) * 0.5 + 0.5)
            res.append(tuple(int(c * t) for c in color))
        return res


class DualWave(Effect):
    name = "dual_wave"
    label = "Dual Wave"
    category = "ambient"
    description = "Twee zachte golven vanuit beide kanten met palet"
    default_params = {"palette": "ocean", "speed": 0.6, "wavelength": 26, "mix": 0.5, "symmetry": 0.8}

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "ocean"))
        speed = ctx.params.get("speed", 0.6)
        wavelength = max(4, ctx.params.get("wavelength", 26))
        mix = clamp(ctx.params.get("mix", 0.5), 0.0, 1.0)
        symmetry = clamp(ctx.params.get("symmetry", 0.8), 0.0, 1.0)
        res: List[RGB] = []
        for i in range(ctx.length):
            pos = i / max(1, ctx.length - 1)
            wave_a = math.sin((pos * ctx.length / wavelength + ctx.time * speed) * math.pi * 2) * 0.5 + 0.5
            wave_b = math.sin(((1 - pos) * ctx.length / wavelength + ctx.time * speed * 1.15 + 0.33) * math.pi * 2) * 0.5 + 0.5
            blend = clamp(wave_a * mix + wave_b * (1 - mix))
            mirrored = abs(pos - 0.5) * 2
            balance = clamp(1 - mirrored * symmetry)
            hue_pos = (ctx.time * 0.05 + pos) % 1.0
            col = palette_color(palette, hue_pos)
            factor = clamp(blend * 0.7 + balance * 0.3)
            res.append(tuple(int(c * factor) for c in col))  # type: ignore
        return res


class ColorFade(Effect):
    name = "color_fade"
    label = "Color Fade"
    category = "ambient"
    description = "Cyclust traag tussen meerdere kleuren"
    default_params = {"colors": [[255, 64, 100], [64, 180, 255], [255, 200, 40]], "speed": 0.05}

    def render(self, ctx: EffectContext) -> List[RGB]:
        colors = [tuple(c) for c in ctx.params.get("colors", [[255, 64, 100], [64, 180, 255], [255, 200, 40]])]  # type: ignore
        speed = ctx.params.get("speed", 0.05)
        phase = (ctx.time * speed) % len(colors)
        idx = int(phase)
        t = phase - idx
        c1 = colors[idx % len(colors)]
        c2 = colors[(idx + 1) % len(colors)]
        mix = lerp_color(c1, c2, t)
        return [mix] * ctx.length


class LavaFlow(Effect):
    name = "lava_flow"
    label = "Lava Flow"
    category = "ambient"
    description = "Warme vloeibare gloed met vuurpalet"
    default_params = {"speed": 0.3, "scale": 0.15}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.3)
        scale = ctx.params.get("scale", 0.15)
        res = []
        for i in range(ctx.length):
            n = fractal_noise(i * scale + ctx.time * speed, 4, seed=7)
            col = palette_color(make_palette("fire"), n)
            res.append(col)
        return res


# --- Ultra smooth ---

class SuperSmooth(Effect):
    name = "super_smooth"
    label = "Super Smooth"
    category = "ambient"
    description = "Super vloeiend pastelverloop"
    default_params = {"palette": "pastel", "speed": 0.22, "scale": 0.1, "blur": 0.6}

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "pastel"))
        speed = ctx.params.get("speed", 0.22)
        scale = ctx.params.get("scale", 0.1)
        blur = clamp(ctx.params.get("blur", 0.6), 0.0, 1.0)
        res: List[RGB] = []
        for i in range(ctx.length):
            pos = ctx.time * speed + i * scale
            base = palette_color(palette, pos)
            neighbor = palette_color(palette, pos + scale)
            res.append(lerp_color(base, neighbor, blur))
        return res


# --- Noise-based ---

class FireNoise(Effect):
    name = "fire_noise"
    label = "Fire Noise"
    category = "noise"
    description = "Vuurgloed met kleine vonkjes"
    default_params = {"speed": 0.6, "sparks": 0.2}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.6)
        sparks = ctx.params.get("sparks", 0.2)
        res = []
        for i in range(ctx.length):
            n = fractal_noise(i * 0.12 + ctx.time * speed, 3, seed=11)
            spark = random.random() < sparks * ctx.dt
            heat = clamp(n + (0.5 if spark else 0))
            col = palette_color(make_palette("fire"), heat)
            res.append(col)
        return res


class Plasma(Effect):
    name = "plasma"
    label = "Plasma"
    category = "noise"
    description = "Organisch plasma met neonkleuren"
    default_params = {"speed": 0.25, "scale": 0.12}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.25)
        scale = ctx.params.get("scale", 0.12)
        res = []
        for i in range(ctx.length):
            v = (math.sin(i * scale + ctx.time * speed) + math.sin((i * 0.3) + ctx.time * speed * 1.3)) * 0.25 + 0.5
            res.append(palette_color(make_palette("neon"), v))
        return res


class Aurora(Effect):
    name = "aurora"
    label = "Aurora"
    category = "noise"
    description = "Noorderlicht-achtige stroken in beweging"
    default_params = {"speed": 0.15, "scale": 0.08}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.15)
        scale = ctx.params.get("scale", 0.08)
        res = []
        for i in range(ctx.length):
            n = fractal_noise(i * scale + ctx.time * speed, 5, seed=20)
            col = palette_color(make_palette("ocean"), n)
            res.append(col)
        return res


class PrismaticNoise(Effect):
    name = "prismatic_noise"
    label = "Prismatic Noise"
    category = "noise"
    description = "Gelaagde noise met gecontroleerde contrast en palet"
    default_params = {"palette": "pastel", "speed": 0.35, "scale": 0.18, "depth": 4, "contrast": 0.82}

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "pastel"))
        speed = ctx.params.get("speed", 0.35)
        scale = ctx.params.get("scale", 0.18)
        depth = max(1, int(ctx.params.get("depth", 4)))
        contrast = clamp(ctx.params.get("contrast", 0.82), 0.2, 1.5)
        res: List[RGB] = []
        for i in range(ctx.length):
            val = fractal_noise(i * scale + ctx.time * speed, depth, seed=33)
            shaped = pow(val, contrast)
            res.append(palette_color(palette, shaped))
        return res


# --- Party & Dynamisch ---

class Comet(Effect):
    name = "comet"
    label = "Comet"
    category = "party"
    description = "Enkele komeet met heldere staart"
    default_params = {"color": [255, 120, 60], "speed": 2.4, "tail": 10, "fade": 0.88}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 120, 60]))  # type: ignore
        speed = ctx.params.get("speed", 1.2)
        tail = max(1, int(ctx.params.get("tail", 12)))
        fade = ctx.params.get("fade", 0.8)
        pos = (ctx.time * speed) % ctx.length
        res = [(0, 0, 0)] * ctx.length
        for i in range(tail):
            idx = int((pos - i) % ctx.length)
            factor = pow(fade, i)
            res[idx] = tuple(int(c * factor) for c in color)
        return res


class KnightRider(Effect):
    name = "knight_rider"
    label = "Knight Rider"
    category = "party"
    description = "Scanner voor/achter (KITT-stijl)"
    default_params = {"color": [255, 0, 40], "speed": 0.8, "tail": 8}

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 0, 40]))  # type: ignore
        speed = ctx.params.get("speed", 0.8)
        tail = max(1, int(ctx.params.get("tail", 8)))
        res = [(0, 0, 0)] * ctx.length
        pos = (math.sin(ctx.time * speed * math.pi * 2) * 0.5 + 0.5) * (ctx.length - 1)
        for i in range(tail):
            idx = int(pos - i)
            if 0 <= idx < ctx.length:
                res[idx] = tuple(int(c * (1 - i / tail)) for c in color)
        return res


class GapChase(Effect):
    name = "gap_chase"
    label = "Gap Chase"
    category = "party"
    description = "Snelle chase met gaten, bounce en lange staart"
    default_params = {"color": [255, 120, 40], "gap": 3, "width": 2, "trail": 0.86, "speed": 1.4, "bounce": True}

    def __init__(self) -> None:
        self.phase = 0.0
        self.direction = 1.0

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 120, 40]))  # type: ignore
        gap = max(1, int(ctx.params.get("gap", 3)))
        width = max(1, int(ctx.params.get("width", 2)))
        trail = clamp(ctx.params.get("trail", 0.86), 0.1, 0.99)
        speed = max(0.05, ctx.params.get("speed", 1.4))
        bounce = bool(ctx.params.get("bounce", True))

        step = width + gap
        travel = speed * ctx.dt * step * ctx.length * 0.15

        if bounce:
            self.phase += self.direction * travel
            if self.phase < 0:
                self.phase = 0
                self.direction = 1.0
            elif self.phase > ctx.length:
                self.phase = ctx.length
                self.direction = -1.0
        else:
            self.phase = (self.phase + travel) % ctx.length

        res = [(0, 0, 0)] * ctx.length
        tail = max(2, int(width * 2))
        for n in range(0, ctx.length + step, step):
            base = (self.phase + n * self.direction) % ctx.length
            for k in range(width + tail):
                idx = int((base + self.direction * k) % ctx.length)
                strength = pow(trail, k)
                res[idx] = lerp_color((0, 0, 0), color, strength)
        return res


class MultiComet(Effect):
    name = "multi_comet"
    label = "Multi Comet"
    category = "party"
    description = "Meerdere kometen tegelijk"
    default_params = {"count": 3, "speed": 1.6, "tail": 12, "fade": 0.82, "palette": "neon", "jitter": 0.25}

    def __init__(self) -> None:
        self.positions: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        count = max(1, int(ctx.params.get("count", 3)))
        speed = max(0.1, ctx.params.get("speed", 1.0))
        tail = max(2, int(ctx.params.get("tail", 12)))
        fade = clamp(ctx.params.get("fade", 0.82), 0.1, 0.98)
        palette = make_palette(ctx.params.get("palette", "neon"))
        jitter = clamp(ctx.params.get("jitter", 0.25), 0.0, 1.0)

        # Maintain comet positions so they don't jump when parameters change mid-flight
        if len(self.positions) != count:
            self.positions = [(ctx.length / max(1, count)) * i for i in range(count)]

        res = [(0, 0, 0)] * ctx.length
        for idx in range(count):
            self.positions[idx] = (self.positions[idx] + speed * ctx.dt * ctx.length * (1 + jitter * random.random())) % ctx.length
            head = self.positions[idx]
            head_color = palette_color(palette, idx / max(1, count - 1))
            for k in range(tail):
                pos = int((head - k) % ctx.length)
                strength = pow(fade, k)
                res[pos] = lerp_color((0, 0, 0), head_color, strength)
        return res


class Twinkle(Effect):
    name = "twinkle"
    label = "Twinkle"
    category = "party"
    description = "Twinkelende sterren over de strip"
    default_params = {"density": 0.12, "fade": 0.88, "color": [255, 255, 255], "background": [0, 0, 0]}

    def __init__(self) -> None:
        self.levels: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        if len(self.levels) != ctx.length:
            self.levels = [0.0] * ctx.length
        density = max(0.0, ctx.params.get("density", 0.12))
        fade = clamp(ctx.params.get("fade", 0.88), 0.0, 0.999)
        color = tuple(ctx.params.get("color", [255, 255, 255]))  # type: ignore
        background = tuple(ctx.params.get("background", [0, 0, 0]))  # type: ignore

        decay = pow(fade, ctx.dt * 60)
        self.levels = [level * decay for level in self.levels]

        # Spawn a handful of new sparkles proportional to length and density
        spawn = max(0, int(ctx.length * density * ctx.dt * 8))
        for _ in range(spawn):
            idx = random.randint(0, ctx.length - 1)
            self.levels[idx] = 1.0

        return [lerp_color(background, color, clamp(level)) for level in self.levels]


class Confetti(Effect):
    name = "confetti"
    label = "Confetti"
    category = "party"
    description = "Kleurige confetti-flitsen"
    default_params = {"chance": 0.22, "fade": 0.9, "palette": "neon"}

    def __init__(self) -> None:
        self.levels: List[float] = []
        self.colors: List[RGB] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        if len(self.levels) != ctx.length:
            self.levels = [0.0] * ctx.length
            self.colors = [(255, 255, 255)] * ctx.length

        chance = max(0.0, ctx.params.get("chance", 0.22))
        fade = clamp(ctx.params.get("fade", 0.9), 0.0, 0.999)
        palette = make_palette(ctx.params.get("palette", "neon"))

        decay = pow(fade, ctx.dt * 60)
        self.levels = [level * decay for level in self.levels]

        spawns = max(0, int(ctx.length * chance * ctx.dt * 6))
        for _ in range(spawns):
            idx = random.randint(0, ctx.length - 1)
            self.levels[idx] = 1.0
            hue_pos = random.random()
            self.colors[idx] = palette_color(palette, hue_pos)

        return [tuple(int(ch * clamp(level)) for ch in self.colors[i]) for i, level in enumerate(self.levels)]


class GlitterOverlay(Effect):
    name = "glitter_overlay"
    label = "Glitter Overlay"
    category = "party"
    description = "Glitterlaag over je huidige effect"
    default_params = {"amount": 0.35, "base": [12, 12, 12], "sparkle": [255, 255, 255], "decay": 0.9}

    def __init__(self) -> None:
        self.levels: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        if len(self.levels) != ctx.length:
            self.levels = [0.0] * ctx.length
        amount = clamp(ctx.params.get("amount", 0.35), 0.0, 2.0)
        decay = clamp(ctx.params.get("decay", 0.9), 0.1, 0.99)
        base_color = tuple(ctx.params.get("base", [12, 12, 12]))  # type: ignore
        sparkle_color = tuple(ctx.params.get("sparkle", [255, 255, 255]))  # type: ignore

        decay_factor = pow(decay, ctx.dt * 60)
        self.levels = [lvl * decay_factor for lvl in self.levels]

        spawn = max(1, int(ctx.length * amount * ctx.dt * 4))
        for _ in range(spawn):
            idx = random.randint(0, ctx.length - 1)
            self.levels[idx] = 1.0

        return [lerp_color(base_color, sparkle_color, clamp(level)) for level in self.levels]


# --- Audio-reactive ---

class AudioBars(Effect):
    name = "audio_bars"
    label = "Audio Bars"
    category = "music"
    description = "Spectrum-balken reageren op audio (mirror optioneel)"
    default_params = {"mirror": True, "palette": "neon", "span": 0}  # span=0 => automatisch volle lengte

    def render(self, ctx: EffectContext) -> List[RGB]:
        bands = ctx.audio.get("bands", [0.0] * 8)
        palette = make_palette(ctx.params.get("palette", "neon"))
        mirror = ctx.params.get("mirror", True)
        raw_span = ctx.params.get("span", 0)
        span = int(raw_span) if raw_span else ctx.length
        span = max(1, min(span, ctx.length))
        segments = len(bands)
        boosted = [min(1.0, pow(level, 0.85) * 1.6) for level in bands]

        if mirror:
            target_len = max(1, span // 2)
            seg_len = max(1, target_len // segments) if segments else target_len
            half = [(0, 0, 0)] * target_len
            for i, level in enumerate(boosted):
                height = max(1, int(level * seg_len))
                for k in range(height):
                    idx = i * seg_len + k
                    if idx < target_len:
                        half[idx] = palette_color(palette, i / max(1, segments - 1))
            res = list(reversed(half)) + half
            if len(res) < span:
                res += [(0, 0, 0)] * (span - len(res))
            if len(res) < ctx.length:
                res += [(0, 0, 0)] * (ctx.length - len(res))
            return res[: ctx.length]

        res = [(0, 0, 0)] * ctx.length
        seg_len = max(1, span // segments) if segments else span
        for i, level in enumerate(boosted):
            height = max(1, int(level * seg_len))
            for k in range(height):
                idx = i * seg_len + k
                if idx < span and idx < ctx.length:
                    res[idx] = palette_color(palette, i / max(1, segments - 1))
        return res[: ctx.length]


class EnergyWave(Effect):
    name = "energy_wave"
    label = "Energy Wave"
    category = "music"
    description = "Audio-golf die meedeint op volume"
    default_params = {"color": [0, 255, 200]}

    def render(self, ctx: EffectContext) -> List[RGB]:
        level = ctx.audio.get("vol", 0.0)
        color = tuple(ctx.params.get("color", [0, 255, 200]))  # type: ignore
        res = []
        for i in range(ctx.length):
            t = math.sin((i / ctx.length * math.pi * 2) + ctx.time * 4) * 0.5 + 0.5
            intensity = clamp(t * level * 2)
            res.append(tuple(int(c * intensity) for c in color))
        return res


class BassPulse(Effect):
    name = "bass_pulse"
    label = "Bass Pulse"
    category = "music"
    description = "Pulse op lage tonen, kleur instelbaar"
    default_params = {"color": [255, 90, 0]}

    def render(self, ctx: EffectContext) -> List[RGB]:
        bass = ctx.audio.get("bands", [0.0])[0] if ctx.audio.get("bands") else 0.0
        color = tuple(ctx.params.get("color", [255, 90, 0]))  # type: ignore
        intensity = clamp(bass * 2)
        return [tuple(int(c * intensity) for c in color)] * ctx.length


class FireAudio(Effect):
    name = "fire_audio"
    label = "Fire Audio"
    category = "music"
    description = "Vuurgloed met audio-gestuurde beweging"
    default_params = {"speed": 0.4}

    def render(self, ctx: EffectContext) -> List[RGB]:
        level = ctx.audio.get("vol", 0.0)
        speed = ctx.params.get("speed", 0.4) + level * 0.6
        res = []
        for i in range(ctx.length):
            n = fractal_noise(i * 0.1 + ctx.time * speed, 4, seed=42)
            heat = clamp(n + level)
            res.append(palette_color(make_palette("fire"), heat))
        return res


class SpectrumGravity(Effect):
    name = "spectrum_gravity"
    label = "Spectrum Gravity"
    category = "music"
    description = "Frequentie-balken met langzaam dalende pieken"
    default_params = {"decay": 0.95, "palette": "ocean"}

    def __init__(self) -> None:
        self.peaks: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        bands = ctx.audio.get("bands", [0.0] * 8)
        palette = make_palette(ctx.params.get("palette", "ocean"))
        decay = ctx.params.get("decay", 0.95)
        if len(self.peaks) != len(bands):
            self.peaks = [0.0] * len(bands)
        res = [(0, 0, 0)] * ctx.length
        seg_len = ctx.length // len(bands) if bands else ctx.length
        for i, level in enumerate(bands):
            self.peaks[i] = max(level, self.peaks[i] * decay)
            height = max(1, int(pow(self.peaks[i], 0.82) * seg_len * 1.6))
            for k in range(height):
                idx = i * seg_len + k
                if idx < ctx.length:
                    res[idx] = palette_color(palette, i / max(1, len(bands) - 1))
            # extra glow at de basis voor meer spektakel
            base_idx = i * seg_len
            if base_idx < ctx.length:
                res[base_idx] = palette_color(palette, i / max(1, len(bands) - 1))
        return res


class PixelRipple(Effect):
    name = "pixel_ripple"
    label = "Pixel Ripple"
    category = "music"
    description = "Ripple vanuit een beat naar buiten"
    default_params = {"color": [0, 200, 255], "fade": 0.9}

    def __init__(self) -> None:
        self.origin = 0
        self.radius = 0

    def render(self, ctx: EffectContext) -> List[RGB]:
        if ctx.audio.get("beat"):
            self.origin = random.randint(0, max(0, ctx.length - 1))
            self.radius = 1
        else:
            self.radius += ctx.dt * 60
        fade = ctx.params.get("fade", 0.9)
        color = tuple(ctx.params.get("color", [0, 200, 255]))  # type: ignore
        res = []
        for i in range(ctx.length):
            dist = abs(i - self.origin)
            if dist <= self.radius:
                factor = max(0.0, 1 - (dist / max(1, self.radius)))
                res.append(tuple(int(c * pow(fade, dist) * factor) for c in color))
            else:
                res.append((0, 0, 0))
        return res


class StrobeOnBeat(Effect):
    name = "strobe_on_beat"
    label = "Strobe on Beat"
    category = "music"
    description = "Flits bij elke gedetecteerde beat"
    default_params = {"color": [255, 255, 255], "flash_ms": 80}

    def __init__(self) -> None:
        self.last_flash = 0.0

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [255, 255, 255]))  # type: ignore
        duration = ctx.params.get("flash_ms", 80) / 1000.0
        if ctx.audio.get("beat"):
            self.last_flash = ctx.time
        on = (ctx.time - self.last_flash) < duration
        return [color if on else (0, 0, 0)] * ctx.length


class SpectrumStream(Effect):
    name = "spectrum_stream"
    label = "Spectrum Stream"
    category = "music"
    description = "VU-meter vanuit het midden, per audioband"
    default_params = {"palette": "neon"}

    def render(self, ctx: EffectContext) -> List[RGB]:
        bands = ctx.audio.get("bands", [0.0] * 8)
        palette = make_palette(ctx.params.get("palette", "neon"))
        res = [(0, 0, 0)] * ctx.length
        half = ctx.length // 2
        for i, level in enumerate(bands):
            length = int(level * half)
            col = palette_color(palette, i / max(1, len(bands) - 1))
            for k in range(length):
                if half + k < ctx.length:
                    res[half + k] = col
                if half - k - 1 >= 0:
                    res[half - k - 1] = col
        return res


class BeatWave(Effect):
    name = "beat_wave"
    label = "Beat Wave"
    category = "music"
    description = "Golf die vanuit midden uitrolt op beats"
    default_params = {"color": [180, 120, 255], "speed": 1.8, "decay": 0.92}

    def __init__(self) -> None:
        self.last_beat = 0.0

    def render(self, ctx: EffectContext) -> List[RGB]:
        color = tuple(ctx.params.get("color", [180, 120, 255]))  # type: ignore
        speed = ctx.params.get("speed", 1.8)
        decay = ctx.params.get("decay", 0.92)
        if ctx.audio.get("beat"):
            self.last_beat = ctx.time
        age = max(0.0, ctx.time - self.last_beat)
        radius = age * speed * (ctx.length / 2)
        res: List[RGB] = []
        mid = ctx.length // 2
        for i in range(ctx.length):
            dist = abs(i - mid)
            if dist <= radius:
                fade = pow(max(0.0, 1 - dist / max(1, radius)), 2)
                res.append(tuple(int(c * fade) for c in color))  # type: ignore
            else:
                res.append((0, 0, 0))
        # zachte decay
        return [tuple(int(ch * pow(decay, age * 10)) for ch in px) for px in res]


class HazePulse(Effect):
    name = "haze_pulse"
    label = "Haze Pulse"
    category = "music"
    description = "Zachte paarse haze met audio-pulsen"
    default_params = {"palette": "neon", "speed": 0.6, "depth": 0.35}

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "neon"))
        speed = ctx.params.get("speed", 0.6)
        depth = ctx.params.get("depth", 0.35)
        vol = ctx.audio.get("vol", 0.0)
        res: List[RGB] = []
        for i in range(ctx.length):
            pos = (i / max(1, ctx.length - 1)) + ctx.time * speed
            base = palette_color(palette, pos)
            haze = 0.25 + depth * (math.sin(pos * 4 + ctx.time * 2) * 0.5 + 0.5)
            boost = 0.5 + vol * 1.2
            mix = tuple(int(min(255, c * (haze + boost * 0.5))) for c in base)  # type: ignore
            res.append(mix)
        return res


class PrismBass(Effect):
    name = "prism_bass"
    label = "Prism Bass"
    category = "music"
    description = "Gespiegelde prisma-balken op bass"
    default_params = {"palette": "neon", "mirror": True}

    def render(self, ctx: EffectContext) -> List[RGB]:
        bands = ctx.audio.get("bands", [0.0] * 8)
        palette = make_palette(ctx.params.get("palette", "neon"))
        mirror = ctx.params.get("mirror", True)
        segments = len(bands)
        if segments == 0:
            return [(0, 0, 0)] * ctx.length
        half_len = ctx.length // (2 if mirror else 1)
        seg_len = max(1, half_len // segments)
        half = [(0, 0, 0)] * half_len
        for i, level in enumerate(bands):
            height = max(1, int(pow(level, 0.8) * seg_len * 1.7))
            col = palette_color(palette, i / max(1, segments - 1))
            for k in range(height):
                idx = i * seg_len + k
                if idx < half_len:
                    half[idx] = col
        if mirror:
            res = list(reversed(half)) + half
            if len(res) < ctx.length:
                res += [(0, 0, 0)] * (ctx.length - len(res))
            return res[: ctx.length]
        return half[: ctx.length]


class SpectrumFlow(Effect):
    name = "spectrum_flow"
    label = "Spectrum Flow"
    category = "music"
    description = "Breedband golf die de hele strip vult en meepulst per band"
    default_params = {"palette": "neon", "speed": 0.85, "trail": 0.84}

    def __init__(self) -> None:
        self.energy: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        bands = ctx.audio.get("bands", [0.0] * 8)
        palette = make_palette(ctx.params.get("palette", "neon"))
        speed = ctx.params.get("speed", 0.85)
        trail = ctx.params.get("trail", 0.84)
        if len(self.energy) != ctx.length:
            self.energy = [0.0] * ctx.length

        for i in range(ctx.length):
            pos = i / max(1, ctx.length - 1)
            band_pos = pos * max(1, len(bands) - 1)
            idx = int(band_pos)
            frac = band_pos - idx
            b1 = bands[idx] if idx < len(bands) else 0.0
            b2 = bands[idx + 1] if idx + 1 < len(bands) else b1
            level = clamp((1 - frac) * b1 + frac * b2)
            sweep = math.sin((pos + ctx.time * speed) * math.pi * 2) * 0.5 + 0.5
            target = clamp(level * 1.4 * (0.4 + sweep * 0.6))
            self.energy[i] = max(target, self.energy[i] * trail)

        res: List[RGB] = []
        for i, val in enumerate(self.energy):
            hue_pos = (ctx.time * speed * 0.2 + i / max(1, ctx.length - 1)) % 1.0
            col = palette_color(palette, hue_pos)
            res.append(tuple(int(c * val) for c in col))  # type: ignore
        return res


class AudioShimmer(Effect):
    name = "audio_shimmer"
    label = "Audio Shimmer"
    category = "music"
    description = "Glitterende stroken op audiobanden met decay"
    default_params = {"palette": "pastel", "trail": 0.9, "sensitivity": 1.3, "sparkle": 0.2}

    def __init__(self) -> None:
        self.energy: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        bands = ctx.audio.get("bands", [0.0] * 8)
        palette = make_palette(ctx.params.get("palette", "pastel"))
        trail = clamp(ctx.params.get("trail", 0.9), 0.5, 0.99)
        sensitivity = clamp(ctx.params.get("sensitivity", 1.3), 0.2, 3.0)
        sparkle = clamp(ctx.params.get("sparkle", 0.2), 0.0, 1.0)
        if len(self.energy) != ctx.length:
            self.energy = [0.0] * ctx.length

        res: List[RGB] = []
        for i in range(ctx.length):
            pos = i / max(1, ctx.length - 1)
            band_pos = pos * max(1, len(bands) - 1)
            idx = int(band_pos)
            frac = band_pos - idx
            b1 = bands[idx] if idx < len(bands) else 0.0
            b2 = bands[idx + 1] if idx + 1 < len(bands) else b1
            level = clamp((1 - frac) * b1 + frac * b2) * sensitivity
            self.energy[i] = max(level, self.energy[i] * trail)
            hue = (ctx.time * 0.12 + pos) % 1.0
            base = palette_color(palette, hue)
            energy = clamp(self.energy[i] + (random.random() * sparkle if level > 0.4 else 0))
            res.append(tuple(int(c * energy) for c in base))  # type: ignore
        return res


class BeatStreaks(Effect):
    name = "beat_streaks"
    label = "Beat Streaks"
    category = "music"
    description = "Heldere streaks over de hele strip op beats en flux"
    default_params = {"palette": "sunset", "trail": 0.82, "speed": 1.6}

    def __init__(self) -> None:
        self.streaks: List[Dict] = []
        self.decay: List[float] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "sunset"))
        trail = ctx.params.get("trail", 0.82)
        speed = ctx.params.get("speed", 1.6)
        vol = ctx.audio.get("vol", 0.0)
        flux = ctx.audio.get("flux", 0.0)
        beat = ctx.audio.get("beat", False)
        if len(self.decay) != ctx.length:
            self.decay = [0.0] * ctx.length

        spawn_prob = 0.15 + vol * 0.6 + flux * 0.5
        spawn_chance = spawn_prob * ctx.dt
        if beat or random.random() < spawn_chance:
            origin = random.randint(0, max(0, ctx.length - 1))
            direction = random.choice([-1, 1])
            self.streaks.append({"pos": origin, "dir": direction, "life": 1.0})
            if len(self.streaks) > 24:
                self.streaks = self.streaks[-24:]

        res_vals = [0.0] * ctx.length
        next_streaks = []
        for s in self.streaks:
            s["pos"] += s["dir"] * speed * ctx.dt * ctx.length * (1.0 + vol)
            s["life"] *= 0.985
            if s["life"] < 0.08:
                continue
            if -ctx.length <= s["pos"] <= ctx.length * 2:
                next_streaks.append(s)
            center = int(s["pos"])
            for k in range(-8, 9):
                idx = center + k
                if 0 <= idx < ctx.length:
                    falloff = max(0.0, 1 - abs(k) / 8)
                    res_vals[idx] = max(res_vals[idx], falloff * s["life"])
        self.streaks = next_streaks

        res: List[RGB] = []
        base_haze = 0.08 + vol * 0.35
        for i in range(ctx.length):
            self.decay[i] = max(res_vals[i], self.decay[i] * trail)
            brightness = clamp(base_haze + self.decay[i])
            col = palette_color(palette, (ctx.time * 0.25 + i / max(1, ctx.length - 1)) % 1.0)
            res.append(tuple(int(c * brightness) for c in col))
        return res


class FluxTunnel(Effect):
    name = "flux_tunnel"
    label = "Flux Tunnel"
    category = "music"
    description = "Tunnel-achtige golf vanuit het midden, gestuurd door flux en bass"
    default_params = {"palette": "ocean", "speed": 1.2, "depth": 2.3}

    def __init__(self) -> None:
        self.phase = 0.0

    def render(self, ctx: EffectContext) -> List[RGB]:
        palette = make_palette(ctx.params.get("palette", "ocean"))
        speed = ctx.params.get("speed", 1.2)
        depth = ctx.params.get("depth", 2.3)
        vol = ctx.audio.get("vol", 0.0)
        flux = ctx.audio.get("flux", 0.0)
        bass = ctx.audio.get("bass", 0.0)
        self.phase = (self.phase + ctx.dt * (speed + flux * 2.0)) % 1.0
        center = (ctx.length - 1) / 2
        res: List[RGB] = []
        for i in range(ctx.length):
            dist = abs(i - center) / max(1.0, center)
            tunnel = max(0.0, 1 - dist)
            swirl = math.sin(dist * depth * math.pi + self.phase * 2 * math.pi) * 0.5 + 0.5
            energy = clamp(tunnel * (0.45 + vol * 1.2) + swirl * 0.55 + flux * 0.9 + bass * 0.7)
            col = palette_color(palette, (self.phase + i / max(1, ctx.length - 1)) % 1.0)
            res.append(tuple(int(c * energy) for c in col))
        return res


class PulseWhite(Effect):
    name = "pulse_white"
    label = "Pulse White"
    category = "ambient"
    description = "Zachte wit/koele pulse"
    default_params = {"color": [255, 255, 255], "speed": 0.6, "intensity": 0.8}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.6)
        inten = ctx.params.get("intensity", 0.8)
        base = tuple(ctx.params.get("color", [255, 255, 255]))  # type: ignore
        phase = (math.sin(ctx.time * speed * 2 * math.pi) + 1) / 2
        val = inten * phase
        return [tuple(int(c * val) for c in base)] * ctx.length  # type: ignore


class Sunrise(Effect):
    name = "sunrise"
    label = "Sunrise"
    category = "ambient"
    description = "Langzame sunrise van onder naar boven"
    default_params = {"speed": 0.08}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.08)
        palette = [(20, 10, 0), (120, 30, 0), (220, 120, 30), (255, 200, 120), (255, 235, 200)]
        res: List[RGB] = []
        for i in range(ctx.length):
            pos = (i / max(1, ctx.length - 1)) + ctx.time * speed
            res.append(palette_color(palette, pos))
        return res


class MatrixRain(Effect):
    name = "matrix_rain"
    label = "Matrix Rain"
    category = "party"
    description = "Groene digital rain"
    default_params = {"density": 0.12, "speed": 1.1, "fade": 0.72, "tail": 10}

    def __init__(self) -> None:
        self.drops: List[Dict[str, float]] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        density = clamp(ctx.params.get("density", 0.12), 0.01, 1.0)
        speed = max(0.1, ctx.params.get("speed", 1.1))
        fade = clamp(ctx.params.get("fade", 0.72), 0.1, 0.98)
        tail = max(2, int(ctx.params.get("tail", 10)))

        target = max(1, int(ctx.length * density))
        while len(self.drops) < target:
            self.drops.append({"pos": random.uniform(-tail, ctx.length), "vel": speed * (0.7 + random.random() * 0.6)})

        res: List[RGB] = [(0, 0, 0)] * ctx.length
        next_drops: List[Dict[str, float]] = []
        for drop in self.drops:
            drop["pos"] += drop["vel"] * ctx.dt * ctx.length * 0.45
            if drop["pos"] < ctx.length + tail:
                next_drops.append(drop)
            head = int(drop["pos"])
            for k in range(tail):
                idx = head - k
                if 0 <= idx < ctx.length:
                    strength = pow(fade, k) * 1.1
                    res[idx] = (0, int(255 * clamp(strength)), 0)
        self.drops = next_drops
        # Gentle green haze background
        for i in range(ctx.length):
            if res[i] == (0, 0, 0):
                res[i] = (0, int(45 * fade), 0)
        return res


class WarpSpeed(Effect):
    name = "warp_speed"
    label = "Warp Speed"
    category = "party"
    description = "Witte streaks vanuit het midden (hyperspace)"
    default_params = {"speed": 1.8, "trail": 0.7, "count": 8, "glow": 0.28}

    def __init__(self) -> None:
        self.streaks: List[Dict[str, float]] = []

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = max(0.1, ctx.params.get("speed", 1.8))
        trail = clamp(ctx.params.get("trail", 0.7), 0.05, 1.0)
        count = max(2, int(ctx.params.get("count", 8)))
        glow = clamp(ctx.params.get("glow", 0.28), 0.0, 1.0)
        center = (ctx.length - 1) / 2.0

        while len(self.streaks) < count:
            dir = random.choice([-1.0, 1.0])
            self.streaks.append({"pos": 0.0, "dir": dir, "phase": random.random(), "life": 1.0})

        res: List[RGB] = [(0, 0, 0)] * ctx.length
        next_streaks: List[Dict[str, float]] = []
        tail_len = max(1, int(center * trail))

        for streak in self.streaks:
            velocity = speed * (1.1 + streak["phase"] * 0.6)
            streak["pos"] += streak["dir"] * velocity * ctx.dt * ctx.length * 0.5
            streak["life"] *= 0.993
            head = center + streak["pos"]

            if streak["life"] < 0.08 or head < -tail_len or head > ctx.length + tail_len:
                continue
            next_streaks.append(streak)

            for k in range(tail_len):
                idx = int(head - streak["dir"] * k)
                if 0 <= idx < ctx.length:
                    val = max(0.0, 1 - k / max(1, tail_len))
                    brightness = clamp(val * streak["life"])
                    col = int(255 * clamp(brightness))
                    base = res[idx]
                    res[idx] = (max(base[0], col), max(base[1], col), max(base[2], col))

        self.streaks = next_streaks

        if glow > 0:
            haze = int(255 * glow * 0.5)
            res = [(max(r, haze), max(g, haze), max(b, haze)) for (r, g, b) in res]

        return res


class SparkleWave(Effect):
    name = "sparkle_wave"
    label = "Sparkle Wave"
    category = "ambient"
    description = "Glitter over een zachte golf"
    default_params = {"color": [80, 160, 255], "speed": 0.7, "sparkles": 0.08}

    def render(self, ctx: EffectContext) -> List[RGB]:
        speed = ctx.params.get("speed", 0.7)
        sparkles = ctx.params.get("sparkles", 0.08)
        base = tuple(ctx.params.get("color", [80, 160, 255]))  # type: ignore
        res: List[RGB] = []
        for i in range(ctx.length):
            phase = (math.sin((i / max(1, ctx.length - 1)) * math.pi * 2 + ctx.time * speed) + 1) / 2
            val = 0.4 + 0.6 * phase
            col = tuple(int(c * val) for c in base)  # type: ignore
            res.append(col)
        count = max(1, int(ctx.length * sparkles))
        for _ in range(count):
            idx = random.randint(0, ctx.length - 1)
            res[idx] = (255, 255, 255)
        return res


# Register all effects
for cls in [
    SolidColor,
    ColorWipe,
    TheaterChase,
    Strobe,
    BlinkPattern,
    GradientScroll,
    Rainbow,
    RainbowCycle,
    RainbowWhite,
    PaletteEffect,
    Breathing,
    SoftWave,
    ColorFade,
    SuperSmooth,
    LavaFlow,
    FireNoise,
    Plasma,
    Aurora,
    PrismaticNoise,
    Comet,
    KnightRider,
    GapChase,
    MultiComet,
    Twinkle,
    Confetti,
    GlitterOverlay,
    AudioBars,
    EnergyWave,
    BassPulse,
    FireAudio,
    SpectrumGravity,
    PixelRipple,
    StrobeOnBeat,
    SpectrumStream,
    BeatWave,
    HazePulse,
    PrismBass,
    SpectrumFlow,
    AudioShimmer,
    BeatStreaks,
    FluxTunnel,
    PulseWhite,
    Sunrise,
    MatrixRain,
    WarpSpeed,
    SparkleWave,
    DualWave,
]:
    register(cls)
