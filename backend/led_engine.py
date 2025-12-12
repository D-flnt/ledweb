import math
import os
import threading
import time
from typing import Dict, List, Optional, Tuple

try:
    from rpi_ws281x import Color, PixelStrip, WS2811_STRIP_GRB
except Exception:  # pragma: no cover - hardware fallback
    PixelStrip = None
    Color = None
    WS2811_STRIP_GRB = None

from .effects import EFFECTS, EffectContext, Effect

RGB = Tuple[int, int, int]


def _clamp_color(val: float) -> int:
    return max(0, min(255, int(val)))


class DummyStrip:
    def __init__(self, num: int) -> None:
        self._n = num
        self._buf = [(0, 0, 0)] * num

    def numPixels(self) -> int:
        return self._n

    def setPixelColor(self, i: int, c: Tuple[int, int, int]) -> None:
        if 0 <= i < self._n:
            self._buf[i] = c

    def show(self) -> None:
        return

    def begin(self) -> None:
        return


class LEDEngine:
    def __init__(self, hardware_cfg: Dict[str, int]) -> None:
        self.cfg = hardware_cfg
        self.strip = self._init_strip(hardware_cfg)
        self.state = {
            "on": True,
            "brightness": hardware_cfg.get("brightness", 200),
            "effect": "rainbow_cycle",
            "fps": 60,
            "intensity_boost": 1.0,
            "max_leds": hardware_cfg.get("led_count", self.strip.numPixels()),
            "effect_params": {},
            # Live/global controls are separated from effect params so the UI can expose them cleanly.
            "live": {
                "master_speed": 1.0,
                "gamma": 1.0,
                "frame_blend": 0.15,
                "direction": "forward",
                "dither": True,
                "dither_strength": 0.3,
            },
            "segments": [],
        }
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self._last_frame = time.time()
        self._audio_snapshot: Dict = {"bands": [0.0] * 8, "vol": 0.0, "beat": False, "bpm": 0.0}
        # Cache effect instances so stateful effects keep their internal state
        self._effect_cache: Dict[str, Effect] = {}
        self._timeline = 0.0
        self._frame_id = 0
        led_count = self.strip.numPixels()
        self._last_buffer: List[RGB] = [(0, 0, 0)] * led_count
        self._smooth_buffer: List[RGB] = list(self._last_buffer)

    def _init_strip(self, cfg: Dict[str, int]):
        num = cfg.get("led_count", 300)
        if os.environ.get("LED_FAKE", "0") == "1" or PixelStrip is None:
            return DummyStrip(num)
        strip = PixelStrip(
            num,
            cfg.get("gpio_pin", 18),
            cfg.get("freq_hz", 800_000),
            cfg.get("dma", 10),
            cfg.get("invert", False),
            cfg.get("brightness", 255),
            cfg.get("channel", 0),
            WS2811_STRIP_GRB if WS2811_STRIP_GRB is not None else 0,
        )
        strip.begin()
        return strip

    def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._thread:
            self._thread.join(timeout=1)

    def update_state(self, **kwargs) -> Dict:
        with self._lock:
            incoming_live = kwargs.pop("live", None)
            # Backwards compatibility: accept "params" as effect params.
            if "params" in kwargs and "effect_params" not in kwargs:
                kwargs["effect_params"] = kwargs.pop("params") or {}
            if incoming_live:
                live_state = dict(self.state.get("live", {}))
                live_state.update(incoming_live)
                self.state["live"] = live_state
            self.state.update(kwargs)
            # Maintain "params" alias for the API/UI while migrating to "effect_params".
            self.state["params"] = dict(self.state.get("effect_params", {}))
            return dict(self.state)

    def set_segments(self, segments: List[Dict]) -> List[Dict]:
        with self._lock:
            self.state["segments"] = segments
            # Reset cache to avoid leaking state between old/new segment layouts.
            self._effect_cache = {}
            return segments

    def snapshot(self) -> Dict:
        with self._lock:
            snap = dict(self.state)
            snap["params"] = dict(self.state.get("effect_params", {}))
            snap["frame_preview"] = list(self._last_buffer)
            return snap

    def update_audio_snapshot(self, snap: Dict) -> None:
        self._audio_snapshot = snap

    def _loop(self) -> None:
        while self.running:
            start = time.time()
            dt = start - self._last_frame
            self._last_frame = start
            frame = self._render_frame(dt)
            self._apply_frame(frame)
            elapsed = time.time() - start
            with self._lock:
                target_fps = float(self.state.get("fps", 60))
            target_fps = max(10.0, min(240.0, target_fps))
            sleep_for = max(0.0, (1 / target_fps) - elapsed)
            time.sleep(sleep_for)

    def _render_frame(self, dt: float) -> List[RGB]:
        # Build one frame of LED data based on current state, segments and audio snapshot.
        with self._lock:
            state = dict(self.state)
            live = {
                "master_speed": 1.0,
                "gamma": 1.0,
                "frame_blend": 0.15,
                "direction": "forward",
                "dither": True,
                "dither_strength": 0.3,
                **(state.get("live") or {}),
            }

        led_limit = max(1, int(state.get("max_leds", self.strip.numPixels())))
        led_count = min(self.strip.numPixels(), led_limit)
        global_boost = max(0.1, min(3.0, float(state.get("intensity_boost", 1.0))))
        buffer: List[RGB] = [(0, 0, 0)] * led_count

        segments = state.get("segments") or [
            {
                "name": "Strip",
                "start": 0,
                "end": led_count - 1,
                "effect": state.get("effect"),
                "params": state.get("effect_params", {}),
            }
        ]

        master_speed = max(0.05, min(10.0, float(live.get("master_speed", 1.0))))
        self._timeline += dt * master_speed
        t = self._timeline
        dt_scaled = dt * master_speed

        for seg in segments:
            start_idx = max(0, int(seg.get("start", 0)))
            end_idx = min(led_count - 1, int(seg.get("end", led_count - 1)))
            if end_idx < start_idx:
                continue

            length = max(1, end_idx - start_idx + 1)

            effect_name = seg.get("effect") or state.get("effect")
            if not effect_name:
                continue

            effect_cls = EFFECTS.get(effect_name)
            if not effect_cls:
                continue

            # Use cached instance so stateful effects keep their internal state per segment.
            cache_key = f"{effect_name}:{start_idx}:{end_idx}"
            effect = self._effect_cache.get(cache_key)
            if effect is None or not isinstance(effect, effect_cls):
                effect = effect_cls()
                self._effect_cache[cache_key] = effect

            base_params = dict(state.get("effect_params") or state.get("params") or {})
            seg_params = seg.get("params") or {}
            params = {**base_params, **seg_params}

            intensity = float(params.get("intensity", 1.0)) * global_boost

            context = EffectContext(
                time=t,
                dt=dt_scaled,
                length=length,
                params=params,
                audio=self._audio_snapshot,
                global_state=state,
                segment=seg,
                timeline=t,
                master_speed=master_speed,
                live=live,
            )

            try:
                colors = effect.render(context)
            except Exception:
                # Fail soft: if an effect blows up, keep the strip dark instead of crashing the loop
                colors = [(0, 0, 0)] * length

            # Normalise length to segment size
            if len(colors) < length:
                if not colors:
                    colors = [(0, 0, 0)] * length
                else:
                    colors = (colors * (length // len(colors) + 1))[:length]
            elif len(colors) > length:
                colors = colors[:length]

            for i, c in enumerate(colors):
                idx = start_idx + i
                if 0 <= idx < led_count:
                    buffer[idx] = tuple(_clamp_color(ch * intensity) for ch in c)
        if not state.get("on", True):
            buffer = [(0, 0, 0)] * led_count
        else:
            brightness = state.get("brightness", 255) / 255.0
            buffer = [(_clamp_color(r * brightness), _clamp_color(g * brightness), _clamp_color(b * brightness)) for r, g, b in buffer]

        buffer = self._apply_frame_filters(buffer, live)
        self._last_buffer = list(buffer)
        return buffer

    def _apply_frame_filters(self, frame: List[RGB], live: Dict) -> List[RGB]:
        if not frame:
            return frame
        gamma = max(0.2, min(4.0, float(live.get("gamma", 1.0))))
        blend = max(0.0, min(0.98, float(live.get("frame_blend", live.get("smoothing", 0.0)))))
        direction = str(live.get("direction", "forward"))
        dither = bool(live.get("dither", False))
        dither_strength = max(0.0, min(1.0, float(live.get("dither_strength", 1.0))))

        if len(self._smooth_buffer) != len(frame):
            self._smooth_buffer = [(0, 0, 0)] * len(frame)

        if blend > 0:
            mix = 1.0 - blend
            blended: List[RGB] = []
            for (nr, ng, nb), (pr, pg, pb) in zip(frame, self._smooth_buffer):
                blended.append(
                    (
                        _clamp_color(pr + (nr - pr) * mix),
                        _clamp_color(pg + (ng - pg) * mix),
                        _clamp_color(pb + (nb - pb) * mix),
                    )
                )
            frame = blended
        self._smooth_buffer = list(frame)

        if abs(gamma - 1.0) > 1e-3:
            inv = 1.0 / gamma
            frame = [
                (
                    _clamp_color(pow(r / 255.0, inv) * 255),
                    _clamp_color(pow(g / 255.0, inv) * 255),
                    _clamp_color(pow(b / 255.0, inv) * 255),
                )
                for r, g, b in frame
            ]

        if dither:
            salt = (self._frame_id * 31) & 0xFF
            jittered: List[RGB] = []
            for i, (r, g, b) in enumerate(frame):
                noise = ((i * 73 + salt) % 7) - 3  # -3..3
                adjust = noise * 0.35 * dither_strength
                jittered.append(
                    (
                        _clamp_color(r + adjust),
                        _clamp_color(g + adjust),
                        _clamp_color(b + adjust),
                    )
                )
            frame = jittered

        if direction == "reverse":
            frame = list(reversed(frame))
        elif direction == "center":
            mid = (len(frame) - 1) / 2.0
            mirrored: List[RGB] = []
            for i in range(len(frame)):
                src = int(abs(i - mid))
                mirrored.append(frame[min(src, len(frame) - 1)])
            frame = mirrored

        self._frame_id = (self._frame_id + 1) % 10_000_000
        return frame

    def _apply_frame(self, frame: List[RGB]) -> None:
        total = self.strip.numPixels()
        for i, (r, g, b) in enumerate(frame):
            if Color:
                self.strip.setPixelColor(i, Color(r, g, b))
            else:
                self.strip.setPixelColor(i, (r, g, b))
        if len(frame) < total:
            for i in range(len(frame), total):
                if Color:
                    self.strip.setPixelColor(i, Color(0, 0, 0))
                else:
                    self.strip.setPixelColor(i, (0, 0, 0))
        self.strip.show()
