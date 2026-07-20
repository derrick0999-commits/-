/* DER-45 Plan B — 即時沉沒模擬器 */

const DEPTH_ZONES = [
  {
    max: 15,
    title: "輕度進水通報",
    body: "依本處規定，投資人應保持樂觀。船身雖有滲水，惟定性為「正常波動」，無須通報親友。",
    code: "甲類",
  },
  {
    max: 30,
    title: "技術性回檔備忘",
    body: "處損未達危險水位。建議朗讀「長線投資」三遍，並忽略任何想賣出的念頭。",
    code: "乙類",
  },
  {
    max: 45,
    title: "套牢認列公告",
    body: "已低於解套海面。依規定不得稱「賠」，應改稱「時間換空間」。請簽名確認。",
    code: "丙類",
  },
  {
    max: Infinity,
    title: "海底寄存函",
    body: "本艙位已移交海溝保管。若見到反彈，那 probably 只是氣泡，不是股價。",
    code: "丁類",
  },
];

const CAPTAIN_QUOTES = [
  "今日海象：多雲。建議把均價當成記憶，不要當成目標。",
  "本席宣布：這不是套牢，是深度價值投資。",
  "請各位乘客系好安全帶——我們要開始「長期持有」了。",
  "海面在上方，問題在於我們選擇往下潛。",
  "若問何時解套，本席答：等風來。風若不來，等下輩子。",
  "今日菜單：鮮魚（被水淹的）、鹹魚（就是我們）。",
  "投資如航海：起點有錢，終點有故事。",
  "雷達顯示前方有反彈——後來發現是回音。",
  "本船不提供停損服務，僅提供「再等等」服務。",
  "各位，我們不是沉沒，是在做底部確認。",
  "今日股價：比昨天更懂人生。",
  "請勿驚慌。驚慌無益，加碼才有（更多虧損的）機會。",
  "海圖標示此處為「黃金坑」。實際上是坑，黃金待查。",
  "若你問我信心，我說：信心滿滿。若你問我部位，我說：先不談這個。",
  "本日廣播結束。明日繼續廣播同一段。",
  "記住：別人恐懼我貪婪——結果我們一起恐懼。",
  "這裡水壓有點大，但心態要更大。",
  "解套線在海面。我們在海底。中間差的是時間（或運氣）。",
  "今日操作建議：關 app，開窗，深呼吸，然後繼續關著 app。",
  "本席保證：只要不停計算，就不會停止難過。",
];

const ROAST_LINES = [
  { pax: "wave", text: "救命啊均價！誰來接盤！" },
  { pax: "cling", text: "欄杆我的命，鬆手就沒了" },
  { pax: "crouch", text: "再算一次…還是負的" },
  { pax: "hang", text: "會回來的，一定會…吧？" },
  { pax: "stern", text: "跌深更好買！我沒在哭" },
  { pax: "wave", text: "這不是套牢，是傳承" },
  { pax: "cling", text: "均價是過去式，現在式是後悔" },
  { pax: "crouch", text: "攤平？我早攤成薄餅了" },
  { pax: "hang", text: "健康回檔？我快不健康了" },
  { pax: "stern", text: "加碼加到船要沉了" },
  { pax: "wave", text: "5386 還我青春" },
  { pax: "cling", text: "不認虧，認了就要面對" },
  { pax: "crouch", text: "除權息？除的是我的希望" },
  { pax: "hang", text: "長線持有＝長線被關" },
  { pax: "stern", text: "別問，問就是價值投資" },
];

const PAYOUTS_PER_YEAR = 2;

let cachedEntries = [];
let cachedConfig = {};
let cachedActions = [];
let cachedLatest = null;
let roastIndex = 0;
let roastTimer = null;
let resizeTimer = null;

function formatNumber(n) {
  return Math.round(n).toLocaleString("zh-TW");
}

function formatPct(n, digits = 1) {
  return Number(n).toFixed(digits);
}

function formatYieldPct(n) {
  const truncated = Math.floor(Number(n) * 100) / 100;
  return truncated.toFixed(2);
}

function dataUrl(path) {
  return `${path}?t=${Date.now()}`;
}

function dayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function getCaptainQuote() {
  const idx = dayOfYear() % CAPTAIN_QUOTES.length;
  return CAPTAIN_QUOTES[idx];
}

function getZone(lossPct) {
  for (const z of DEPTH_ZONES) {
    if (lossPct < z.max) return z;
  }
  return DEPTH_ZONES[DEPTH_ZONES.length - 1];
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
    adj_close: adjClose,
    shares: posTotal.shares,
    restored_buy_price: posPrice.restoredBuyPrice,
    restored_cost_basis: posPrice.restoredCostBasis,
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

/* ── Cruel dashboard (全推導) ── */

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

  return {
    needRisePct,
    divYieldPct,
    divYears,
  };
}

/* ── Ocean vertical profile canvas ── */

function depthToY(lossPct, maxDepth, padTop, chartH) {
  const clamped = Math.max(0, Math.min(lossPct, maxDepth));
  return padTop + (clamped / maxDepth) * chartH;
}

function renderMilestoneSigns(maxDepth) {
  const rail = document.getElementById("milestone-rail");
  if (!rail) return;
  rail.innerHTML = "";

  DEPTH_ZONES.forEach((zone, i) => {
    const prevMax = i === 0 ? 0 : DEPTH_ZONES[i - 1].max;
    const midPct = zone.max === Infinity ? Math.min(maxDepth * 0.88, 55) : (prevMax + zone.max) / 2;
    const topPct = (midPct / maxDepth) * 100;

    const el = document.createElement("div");
    el.className = "doc-sign";
    el.style.top = `${Math.min(topPct, 92)}%`;
    el.innerHTML = `
      <p class="doc-title">${zone.code} · ${zone.title}</p>
      <p class="doc-body">${zone.body}</p>
      <p class="doc-depth">適用深度 ${prevMax}–${zone.max === Infinity ? "∞" : zone.max}%</p>
    `;
    rail.appendChild(el);
  });
}

function drawOceanProfile(entries, latest, actions) {
  const canvas = document.getElementById("ocean-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 280);
  const h = Math.max(rect.height, 180);

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 14, right: 12, bottom: 16, left: 38 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const series = entries.map((e) => e.price_loss_pct ?? e.loss_pct);
  const maxDepth = Math.max(40, ...series, latest.price_loss_pct) * 1.08;
  renderMilestoneSigns(maxDepth);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, pad.top + chartH * 0.18);
  skyGrad.addColorStop(0, "#87bdd8");
  skyGrad.addColorStop(1, "#4eb8d9");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(pad.left, pad.top, chartW, chartH * 0.18);

  const waterGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  waterGrad.addColorStop(0, "#4eb8d9");
  waterGrad.addColorStop(0.35, "#1f6f9f");
  waterGrad.addColorStop(1, "#041018");
  ctx.fillStyle = waterGrad;
  ctx.fillRect(pad.left, pad.top, chartW, chartH);

  const surfaceY = depthToY(0, maxDepth, pad.top, chartH);
  ctx.strokeStyle = "rgba(255, 217, 61, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, surfaceY);
  ctx.lineTo(pad.left + chartW, surfaceY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#ffd93d";
  ctx.font = "700 10px 'Noto Sans TC', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`海面 · 解套線 ${formatPct(latest.restored_buy_price, 2)}`, pad.left + 4, surfaceY - 5);

  const depthLabels = 4;
  ctx.fillStyle = "rgba(232, 244, 251, 0.75)";
  ctx.font = "500 10px 'Noto Sans TC', sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= depthLabels; i++) {
    const pct = (maxDepth / depthLabels) * i;
    const y = depthToY(pct, maxDepth, pad.top, chartH);
    ctx.fillText(`${pct.toFixed(0)}%`, pad.left - 6, y + 3);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
  }

  const xStep = entries.length > 1 ? chartW / (entries.length - 1) : chartW / 2;
  const toX = (i) => pad.left + (entries.length > 1 ? i * xStep : chartW / 2);

  if (entries.length > 0) {
    ctx.beginPath();
    series.forEach((pct, i) => {
      const x = toX(i);
      const y = depthToY(pct, maxDepth, pad.top, chartH);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(255, 140, 66, 0.85)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.lineTo(toX(entries.length - 1), pad.top + chartH);
    ctx.lineTo(toX(0), pad.top + chartH);
    ctx.closePath();
    const trailGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    trailGrad.addColorStop(0, "rgba(255, 140, 66, 0.25)");
    trailGrad.addColorStop(1, "rgba(255, 140, 66, 0.02)");
    ctx.fillStyle = trailGrad;
    ctx.fill();
  }

  const actionDates = new Set(actions.map((a) => a.date));
  entries.forEach((entry, i) => {
    if (!actionDates.has(entry.date)) return;
    const x = toX(i);
    ctx.strokeStyle = "rgba(255, 217, 61, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd93d";
    ctx.font = "600 9px 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("除權息", x, pad.top + 10);
  });

  const shipY = depthToY(latest.price_loss_pct, maxDepth, pad.top, chartH);
  const shipX = toX(entries.length - 1);

  ctx.fillStyle = "rgba(4, 16, 24, 0.55)";
  ctx.beginPath();
  ctx.ellipse(shipX, shipY + 8, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(shipX, shipY);
  ctx.rotate(-0.08);
  ctx.fillStyle = "#1b2f3d";
  ctx.beginPath();
  ctx.moveTo(-28, 6);
  ctx.lineTo(28, 6);
  ctx.quadraticCurveTo(32, 0, 24, -8);
  ctx.lineTo(-18, -8);
  ctx.lineTo(-28, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#375a6f";
  ctx.fillRect(-14, -18, 28, 12);
  ctx.fillStyle = "#ffd93d";
  ctx.font = "700 8px 'Noto Sans TC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("5386", 0, -10);
  ctx.restore();

  ctx.fillStyle = "#ff8c42";
  ctx.beginPath();
  ctx.arc(shipX, shipY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#e8f4fb";
  ctx.font = "600 9px 'Noto Sans TC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("船位", shipX, shipY - 14);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(158, 196, 216, 0.8)";
  ctx.font = "500 9px 'Noto Sans TC', sans-serif";
  const labelEvery = Math.max(1, Math.floor(entries.length / 5));
  entries.forEach((entry, i) => {
    if (i % labelEvery !== 0 && i !== entries.length - 1) return;
    ctx.fillText(entry.date.slice(5), toX(i), h - 4);
  });
}

/* ── Share card 1080×1350 ── */

function drawShareCard(latest, cruel, config) {
  const canvas = document.getElementById("share-canvas");
  const ctx = canvas.getContext("2d");
  const w = 1080;
  const h = 1350;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0d3550");
  bg.addColorStop(0.45, "#0a2840");
  bg.addColorStop(1, "#041018");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#e8f4fb";
  ctx.font = "700 36px 'Noto Serif TC', serif";
  ctx.fillText("青雲(5386) 沉沒模擬器", 60, 90);

  ctx.fillStyle = "#9ec4d8";
  ctx.font = "500 24px 'Noto Sans TC', sans-serif";
  ctx.fillText(getCaptainQuote(), 60, 150, w - 120);

  ctx.fillStyle = "#ff8c42";
  ctx.font = "700 72px 'Noto Serif TC', serif";
  ctx.fillText(`-${formatPct(latest.loss_pct, 2)}%`, 60, 280);
  ctx.fillStyle = "#e85d3a";
  ctx.font = "700 48px 'Noto Sans TC', sans-serif";
  ctx.fillText(`${formatNumber(latest.loss_amount)} 元`, 60, 350);

  ctx.fillStyle = "#9ec4d8";
  ctx.font = "500 28px 'Noto Sans TC', sans-serif";
  ctx.fillText(`處損深度 ${formatPct(latest.price_loss_pct, 2)}% · 收盤 ${formatPct(latest.close_price, 2)}`, 60, 420);
  ctx.fillText(`解套線 ${formatPct(latest.restored_buy_price, 2)} · ${formatNumber(latest.shares)} 股`, 60, 465);

  const cards = [
    ["要解套還需漲", `+${formatPct(cruel.needRisePct, 1)}%`],
    ["股利年化殖利率", `${formatYieldPct(cruel.divYieldPct)}%`],
    ["只靠股利回本", `${formatPct(cruel.divYears, 1)} 年`],
  ];
  cards.forEach(([label, value], i) => {
    const y = 540 + i * 130;
    ctx.strokeStyle = "rgba(232, 116, 58, 0.5)";
    ctx.strokeRect(60, y, w - 120, 100);
    ctx.fillStyle = "#9ec4d8";
    ctx.font = "500 24px 'Noto Sans TC', sans-serif";
    ctx.fillText(label, 80, y + 38);
    ctx.fillStyle = "#e85d3a";
    ctx.font = "700 42px 'Noto Serif TC', serif";
    ctx.fillText(value, 80, y + 82);
  });

  ctx.fillStyle = "rgba(158, 196, 216, 0.6)";
  ctx.font = "400 22px 'Noto Sans TC', sans-serif";
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

/* ── Roast easter egg ── */

function spawnRoastBubbles(container) {
  container.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const b = document.createElement("div");
    b.className = "roast-bubble";
    const size = 4 + Math.random() * 10;
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
    b.style.left = `${10 + Math.random() * 80}%`;
    b.style.animationDelay = `${Math.random() * 2}s`;
    b.style.animationDuration = `${2 + Math.random() * 2}s`;
    container.appendChild(b);
  }
}

function showRoast() {
  const layer = document.getElementById("roast-layer");
  const lineEl = document.getElementById("roast-line");
  const bubbles = document.getElementById("roast-bubbles");
  if (!layer || !lineEl) return;

  const line = ROAST_LINES[roastIndex % ROAST_LINES.length];
  roastIndex += 1;
  lineEl.textContent = line.text;
  spawnRoastBubbles(bubbles);
  layer.hidden = false;

  clearTimeout(roastTimer);
  roastTimer = setTimeout(() => {
    layer.hidden = true;
  }, 3200);
}

function initRoast() {
  const btn = document.getElementById("btn-roast");
  const layer = document.getElementById("roast-layer");
  if (btn) btn.addEventListener("click", showRoast);
  if (layer) {
    layer.addEventListener("click", () => {
      layer.hidden = true;
    });
  }
}

/* ── Dashboard update ── */

function updateUI(latest, config, entries) {
  cachedLatest = latest;
  const cruel = computeCruelMetrics(latest, cachedActions);
  const zone = getZone(latest.price_loss_pct);

  document.getElementById("captain-quote").textContent = getCaptainQuote();
  document.getElementById("depth-pct").textContent = formatPct(latest.price_loss_pct, 2);
  document.getElementById("ocean-sub").textContent =
    `${zone.code} ${zone.title} · 總報酬 ${formatPct(latest.loss_pct, 2)}%`;
  document.getElementById("loss-amount").textContent = formatNumber(latest.loss_amount);
  document.getElementById("close-price").textContent = formatPct(latest.close_price, 2);
  document.getElementById("breakeven-price").textContent = formatPct(latest.restored_buy_price, 2);
  document.getElementById("need-rise").textContent = formatPct(cruel.needRisePct, 1);
  document.getElementById("div-yield").textContent = formatYieldPct(cruel.divYieldPct);
  document.getElementById("div-years").textContent = formatPct(cruel.divYears, 1);

  drawOceanProfile(entries, latest, cachedActions);
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
      document.getElementById("captain-quote").textContent = "船隻待命中，尚未收到航海數據…";
      return;
    }

    updateUI(cachedEntries[cachedEntries.length - 1], cachedConfig, cachedEntries);
  } catch (err) {
    console.error("Failed to load:", err);
    document.getElementById("captain-quote").textContent =
      "通訊中斷，無法讀取航海數據（請重新整理）";
  }
}

function redraw() {
  if (cachedLatest && cachedEntries.length) {
    drawOceanProfile(cachedEntries, cachedLatest, cachedActions);
  }
}

document.getElementById("btn-share")?.addEventListener("click", downloadShareCard);
initRoast();
loadData();

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(redraw, 100);
});

const oceanFrame = document.querySelector(".ocean-frame");
if (oceanFrame && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redraw, 80);
  }).observe(oceanFrame);
}
