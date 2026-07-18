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
  const maxSink = 72;
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

function dataUrl() {
  return `data/price-history.json?t=${Date.now()}`;
}

function drawDepthChart(entries, config = {}) {
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

  const pad = { top: 16, right: 18, bottom: 28, left: 46 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  if (entries.length === 0) {
    ctx.fillStyle = "#3d5568";
    ctx.font = "500 13px 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("尚無歷史資料，等待首次收盤更新...", w / 2, h / 2);
    return;
  }

  const lossPcts = entries.map((e) => e.loss_pct);
  const maxLoss = Math.max(...lossPcts, 10);
  const minLoss = Math.min(...lossPcts, 0);

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

  ctx.beginPath();
  entries.forEach((entry, i) => {
    const x = pad.left + (entries.length > 1 ? i * xStep : chartW / 2);
    const y = toY(entry.loss_pct);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = "#c45c26";
  ctx.lineWidth = 2.25;
  ctx.stroke();

  ctx.lineTo(pad.left + (entries.length - 1) * xStep, pad.top + chartH);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  fillGrad.addColorStop(0, "rgba(196, 92, 38, 0.28)");
  fillGrad.addColorStop(1, "rgba(196, 92, 38, 0.03)");
  ctx.fillStyle = fillGrad;
  ctx.fill();

  const last = entries.length - 1;
  entries.forEach((entry, i) => {
    const x = pad.left + (entries.length > 1 ? i * xStep : chartW / 2);
    const y = toY(entry.loss_pct);
    const isLast = i === last;
    ctx.beginPath();
    ctx.arc(x, y, isLast ? 4.5 : 2.75, 0, Math.PI * 2);
    ctx.fillStyle = isLast ? "#8f3d14" : "#c45c26";
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
    const x = pad.left + (entries.length > 1 ? i * xStep : chartW / 2);
    ctx.fillText(entry.date.slice(5), x, h - pad.bottom + 16);
  });
}

function updateDashboard(latest, config) {
  currentLossPct = latest.loss_pct;
  document.getElementById("loss-amount").textContent = formatNumber(latest.loss_amount);
  document.getElementById("loss-pct").textContent = latest.loss_pct.toFixed(2);
  document.getElementById("close-price").textContent = latest.close_price.toFixed(2);
  document.getElementById("remaining-pct").textContent = latest.remaining_pct.toFixed(2);
  document.getElementById("milestone-text").textContent = getMilestone(latest.loss_pct);

  updateShipPosition(latest.loss_pct);
  createBubbles(latest.loss_pct);

  const stockName = config?.stock_name || "青雲";
  document.getElementById("chart-meta").textContent =
    `${stockName} · 成本 ${formatNumber(config?.cost_basis || 0)} 元 · 均價 ${config?.buy_price || "—"} 元`;
}

async function loadData() {
  try {
    const res = await fetch(dataUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const entries = data.entries || [];
    const config = data.config_snapshot || {};

    if (entries.length === 0) {
      document.getElementById("milestone-text").textContent = "船隻待命中，尚未收到任何航海數據...";
      drawDepthChart([], config);
      return;
    }

    const latest = entries[entries.length - 1];
    updateDashboard(latest, config);
    try {
      drawDepthChart(entries, config);
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

initPassengerMode();
loadData();

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fetch(dataUrl())
      .then((r) => r.json())
      .then((data) => drawDepthChart(data.entries || [], data.config_snapshot || {}))
      .catch(() => {});
  }, 200);
});
