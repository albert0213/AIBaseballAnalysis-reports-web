// ================== 유틸 ==================
async function fetchJSON(url, label = "fetchJSON") {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (err) {
    console.error(`[${label}] JSON 로드 실패:`, url, err);
    throw new Error(`JSON 로드 실패: ${url} (${err.message})`);
  }
}

function text(elId, v) {
  const el = document.getElementById(elId);
  if (el) el.textContent = v ?? "-";
}
function setRaw(elId, obj) {
  const el = document.getElementById(elId);
  if (el) el.textContent = obj ? JSON.stringify(obj, null, 2) : "-";
}
function joinUrl(...parts) {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/,'') : encodeURIComponent(p)))
    .join("/")
    .replace(/([^:])\/{2,}/g, "$1/");
}

// ================== 글로벌 상태 ==================
const state = {
  current: { playerId: null, reportId: null },
  summary: null,
  series: null,
  video: null,
  overlayVid: null,
  fps: 30,
  toggles: { head: true, skel: true, path: false },
  angleChart: null,
  playersById: {},
  usingRVFC: false,
  rate: 1 // ▶ 현재 재생 속도
};

// ================== 초기 로드 ==================
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadPlayers();
  } catch (e) {
    console.warn("players.json 로드 실패(선수 이름 매핑 없이 진행):", e);
  }
  wireOverlayControls();
  wirePlaybackControls();
  await loadIndex();
});

async function loadPlayers() {
  const players = await fetchJSON("./data/players.json", "players");
  const map = {};
  for (const p of players) map[p.id] = p;
  state.playersById = map;
}

function playerLabel(id) {
  const p = state.playersById[id];
  if (!p) return id;
  const teamNum = p.team ? `${p.team} #${p.number}` : `#${p.number}`;
  return `${p.name} (${teamNum})`;
}

// ================== 목록 렌더 ==================
function renderReportList(index) {
  const list = document.getElementById("report-list");
  list.innerHTML = "";
  if (!index || !index.length) {
    list.innerHTML = "<em>reports/index.json에 항목이 없습니다.</em>";
    return;
  }

  const teams = {};
  for (const item of index) {
    const pid = item.player_id;
    const p = state.playersById[pid];
    const teamName = p?.team || "팀 미지정";
    if (!teams[teamName]) teams[teamName] = { players: {} };
    if (!teams[teamName].players[pid]) {
      teams[teamName].players[pid] = { player: p || { id: pid, name: pid, number: "-", team: teamName }, items: [] };
    }
    teams[teamName].players[pid].items.push(item);
  }

  const teamNames = Object.keys(teams).sort((a, b) => a.localeCompare(b, "ko"));
  for (const tName of teamNames) {
    const team = teams[tName];
    const teamPlayers = Object.values(team.players);

    const teamDetails = document.createElement("details");
    teamDetails.className = "team-group";
    teamDetails.open = false;

    const teamSummary = document.createElement("summary");
    const teamCount = teamPlayers.reduce((sum, tp) => sum + tp.items.length, 0);
    teamSummary.innerHTML = `<span class="group-title">🏷️ ${tName}</span><span class="group-count">${teamCount}</span>`;
    teamDetails.appendChild(teamSummary);

    teamPlayers.sort((a, b) => {
      const an = a.player?.name || a.player?.id || "";
      const bn = b.player?.name || b.player?.id || "";
      const cmp = an.localeCompare(bn, "ko");
      if (cmp !== 0) return cmp;
      return (a.player?.number ?? 1e9) - (b.player?.number ?? 1e9);
    });

    for (const tp of teamPlayers) {
      const p = tp.player;
      const playerDetails = document.createElement("details");
      playerDetails.className = "player-group";

      const pLabel = `${p?.name ?? p.id} ${p?.number ? `(#${p.number})` : ""} ${p?.id ? `[${p.id}]` : ""}`;
      const pSummary = document.createElement("summary");
      pSummary.innerHTML = `<span class="group-title">👤 ${pLabel}</span><span class="group-count">${tp.items.length}</span>`;
      playerDetails.appendChild(pSummary);

      const ul = document.createElement("div");
      ul.className = "report-items";
      tp.items.forEach(item => {
        const div = document.createElement("div");
        div.className = "report-item";
        const title = item.title ? ` — ${item.title}` : "";
        div.textContent = `${item.report_id}${title}`;
        div.addEventListener("click", () => openReport(item.player_id, item.report_id));
        ul.appendChild(div);
      });

      playerDetails.appendChild(ul);
      teamDetails.appendChild(playerDetails);
    }

    list.appendChild(teamDetails);
  }
}

async function loadIndex() {
  try {
    const idx = await fetchJSON("./reports/index.json", "index");
    renderReportList(idx);
  } catch (e) {
    document.getElementById("report-list").innerHTML = `<em>reports/index.json 로드 실패</em>`;
    console.error(e);
  }
}

// ================== 리포트 오픈 ==================
async function openReport(playerId, reportId) {
  state.current = { playerId, reportId };

  const base = joinUrl("./reports", playerId, reportId);
  const summaryUrl = joinUrl(base, "summary.json");
  const seriesUrl  = joinUrl(base, "series.json");

  console.log("[openReport] start", { playerId, reportId, summaryUrl, seriesUrl });

  try {
    const summary = await fetchJSON(summaryUrl, "summary");
    const series  = await fetchJSON(seriesUrl, "series");
    state.summary = summary;
    state.series  = series;
    state.fps     = Number(series?.fps) || 30;

    // 카드
    text("card-player", playerId);
    const p = state.playersById[playerId];
    text("card-player-name", p ? p.name : "-");
    text("card-team-num", p ? `${p.team || "-"} / #${p.number ?? "-"}` : "-");
    text("card-report", reportId);
    text("card-swing-type", summary?.swing_type ?? "-");
    text("card-sep", summary?.separation_deg ?? summary?.separationAngle ?? "-");
    text("card-stride", summary?.stride_cm ?? summary?.strideLength ?? "-");

    setRaw("raw-summary", summary);
    setRaw("raw-series", series);

    // 비디오
    const video = document.getElementById("player");
    const videoWrap = document.getElementById("videoWrap");
    const fallback = joinUrl(base, "assets", "report_video.mp4");
    video.src = summary?.assets?.report_video || fallback;
    state.video = video;

    // 오버레이 비디오
    const overlayVid = document.getElementById("overlayVid");
    overlayVid.removeAttribute("src");
    overlayVid.style.display = "none";
    state.overlayVid = overlayVid;

    // 비디오 메타데이터 로드 후 레이아웃/동기화 준비
    video.onloadedmetadata = () => {
      lockAspectRatio(videoWrap, video);
      syncLayerSizes(video, overlayVid, document.getElementById("overlay"));
      setupVideoSync(); // 1회 바인딩
      // ▶ 초기 재생 속도 적용
      setPlaybackRate(state.rate);
      applyOverlaySelection(); // 현재 선택된 오버레이 반영
      // 초기 seek range
      const seek = document.getElementById("seek");
      seek.min = 0;
      seek.max = Math.floor(video.duration * 1000);
      seek.value = 0;
    };

    buildCharts(series);
  } catch (e) {
    console.error("openReport error", e);
    alert(`리포트 로드 실패:\n${e.message}\n(자세한 내용은 콘솔을 확인하세요)`);
  }
}

// ================== 비율/레이어 사이즈 ==================
function lockAspectRatio(container, video) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const ratio = (vw / vh).toFixed(6);
  container.style.setProperty("--video-aspect", ratio);
}

function syncLayerSizes(video, overlayVid, canvas) {
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ================== 오버레이 비디오 컨트롤 ==================
function wireOverlayControls() {
  const sel = document.getElementById("overlaySelect");
  const op  = document.getElementById("overlayOpacity");
  const blend = document.getElementById("overlayBlend");

  sel.onchange = applyOverlaySelection;
  op.oninput = () => {
    const v = Number(op.value);
    if (state.overlayVid) state.overlayVid.style.opacity = (v / 100).toFixed(2);
  };
  blend.onchange = () => {
    if (state.overlayVid) state.overlayVid.style.mixBlendMode = blend.value;
  };
}

function applyOverlaySelection() {
  const sel = document.getElementById("overlaySelect");
  const file = sel.value;
  const vid  = state.overlayVid;
  if (!vid) return;

  if (!file) {
    vid.removeAttribute("src");
    vid.style.display = "none";
    return;
  }
  const { playerId, reportId } = state.current;
  if (!playerId || !reportId) return;

  const src = joinUrl("./reports", playerId, reportId, "assets", file);
  console.log("[overlay] select", src);

  vid.onloadedmetadata = () => {
    // ▶ 오버레이도 동일 속도/시간으로 동기화
    vid.playbackRate = state.rate;
    trySyncOverlayVideo();
  };
  vid.onerror = () => {
    console.warn("[overlay] 로드 실패:", src);
    vid.removeAttribute("src");
    vid.style.display = "none";
    alert(`오버레이 영상 로드 실패: ${src}`);
  };

  vid.src = src;
  vid.style.display = "block";

  // 스타일 초기값
  const op  = document.getElementById("overlayOpacity");
  vid.style.opacity = (Number(op.value) / 100).toFixed(2);
  const blend = document.getElementById("overlayBlend");
  vid.style.mixBlendMode = blend.value;
}

function trySyncOverlayVideo() {
  if (!state.video || !state.overlayVid) return;
  const base = state.video;
  const over = state.overlayVid;

  // 시간 동기
  over.currentTime = base.currentTime || 0;

  // 재생 상태 동기
  if (!over.paused && base.paused) over.pause();
  if (!base.paused && over.paused) over.play().catch(()=>{});

  // ▶ 속도 동기
  if (over.playbackRate !== base.playbackRate) {
    over.playbackRate = base.playbackRate;
  }
}

// ================== 재생 속도 컨트롤 ==================
function wirePlaybackControls() {
  const buttons = document.querySelectorAll(".rate-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const rate = Number(btn.dataset.rate);
      setPlaybackRate(rate);
      // 버튼 활성화 표시
      buttons.forEach(b => b.classList.toggle("active", b === btn));
    });
  });
  // 초기 활성화 표시
  buttons.forEach(b => {
    if (Number(b.dataset.rate) === state.rate) b.classList.add("active");
  });
}

function setPlaybackRate(r) {
  if (!r || r <= 0) r = 1;
  state.rate = r;
  if (state.video) state.video.playbackRate = r;
  if (state.overlayVid) state.overlayVid.playbackRate = r;
  console.log(`[속도 변경] ${r}x`);
}

// ================== 비디오 동기화 + 캔버스 ==================
let syncBound = false;
function setupVideoSync() {
  if (syncBound) return; // 중복 바인딩 방지
  syncBound = true;

  const video = state.video;
  const overlayVid = state.overlayVid;
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const seek = document.getElementById("seek");

  // 반응형 리사이즈
  function onResize() {
    syncLayerSizes(video, overlayVid, canvas);
  }
  window.addEventListener("resize", onResize);

  // 시킹
  seek.addEventListener("input", (e) => {
    const t = Number(e.target.value) / 1000;
    state.video.currentTime = t;
    trySyncOverlayVideo();
  });

  // 재생/일시정지 연동
  video.addEventListener("play", () => overlayVid.play().catch(()=>{}));
  video.addEventListener("pause", () => overlayVid.pause());

  // ▶ 속도 변경 이벤트(브라우저 단축키 등으로 변경 시 UI/오버레이 동기화)
  video.addEventListener("ratechange", () => {
    state.rate = video.playbackRate || 1;
    if (overlayVid.playbackRate !== state.rate) overlayVid.playbackRate = state.rate;
    const sel = document.getElementById("rateSelect");
    if (sel && sel.value !== String(state.rate)) sel.value = String(state.rate);
  });

  // RVFC 지원 여부
  state.usingRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  function drawOverlayCanvas(tSec) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // TODO: 좌표/스켈레톤 드로잉 연결 지점
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#000";
    ctx.fillRect(8, 8, 160, 30);
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(`t = ${tSec.toFixed(2)}s @ ${state.rate}x`, 16, 28);
    ctx.restore();

    // UI 동기
    const seekEl = document.getElementById("seek");
    seekEl.value = Math.floor(tSec * 1000);
    updateChartCursor(tSec);
  }

  if (state.usingRVFC) {
    const loop = (now, meta) => {
      drawOverlayCanvas(meta.mediaTime);
      trySyncOverlayVideo();
      video.requestVideoFrameCallback(loop);
    };
    video.requestVideoFrameCallback(loop);
  } else {
    video.addEventListener("timeupdate", () => {
      drawOverlayCanvas(video.currentTime);
      trySyncOverlayVideo();
    });
  }
}

// ================== 그래프 ==================
function nearestIndexByTime(labels, tSec) {
  if (!Array.isArray(labels) || !labels.length) return 0;
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
  const ctx = el.getContext("2d");
  if (state.angleChart) {
    state.angleChart.destroy();
    state.angleChart = null;
  }
  if (!series || !series.angles) {
    ctx.clearRect(0, 0, el.width, el.height);
    return;
  }

  const labels = Array.isArray(series.time_s) ? series.time_s : null;
  const keys = Object.keys(series.angles);
  const datasets = [];

  const priority = ["separation","shoulder","pelvis","opening"];
  const sortedKeys = keys.sort((a,b)=>{
    const pa = priority.findIndex(p=>a.includes(p));
    const pb = priority.findIndex(p=>b.includes(p));
    return (pa<0?99:pa) - (pb<0?99:pb);
  });

  for (const k of sortedKeys) {
    const arr = series.angles[k];
    if (!Array.isArray(arr) || !arr.length) continue;
    datasets.push({
      label: k,
      data: arr,
      pointRadius: 0,
      borderWidth: 2
    });
    if (datasets.length >= 3) break;
  }

  if (!datasets.length) return;

  state.angleChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels || datasets[0].map((_, i) => i),
      datasets
    },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: true }, tooltip: { enabled: true } },
      scales: { x: { display: true }, y: { display: true } },
      onClick: (evt) => {
        if (!labels) return;
        const scaleX = state.angleChart.scales.x;
        const xVal = scaleX.getValueForPixel(evt.x);
        const idx = Math.max(0, Math.min(labels.length - 1, Math.round(xVal)));
        const t = labels[idx];
        if (typeof t === "number" && state.video) {
          state.video.currentTime = t;
          trySyncOverlayVideo();
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
