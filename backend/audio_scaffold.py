import math
import threading
import time
from typing import Dict, List, Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover - fallback for environments without numpy
    np = None

# Optional audio capture libraries
try:
    import sounddevice as sd  # type: ignore
except Exception:  # pragma: no cover
    sd = None


class AudioFrame:
    def __init__(self):
        self.bands: List[float] = []
        self.waveform: List[float] = []
        self.amplitude: float = 0.0
        self.bass: float = 0.0
        self.beat: bool = False
        self.bpm: float = 0.0

    def as_dict(self) -> Dict:
        return {
            "bands": self.bands,
            "waveform": self.waveform,
            "amplitude": self.amplitude,
            "bass": self.bass,
            "beat": self.beat,
            "bpm": self.bpm,
        }


class AudioEngine:
    def __init__(self, sample_rate: int = 44100, fft_size: int = 1024):
        self.sample_rate = sample_rate
        self.fft_size = fft_size
        self.device = None
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.lock = threading.RLock()
        self.frame = AudioFrame()
        self.last_peak = 0.0
        self.bpm = 0.0

    def start(self, device: Optional[str] = None):
        if self.running:
            return
        self.device = device
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1)

    def _loop(self):
        while self.running:
            self.frame = self._capture_and_process()
            time.sleep(0.01)

    def _capture_and_process(self) -> AudioFrame:
        frame = AudioFrame()
        if np is None:
            # Fallback: synthesize a low amplitude waveform so audio effects still run
            t = time.time()
            samples = [math.sin(t), math.sin(t * 1.3), math.sin(t * 1.7)]
            frame.waveform = [0.2 * s for s in samples][: self.fft_size // 2]
            frame.bands = [0.1] * 8
            frame.amplitude = 0.1
            frame.bass = 0.1
            frame.beat = False
            frame.bpm = 0.0
            return frame

        if sd:
            try:
                samples = sd.rec(
                    self.fft_size,
                    samplerate=self.sample_rate,
                    channels=1,
                    dtype="float32",
                    blocking=True,
                    device=self.device,
                )
                samples = samples.flatten()
            except Exception:
                samples = np.zeros(self.fft_size)
        else:
            # No capture available, use silence
            samples = np.zeros(self.fft_size)

        frame.waveform = samples.tolist()
        amplitude = float(np.clip(np.max(np.abs(samples)), 0, 1))
        frame.amplitude = amplitude
        fft = np.fft.rfft(samples * np.hanning(len(samples)))
        magnitude = np.abs(fft)
        bands = self._split_bands(magnitude)
        frame.bands = bands
        frame.bass = float(np.clip(np.mean(bands[:2]) * 2, 0, 1))
        frame.beat = self._detect_beat(amplitude)
        frame.bpm = self.bpm
        return frame

    def _split_bands(self, magnitude: "np.ndarray") -> List[float]:
        # 8 bands splitting the FFT result roughly log-spaced
        band_edges = [20, 60, 250, 500, 2000, 4000, 6000, 20000]
        freqs = np.fft.rfftfreq(self.fft_size, 1 / self.sample_rate)
        bands = []
        start = 0
        for edge in band_edges:
            idx = np.where(freqs <= edge)[0]
            end = idx[-1] if len(idx) else start
            val = float(np.mean(magnitude[start:end + 1])) if end >= start else 0.0
            bands.append(float(np.clip(val * 5, 0, 1)))
            start = end + 1
        return bands

    def _detect_beat(self, amplitude: float) -> bool:
        now = time.time()
        threshold = 0.35
        if amplitude > threshold and (now - self.last_peak) > 0.25:
            interval = now - self.last_peak if self.last_peak else 0
            if interval > 0:
                self.bpm = 60 / interval
            self.last_peak = now
            return True
        return False

    def snapshot(self) -> AudioFrame:
        with self.lock:
            return self.frame
