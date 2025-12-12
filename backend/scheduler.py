import datetime as dt
import threading
import time
from typing import Callable, Dict, List, Optional

from .config_store import config_store


class Scheduler:
    def __init__(self, on_trigger: Callable[[Dict], None]) -> None:
        self.on_trigger = on_trigger
        self.running = False
        self._thread: Optional[threading.Thread] = None

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

    def _loop(self) -> None:
        while self.running:
            now = dt.datetime.now()
            alarms = config_store.get_alarms()
            changed = False
            for alarm in alarms.get("alarms", []):
                if not alarm.get("enabled", True):
                    continue
                days = alarm.get("days", [])
                if days and now.strftime("%a").lower()[:2] not in days:
                    continue
                if alarm.get("time") == now.strftime("%H:%M"):
                    self.on_trigger(alarm)
            timers = alarms.get("timers", [])
            for timer in timers:
                if not timer.get("enabled", True):
                    continue
                timer["seconds"] = timer.get("seconds", 0) - 1
                if timer["seconds"] <= 0:
                    self.on_trigger(timer)
                    timer["enabled"] = False
                    changed = True
            if changed:
                config_store.save_alarms(alarms)
            time.sleep(1)


scheduler: Optional[Scheduler] = None
