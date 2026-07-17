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

## 治理定位（雲端 agent 職權 · 永久規則）

指揮官裁示（2026-07-17）—— 適用於本 repo 的所有雲端 agent：

- **職權範圍**＝環境建置、依賴維護、唯讀探索與回報。
- 凡涉及**應用程式碼**的新增或修改，一律：
  1. 先有 Linear 票（`DER-n`）；
  2. 走**分支 ＋ PR**，**禁止直推 `main`**；
  3. PR 描述須含 `Fixes DER-n`。
- **未持票時只能回報建議，不得動碼。**
- **Update script 範圍永久鎖定「依賴刷新」**（`npm install` / venv+`pip install`，檔案存在才裝）；禁止自行加入服務啟動、build、migration、部署類步驟。
- **機密**：不放進 Cursor 雲端 Secrets。遇到需要機密的操作＝**跳過並回報**，不重複索取；日後如需，另發專用低權 token，不共用主力憑證。
