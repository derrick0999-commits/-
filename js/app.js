const MILESTONES = [
  { max: 10, text: "船身輕微進水，甲板員表示無需驚慌" },
  { max: 30, text: "船艙開始積水，有人開始翻查逃生手冊" },
  { max: 50, text: "船長廣播：這是暫時性技術性回檔" },
  { max: 70, text: "救生艇已放下，但船長選擇留下" },
  { max: 90, text: "僅剩桅杆露出水面，海鳥停靠休息" },
  { max: Infinity, text: "沉入馬里亞納海溝，考古隊已列入未來挖掘清單" },
];

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
  const maxSink = 65;
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

function drawDepthChart(entries, config = {}) {
  const canvas = document.getElementById("depth-chart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 900;
  const h = rect.height || 160;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const pad = { top: 14, right: 50, bottom: 28, left: 44 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  if (entries.length === 0) {
    ctx.fillStyle = "#5c6f82";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("尚無歷史資料，等待首次收盤更新...", w / 2, h / 2);
    return;
  }

  const lossPcts = entries.map((e) => e.loss_pct);
  const maxLoss = Math.max(...lossPcts, 10);
  const minLoss = Math.min(...lossPcts, 0);

  const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  grad.addColorStop(0, "#b8e4f8");
  grad.addColorStop(0.5, "#6ec4e8");
  grad.addColorStop(1, "#1a6a9e");
  ctx.fillStyle = grad;
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
  ctx.strokeStyle = "#e53935";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(pad.left + (entries.length - 1) * xStep, pad.top + chartH);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  fillGrad.addColorStop(0, "rgba(229, 57, 53, 0.25)");
  fillGrad.addColorStop(1, "rgba(229, 57, 53, 0.04)");
  ctx.fillStyle = fillGrad;
  ctx.fill();

  entries.forEach((entry, i) => {
    const x = pad.left + (entries.length > 1 ? i * xStep : chartW / 2);
    const y = toY(entry.loss_pct);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#f57c00";
    ctx.fill();
  });

  ctx.fillStyle = "#5c6f82";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  const yLabels = 5;
  const shares = Number(config?.shares) || 0;
  const costBasis = Number(config?.cost_basis) || 0;
  for (let i = 0; i <= yLabels; i++) {
    const val = minLoss + ((maxLoss - minLoss) / yLabels) * i;
    const y = toY(val);
    ctx.fillText(`${val.toFixed(1)}%`, pad.left - 8, y + 4);

    if (shares > 0 && costBasis > 0) {
      // Invert loss% formula: price = market_value / shares, market_value = cost * (1 - loss%)
      const price = (costBasis * (1 - val / 100)) / shares;
      ctx.textAlign = "left";
      ctx.fillText(`${price.toFixed(1)}`, pad.left + chartW + 8, y + 4);
      ctx.textAlign = "right";
    }

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  const labelInterval = Math.max(1, Math.floor(entries.length / 8));
  entries.forEach((entry, i) => {
    if (i % labelInterval !== 0 && i !== entries.length - 1) return;
    const x = pad.left + (entries.length > 1 ? i * xStep : chartW / 2);
    ctx.fillText(entry.date.slice(5), x, h - pad.bottom + 16);
  });

  ctx.fillStyle = "#5c6f82";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("虧損深度 (%)", pad.left / 2, pad.top + chartH / 2);
  if (shares > 0 && costBasis > 0) {
    ctx.save();
    ctx.translate(w - 10, pad.top + chartH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText("收盤價 (NT$)", 0, 0);
    ctx.restore();
  }
}

function updateDashboard(latest, config) {
  document.getElementById("loss-amount").textContent = formatNumber(latest.loss_amount);
  document.getElementById("loss-pct").textContent = latest.loss_pct.toFixed(2);
  document.getElementById("close-price").textContent = latest.close_price.toFixed(2);
  document.getElementById("remaining-pct").textContent = latest.remaining_pct.toFixed(2);
  document.getElementById("milestone-text").textContent = getMilestone(latest.loss_pct);

  updateShipPosition(latest.loss_pct);
  createBubbles(latest.loss_pct);

  const stockName = config?.stock_name || "青雲";
  document.getElementById("chart-meta").textContent =
    `${stockName} · 成本 ${formatNumber(config?.cost_basis || 0)} 元 · 均價 ${config?.buy_price || "—"} 元 · 共 ${formatNumber(config?.shares || 0)} 股`;
}

async function loadData() {
  try {
    const res = await fetch("data/price-history.json");
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
    drawDepthChart(entries, config);
  } catch (err) {
    console.error("Failed to load price history:", err);
    document.getElementById("milestone-text").textContent = "通訊中斷，無法讀取航海數據（請確認 price-history.json 存在）";
  }
}

loadData();

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fetch("data/price-history.json")
      .then((r) => r.json())
      .then((data) => drawDepthChart(data.entries || [], data.config_snapshot || {}))
      .catch(() => {});
  }, 200);
});
