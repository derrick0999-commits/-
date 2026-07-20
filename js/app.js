/* DER-45 v2.5 — 即時沉沒模擬器（設計稿對齊） */

const SPEECH_LINES = [
  { t: "船長…我們是不是在下沉？", w: "crew" },
  { t: "本席宣布：這是暫時性回檔。", w: "cap" },
  { t: "訊號…還有訊號嗎？", w: "crew" },
  { t: "不賣就不算賠。", w: "cap" },
  { t: "天啊 求求你反彈一下", w: "crew" },
  { t: "主力在洗盤，稍安勿躁。", w: "cap" },
  { t: "我當初是看它十年的…", w: "crew" },
  { t: "跌深，就是最大的利多。", w: "cap" },
  { t: "有人收得到訊號嗎！", w: "crew" },
  { t: "基本面沒有改變。", w: "cap" },
];

const PAYOUTS_PER_YEAR = 2;

let cachedEntries = [];
let cachedConfig = {};
let cachedActions = [];
let cachedLatest = null;
let speechIndex = 0;
let autoSpeechTimer = null;

function formatNumber(n) {
  return Math.round(n).toLocaleString("zh-TW");
}

function formatPct(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function formatYieldPct(n) {
  const truncated = Math.floor(Number(n) * 100) / 100;
  return truncated.toFixed(2);
}

function dataUrl(path) {
  return `${path}?t=${Date.now()}`;
}

/* ── Corporate actions (DER-44) ── */

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
  for (const action of [...actions].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (asOf >= action.date) continue;
    price = (price - action.cashDividend) / (1 + action.stockDividendRatio);
  }
  return price;
}

function derivePosition(config, asOf, actions) {
  let shares = Number(config.shares) || 0;
  const originalCost = Number(config.cost_basis) || 0;
  let cashReceived = 0;
  for (const action of actions) {
    if (action.date > asOf) break;
    if (action.cashDividend) cashReceived += shares * action.cashDividend;
    if (action.stockDividendRatio) shares *= 1 + action.stockDividendRatio;
  }
  const restoredCost = originalCost - cashReceived;
  return {
    shares,
    cashReceived,
    restoredCostBasis: restoredCost,
    restoredBuyPrice: shares ? restoredCost / shares : 0,
    originalCostBasis: originalCost,
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
    shares: posTotal.shares,
    restored_buy_price: posPrice.restoredBuyPrice,
    cash_received: posTotal.cashReceived,
    loss_amount: lossAmount,
    loss_pct: lossPct,
    price_loss_amount: priceLossAmount,
    price_loss_pct: priceLossPct,
  };
}

function enrichEntries(entries, config, actions) {
  return entries.map((entry) => {
    const dual = computeDualMetrics(config, entry.close_price, entry.date, actions);
    return { ...entry, ...dual, close_price: Number(entry.close_price) };
  });
}

function computeCruelMetrics(latest, actions) {
  const priceLossPct = latest.price_loss_pct;
  const priceLossAmount = latest.price_loss_amount;
  const restoredBuy = latest.restored_buy_price;

  const needRisePct = priceLossPct >= 100
    ? Infinity
    : (priceLossPct / (100 - priceLossPct)) * 100;

  const annualCashPerShare = actions.reduce(
    (sum, a) => sum + a.cashDividend * PAYOUTS_PER_YEAR,
    0,
  );
  const divYieldPct = restoredBuy > 0 ? (annualCashPerShare / restoredBuy) * 100 : 0;
  const latestPayoutTotal = latest.cash_received || 0;
  const divYears = latestPayoutTotal > 0 ? priceLossAmount / latestPayoutTotal : Infinity;

  return { needRisePct, divYieldPct, divYears };
}

/* ── Spark mini chart ── */

function drawSparkChart(entries, actions) {
  const svg = document.getElementById("spark-svg");
  if (!svg || entries.length === 0) return;

  const w = 320;
  const h = 60;
  const pad = { l: 4, r: 4, t: 6, b: 6 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const series = entries.map((e) => e.loss_pct);
  const minV = Math.min(...series, 0);
  const maxV = Math.max(...series, 10);
  const range = maxV - minV || 1;

  const toX = (i) => pad.l + (entries.length > 1 ? (i / (entries.length - 1)) * chartW : chartW / 2);
  const toY = (v) => pad.t + ((v - minV) / range) * chartH;

  const pts = series.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const last = pts[pts.length - 1];
  const first = pts[0];

  document.getElementById("spark-line")?.setAttribute("points", linePoints);
  document.getElementById("spark-fill")?.setAttribute(
    "d",
    `M${first.x},${first.y} ${pts.slice(1).map((p) => `L${p.x},${p.y}`).join(" ")} L${last.x},${h - pad.b} L${first.x},${h - pad.b} Z`,
  );
  document.getElementById("spark-dot")?.setAttribute("cx", last.x);
  document.getElementById("spark-dot")?.setAttribute("cy", last.y);

  const actionDates = new Set(actions.map((a) => a.date));
  const eventIdx = entries.findIndex((e) => actionDates.has(e.date));
  const eventG = document.getElementById("spark-event");
  if (eventG && eventIdx >= 0) {
    const ex = toX(eventIdx);
    document.getElementById("spark-event-line")?.setAttribute("x1", ex);
    document.getElementById("spark-event-line")?.setAttribute("x2", ex);
    document.getElementById("spark-event-text")?.setAttribute("x", ex - 4);
    eventG.hidden = false;
  } else if (eventG) {
    eventG.hidden = true;
  }

  const days = entries.length;
  document.getElementById("spark-lbl").textContent = `近 ${days} 日下潛軌跡`;
  document.getElementById("spark-start").textContent = entries[0].date.slice(5);
  document.getElementById("spark-end").textContent = entries[entries.length - 1].date.slice(5);
}

/* ── Speech bubbles ── */

function popSpeech(line) {
  const stage = document.getElementById("stage");
  const bubbles = document.getElementById("bubbles");
  if (!stage || !bubbles) return;

  const el = document.createElement("div");
  el.className = `speech go${line.w === "cap" ? " cap" : ""}`;
  el.textContent = line.t;
  const cx = stage.clientWidth * 0.5 + (Math.random() * 40 - 20);
  el.style.left = `${cx}px`;
  el.style.top = "23%";
  bubbles.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

function onShipClick() {
  const hint = document.getElementById("hint");
  if (hint) hint.classList.add("is-hidden");
  popSpeech(SPEECH_LINES[speechIndex % SPEECH_LINES.length]);
  speechIndex += 1;
  setTimeout(() => {
    popSpeech(SPEECH_LINES[speechIndex % SPEECH_LINES.length]);
    speechIndex += 1;
  }, 650);
}

function initAmbientBubbles() {
  const stage = document.getElementById("stage");
  if (!stage) return;
  for (let i = 0; i < 9; i++) {
    const b = document.createElement("div");
    b.className = "amb";
    const s = 3 + Math.random() * 7;
    b.style.width = `${s}px`;
    b.style.height = `${s}px`;
    b.style.left = `${Math.random() * 100}%`;
    b.style.top = `${58 + Math.random() * 38}%`;
    b.style.animationDuration = `${7 + Math.random() * 7}s`;
    b.style.animationDelay = `${-Math.random() * 7}s`;
    stage.appendChild(b);
  }
}

function initAutoSpeech() {
  const crewLines = SPEECH_LINES.filter((l) => l.w === "crew");
  autoSpeechTimer = setInterval(() => {
    popSpeech(crewLines[Math.floor(Math.random() * crewLines.length)]);
  }, 3600);
}

/* ── Share card 1080×1350 ── */

function drawShareCard(latest, cruel, config) {
  const canvas = document.getElementById("share-canvas");
  const ctx = canvas.getContext("2d");
  const w = 1080;
  const h = 1350;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#7fb2d6");
  bg.addColorStop(0.18, "#4a90c2");
  bg.addColorStop(0.44, "#1e4d73");
  bg.addColorStop(0.72, "#0a2540");
  bg.addColorStop(1, "#01060f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#12202c";
  ctx.font = "900 72px 'Noto Serif TC', serif";
  ctx.fillText("青雲", 60, 120);
  ctx.fillStyle = "#e8703a";
  ctx.font = "700 42px 'Noto Serif TC', serif";
  ctx.fillText("平步向下", 60, 175);

  ctx.fillStyle = "#8fa6bb";
  ctx.font = "500 28px 'Noto Sans TC', sans-serif";
  ctx.fillText("5386.TWO · 即時沉沒模擬器", 60, 230);

  ctx.fillStyle = "#e8703a";
  ctx.font = "900 96px 'Noto Serif TC', serif";
  ctx.fillText(formatNumber(latest.loss_amount), 60, 380);
  ctx.fillStyle = "#cddceb";
  ctx.font = "500 36px 'Noto Sans TC', sans-serif";
  ctx.fillText("元", 60 + ctx.measureText(formatNumber(latest.loss_amount)).width + 12, 380);

  ctx.fillStyle = "#e6eef6";
  ctx.font = "500 32px 'Noto Sans TC', sans-serif";
  ctx.fillText(`沉沒深度 ${formatPct(latest.loss_pct)}% · 收盤 ${formatPct(latest.close_price)}`, 60, 450);
  ctx.fillText(`海面解套線 ${formatPct(latest.restored_buy_price)} · ${formatNumber(latest.shares)} 股`, 60, 500);

  const cards = [
    ["浮出海面還需漲", `+${formatPct(cruel.needRisePct, 1)}%`],
    ["股利救生圈回本", `${formatYieldPct(cruel.divYieldPct)}%`],
    ["只靠配息浮出", `${formatPct(cruel.divYears, 1)} 年`],
  ];
  cards.forEach(([label, value], i) => {
    const y = 580 + i * 150;
    ctx.strokeStyle = "rgba(232, 112, 58, 0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(60, y, w - 120, 120);
    ctx.fillStyle = "#8fa6bb";
    ctx.font = "500 28px 'Noto Sans TC', sans-serif";
    ctx.fillText(label, 80, y + 45);
    ctx.fillStyle = "#e8703a";
    ctx.font = "900 52px 'Noto Serif TC', serif";
    ctx.fillText(value, 80, y + 100);
  });

  ctx.fillStyle = "rgba(143, 166, 187, 0.7)";
  ctx.font = "400 24px 'Noto Sans TC', sans-serif";
  ctx.fillText(`${config.stock_name || "青雲"} · 僅供娛樂 · ${latest.date}`, 60, h - 60);

  return canvas;
}

function downloadShareCard() {
  if (!cachedLatest) return;
  const cruel = computeCruelMetrics(cachedLatest, cachedActions);
  const canvas = drawShareCard(cachedLatest, cruel, cachedConfig);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `5386-sinking-${cachedLatest.date}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/* ── Dashboard ── */

function updateUI(latest, entries) {
  cachedLatest = latest;
  const cruel = computeCruelMetrics(latest, cachedActions);

  document.getElementById("breakeven-price").textContent = formatPct(latest.restored_buy_price);
  document.getElementById("loss-amount").textContent = formatNumber(latest.loss_amount);
  document.getElementById("loss-pct").textContent = formatPct(latest.loss_pct);
  document.getElementById("close-price").textContent = formatPct(latest.close_price);
  document.getElementById("need-rise").textContent = formatPct(cruel.needRisePct, 1);
  document.getElementById("div-yield").textContent = formatYieldPct(cruel.divYieldPct);
  document.getElementById("div-years").textContent = formatPct(cruel.divYears, 1);

  drawSparkChart(entries, cachedActions);
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
    cachedActions = normalizeActions(actionsRaw);
    cachedConfig = data.config_snapshot || {};
    cachedEntries = enrichEntries(data.entries || [], cachedConfig, cachedActions);

    if (cachedEntries.length === 0) {
      popSpeech({ t: "船隻待命中，尚未收到航海數據…", w: "cap" });
      return;
    }

    updateUI(cachedEntries[cachedEntries.length - 1], cachedEntries);
  } catch (err) {
    console.error("Failed to load:", err);
    popSpeech({ t: "通訊中斷，無法讀取航海數據", w: "cap" });
  }
}

document.getElementById("ship")?.addEventListener("click", onShipClick);
document.getElementById("btn-share")?.addEventListener("click", downloadShareCard);
initAmbientBubbles();
initAutoSpeech();
loadData();
