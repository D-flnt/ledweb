import json
import math
import random
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from numba import jit
from scipy.fft import rfft

try:
    import pyaudio
except ImportError:
    pyaudio = None

try:
    from rpi_ws281x import Color, PixelStrip, WS2811_STRIP_GRB
except ImportError:
    PixelStrip = Color = WS2811_STRIP_GRB = None

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

RGB = Tuple[int, int, int]

# Optimized utility functions with numba
@jit(nopython=True)
def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))

@jit(nopython=True)
def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t

@jit(nopython=True)
def hsv_to_rgb(h: float, s: float, v: float) -> Tuple[int, int, int]:
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

@jit(nopython=True)
def value_noise(x: float, seed: int = 0) -> float:
    xi = int(math.floor(x))
    xf = x - xi
    # Simplified random for numba
    random.seed(xi + seed * 1013)
    v1 = random.random()
    random.seed(xi + 1 + seed * 1013)
    v2 = random.random()
    return lerp(v1, v2, xf)

@jit(nopython=True)
def smooth_noise(x: float, seed: int = 0) -> float:
    return (value_noise(x - 1, seed) + value_noise(x, seed) + value_noise(x + 1, seed)) / 3.0

@jit(nopython=True)
def fractal_noise(x: float, octaves: int = 4, seed: int = 0) -> float:
    total = 0.0
    freq = 1.0
    amp = 1.0
    max_amp = 0.0
    for _ in range(octaves):
