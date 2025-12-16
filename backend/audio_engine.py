import math
import os
import threading
import time
from contextlib import contextmanager
from typing import Dict, List, Optional

import numpy as np

try:
    import pyaudio
except Exception:  # pragma: no cover - runtime fallback
    pyaudio = None


@contextmanager
def _suppress_alsa() -> None:
    """Temporarily silence ALSA stderr noise while probing devices."""
    fd = os.dup(2)
    try:
        with open(os.devnull, "w") as devnull:
            os.dup2(devnull.fileno(), 2)
            yield
    finally:
        os.dup2(fd, 2)
        os.close(fd)


class AudioEngine:
    def __init__(self, rate: int = 44100, chunk: int = 512) -> None:
        self.rate = rate
        self.chunk = chunk
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self.snapshot: Dict = {
            "bands": [0.0] * 8,
            "vol": 0.0,
            "beat": False,
            "bpm": 0.0,
            "enabled": True,
            "flux": 0.0,
            "rms": 0.0,
            "bass": 0.0,
            "agc_gain": 1.0,
        }
        self._pa = None
        self._stream = None
        self._last_beat = 0.0
        self._beats: List[float] = []
        self.gain = 4.0
        self.alpha = 0.28
        self.beat_threshold = 0.35
        self.enabled = True
        self._agc_gain = 1.0
        self._input_device_index: Optional[int] = None
        self._error: Optional[str] = None
        self._agc_ref = 2_000_000.0
        self.agc_target = 0.85
        self._fast_alpha = 0.6
        self._prev_spectrum: Optional[np.ndarray] = None
        self._flux_history: List[float] = []

    def update_settings(
        self, gain: Optional[float] = None, smoothing: Optional[float] = None, beat_threshold: Optional[float] = None, enabled: Optional[bool] = None
    ) -> Dict:
        if gain is not None:
            self.gain = max(0.1, float(gain))
        if smoothing is not None:
            self.alpha = max(0.05, min(0.95, float(smoothing)))
        if beat_threshold is not None:
            self.beat_threshold = max(0.05, min(1.0, float(beat_threshold)))
        if enabled is not None:
            self.enabled = bool(enabled)
        return {"gain": self.gain, "smoothing": self.alpha, "beat_threshold": self.beat_threshold, "enabled": self.enabled}

    def start(self) -> None:
        if self.running:
            return
        if pyaudio is None:
            self._disable_audio("PyAudio not available")
            return
        device_index = self._find_input_device()
        if device_index is None:
            self._disable_audio("No audio input device detected")
            return
        self._input_device_index = device_index
        self.running = True
        self._thread = threading.Thread(target=self._loop, args=(device_index,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._thread:
            self._thread.join(timeout=1)
        self._cleanup_audio()

    def _find_input_device(self, pa_obj: Optional["pyaudio.PyAudio"] = None) -> Optional[int]:
        if pyaudio is None:
            return None
        owns_instance = False
        if pa_obj is None:
            owns_instance = True
            with _suppress_alsa():
                pa_obj = pyaudio.PyAudio()
        try:
            with _suppress_alsa():
                count = pa_obj.get_device_count()
            for i in range(count):
                with _suppress_alsa():
                    info = pa_obj.get_device_info_by_index(i)
                if info.get("maxInputChannels", 0) > 0:
                    return i
            return None
        finally:
            if owns_instance and pa_obj:
                with _suppress_alsa():
                    pa_obj.terminate()

    def _open_stream(self, device_index: Optional[int]) -> None:
        with _suppress_alsa():
            self._pa = pyaudio.PyAudio()
        if device_index is None:
            device_index = self._find_input_device(self._pa)
        if device_index is None:
            raise RuntimeError("No audio input available")
        with _suppress_alsa():
            self._stream = self._pa.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=self.rate,
                input=True,
                frames_per_buffer=self.chunk,
                input_device_index=device_index,
            )

    def _cleanup_audio(self) -> None:
        if self._stream:
            try:
                with _suppress_alsa():
                    self._stream.stop_stream()
            finally:
                with _suppress_alsa():
                    self._stream.close()
            self._stream = None
        if self._pa:
            with _suppress_alsa():
                self._pa.terminate()
            self._pa = None

    def _disable_audio(self, reason: str) -> None:
        self.enabled = False
        self.running = False
        self._error = reason
        self.snapshot = {
            "bands": [0.0] * 8,
            "vol": 0.0,
            "beat": False,
            "bpm": 0.0,
            "gain": self.gain,
            "smoothing": self.alpha,
            "beat_threshold": self.beat_threshold,
            "enabled": False,
            "flux": 0.0,
            "rms": 0.0,
            "bass": 0.0,
            "agc_gain": self._agc_gain,
            "error": reason,
        }

    def _loop(self, device_index: Optional[int] = None) -> None:
        try:
            self._open_stream(device_index)
        except Exception as exc:
            self._cleanup_audio()
            self._disable_audio(f"Audio disabled: {exc}")
            return
        window = np.hanning(self.chunk)
        freqs = np.fft.rfftfreq(self.chunk, 1.0 / self.rate)
        band_ranges = [
            (20, 60),
            (60, 250),
            (250, 500),
            (500, 2000),
            (2000, 4000),
            (4000, 6000),
            (6000, 12000),
            (12000, 20000),
        ]
        smoothing = np.zeros(len(band_ranges))
        fast_env = np.zeros(len(band_ranges))
        self._prev_spectrum = np.zeros(len(band_ranges))
        while self.running:
            try:
                data = np.frombuffer(self._stream.read(self.chunk, exception_on_overflow=False), dtype=np.int16)
            except Exception:
                continue
            if data.size != self.chunk:
                continue
            windowed = data * window
            rms = float(np.sqrt(np.mean(windowed.astype(np.float64) ** 2)))
            rms_norm = min(1.0, rms / 32768.0)
            fft_data = np.fft.rfft(windowed)
            fft_mag = np.abs(fft_data)
            raw_bands = []
            for low, high in band_ranges:
                mask = (freqs >= low) & (freqs < high)
                if not np.any(mask):
                    raw_bands.append(0.0)
                    continue
                raw_bands.append(float(np.mean(fft_mag[mask])))

            peak_energy = max(raw_bands) if raw_bands else 0.0
            self._agc_ref = 0.98 * self._agc_ref + 0.02 * max(1.0, peak_energy)
            scale = (self.gain * self._agc_gain) / max(1.0, self._agc_ref)
            scaled_bands = np.clip(np.array(raw_bands) * scale, 0.0, 2.0)
            band_levels = np.minimum(1.0, np.power(scaled_bands, 0.9))

            fast_env = self._fast_alpha * band_levels + (1 - self._fast_alpha) * fast_env
            smoothing = self.alpha * band_levels + (1 - self.alpha) * smoothing

            vol_fast = float(np.clip(np.max(fast_env), 0.0, 1.0))
            vol_slow = float(np.clip(np.max(smoothing), 0.0, 1.0))
            vol = float(np.clip(vol_fast * 0.65 + vol_slow * 0.35, 0.0, 1.0))
            bass_level = float(np.mean(fast_env[:2])) if len(fast_env) >= 2 else vol

            flux = 0.0
            if self._prev_spectrum is not None:
                diff = np.maximum(band_levels - self._prev_spectrum, 0)
                focus = diff[: max(3, len(diff) // 2)]
                flux = float(np.mean(focus)) if focus.size else float(np.mean(diff))
            self._prev_spectrum = band_levels
            self._flux_history.append(flux)
            if len(self._flux_history) > 64:
                self._flux_history.pop(0)

            vol_probe = (peak_energy * self.gain * self._agc_gain) / max(1.0, self._agc_ref)
            error = self.agc_target - vol_probe
            self._agc_gain *= 1.0 + error * 0.12
            self._agc_gain = float(np.clip(self._agc_gain, 0.05, 120.0))

            now = time.time()
            beat = self._detect_beat(flux, bass_level, now) if self.enabled else False
            bpm = self._estimate_bpm(now) if self.enabled else 0.0
            bands_out = smoothing.tolist() if self.enabled else [0.0] * len(smoothing)
            self.snapshot = {
                "bands": bands_out,
                "vol": vol if self.enabled else 0.0,
                "beat": beat,
                "bpm": bpm,
                "gain": self.gain,
                "smoothing": self.alpha,
                "beat_threshold": self.beat_threshold,
                "enabled": self.enabled,
                "flux": flux if self.enabled else 0.0,
                "rms": rms_norm if self.enabled else 0.0,
                "bass": bass_level if self.enabled else 0.0,
                "agc_gain": self._agc_gain,
            }
        self._cleanup_audio()

    def _detect_beat(self, flux: float, bass: float, now: float) -> bool:
        history = self._flux_history[-24:]
        avg = float(np.mean(history)) if history else 0.0
        std = float(np.std(history)) if history else 0.0
        adaptive = avg + std * 1.2
        threshold = max(self.beat_threshold, adaptive)
        min_interval = 0.14
        if flux > threshold and bass > 0.08 and (now - self._last_beat) > min_interval:
            self._last_beat = now
            self._beats.append(now)
            self._beats = [b for b in self._beats if now - b < 10]
            return True
        return False

    def _estimate_bpm(self, now: float) -> float:
        beats = [b for b in self._beats if now - b < 15]
        if len(beats) < 2:
            return 0.0
        intervals = [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]
        avg = sum(intervals) / len(intervals)
        if avg <= 0:
            return 0.0
        return 60.0 / avg


audio_engine = AudioEngine()
