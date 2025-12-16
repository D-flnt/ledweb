import json
import threading
import time
from pathlib import Path
from typing import Dict, List

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import auth_manager
from .audio_engine import audio_engine
from .config_store import config_store
from .effects import EFFECTS
from .led_engine import LEDEngine
from .scheduler import Scheduler

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Pi LED Controller", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


def require_auth(x_session_token: str | None = Header(default=None)) -> str:
    if not x_session_token or not auth_manager.verify(x_session_token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return x_session_token


hardware_cfg = config_store.load("hardware")
led_engine = LEDEngine(hardware_cfg)
led_engine.start()
zones = config_store.get_zones()
led_engine.set_segments(zones)

audio_engine.start()

def _link_audio():
    while True:
        led_engine.update_audio_snapshot(audio_engine.snapshot)
        time.sleep(0.02)


threading.Thread(target=_link_audio, daemon=True).start()


def apply_preset(preset: Dict) -> None:
    effect_params = preset.get("effect_params") or preset.get("params", {})
    live = preset.get("live") or {}
    brightness = preset.get("brightness") or effect_params.get("brightness")
    state_updates = {"effect": preset.get("effect", "rainbow_cycle"), "effect_params": effect_params}
    if brightness is not None:
        state_updates["brightness"] = brightness
    if live:
        state_updates["live"] = live
    led_engine.update_state(**state_updates)
    if "segments" in preset:
        led_engine.set_segments(preset.get("segments") or [])


def _get_default_preset() -> Dict | None:
    ui_cfg = config_store.get_ui()
    presets = config_store.get_presets()
    preferred = (ui_cfg or {}).get("default_preset")
    for preset in presets:
        if preset.get("name") == preferred:
            return preset
    return presets[0] if presets else None


def _apply_startup_preset(active_zones: List[Dict]) -> None:
    if audio_engine.enabled:
        return
    if not active_zones:
        return
    music_only = True
    for seg in active_zones:
        effect_cls = EFFECTS.get(seg.get("effect"))
        if not effect_cls or getattr(effect_cls, "category", "") != "music":
            music_only = False
            break
    if not music_only:
        return
    preset = _get_default_preset()
    if preset:
        print("[ledweb] Audio input missing; applying default preset instead of music-only zones.")
        apply_preset(preset)
    else:
        print("[ledweb] Audio input missing; using rainbow_cycle fallback.")
        led_engine.set_segments([])
        led_engine.update_state(effect="rainbow_cycle", effect_params={})


_apply_startup_preset(zones)


scheduler = Scheduler(on_trigger=lambda alarm: apply_preset({"effect": alarm.get("effect", "solid"), "params": alarm.get("params", {}), "segments": alarm.get("segments", [])}))
scheduler.start()


@app.get("/")
def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/api/login")
def login(body: Dict):
    token = auth_manager.login(body.get("password", ""))
    if not token:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"token": token}


@app.get("/api/status")
def status(token: str = Depends(require_auth)):
    def _schema(params: Dict) -> List[Dict]:
        schema = []
        for k, v in (params or {}).items():
            entry = {"name": k, "type": "unknown"}
            if isinstance(v, bool):
                entry["type"] = "boolean"
            elif isinstance(v, (int, float)):
                entry["type"] = "number"
            elif isinstance(v, str):
                entry["type"] = "string"
            elif isinstance(v, list):
                if len(v) == 3 and all(isinstance(c, (int, float)) for c in v):
                    entry["type"] = "color"
                else:
                    entry["type"] = "list"
            schema.append(entry)
        return schema

    return {
        "state": led_engine.snapshot(),
        "hardware": hardware_cfg,
        "effects": [
            {
                "name": name,
                "label": getattr(cls, "label", name),
                "category": cls.category,
                "description": cls.description,
                "default_params": cls.default_params,
                "param_schema": _schema(getattr(cls, "default_params", {})),
            }
            for name, cls in EFFECTS.items()
        ],
        "presets": config_store.get_presets(),
        "zones": config_store.get_zones(),
        "alarms": config_store.get_alarms(),
        "ui": config_store.get_ui(),
        "audio": audio_engine.snapshot,
    }


@app.post("/api/state")
def update_state(body: Dict, token: str = Depends(require_auth)):
    led_engine.update_state(**body)
    return {"ok": True, "state": led_engine.snapshot()}


@app.post("/api/effect")
def set_effect(body: Dict, token: str = Depends(require_auth)):
    effect = body.get("effect", "solid")
    params = body.get("effect_params") or body.get("params") or {}
    live = body.get("live") or {}
    state = led_engine.update_state(effect=effect, effect_params=params, live=live)
    if body.get("apply_segments", True):
        segments = state.get("segments") or []
        if segments:
            updated = []
            for seg in segments:
                merged_params = {**(seg.get("params") or {}), **params}
                updated.append({**seg, "effect": effect, "params": merged_params})
            led_engine.set_segments(updated)
            state = led_engine.snapshot()
    return {"ok": True, "state": state}


@app.post("/api/segments")
def set_segments(body: List[Dict], token: str = Depends(require_auth)):
    segments = led_engine.set_segments(body)
    config_store.save_zones(body)
    return {"segments": segments}


@app.post("/api/presets/save")
def save_preset(body: Dict, token: str = Depends(require_auth)):
    presets = config_store.get_presets()
    presets = [p for p in presets if p.get("name") != body.get("name")]
    presets.append(body)
    config_store.save_presets(presets)
    return {"presets": presets}


@app.post("/api/presets/apply")
def apply(body: Dict, token: str = Depends(require_auth)):
    name = body.get("name")
    for preset in config_store.get_presets():
        if preset.get("name") == name:
            apply_preset(preset)
            return {"ok": True}
    return {"ok": False}


@app.post("/api/presets/delete")
def delete_preset(body: Dict, token: str = Depends(require_auth)):
    name = body.get("name")
    presets = [p for p in config_store.get_presets() if p.get("name") != name]
    config_store.save_presets(presets)
    return {"presets": presets}


@app.post("/api/alarms")
def update_alarms(body: Dict, token: str = Depends(require_auth)):
    config_store.save_alarms(body)
    return {"alarms": body}


@app.post("/api/ui")
def update_ui(body: Dict, token: str = Depends(require_auth)):
    cfg = config_store.save_ui(body)
    return {"ui": cfg}


@app.post("/api/audio")
def update_audio(body: Dict, token: str = Depends(require_auth)):
    gain = body.get("gain")
    smoothing = body.get("smoothing")
    beat_threshold = body.get("beat_threshold")
    enabled = body.get("enabled")
    settings = audio_engine.update_settings(gain=gain, smoothing=smoothing, beat_threshold=beat_threshold, enabled=enabled)
    return {"audio": {**audio_engine.snapshot, **settings}}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    token = ws.query_params.get("token")
    if not token or not auth_manager.verify(token):
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        while True:
            payload = {
                "state": led_engine.snapshot(),
                "audio": audio_engine.snapshot,
            }
            await ws.send_text(json.dumps(payload))
            await ws.receive_text()
    except WebSocketDisconnect:
        return
