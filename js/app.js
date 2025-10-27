// ===== 유틸 =====
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}
function text(elId, v) {
  const el = document.getElementById(elId);
  if (el) el.textContent = v ?? "-";
}
function setRaw(elId, obj) {
  const el = document.getElementById(elId);
  if (el) el.textContent = obj ? JSON.stringify(obj, null, 2) : "-";
}

// ===== 글로벌 상태 =====
const state = {
  current: { playerId: null, reportId: null },
  summary: null,
  series: null,
  video: null,
  overlayVid: null,
  fps: 30,
  toggles: { head: true, skel: true, path: false },
  angleChart: null,
  playersById: {}, // { "0001": {id,name,team,number,...}, ... }
};

// ===== 초기 로드 =====
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadPlayers();
  } catch(e) {
    console.warn("players.json 로드 실패(선수 이름 매핑 없이 진행):", e);
  }
  await loadIndex();
});

async function loadPlayers() {
  const players = await fetchJSON("./data/players.json");
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

// ===== 목록 렌더 =====
function renderReportList(index) {
  const list = document.getElementById("report-list");
  list.innerHTML = "";
  if (!index || !index.length) {
    list.innerHTML = "<em>reports/index.json에 항목이 없습니다.</em>";
    return;
  }

  // 1) 팀 → 선수 → 리포트 구조 만들기
  const teams = {}; // { teamName: { players: { playerId: { player, items: [] } } } }
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

  // 팀명 정렬(한글/영문 혼합 대비)
  const teamNames = Object.keys(teams).sort((a,b)=> a.localeCompare(b));
  for (const tName of teamNames) {
    const team = teams[tName];
    const teamPlayers = Object.values(team.players);

    // 팀 섹션(details)
    const teamDetails = document.createElement("details");
    teamDetails.className = "team-group";
    teamDetails.open = false; // 기본 펼침(원하면 false)

    const teamSummary = document.createElement("summary");
    const teamCount = teamPlayers.reduce((sum, tp) => sum + tp.items.length, 0);
    teamSummary.innerHTML = `<span class="group-title">🏷️ ${tName}</span><span class="group-count">${teamCount}</span>`;
    teamDetails.appendChild(teamSummary);

    // 2) 선수별 정렬(이름 → 등번호)
    teamPlayers.sort((a,b)=>{
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

      // 리포트 항목들
      const ul = document.createElement("div");
      ul.className = "report-items";
      // 최신 report_id가 뒤에 날짜가 있으면 그걸 기준으로 역정렬하고 싶다면 여기서 정렬 로직 추가 가능
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
    const idx = await fetchJSON("./reports/index.json");
    renderReportList(idx);
  } catch (e) {
    document.getElementById("report-list").innerHTML = `<em>reports/index.json 로드 실패</em>`;
    console.error(e);
  }
}

// ===== 리포트 오픈 =====
async function openReport(playerId, reportId) {
  state.current = { playerId, reportId };
  try {
    const summary = await fetchJSON(`./reports/${playerId}/${reportId}/summary.json`);
    const series  = await fetchJSON(`./reports/${playerId}/${reportId}/series.json`);
    state.summary = summary;
    state.series  = series;
    state.fps     = series?.fps ?? 30;

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
    const fallback = `./reports/${playerId}/${reportId}/assets/report_video.mp4`;
    video.src = summary?.assets?.report_video || fallback;
    state.video = video;

    // 오버레이 비디오
    state.overlayVid = document.getElementById("overlayVid");
    wireOverlayControls(); // select, opacity, blend 이벤트 바인딩
    // 초기 선택 반영
    applyOverlaySelection();

    // 토글(캔버스용 - 추후 실제 좌표 드로잉 연결)
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

// ===== 오버레이 비디오 컨트롤 =====
function wireOverlayControls() {
  const sel = document.getElementById("overlaySelect");
  const op  = document.getElementById("overlayOpacity");
  const blend = document.getElementById("overlayBlend");
  sel.onchange = applyOverlaySelection;
  op.oninput = () => {
    const v = Number(op.value);
    state.overlayVid.style.opacity = (v/100).toFixed(2);
  };
  blend.onchange = () => {
    state.overlayVid.style.mixBlendMode = blend.value;
  };
}

function applyOverlaySelection() {
  const sel = document.getElementById("overlaySelect");
  const file = sel.value;
  const vid  = state.overlayVid;
  if (!file) {
    vid.removeAttribute("src");
    vid.style.display = "none";
    return;
  }
  const { playerId, reportId } = state.current;
  vid.src = `./reports/${playerId}/${reportId}/assets/${file}`;
  vid.style.display = "block";
  // 플레이어와 동기화 (load 후 currentTime 일치)
  vid.onloadedmetadata = () => {
    trySyncOverlayVideo();
  };
  // 스타일 초기값
  const op  = document.getElementById("overlayOpacity");
  vid.style.opacity = (Number(op.value)/100).toFixed(2);
  const blend = document.getElementById("overlayBlend");
  vid.style.mixBlendMode = blend.value;
}

function trySyncOverlayVideo() {
  if (!state.video || !state.overlayVid) return;
  state.overlayVid.currentTime = state.video.currentTime || 0;
  if (!state.overlayVid.paused && state.video.paused) state.overlayVid.pause();
  if (!state.video.paused && state.overlayVid.paused) state.overlayVid.play().catch(()=>{});
}

// ===== 비디오 동기화 + 캔버스(자리만) =====
function setupVideoSync() {
  const video = state.video;
  const overlayVid = state.overlayVid;
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const seek = document.getElementById("seek");

  // 리사이즈
  function resizeCanvas() {
    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // overlay 영상도 같은 크기 배치
    overlayVid.style.width = rect.width + "px";
    overlayVid.style.height = rect.height + "px";
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // 시킹 연결
  video.addEventListener("loadedmetadata", () => {
    seek.min = 0; seek.max = Math.floor(video.duration * 1000); seek.value = 0;
  });
  seek.addEventListener("input", (e) => {
    const t = Number(e.target.value)/1000;
    video.currentTime = t;
    trySyncOverlayVideo();
  });

  // 재생/일시정지 연동
  video.addEventListener("play", () => overlayVid.play().catch(()=>{}));
  video.addEventListener("pause", () => overlayVid.pause());

  // 타임업데이트 연동
  const useRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  function drawOverlayCanvas(tSec) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 추후: 좌표/스켈레톤 직접 드로잉을 여기에 연결
    // 지금은 자리 표시 + 현재시간
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#000";
    ctx.fillRect(8, 8, 120, 30);
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(`t = ${tSec.toFixed(2)}s`, 16, 28);
    ctx.restore();

    seek.value = Math.floor(tSec * 1000);
    updateChartCursor(tSec);
  }

  if (useRVFC) {
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

// ===== 그래프 =====
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
    // 비어있으면 그냥 끝
    el.getContext("2d").clearRect(0,0,el.width,el.height);
    return;
  }

  const labels = Array.isArray(series.time_s) ? series.time_s : null;
  const keys = Object.keys(series.angles);
  const datasets = [];
  const palette = ["", "", ""]; // Chart.js 기본색 사용(명시색 X)
  // 보여줄 우선순위: separation, shoulder*, pelvis*, opening 등
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
    if (datasets.length >= 3) break; // 최대 3개만 (과밀 방지)
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


// === 레이어 크기 동기화 ===
const video = document.getElementById('mainVideo');
const overlayVid = document.getElementById('overlayVid');
const canvas = document.getElementById('overlayCanvas');
const ctx = canvas.getContext('2d');

function resizeLayersToVideo() {
  if (!video) return;
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // 보이는 크기 통일
  [canvas, overlayVid].forEach(el => {
    if (!el) return;
    el.style.width  = rect.width + 'px';
    el.style.height = rect.height + 'px';
  });

  // 캔버스 내부 픽셀(DPR 반영)
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 메타데이터/리사이즈/전체화면 시 동기화
video?.addEventListener('loadedmetadata', () => {
  // 원본 비율을 컨테이너에 고정하려면 아래 주석 해제
  // document.getElementById('player').style.aspectRatio =
  //   `${video.videoWidth} / ${video.videoHeight}`;
  resizeLayersToVideo();
});
window.addEventListener('resize', resizeLayersToVideo);
document.addEventListener('fullscreenchange', resizeLayersToVideo);

// (선택) 소스 교체 유틸
function loadReportSources(mainSrc, overlaySrc) {
  video.src = mainSrc;
  if (overlaySrc) {
    overlayVid.src = overlaySrc;
    overlayVid.style.display = '';
  } else {
    overlayVid.removeAttribute('src');
    overlayVid.style.display = 'none';
  }
}

// === 좌표 스케일 유틸 ===
function getVideoScale() {
  const rect = video.getBoundingClientRect();
  return {
    sx: rect.width  / (video.videoWidth  || rect.width  || 1),
    sy: rect.height / (video.videoHeight || rect.height || 1)
  };
}
// 사용 예시:
// const {sx, sy} = getVideoScale();
// const x = kp.x * sx; const y = kp.y * sy; 로 캔버스에 그리면 정확히 겹칩니다.
