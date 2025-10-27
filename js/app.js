// 간단 유틸
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

const state = {
  current: { playerId: null, reportId: null },
  summary: null,
  series: null,
  video: null,
  fps: 30,
  toggles: { head: true, skel: true, path: false },
  angleChart: null,
  videoRect: { w: 0, h: 0 }
};

function text(elId, v) {
  const el = document.getElementById(elId);
  if (el) el.textContent = v ?? "-";
}

function setRaw(elId, obj) {
  const el = document.getElementById(elId);
  if (el) el.textContent = obj ? JSON.stringify(obj, null, 2) : "-";
}

function renderReportList(index) {
  const list = document.getElementById("report-list");
  list.innerHTML = "";
  if (!index || !index.length) {
    list.innerHTML = "<em>reports/index.json에 항목이 없습니다.</em>";
    return;
  }
  index.forEach(item => {
    const div = document.createElement("div");
    div.className = "report-item";
    div.textContent = `${item.player_id} / ${item.report_id} ${item.title ? "— " + item.title : ""}`;
    div.addEventListener("click", () => openReport(item.player_id, item.report_id));
    list.appendChild(div);
  });
}

async function loadIndex() {
  try {
    const idx = await fetchJSON("./reports/index.json");
    renderReportList(idx);
  } catch (e) {
    document.getElementById("report-list").innerHTML = `<em>reports/index.json 로드 실패</em>`;
    console.error(e);
  }
}

async function openReport(playerId, reportId) {
  state.current = { playerId, reportId };
  try {
    const summary = await fetchJSON(`./reports/${playerId}/${reportId}/summary.json`);
    const series = await fetchJSON(`./reports/${playerId}/${reportId}/series.json`);
    state.summary = summary;
    state.series = series;
    state.fps = series?.fps ?? 30;

    // 카드 채우기
    text("card-player", playerId);
    text("card-report", reportId);
    text("card-swing-type", summary?.swing_type ?? "-");
    text("card-sep", summary?.separation_deg ?? "-");
    text("card-stride", summary?.stride_cm ?? "-");

    setRaw("raw-summary", summary);
    setRaw("raw-series", series);

    // 비디오 소스 세팅
    const video = document.getElementById("player");
    const fallback = `./reports/${playerId}/${reportId}/assets/report_video.mp4`;
    const fromSummary = summary?.assets?.report_video;
    video.src = fromSummary ? fromSummary : fallback;
    state.video = video;

    // 토글 핸들러
    document.querySelectorAll(".toggles input[type=checkbox]").forEach(chk => {
      chk.addEventListener("change", (e) => {
        const key = e.target.dataset.layer;
        state.toggles[key] = e.target.checked;
      });
    });

    setupVideoSync();
    buildCharts(series);

  } catch (e) {
    console.error("openReport error", e);
    alert("리포트 로드 실패: 콘솔을 확인하세요.");
  }
}

function setupVideoSync() {
  const video = state.video;
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const seek = document.getElementById("seek");

  function resizeCanvas() {
    // 비디오 요소 크기를 기준으로 캔버스 사이즈 맞춤
    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.videoRect.w = rect.width;
    state.videoRect.h = rect.height;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  video.addEventListener("loadedmetadata", () => {
    seek.min = 0;
    seek.max = Math.floor(video.duration * 1000);
    seek.value = 0;
  });
  seek.addEventListener("input", (e) => {
    video.currentTime = Number(e.target.value) / 1000;
  });

  const useRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  function drawOverlay(tSec) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- 여기에 실제 오버레이 그리기 로직 추가 예정 ---
    // 최소 동작 버전: 현재 시간 표시 + 데모 라인
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#000";
    ctx.fillRect(8, 8, 120, 30);
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(`t = ${tSec.toFixed(2)}s`, 16, 28);
    ctx.restore();

    // (예시) Skeleton 토글 시 데모 도형
    if (state.toggles.skel) {
      ctx.beginPath();
      ctx.moveTo(20, 60);
      ctx.lineTo(60, 120);
      ctx.lineTo(100, 80);
      ctx.stroke();
    }

    updateChartCursor(tSec);
    seek.value = Math.floor(tSec * 1000);
  }

  if (useRVFC) {
    const loop = (now, meta) => {
      drawOverlay(meta.mediaTime);
      video.requestVideoFrameCallback(loop);
    };
    video.requestVideoFrameCallback(loop);
  } else {
    video.addEventListener("timeupdate", () => drawOverlay(video.currentTime));
  }
}

function nearestIndexByTime(labels, tSec) {
  if (!Array.isArray(labels) || !labels.length) return 0;
  // labels가 time 배열([0, 0.033, ...])이라고 가정
  let lo = 0, hi = labels.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = labels[mid];
    if (v === tSec) return mid;
    if (v < tSec) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

function buildCharts(series) {
  const el = document.getElementById("chart-angles");
  if (!series) {
    el.replaceWith(el.cloneNode(true)); // 차트 초기화
    state.angleChart = null;
    return;
  }

  const labels = Array.isArray(series.time_s) ? series.time_s : null;
  const sep = series?.angles?.separation || [];
  const ctx = el.getContext("2d");

  if (state.angleChart) {
    state.angleChart.destroy();
  }

  state.angleChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels || sep.map((_, i) => i),
      datasets: [{
        label: "Separation (deg)",
        data: sep,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: true }, tooltip: { enabled: true } },
      scales: {
        x: { display: true, title: { display: false } },
        y: { display: true, title: { display: false } }
      },
      onClick: (evt) => {
        if (!labels) return;
        const x = state.angleChart.scales.x.getValueForPixel(evt.x);
        const idx = Math.max(0, Math.min(labels.length - 1, Math.round(x)));
        const t = labels[idx];
        if (typeof t === "number" && state.video) {
          state.video.currentTime = t;
        }
      }
    }
  });
}

function updateChartCursor(tSec) {
  const chart = state.angleChart;
  if (!chart) return;
  const labels = chart.data.labels;
  if (!Array.isArray(labels) || !labels.length) return;
  const idx = nearestIndexByTime(labels, tSec);
  chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
  chart.update("none");
}

// 시작
window.addEventListener("DOMContentLoaded", loadIndex);
