import json
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, Optional

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"

DEFAULT_FILES = {
    "auth": {"password": "change_me"},
    "hardware": {
        "led_count": 300,
        "gpio_pin": 18,
        "freq_hz": 800_000,
        "dma": 10,
        "invert": False,
        "brightness": 200,
        "channel": 0,
        "strip_type": "ws281x",
    },
    "ui": {
        "name": "Pi LED Controller",
        "accent": "#32ffe0",
        "ui_scale": "normaal",
        "glass": True,
        "default_preset": "Neon Regenboog",
    },
    "presets": [
        {
            "name": "Neon Regenboog",
            "effect": "rainbow_cycle",
            "params": {"speed": 1.0, "intensity": 1.0, "brightness": 220},
            "segments": [],
        },
        {
            "name": "Rustige Pulse",
            "effect": "breathing",
            "params": {"color": [64, 196, 255], "speed": 0.5, "intensity": 0.6},
            "segments": [],
        },
    ],
    "zones": [
        {"name": "Volledige strip", "start": 0, "end": 299, "effect": "rainbow_cycle", "params": {}}
    ],
    "alarms": {"alarms": [], "timers": []},
}


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


class ConfigStore:
    def __init__(self) -> None:
        self.lock = RLock()
        _ensure_dir(CONFIG_DIR)
        for key, default in DEFAULT_FILES.items():
            path = CONFIG_DIR / f"{key}.json"
            if not path.exists():
                path.write_text(json.dumps(default, indent=2))

    def _path(self, name: str) -> Path:
        return CONFIG_DIR / f"{name}.json"

    def load(self, name: str) -> Any:
        path = self._path(name)
        with self.lock:
            if not path.exists():
                default = DEFAULT_FILES.get(name, {})
                path.write_text(json.dumps(default, indent=2))
            return json.loads(path.read_text())

    def save(self, name: str, data: Any) -> None:
        path = self._path(name)
        with self.lock:
            path.write_text(json.dumps(data, indent=2))

    def update_hardware(self, data: Dict[str, Any]) -> Dict[str, Any]:
        cfg = self.load("hardware")
        cfg.update(data)
        self.save("hardware", cfg)
        return cfg

    def get_auth(self) -> Dict[str, Any]:
        return self.load("auth")

    def get_auth_password(self) -> str:
        return str(self.get_auth().get("password", ""))

    def save_auth_password(self, password: str) -> Dict[str, Any]:
        cfg = {"password": str(password)}
        self.save("auth", cfg)
        return cfg

    def get_presets(self) -> List[Dict[str, Any]]:
        return self.load("presets")

    def save_presets(self, presets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        self.save("presets", presets)
        return presets

    def get_zones(self) -> List[Dict[str, Any]]:
        return self.load("zones")

    def save_zones(self, zones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        self.save("zones", zones)
        return zones

    def get_ui(self) -> Dict[str, Any]:
        return self.load("ui")

    def save_ui(self, ui_cfg: Dict[str, Any]) -> Dict[str, Any]:
        self.save("ui", ui_cfg)
        return ui_cfg

    def get_alarms(self) -> Dict[str, Any]:
        return self.load("alarms")

    def save_alarms(self, data: Dict[str, Any]) -> Dict[str, Any]:
        self.save("alarms", data)
        return data


config_store = ConfigStore()
