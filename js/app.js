const MILESTONES = [
  { max: 10, text: "船身輕微進水，甲板員表示無需驚慌" },
  { max: 30, text: "船艙開始積水，有人開始翻查逃生手冊" },
  { max: 50, text: "船長廣播：這是暫時性技術性回檔" },
  { max: 70, text: "救生艇已放下，但船長選擇留下" },
  { max: 90, text: "僅剩桅杆露出水面，海鳥停靠休息" },
  { max: Infinity, text: "沉入馬里亞納海溝，考古隊已列入未來挖掘清單" },
];

/* Short lines per passenger — shown above each head */
const PAX_LINES = {
  wave: [
    "救命啊均價！",
    "手還舉著…",
    "誰來接盤？",
  ],
  cling: [
    "再撐一下…",
    "欄杆我的命",
    "不認虧！",
  ],
  crouch: [
    "要攤平嗎",
    "再算一次…",
    "均價魔法",
  ],
  hang: [
    "會回來的",
    "健康回檔",
    "長線持有",
  ],
  stern: [
    "加碼中",
    "跌深更好買",
    "船尾續攤",
  ],
};

const PAX_ORDER = ["wave", "cling", "crouch", "hang", "stern"];

let roastRound = 0;
let roastTimer = null;
let currentLossPct = 0;
let cachedEntries = [];
let cachedConfig = {};
let cachedActions = [];
let resizeTimer;

function formatNumber(n) {
  return Math.round(n).toLocaleString("zh-TW");
}

function getMilestone(lossPct) {
  for (const m of MILESTONES) {
    if (lossPct < m.max) return m.text;
  }
  return MILESTONES[MILESTONES.length - 1].text;
}

function updateShipPosition(lossPct) {
  const maxSink = 56;
  const sinkPx = Math.min(lossPct / 100, 1) * maxSink;
  document.documentElement.style.setProperty("--ship-sink", `${sinkPx}px`);
}

function createBubbles(lossPct) {
  const container = document.getElementById("bubbles");
  container.innerHTML = "";

  const count = Math.max(3, Math.min(40, Math.floor(lossPct / 2.5) + 3));
  for (let i = 0; i < count; i++) {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const size = 4 + Math.random() * 10;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${10 + Math.random() * 80}%`;
    bubble.style.animationDuration = `${3 + Math.random() * 5}s`;
    bubble.style.animationDelay = `${Math.random() * 4}s`;
    container.appendChild(bubble);
  }
}

function lineForPax(paxId, round) {
  const lines = PAX_LINES[paxId] || ["…"];
  // Deeper losses skew toward later (more desperate) lines
  const depthBias = currentLossPct >= 50 ? 1 : 0;
  return lines[(round + depthBias) % lines.length];
}

function showPassengerRoast() {
  const callouts = document.getElementById("pax-callouts");
  const shipHit = document.getElementById("ship-hit");
  const hint = document.getElementById("ship-hint");
  if (!callouts || !shipHit) return;

  const nodes = [...callouts.querySelectorAll(".pax-callout")];
  if (nodes.length === 0) return;

  // One-at-a-time roll call — avoids overlapping bubbles on a small ship
  const active = roastRound % nodes.length;
  callouts.hidden = false;
  nodes.forEach((el, i) => {
    const paxId = el.dataset.pax || PAX_ORDER[i];
    if (i === active) {
      el.hidden = false;
      el.textContent = lineForPax(paxId, Math.floor(roastRound / nodes.length));
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  });
  roastRound += 1;

  shipHit.classList.add("is-speaking");
  if (hint) hint.classList.add("is-hidden");

  clearTimeout(roastTimer);
  roastTimer = setTimeout(() => {
    callouts.hidden = true;
    nodes.forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
    shipHit.classList.remove("is-speaking");
  }, 2800);
}

function initPassengerMode() {
  const shipHit = document.getElementById("ship-hit");
  if (!shipHit) return;
  shipHit.addEventListener("click", showPassengerRoast);
}

function dataUrl(path) {
  return `${path}?t=${Date.now()}`;
}

/* ── Corporate actions (DER-44 plan A) ── */

function normalizeActions(raw) {
  const list = Array.isArray(raw?.actions) ? raw.actions : [];
  return list
    .map((item) => ({
      date: String(item.date),
      cashDividend: Number(item.cash_dividend) || 0,
      stockDividendRatio: Number(item.stock_dividend_ratio) || 0,
      label: String(item.label || "除權息"),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function adjustPrice(rawPrice, asOf, actions) {
  let price = Number(rawPrice);
  const newestFirst = [...actions].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const action of newestFirst) {
    if (asOf >= action.date) continue;
    const divisor = 1 + action.stockDividendRatio;
    price = (price - action.cashDividend) / divisor;
  }
  return price;
}

function derivePosition(config, asOf, actions) {
  let shares = Number(config.shares) || 0;
  const originalShares = shares;
  const originalCost = Number(config.cost_basis) || 0;
  const originalBuy = Number(config.buy_price) || 0;
  let cashReceived = 0;

  for (const action of actions) {
    if (action.date > asOf) break;
    if (action.cashDividend) cashReceived += shares * action.cashDividend;
    if (action.stockDividendRatio) shares *= 1 + action.stockDividendRatio;
  }

  const restoredCost = originalCost - cashReceived;
  const restoredBuy = shares ? restoredCost / shares : 0;
  return {
    shares,
    cashReceived,
    restoredCostBasis: restoredCost,
    restoredBuyPrice: restoredBuy,
    originalShares,
    originalCostBasis: originalCost,
    originalBuyPrice: originalBuy,
  };
}

function scaleDateForAdjustedPrice(asOf, actions) {
  let scale = asOf;
  for (const action of actions) {
    if (action.date > asOf && action.date > scale) scale = action.date;
  }
  return scale;
}

function computeDualMetrics(config, rawClose, asOf, actions) {
  const posTotal = derivePosition(config, asOf, actions);
  const adjClose = adjustPrice(rawClose, asOf, actions);
  const posPrice = derivePosition(config, scaleDateForAdjustedPrice(asOf, actions), actions);

  const priceMarketValue = adjClose * posPrice.shares;
  const priceLossAmount = posPrice.restoredCostBasis - priceMarketValue;
  const priceLossPct = posPrice.restoredCostBasis
    ? (priceLossAmount / posPrice.restoredCostBasis) * 100
    : 0;

  const marketValue = rawClose * posTotal.shares;
  const totalValue = marketValue + posTotal.cashReceived;
  const lossAmount = posTotal.originalCostBasis - totalValue;
  const lossPct = posTotal.originalCostBasis
    ? (lossAmount / posTotal.originalCostBasis) * 100
    : 0;

  return {
    date: asOf,
    close_price: Number(rawClose),
    adj_close: adjClose,
    market_value: marketValue,
    total_value: totalValue,
    cash_received: posTotal.cashReceived,
    shares: posTotal.shares,
    restored_buy_price: posPrice.restoredBuyPrice,
    restored_cost_basis: posPrice.restoredCostBasis,
    loss_amount: lossAmount,
    loss_pct: lossPct,
    remaining_pct: 100 - lossPct,
    price_loss_amount: priceLossAmount,
    price_loss_pct: priceLossPct,
    price_remaining_pct: 100 - priceLossPct,
    eventDates: actions.filter((a) => a.date === asOf).map((a) => a.label),
  };
}

function enrichEntries(entries, config, actions) {
  return entries.map((entry) => {
    const dual = computeDualMetrics(config, entry.close_price, entry.date, actions);
    return {
      ...entry,
      ...dual,
      // Keep raw close authoritative; dual may restate rounded fields.
      close_price: Number(entry.close_price),
    };
  });
}

function drawDepthChart(entries, actions = []) {
  const canvas = document.getElementById("depth-chart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 900;
  const h = rect.height || 160;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = h < 120
    ? { top: 8, right: 10, bottom: 18, left: 36 }
    : { top: 12, right: 14, bottom: 22, left: 42 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  if (entries.length === 0) {
    ctx.fillStyle = "#3d5568";
    ctx.font = "500 13px 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("尚無歷史資料，等待首次收盤更新...", w / 2, h / 2);
    return;
  }

  // A案：還原價連續線 → 以價差 loss（還原成本尺度）繪製，避免除權息假斷崖
  const series = entries.map((e) =>
    Number.isFinite(e.price_loss_pct) ? e.price_loss_pct : e.loss_pct
  );
  const maxLoss = Math.max(...series, 10);
  const minLoss = Math.min(...series, 0);

  const waterGrad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  waterGrad.addColorStop(0, "#b7dff2");
  waterGrad.addColorStop(0.45, "#5aafd4");
  waterGrad.addColorStop(1, "#0f4f78");
  ctx.fillStyle = waterGrad;
  ctx.fillRect(pad.left, pad.top, chartW, chartH);

  const xStep = entries.length > 1 ? chartW / (entries.length - 1) : chartW / 2;

  function toY(lossPct) {
    const range = maxLoss - minLoss || 1;
    const normalized = (lossPct - minLoss) / range;
    return pad.top + normalized * chartH;
  }

  function toX(i) {
    return pad.left + (entries.length > 1 ? i * xStep : chartW / 2);
  }

  // Event flags (除權息日)
  const actionDates = new Set(actions.map((a) => a.date));
  entries.forEach((entry, i) => {
    if (!actionDates.has(entry.date)) return;
    const x = toX(i);
    ctx.strokeStyle = "rgba(143, 61, 20, 0.55)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8f3d14";
    ctx.font = "600 10px 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("除權息", x, pad.top + 11);
  });

  ctx.beginPath();
  series.forEach((lossPct, i) => {
    const x = toX(i);
    const y = toY(lossPct);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = "#c45c26";
  ctx.lineWidth = 2.25;
  ctx.stroke();

  ctx.lineTo(toX(entries.length - 1), pad.top + chartH);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  fillGrad.addColorStop(0, "rgba(196, 92, 38, 0.28)");
  fillGrad.addColorStop(1, "rgba(196, 92, 38, 0.03)");
  ctx.fillStyle = fillGrad;
  ctx.fill();

  const last = entries.length - 1;
  series.forEach((lossPct, i) => {
    const x = toX(i);
    const y = toY(lossPct);
    const isLast = i === last;
    const isEvent = actionDates.has(entries[i].date);
    ctx.beginPath();
    ctx.arc(x, y, isLast || isEvent ? 4.5 : 2.75, 0, Math.PI * 2);
    ctx.fillStyle = isLast || isEvent ? "#8f3d14" : "#c45c26";
    ctx.fill();
    if (isLast) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(143, 61, 20, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  ctx.fillStyle = "#3d5568";
  ctx.font = "500 11px 'Noto Sans TC', sans-serif";
  ctx.textAlign = "right";
  const yLabels = 4;
  for (let i = 0; i <= yLabels; i++) {
    const val = minLoss + ((maxLoss - minLoss) / yLabels) * i;
    const y = toY(val);
    ctx.fillText(`${val.toFixed(1)}%`, pad.left - 8, y + 4);

    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  const labelInterval = Math.max(1, Math.floor(entries.length / 6));
  entries.forEach((entry, i) => {
    if (i % labelInterval !== 0 && i !== entries.length - 1) return;
    const x = toX(i);
    ctx.fillText(entry.date.slice(5), x, h - pad.bottom + 16);
  });
}

function updateDashboard(latest, config) {
  currentLossPct = latest.loss_pct;
  document.getElementById("loss-amount").textContent = formatNumber(latest.loss_amount);
  document.getElementById("loss-pct").textContent = Number(latest.loss_pct).toFixed(2);
  document.getElementById("close-price").textContent = Number(latest.close_price).toFixed(2);

  const priceLossEl = document.getElementById("price-loss-pct");
  if (priceLossEl) {
    priceLossEl.textContent = Number(latest.price_loss_pct).toFixed(2);
  }
  const sharesEl = document.getElementById("effective-shares");
  if (sharesEl) {
    sharesEl.textContent = formatNumber(latest.shares);
  }
  const restoredEl = document.getElementById("restored-buy");
  if (restoredEl) {
    restoredEl.textContent = Number(latest.restored_buy_price).toFixed(2);
  }

  document.getElementById("milestone-text").textContent = getMilestone(latest.loss_pct);

  updateShipPosition(latest.loss_pct);
  createBubbles(latest.loss_pct);

  const stockName = config?.stock_name || "青雲";
  const restored = Number(latest.restored_buy_price);
  const shares = latest.shares;
  document.getElementById("chart-meta").textContent =
    `${stockName} · 總報酬（原始成本）· 還原均價 ${restored.toFixed(2)} 元 · ${formatNumber(shares)} 股`;
}

async function loadData() {
  try {
    const [histRes, actionsRes] = await Promise.all([
      fetch(dataUrl("data/price-history.json")),
      fetch(dataUrl("data/corporate_actions.json")),
    ]);
    if (!histRes.ok) throw new Error(`HTTP ${histRes.status}`);
    const data = await histRes.json();
    const actionsRaw = actionsRes.ok ? await actionsRes.json() : { actions: [] };
    const actions = normalizeActions(actionsRaw);
    const config = data.config_snapshot || {};
    const rawEntries = data.entries || [];
    const entries = enrichEntries(rawEntries, config, actions);

    cachedEntries = entries;
    cachedConfig = config;
    cachedActions = actions;

    if (entries.length === 0) {
      document.getElementById("milestone-text").textContent = "船隻待命中，尚未收到任何航海數據...";
      redrawChart();
      return;
    }

    const latest = entries[entries.length - 1];
    updateDashboard(latest, config);
    try {
      redrawChart();
    } catch (chartErr) {
      console.error("Chart render failed:", chartErr);
      document.getElementById("chart-meta").textContent = "走勢圖渲染失敗，數據已載入";
    }
  } catch (err) {
    console.error("Failed to load price history:", err);
    document.getElementById("milestone-text").textContent =
      "通訊中斷，無法讀取航海數據（請重新整理或刪除主畫面捷徑後重加）";
  }
}

function redrawChart() {
  try {
    drawDepthChart(cachedEntries, cachedActions);
  } catch (_) {
    /* ignore transient layout sizes */
  }
}

initPassengerMode();
loadData();

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(redrawChart, 120);
});

const chartWrap = document.querySelector(".depth-chart-wrapper");
if (chartWrap && typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawChart, 80);
  });
  ro.observe(chartWrap);
}
