# AGENTS.md

## Cursor Cloud specific instructions

青雲(5386) 沉沒基金 — a pure static HTML/CSS/JS stock-loss visualization dashboard, plus a Python data updater. Standard details are in `README.md`.

### Run (development) — static site
- No build step. Serve the repo root and open the page:
  ```
  python3 -m http.server 8080
  ```
  → http://localhost:8080 . The frontend (`js/app.js`) fetches `data/price-history.json`, which is committed, so the dashboard (sinking ship + depth chart) renders standalone with no backend or secrets.

### Data updater (Python)
- The update script provisions a virtualenv at `.venv` and installs `requirements.txt` (`yfinance`).
- Run: `./.venv/bin/python scripts/fetch_price.py` (or `scripts/backfill_history.py`). Requires egress to Yahoo Finance (available in the cloud VM).
- Note: this **overwrites the tracked `data/price-history.json`** (at minimum the `last_updated` timestamp). Revert with `git checkout -- data/price-history.json` if you don't intend to commit the refreshed data.
