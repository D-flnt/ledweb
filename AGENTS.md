# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: FastAPI service that exposes LED control, authentication, scheduling, and audio-reactive endpoints; serves the UI from `frontend/`.
- `frontend/`: Static HTML/CSS/JS UI; requests API endpoints under `/api/*` and uses websockets for live updates.
- `config/`: Default runtime configuration (`config/config.json`) loaded by `backend/config_store.py`.
- `led-controller/`: Standalone hardware control prototype; keep changes isolated unless intentionally replacing the main backend.
- Root scripts: `led_test.py` is a hardware smoke test for a connected LED strip.

## Build, Test, and Development Commands
- Create venv and install server deps (FastAPI, uvicorn[standard], numpy, pyaudio, rpi_ws281x, etc.): `python -m venv .venv && source .venv/bin/activate && pip install -U pip fastapi "uvicorn[standard]" numpy pyaudio rpi_ws281x`.
- Run API + UI locally: `uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000` (serves UI at `/frontend/`).
- Hardware smoke test: `python led_test.py` (requires LED strip and rpi_ws281x installed).
- Legacy prototype server: `python led-controller/main.py` (only if you intentionally maintain the older stack).

## Coding Style & Naming Conventions
- Python: PEP 8 with 4-space indentation; keep type hints as in existing modules; prefer async endpoints in `backend/main.py`; snake_case for functions/vars and UPPER_SNAKE_CASE for constants.
- Frontend: Plain ES modules in `frontend/app.js`; keep DOM helper naming (`qs`, `api`, `saveState*`) camelCase and avoid global leaks.
- Config keys: match existing JSON naming (lowercase with underscores) to avoid breaking `config_store`.
- Add concise docstrings/comments only where behavior is non-obvious (hardware bounds, auth flow, power limiting).

## Testing Guidelines
- No automated suite yet; rely on targeted checks:
  - API smoke: `curl -X GET http://localhost:8000/api/status -H "X-Session-Token: <token>"`.
  - Hardware smoke: `python led_test.py` before deploying to new hardware.
- Keep new logic structured for future `pytest` adoption (pure functions, side-effect isolation).

## Configuration & Security Tips
- Do not commit secrets; `config/config.json` contains defaults only. Override runtime settings via env vars or deployment-specific copies.
- Auth tokens are required for `/api/*` routes; ensure new endpoints call `require_auth` unless explicitly public.
- Be cautious with power/brightness defaults; respect bounds enforced in `backend/main.py` and `config_store.set_state`.

## Commit & Pull Request Guidelines
- Use clear, imperative commit subjects (e.g., `Add audio power limiter`, `Fix websocket reconnect loop`); group related changes.
- Document behavior changes in PR descriptions: what changed, why, how to test (commands), and any hardware assumptions.
- Link issues/tickets when applicable; include screenshots or brief notes for UI-impacting changes.
