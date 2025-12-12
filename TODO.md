# Optimization Plan for Ledweb Project

## Information Gathered
- The project is a FastAPI-based LED controller for Raspberry Pi with real-time audio synchronization.
- Key components: Audio engine (FFT-based processing at ~200 Hz), LED engine (rendering at 60 FPS), multiple effects (some using fractal noise), WebSocket for real-time updates, scheduler for alarms.
- Potential bottlenecks: CPU-intensive FFT in audio engine, effect rendering with noise functions, frequent WebSocket payloads, threading overhead.

## Revised Plan (User Request: Make Faster, Compact into Fewer Files, Rewrite, Make Copy, Show How to Run Other Versions)
- **Create Optimized Copy**: Create a new directory `ledweb-optimized` with a rewritten, compact version.
- **Compact Code**: Combine modules into fewer files (e.g., one main file with embedded classes for audio, LED, effects).
- **Speed Optimizations**: Use numba for JIT compilation on critical functions, reduce FFT rate, cache noise values, optimize math operations.
- **Rewrite for Efficiency**: Refactor code to minimize allocations, use faster data structures, simplify logic.
- **Version Switching**: Provide a `switch_version.sh` script to easily switch between original and optimized versions by copying files.
- **Dependencies**: Add numba, update others for performance.

## Dependent Files to Edit/Create
- Create `ledweb-optimized/` directory with compact rewritten code.
- `switch_version.sh`: Script to switch versions.
- Update `requirements.txt` in optimized version.

## Followup Steps
- Test optimized version on Raspberry Pi.
- Profile and compare performance.
- Ensure all features work in compact version.
