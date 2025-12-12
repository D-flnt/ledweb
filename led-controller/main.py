import argparse
import asyncio
import colorsys
import json
import math
import os
import signal
import sys
import threading
import time
from typing import Dict, List, Set

import numpy as np
import pyaudio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from rpi_ws281x import Color, PixelStrip

# --- CONFIGURATIE ---
LED_COUNT = 300
LED_PIN = 18
LED_FREQ_HZ = 800000
LED_DMA = 10
LED_BRIGHTNESS = 255
LED_INVERT = False
LED_CHANNEL = 0
CONFIG_FILE = os.path.join("config", "settings.json")

# --- GLOBALS & STATE ---
strip: PixelStrip = None
app = FastAPI()
connections: Set[WebSocket] = set()

state: Dict[str, object] = {
    "on": True,
    "brightness": 128,
    "effect": "solid",
    "primary_color": "#00ffcc",  # Neon Cyan default
    "secondary_color": "#ff00ff",  # Neon Magenta default
    "speed": 128,  # 0-255
    "intensity": 128,  # 0-255
    "fps": 60,
    "audio_enabled": True,
    "audio_gain": 5.0,
    "audio_squelch": 10,
}

audio_data: Dict[str, object] = {
    "vol": 0.0,
    "bands": [0.0] * 8,
    "beat": False,
    "last_beat": 0.0,
}

# Frequentiebanden (Hz): Sub, Bass, Low-Mid, Mid, High-Mid, Presence, Brilliance
BAND_RANGES = [
    (20, 60),
    (60, 120),
    (120, 250),
    (250, 500),
    (500, 2000),
    (2000, 4000),
    (4000, 6000),
    (6000, 12000),
]


# --- HELPER FUNCTIES ---
def hex_to_rgb(hex_code: str):
    hex_code = hex_code.lstrip("#")
    return tuple(int(hex_code[i : i + 2], 16) for i in (0, 2, 4))


def wheel(pos):
    """Genereert regenboogkleuren over 0-255 posities."""
    if pos < 85:
        return Color(pos * 3, 255 - pos * 3, 0)
    elif pos < 170:
        pos -= 85
        return Color(255 - pos * 3, 0, pos * 3)
    else:
        pos -= 170
        return Color(0, pos * 3, 255 - pos * 3)


def scale_color(color, brightness):
    """Schaalt een kleur op basis van helderheid (0-255)."""
    r = (color >> 16) & 0xFF
    g = (color >> 8) & 0xFF
    b = color & 0xFF
    factor = brightness / 255.0
    return Color(int(r * factor), int(g * factor), int(b * factor))


def lerp_color(c1, c2, t: float):
    t = max(0.0, min(1.0, t))
    r = int(c1[0] + (c2[0] - c1[0]) * t)
    g = int(c1[1] + (c2[1] - c1[1]) * t)
    b = int(c1[2] + (c2[2] - c1[2]) * t)
    return Color(r, g, b)


# --- AUDIO ENGINE (THREAD) ---
def audio_thread_func():
    global audio_data
    chunk = 1024
    rate = 44100
    alpha = 0.35  # Exponential smoothing
    smoothing = np.zeros(len(BAND_RANGES))
    beat_history: List[float] = []
    max_history = 43  # ~1s window at ~43 updates/s
    last_beat_ts = 0.0
    min_beat_interval = 0.15  # seconds
    norm_ref = 2_500_000  # Gain reference for normalization

    p = pyaudio.PyAudio()

    device_index = None
    for i in range(p.get_device_count()):
        info = p.get_device_info_by_index(i)
        if "USB" in info.get("name", "") and info.get("maxInputChannels") > 0:
            device_index = i
            print(f"[AUDIO] USB Device gevonden: {info['name']}")
            break

    try:
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=rate,
            input=True,
            frames_per_buffer=chunk,
            input_device_index=device_index,
        )
    except Exception as e:
        print(f"[AUDIO ERROR] Kan stream niet openen: {e}")
        return

    print("[AUDIO] Engine gestart...")

    freqs = np.fft.rfftfreq(chunk, 1.0 / rate)

    while True:
        try:
            data = np.frombuffer(
                stream.read(chunk, exception_on_overflow=False), dtype=np.int16
            )
        except Exception:
            continue

        if not state.get("audio_enabled", True):
            time.sleep(0.05)
            continue

        # Windowing + FFT
        windowed = data * np.hanning(len(data))
        fft_data = np.fft.rfft(windowed)
        fft_mag = np.abs(fft_data)

        band_levels = []
        for low, high in BAND_RANGES:
            mask = (freqs >= low) & (freqs < high)
            if not np.any(mask):
                band_levels.append(0.0)
                continue
            level = float(np.mean(fft_mag[mask]))
            normalized = min(1.0, (level * state["audio_gain"]) / norm_ref)
            band_levels.append(normalized)

        # Exponential smoothing voor vloeiende bewegingen
        band_levels = np.array(band_levels)
        smoothing = alpha * band_levels + (1 - alpha) * smoothing

        vol = float(np.clip(np.max(smoothing), 0.0, 1.0))

        # Beat detection op lage frequenties (sub + bass)
        low_energy = float((smoothing[0] + smoothing[1]) / 2.0)
        beat_history.append(low_energy)
        if len(beat_history) > max_history:
            beat_history.pop(0)

        beat = False
        now = time.time()
        if len(beat_history) > 10:
            avg_energy = sum(beat_history) / len(beat_history)
            if (
                low_energy > avg_energy * 1.7
                and now - last_beat_ts > min_beat_interval
                and low_energy > 0.05
            ):
                beat = True
                last_beat_ts = now

        # Bewaar snapshot
        audio_data = {
            "vol": vol,
            "bands": smoothing.tolist(),
            "beat": beat,
            "last_beat": last_beat_ts,
        }


# --- LED EFFECTEN ENGINE (THREAD) ---
class LEDEngine(threading.Thread):
    def __init__(self):
        super().__init__()
        self.daemon = True
        self.stop_event = threading.Event()

    def run(self):
        print("[LEDS] Engine gestart.")
        t = 0
        while not self.stop_event.is_set():
            if not state["on"]:
                self.fade_to_black()
                time.sleep(0.5)
                continue

            effect = state["effect"]
            speed_factor = state["speed"] / 255.0
            strip.setBrightness(state["brightness"])

            if effect == "solid":
                c = hex_to_rgb(state["primary_color"])
                for i in range(strip.numPixels()):
                    strip.setPixelColor(i, Color(*c))

            elif effect == "rainbow":
                for i in range(strip.numPixels()):
                    idx = int((i * 256 / strip.numPixels()) + t) & 255
                    strip.setPixelColor(i, wheel(idx))
                t += 2 + int(speed_factor * 10)
                if t > 255:
                    t = 0

            elif effect == "scanner":
                self.fade(0.80)
                pos = int(
                    (math.sin(t * 0.1 * max(speed_factor, 0.05)) + 1)
                    / 2
                    * (strip.numPixels() - 1)
                )
                c = hex_to_rgb(state["primary_color"])
                strip.setPixelColor(pos, Color(*c))
                if pos > 0:
                    strip.setPixelColor(pos - 1, scale_color(Color(*c), 100))
                if pos < strip.numPixels() - 1:
                    strip.setPixelColor(pos + 1, scale_color(Color(*c), 100))
                t += 1

            elif effect == "breathing":
                val = (math.exp(math.sin(t * 0.05 * speed_factor + 0.01)) - 0.367879441) * 108.0
                c = hex_to_rgb(state["primary_color"])
                faded_c = scale_color(Color(*c), int(val))
                for i in range(strip.numPixels()):
                    strip.setPixelColor(i, faded_c)
                t += 1

            elif effect == "matrix":
                self.fade(0.90)
                if np.random.random() < (0.05 * speed_factor + 0.01):
                    strip.setPixelColor(
                        np.random.randint(0, strip.numPixels()), Color(0, 255, 0)
                    )

            elif effect == "fire":
                for i in range(strip.numPixels()):
                    flicker = np.random.randint(0, 50)
                    r = 255 - flicker
                    g = max(0, 90 - flicker)
                    b = 0
                    strip.setPixelColor(i, Color(r, g, b))

            # --- AUDIO REACTIVE EFFECTEN ---
            elif effect == "audio_bars":
                segment_len = max(1, strip.numPixels() // len(BAND_RANGES))
                for i in range(strip.numPixels()):
                    strip.setPixelColor(i, Color(0, 0, 0))
                primary = hex_to_rgb(state["primary_color"])
                secondary = hex_to_rgb(state["secondary_color"])
                for idx, level in enumerate(audio_data["bands"]):
                    height = int(level * segment_len)
                    color = lerp_color(primary, secondary, idx / (len(BAND_RANGES) - 1))
                    start = idx * segment_len
                    end = min(strip.numPixels(), start + height)
                    for i in range(start, end):
                        strip.setPixelColor(i, color)

            elif effect == "audio_pulse":
                bass = (audio_data["bands"][0] + audio_data["bands"][1]) / 2
                if bass > 0.1:
                    bright = int(min(255, bass * 800))
                    c = hex_to_rgb(state["primary_color"])
                    final_c = scale_color(Color(*c), bright)
                    for i in range(strip.numPixels()):
                        strip.setPixelColor(i, final_c)
                else:
                    self.fade(0.8)

            elif effect == "strobe_on_beat":
                now = time.time()
                beat_active = now - audio_data["last_beat"] < 0.12
                if beat_active:
                    c = hex_to_rgb(state["primary_color"])
                    bright = scale_color(Color(*c), 255)
                    for i in range(strip.numPixels()):
                        strip.setPixelColor(i, bright)
                else:
                    self.fade(0.55)

            elif effect == "spectrum_stream":
                center = strip.numPixels() // 2
                total = audio_data["vol"]
                height = int(total * center)
                primary = hex_to_rgb(state["primary_color"])
                secondary = hex_to_rgb(state["secondary_color"])
                for i in range(strip.numPixels()):
                    strip.setPixelColor(i, Color(0, 0, 0))
                for i in range(height):
                    t_ratio = i / max(1, height)
                    color = lerp_color(primary, secondary, t_ratio)
                    right = center + i
                    left = center - i
                    if 0 <= right < strip.numPixels():
                        strip.setPixelColor(right, color)
                    if 0 <= left < strip.numPixels():
                        strip.setPixelColor(left, color)

            strip.show()
            time.sleep(1.0 / max(10, state["fps"]))

    def fade(self, factor=0.9):
        for i in range(strip.numPixels()):
            c = strip.getPixelColor(i)
            r = int(((c >> 16) & 0xFF) * factor)
            g = int(((c >> 8) & 0xFF) * factor)
            b = int((c & 0xFF) * factor)
            strip.setPixelColor(i, Color(r, g, b))

    def fade_to_black(self):
        self.fade(0.5)
        strip.show()


# --- BACKEND WEBSERVER & API ---
app.mount("/static", StaticFiles(directory="static"), name="static")


def load_index():
    with open("static/index.html", "r") as f:
        return f.read()


@app.get("/")
async def get():
    return HTMLResponse(load_index())


async def broadcast_state():
    payload = json.dumps({"type": "state", "data": state})
    for ws in list(connections):
        try:
            await ws.send_text(payload)
        except Exception:
            pass


def get_audio_payload():
    snap = audio_data.copy()
    snap["bands"] = list(snap["bands"])
    return json.dumps({"type": "audio", "data": snap})


async def send_audio_stream(ws: WebSocket):
    while True:
        try:
            await ws.send_text(get_audio_payload())
            await asyncio.sleep(1 / 60.0)
        except Exception:
            break


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connections.add(websocket)
    sender = asyncio.create_task(send_audio_stream(websocket))

    try:
        await websocket.send_text(json.dumps({"type": "state", "data": state}))
        await websocket.send_text(get_audio_payload())
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg["type"] == "set_state":
                updates = msg["data"]
                state.update(updates)
                await broadcast_state()

            elif msg["type"] == "save_config":
                with open(CONFIG_FILE, "w") as f:
                    json.dump(state, f)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        sender.cancel()
        connections.discard(websocket)


# --- INIT ---
if __name__ == "__main__":
    strip = PixelStrip(
        LED_COUNT,
        LED_PIN,
        LED_FREQ_HZ,
        LED_DMA,
        LED_INVERT,
        LED_BRIGHTNESS,
        LED_CHANNEL,
    )
    strip.begin()

    t_audio = threading.Thread(target=audio_thread_func, daemon=True)
    t_audio.start()

    t_led = LEDEngine()
    t_led.start()

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="warning")
