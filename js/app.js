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
function waitEvent(target, event, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let to = null;
    const on = () => {
      clearTimeout(to);
      target.removeEventListener(event, on);
      resolve();
    };
    target.addEventListener(event, on, { once: true });
    to = setTimeout(() => {
      target.removeEventListener(event, on);
      reject(new Error(`event '${event}' timeout`));
    }, timeoutMs);
  });
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
  rate: 1,                 // ▶ 현재 재생 속도
  parsedAngles: null,      // {frames, time_s, shoulder, hip, separation}
  lastSnapshot: null       // {dataUrl, t, frame}
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
  wirePreviewControls();
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
      teams[teamName].players[pid] = {
        player: p || { id: pid, name: pid, number: "-", team: teamName },
        items: []
      };
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
    teamSummary.innerHTML =
      `<span class="group-title">🏷️ ${tName}</span><span class="group-count">${teamCount}</span>`;
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
      pSummary.innerHTML =
        `<span class="group-title">👤 ${pLabel}</span><span class="group-count">${tp.items.length}</span>`;
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
    document.getElementById("report-list").innerHTML = "<em>reports/index.json 로드 실패</em>";
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
    const series  = await fetchJSON(seriesUrl,  "series");

    state.summary = summary;
    state.series  = series;

    // fps: meta.fps 또는 series.fps
    state.fps = Number(series?.meta?.fps || series?.fps) || 30;

    // 카드
    text("card-player", playerId);
    const p = state.playersById[playerId];
    text("card-player-name", p ? p.name : "-");
    text("card-team-num",   p ? `${p.team || "-"} / #${p.number ?? "-"}` : "-");
    text("card-report", reportId);
    text("card-swing-type", summary?.swing_type ?? "-");
    text("card-sep",   summary?.separation_deg ?? summary?.separationAngle ?? "-");
    text("card-stride",summary?.stride_cm ?? summary?.strideLength ?? "-");

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

    // 메타데이터 후 레이아웃/동기화 준비
    video.onloadedmetadata = () => {
      lockAspectRatio(videoWrap, video);
      syncLayerSizes(video, overlayVid, document.getElementById("overlay"));
      setupVideoSync(); // 1회 바인딩
      setPlaybackRate(state.rate); // ▶ 초기 재생 속도 반영
      applyOverlaySelection();     // 현재 선택된 오버레이 로드

      // seek range
      const seek = document.getElementById("seek");
      seek.min = 0;
      seek.max = Math.floor(video.duration * 1000);
      seek.value = 0;
    };

    // 각도 차트
    state.parsedAngles = parseAnglesFromSeries(series, state.fps);
    buildCharts(state.parsedAngles);

    // 프리뷰 리셋
    setPreview(null, null, null);

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
  const op = document.getElementById("overlayOpacity");
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
  const vid = state.overlayVid;
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
  const op = document.getElementById("overlayOpacity");
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
  function onResize() { syncLayerSizes(video, overlayVid, canvas); }
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
  });

  // RVFC 지원 여부
  state.usingRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  function drawOverlayCanvas(tSec) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // (여기에 좌표/스켈레톤 드로잉을 연결할 수 있음)
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#000";
    ctx.fillRect(8, 8, 180, 30);
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
    const loop = (_now, meta) => {
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

// ================== 각도 데이터 파싱/차트 ==================
function parseAnglesFromSeries(series, fpsFallback = 30) {
  // 우선 신규 스키마: series.series.shoulder_hip_rotation.*
  const fps = Number(series?.meta?.fps || series?.fps) || fpsFallback;
  const block = series?.series?.shoulder_hip_rotation;
  if (block?.frame && block?.shoulder_deg && block?.hip_deg) {
    const frames = block.frame;
    const time_s = frames.map(f => (Number(f) - 1) / fps);
    const shoulder = block.shoulder_deg;
    const hip = block.hip_deg;
    const separation = Array.isArray(block.separation_deg) ? block.separation_deg : null;
    return { frames, time_s, shoulder, hip, separation, fps };
  }

  // 구형(예비) 스키마: series.angles + series.time_s
  const time_s = series?.time_s;
  const shoulder = series?.angles?.shoulder ?? null;
  const hip = series?.angles?.hip ?? null;
  const separation = series?.angles?.separation ?? null;
  const frames = time_s?.map((t, i) => i + 1) ?? null;
  return { frames, time_s, shoulder, hip, separation, fps };
}

function buildCharts(parsed) {
  const el = document.getElementById("chart-angles");
  const ctx = el.getContext("2d");

  if (state.angleChart) {
    state.angleChart.destroy();
    state.angleChart = null;
  }
  if (!parsed || !parsed.shoulder || !parsed.hip) {
    ctx.clearRect(0, 0, el.width, el.height);
    return;
  }

  const labels = parsed.time_s ?? parsed.frames ?? parsed.shoulder.map((_, i) => i);
  const datasets = [
    { label: "Shoulder (deg)", data: parsed.shoulder, pointRadius: 0, borderWidth: 2 },
    { label: "Hip (deg)",       data: parsed.hip,      pointRadius: 0, borderWidth: 2 }
  ];
  if (parsed.separation && Array.isArray(parsed.separation)) {
    datasets.push({ label: "Separation (deg)", data: parsed.separation, pointRadius: 0, borderWidth: 2 });
  }

  state.angleChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true }
      },
      scales: { x: { display: true }, y: { display: true } },
      onClick: async (evt) => {
        // x 픽셀 → 인덱스 → 시간/프레임
        const scaleX = state.angleChart.scales.x;
        const xVal = scaleX.getValueForPixel(evt.x);
        let idx = Math.round(xVal);
        idx = Math.max(0, Math.min(labels.length - 1, idx));

        let t = 0;
        let frame = 1;
        if (Array.isArray(parsed.time_s)) {
          t = parsed.time_s[idx];
          frame = parsed.frames ? parsed.frames[idx] : Math.round(t * parsed.fps) + 1;
        } else {
          frame = parsed.frames[idx];
          t = (frame - 1) / parsed.fps;
        }

        // 1) 영상/오버레이 시킹
        await gotoTimeAndOverlay(t, "shoulder_hip_rotation.mp4");

        // 2) 현재 프레임 합성 이미지 프리뷰 생성
        try {
          const dataUrl = await captureCompositePNG();
          setPreview(dataUrl, t, frame);
        } catch (e) {
          console.warn("스냅샷 실패:", e);
          setPreview(null, t, frame);
        }
      }
    }
  });
}

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
function updateChartCursor(tSec) {
  const chart = state.angleChart;
  const parsed = state.parsedAngles;
  if (!chart || !parsed) return;

  const labels = chart.data.labels;
  if (!Array.isArray(labels) || !labels.length) return;

  let idx = 0;
  if (Array.isArray(parsed.time_s)) {
    idx = nearestIndexByTime(parsed.time_s, tSec);
  } else {
    const frame = Math.round(tSec * parsed.fps) + 1;
    idx = Math.max(0, Math.min((parsed.frames?.length ?? 1) - 1, frame - 1));
  }
  chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
  chart.update("none");
}

// ================== 그래프 → 프레임 시킹 & 합성 ==================
async function gotoTimeAndOverlay(tSec, overlayFile) {
  const video = state.video;
  if (!video) return;

  // 오버레이를 shoulder_hip_rotation으로 강제 전환
  const sel = document.getElementById("overlaySelect");
  if (sel && sel.value !== overlayFile) {
    sel.value = overlayFile;
    applyOverlaySelection(); // 로드 시 onloadedmetadata에서 동기화됨
  }

  // 시간 맞추기
  video.currentTime = tSec;
  trySyncOverlayVideo();

  // 양쪽 모두 seek 안정화 대기
  try {
    await Promise.race([
      waitEvent(video, "seeked", 1200),
      waitEvent(video, "timeupdate", 1200)
    ]);
  } catch { /* ignore */ }

  if (state.overlayVid?.src) {
    try {
      state.overlayVid.currentTime = tSec;
      await Promise.race([
        waitEvent(state.overlayVid, "seeked", 1200),
        waitEvent(state.overlayVid, "timeupdate", 1200)
      ]);
    } catch { /* ignore */ }
  }
}

async function captureCompositePNG() {
  const video = state.video;
  const overlay = state.overlayVid;
  if (!video) throw new Error("video 없음");

  // 화면 크기대로 캔버스 생성
  const rect = video.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  const off = document.createElement("canvas");
  off.width = Math.floor(w * dpr);
  off.height = Math.floor(h * dpr);
  const ctx = off.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 본편 그리기
  ctx.drawImage(video, 0, 0, w, h);

  // 오버레이 비디오가 있으면 합성
  if (overlay && overlay.src && overlay.readyState >= 2) {
    // mix-blend-mode은 CSS 합성이므로 캔버스에서는 흉내만 가능 — 여기선 단순 'screen' 유사 합성으로 처리
    // 간단 구현: 오버레이를 그대로 그리되 전체 투명도는 현재 스타일을 반영
    const opacity = Number((overlay.style.opacity || "0.7"));
    if (opacity > 0) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlay, 0, 0, w, h);
      ctx.restore();
    }
  }

  // 라벨
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.fillRect(8, 8, 190, 30);
  ctx.fillStyle = "#fff";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`snapshot @ ${video.currentTime.toFixed(3)}s`, 16, 28);
  ctx.restore();

  return off.toDataURL("image/png");
}

// ================== 스냅샷 프리뷰 UI ==================
function wirePreviewControls() {
  const btn = document.getElementById("btnSavePng");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!state.lastSnapshot?.dataUrl) return;
    const a = document.createElement("a");
    const t = state.lastSnapshot.t?.toFixed(3) ?? "time";
    const { playerId, reportId } = state.current;
    a.href = state.lastSnapshot.dataUrl;
    a.download = `${playerId || "player"}_${reportId || "report"}_${t}s.png`;
    a.click();
  });
}
function setPreview(dataUrl, t, frame) {
  const img = document.getElementById("framePreview");
  const meta = document.getElementById("previewMeta");
  if (!img || !meta) return;

  if (!dataUrl) {
    img.removeAttribute("src");
    meta.textContent = "-";
    state.lastSnapshot = null;
    return;
  }
  img.src = dataUrl;
  meta.textContent = `t=${t.toFixed(3)}s, frame=${frame}`;
  state.lastSnapshot = { dataUrl, t, frame };
}

// ================== 차트 커서용 도우미 (위에서 사용) ==================
// (이미 위에 구현)

// ================== 보조: 기존 코드 호환을 위한 빈 훅 ==================
// 필요 시 스켈레톤/헤드/핸드 Path 토글과 연결

