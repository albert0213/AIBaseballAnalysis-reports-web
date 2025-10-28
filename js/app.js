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
function text(id, v){ const el=document.getElementById(id); if(el) el.textContent=v ?? "-"; }
function setRaw(id, obj){ const el=document.getElementById(id); if(el) el.textContent = obj? JSON.stringify(obj,null,2) : "-"; }
function joinUrl(...parts){
  return parts.filter(Boolean)
    .map((p,i)=> i===0? p.replace(/\/+$/,'') : encodeURIComponent(p))
    .join("/")
    .replace(/([^:])\/{2,}/g,"$1/");
}
function waitEvent(target, event, timeoutMs=1500){
  return new Promise((resolve,reject)=>{
    let to=null;
    const on=()=>{ clearTimeout(to); target.removeEventListener(event,on); resolve(); };
    target.addEventListener(event,on,{once:true});
    to=setTimeout(()=>{ target.removeEventListener(event,on); reject(new Error(`'${event}' timeout`)); }, timeoutMs);
  });
}

// ================== 글로벌 상태 ==================
const state = {
  current: { playerId:null, reportId:null },
  summary: null,
  series:  null,
  video:   null,
  overlayVid: null,
  fps: 30,
  playersById: {},
  rate: 1,
  usingRVFC: false,

  chartRotation: null,

  rot: null,     // rotation data
  center: null,  // center-shift data

  lastSnapshot: null
};

// ================== 초기 로드 ==================
window.addEventListener("DOMContentLoaded", async ()=>{
  wireTopNav();
  wireOverlayControls();
  wirePlaybackControls();
  wireSubViewButtons();
  wireRotationPreviewButtons();
  wireCenterPreviewButtons();

  try { await loadPlayers(); } catch(e){ console.warn("players.json 로드 실패:", e); }
  await loadIndex();

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
});

async function loadPlayers(){
  const players = await fetchJSON("./data/players.json","players");
  const map={}; for(const p of players) map[p.id]=p;
  state.playersById = map;
}
function playerLabel(id){
  const p = state.playersById[id];
  if(!p) return id;
  const teamNum = p.team ? `${p.team} #${p.number}` : `#${p.number}`;
  return `${p.name} (${teamNum})`;
}

// ================== 라우팅 ==================
function wireTopNav(){
  const toRot = document.getElementById("nav-rotation");
  const toCen = document.getElementById("nav-center");
  if (toRot) toRot.addEventListener("click", ()=> goRoute("#/rotation"));
  if (toCen) toCen.addEventListener("click", ()=> goRoute("#/center"));
}
function wireSubViewButtons(){
  const b1 = document.getElementById("back-main-1");
  const b2 = document.getElementById("back-main-2");
  if (b1) b1.addEventListener("click", ()=> goRoute("#/"));
  if (b2) b2.addEventListener("click", ()=> goRoute("#/"));
}
function goRoute(hash){ location.hash = hash; }
function handleRoute(){
  const hash = location.hash || "#/";
  const views = document.querySelectorAll(".view");
  views.forEach(v => v.classList.remove("active"));

  const viewMain = document.getElementById("view-main");
  const viewRot  = document.getElementById("view-rotation");
  const viewCen  = document.getElementById("view-center");

  if (hash.startsWith("#/rotation")) {
    viewRot?.classList.add("active");
    if (state.rot) buildRotationChart();
  } else if (hash.startsWith("#/center")) {
    viewCen?.classList.add("active");
    if (state.center) initCenterView();
  } else {
    viewMain?.classList.add("active");
  }
}

// ================== 목록 렌더 ==================
function renderReportList(index){
  const list = document.getElementById("report-list");
  list.innerHTML = "";
  if (!index || !index.length){
    list.innerHTML = "<em>reports/index.json에 항목이 없습니다.</em>";
    return;
  }
  const teams={};
  for(const item of index){
    const pid=item.player_id; const p=state.playersById[pid];
    const teamName = p?.team || "팀 미지정";
    if(!teams[teamName]) teams[teamName]={ players:{} };
    if(!teams[teamName].players[pid]){
      teams[teamName].players[pid] = { player: p || { id:pid, name:pid, number:"-", team:teamName }, items: [] };
    }
    teams[teamName].players[pid].items.push(item);
  }
  const teamNames = Object.keys(teams).sort((a,b)=>a.localeCompare(b,"ko"));
  for(const tName of teamNames){
    const team = teams[tName];
    const teamPlayers = Object.values(team.players);

    const teamDetails = document.createElement("details");
    teamDetails.className = "team-group";
    teamDetails.open = false;

    const teamSummary = document.createElement("summary");
    const teamCount = teamPlayers.reduce((s,tp)=> s + tp.items.length, 0);
    teamSummary.innerHTML = `<span class="group-title">🏷️ ${tName}</span><span class="group-count">${teamCount}</span>`;
    teamDetails.appendChild(teamSummary);

    teamPlayers.sort((a,b)=>{
      const an=a.player?.name || a.player?.id || "";
      const bn=b.player?.name || b.player?.id || "";
      const cmp=an.localeCompare(bn,"ko");
      if(cmp!==0) return cmp;
      return (a.player?.number ?? 1e9) - (b.player?.number ?? 1e9);
    });

    for(const tp of teamPlayers){
      const p=tp.player;
      const playerDetails=document.createElement("details");
      playerDetails.className="player-group";

      const pLabel = `${p?.name ?? p.id} ${p?.number?`(#${p.number})`:""} ${p?.id?`[${p.id}]`:""}`;
      const pSummary=document.createElement("summary");
      pSummary.innerHTML = `<span class="group-title">👤 ${pLabel}</span><span class="group-count">${tp.items.length}</span>`;
      playerDetails.appendChild(pSummary);

      const ul=document.createElement("div");
      ul.className="report-items";
      tp.items.forEach(item=>{
        const div=document.createElement("div");
        div.className="report-item";
        const title = item.title? ` — ${item.title}` : "";
        div.textContent = `${item.report_id}${title}`;
        div.addEventListener("click", ()=> openReport(item.player_id, item.report_id));
        ul.appendChild(div);
      });
      playerDetails.appendChild(ul);
      teamDetails.appendChild(playerDetails);
    }
    list.appendChild(teamDetails);
  }
}
async function loadIndex(){
  try {
    const idx = await fetchJSON("./reports/index.json","index");
    renderReportList(idx);
  } catch (e) {
    document.getElementById("report-list").innerHTML = "<em>reports/index.json 로드 실패</em>";
    console.error(e);
  }
}

// ================== 리포트 오픈 ==================
async function openReport(playerId, reportId){
  state.current = { playerId, reportId };
  const base = joinUrl("./reports", playerId, reportId);
  const summaryUrl = joinUrl(base, "summary.json");
  const seriesUrl  = joinUrl(base, "series.json");

  try {
    const summary = await fetchJSON(summaryUrl,"summary");
    const series  = await fetchJSON(seriesUrl, "series");
    state.summary = summary;
    state.series  = series;

    state.fps = Number(series?.meta?.fps || series?.fps) || 30;

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

    video.onloadedmetadata = ()=>{
      lockAspectRatio(videoWrap, video);
      syncLayerSizes(video, overlayVid, document.getElementById("overlay"));
      setupVideoSync();
      setPlaybackRate(state.rate);
      applyOverlaySelection();

      const seek = document.getElementById("seek");
      seek.min = 0;
      seek.max = Math.floor(video.duration * 1000);
      seek.value = 0;
    };

    // 서브페이지 데이터
    state.rot    = parseRotation(series, state.fps);
    state.center = parseCenterShift(series);

    handleRoute();

  } catch (e) {
    console.error("openReport error", e);
    alert(`리포트 로드 실패:\n${e.message}\n(자세한 내용은 콘솔을 확인하세요)`);
  }
}

// ================== 비율/레이어 사이즈 & 동기 ==================
function lockAspectRatio(container, video){
  const vw=video.videoWidth||16, vh=video.videoHeight||9;
  container.style.setProperty("--video-aspect", (vw/vh).toFixed(6));
}
function syncLayerSizes(video, overlayVid, canvas){
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = rect.width+"px";
  canvas.style.height= rect.height+"px";
  canvas.width  = Math.floor(rect.width*dpr);
  canvas.height = Math.floor(rect.height*dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function wireOverlayControls(){
  const sel=document.getElementById("overlaySelect");
  const op =document.getElementById("overlayOpacity");
  const blend=document.getElementById("overlayBlend");
  if (sel)   sel.onchange = applyOverlaySelection;
  if (op)    op.oninput   = ()=>{ if(state.overlayVid) state.overlayVid.style.opacity = (Number(op.value)/100).toFixed(2); };
  if (blend) blend.onchange= ()=>{ if(state.overlayVid) state.overlayVid.style.mixBlendMode = blend.value; };
}
function applyOverlaySelection(){
  const sel=document.getElementById("overlaySelect");
  const file=sel?.value;
  const vid = state.overlayVid;
  if (!vid) return;
  if (!file){
    vid.removeAttribute("src");
    vid.style.display="none";
    return;
  }
  const {playerId, reportId} = state.current;
  if (!playerId || !reportId) return;

  const src = joinUrl("./reports", playerId, reportId, "assets", file);
  vid.onloadedmetadata = ()=>{ vid.playbackRate = state.rate; trySyncOverlayVideo(); };
  vid.onerror = ()=>{ console.warn("[overlay] 로드 실패:", src); vid.removeAttribute("src"); vid.style.display="none"; alert(`오버레이 영상 로드 실패: ${src}`); };
  vid.src = src;
  vid.style.display="block";

  const op = document.getElementById("overlayOpacity");
  vid.style.opacity = (Number(op?.value || 70)/100).toFixed(2);
  const blend = document.getElementById("overlayBlend");
  vid.style.mixBlendMode = blend?.value || "screen";
}
function trySyncOverlayVideo(){
  if (!state.video || !state.overlayVid) return;
  const base=state.video, over=state.overlayVid;
  over.currentTime = base.currentTime || 0;
  if (!over.paused && base.paused) over.pause();
  if (!base.paused && over.paused) over.play().catch(()=>{});
  if (over.playbackRate !== base.playbackRate) over.playbackRate = base.playbackRate;
}
function wirePlaybackControls(){
  document.querySelectorAll(".rate-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const r = Number(btn.dataset.rate)||1;
      setPlaybackRate(r);
      document.querySelectorAll(".rate-btn").forEach(b=> b.classList.toggle("active", b===btn));
    });
  });
}
function setPlaybackRate(r){
  if (!r || r<=0) r=1;
  state.rate=r;
  if (state.video) state.video.playbackRate=r;
  if (state.overlayVid) state.overlayVid.playbackRate=r;
}
let syncBound=false;
function setupVideoSync(){
  if (syncBound) return;
  syncBound = true;

  const video=state.video, overlayVid=state.overlayVid, canvas=document.getElementById("overlay");
  const ctx=canvas.getContext("2d");
  const seek=document.getElementById("seek");

  function onResize(){ syncLayerSizes(video, overlayVid, canvas); }
  window.addEventListener("resize", onResize);

  seek.addEventListener("input",(e)=>{
    const t = Number(e.target.value)/1000;
    state.video.currentTime = t;
    trySyncOverlayVideo();
  });
  video.addEventListener("play", ()=> overlayVid.play().catch(()=>{}));
  video.addEventListener("pause",()=> overlayVid.pause());
  video.addEventListener("ratechange", ()=>{
    state.rate = video.playbackRate || 1;
    if (overlayVid.playbackRate !== state.rate) overlayVid.playbackRate = state.rate;
  });

  state.usingRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  function drawOverlayCanvas(tSec){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.globalAlpha=.8; ctx.fillStyle="#000";
    ctx.fillRect(8,8,190,30);
    ctx.fillStyle="#fff"; ctx.font="14px system-ui, sans-serif";
    ctx.fillText(`t = ${tSec.toFixed(2)}s @ ${state.rate}x`, 16, 28);
    ctx.restore();
    const seekEl=document.getElementById("seek");
    seekEl.value = Math.floor(tSec*1000);
  }
  if (state.usingRVFC){
    const loop=(_now,meta)=>{ drawOverlayCanvas(meta.mediaTime); trySyncOverlayVideo(); video.requestVideoFrameCallback(loop); };
    video.requestVideoFrameCallback(loop);
  } else {
    video.addEventListener("timeupdate", ()=>{ drawOverlayCanvas(video.currentTime); trySyncOverlayVideo(); });
  }
}

// ================== 데이터 파싱 ==================
function parseRotation(series, fpsFallback){
  const fps = Number(series?.meta?.fps || series?.fps) || fpsFallback || 30;
  const blk = series?.series?.shoulder_hip_rotation;
  if (!blk?.frame || !blk?.shoulder_deg || !blk?.hip_deg) return null;
  return { fps, frames: blk.frame, shoulder: blk.shoulder_deg, hip: blk.hip_deg, separation: blk.separation_deg ?? null };
}
function parseCenterShift(series){
  const blk = series?.series?.center_shift;
  if (!blk?.frame || !blk?.left_ratio || !blk?.right_ratio) return null;
  return { frames: blk.frame, left: blk.left_ratio, right: blk.right_ratio };
}

// ================== 회전 차트 ==================
const hLinesPlugin = {
  id: "hLines",
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!scales?.y) return;
    const yScale = scales.y;
    [0, 90].forEach((yVal) => {
      const y = yScale.getPixelForValue(yVal);
      if (isNaN(y)) return;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.restore();
    });
  },
};
function buildRotationChart() {
  const parsed = state.rot;
  const el = document.getElementById("chart-rotation");
  if (!parsed || !el) return;

  const ctx = el.getContext("2d");
  if (state.chartRotation) { state.chartRotation.destroy(); state.chartRotation = null; }

  const S = parsed.frames.map((f, i) => ({ x: Number(f), y: Number(parsed.shoulder[i] ?? 0) }));
  const H = parsed.frames.map((f, i) => ({ x: Number(f), y: Number(parsed.hip[i] ?? 0) }));

  let SEP = null, sepMaxPt = null;
  if (parsed.separation && parsed.separation.length) {
    SEP = parsed.frames.map((f, i) => ({ x: Number(f), y: Number(parsed.separation[i] ?? 0) }));
    let maxVal = -Infinity, maxIdx = -1;
    for (let i = 0; i < parsed.separation.length; i++) {
      const v = +parsed.separation[i];
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }
    if (maxIdx >= 0) sepMaxPt = { x: +parsed.frames[maxIdx], y: +parsed.separation[maxIdx] };
  }

  state.chartRotation = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label: "Shoulder (deg)", data: S, pointRadius: 0, borderWidth: 2, borderColor: "#60a5fa", backgroundColor: "#60a5fa" },
        { label: "Hip (deg)",      data: H, pointRadius: 0, borderWidth: 2, borderColor: "#34d399", backgroundColor: "#34d399"},
        ...(SEP ? [{
          label: "Separation (deg)",
          data: SEP,
          pointRadius: 0,
          borderWidth: 2,
          borderColor: "#9ca3af",
          backgroundColor: "#9ca3af"
        }] : []),
        ...(sepMaxPt ? [{
          type: "scatter",
          label: "Separation Max",
          data: [sepMaxPt],
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          borderColor: "#f59e0b",
          backgroundColor: "#fbbf24",
          showLine: false
        }] : [])
      ]
    },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: true }, tooltip: { enabled: true } },
      scales: {
        x: { type: "linear", title: { display: true, text: "Frame" }, grid: { color: "rgba(255,255,255,0.08)", borderDash: [4, 4] } },
        y: { type: "linear", title: { display: true, text: "Angle (deg)" }, grid: { color: "rgba(255,255,255,0.08)", borderDash: [4, 4] } }
      },
      onClick: async (evt) => {
        const elems = state.chartRotation.getElementsAtEventForMode(evt, "nearest", { intersect: false }, true);
        if (!elems?.length) return;
        const { datasetIndex, index } = elems[0];
        const ds = state.chartRotation.data.datasets[datasetIndex].data;
        const point = ds[index];
        const frame = Number(point.x);
        const t = (frame - 1) / (state.rot?.fps || state.fps || 30);

        await gotoTimeAndOverlay(t, "shoulder_hip_rotation.mp4");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
          const dataUrl = await captureCompositePNG();
          setRotationPreview(dataUrl, t, frame);
        } catch (e) {
          console.warn("스냅샷 실패:", e);
          setRotationPreview(null, t, frame);
        }
      }
    },
    plugins: [ hLinesPlugin ]
  });
}

// ================== 그래프 → 시킹 & 스냅샷(회전) ==================
async function gotoTimeAndOverlay(tSec, overlayFile){
  const video=state.video;
  if (!video) return;

  const sel=document.getElementById("overlaySelect");
  if (sel && sel.value !== overlayFile){
    sel.value = overlayFile;
    applyOverlaySelection();
  }

  video.currentTime = tSec;
  trySyncOverlayVideo();

  try {
    await Promise.race([waitEvent(video,"seeked",1200), waitEvent(video,"timeupdate",1200)]);
  } catch {}

  if (state.overlayVid?.src){
    try {
      state.overlayVid.currentTime = tSec;
      await Promise.race([waitEvent(state.overlayVid,"seeked",1200), waitEvent(state.overlayVid,"timeupdate",1200)]);
    } catch {}
  }
}
async function captureCompositePNG() {
  const video = state.video;
  const overlay = state.overlayVid;
  if (!video) throw new Error("video 없음");

  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;

  let w = Math.floor(rect.width)  || vw;
  let h = Math.floor(rect.height) || vh;
  if (!w && h) w = Math.round(h * (vw / vh));
  if (!h && w) h = Math.round(w * (vh / vw));

  const dpr = window.devicePixelRatio || 1;
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.floor(w * dpr));
  off.height = Math.max(1, Math.floor(h * dpr));
  const ctx = off.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
  else throw new Error("video not ready");

  if (overlay && overlay.src && overlay.readyState >= 2) {
    const opacity = Number(overlay.style.opacity || "0.7");
    if (opacity > 0) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlay, 0, 0, w, h);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.fillRect(8, 8, 240, 30);
  ctx.fillStyle = "#fff";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`snapshot @ ${video.currentTime.toFixed(3)}s`, 16, 28);
  ctx.restore();

  return off.toDataURL("image/png");
}

// ================== 회전뷰: 프리뷰 UI ==================
function wireRotationPreviewButtons(){
  const btn = document.getElementById("btnSaveRotationPng");
  if (btn) btn.addEventListener("click", ()=>{
    const snap = state.lastSnapshot;
    if (!snap?.dataUrl) return;
    const a = document.createElement("a");
    const t = snap.t?.toFixed(3) ?? "time";
    const {playerId, reportId} = state.current;
    a.href = snap.dataUrl;
    a.download = `${playerId||"player"}_${reportId||"report"}_${t}s_rotation.png`;
    a.click();
  });
}
function setRotationPreview(dataUrl, t, frame){
  const img = document.getElementById("rotationPreview");
  const meta= document.getElementById("rotationMeta");
  if (!img || !meta) return;
  if (!dataUrl){
    img.removeAttribute("src");
    meta.textContent = `t=${(t??0).toFixed?.(3)??"-"}s, frame=${frame??"-"}`;
    state.lastSnapshot = null;
    return;
  }
  img.src = dataUrl;
  meta.textContent = `t=${t.toFixed(3)}s, frame=${frame}`;
  state.lastSnapshot = { dataUrl, t, frame };
}

// ================== 무게 중심 이동: 스냅샷/슬라이더/비율바 ==================
const centerState = {
  ready: false,
  frames: [],
  left: [],
  right: [],
  fps: 30,
  baseVideo: null,
  overlayVideo: null,
  canvas: null, ctx: null, imgEl: null, slider: null,
  frameLabel: null, ratioTextBig: null, leftBar: null, rightBar: null,
  reqId: 0
};

function wireCenterPreviewButtons(){
  const btn = document.getElementById("btnSaveCenterPng");
  if (btn) btn.addEventListener("click", ()=>{
    const img = document.getElementById("centerPreview");
    if (!img?.src) return;
    const a = document.createElement("a");
    const {playerId, reportId} = state.current;
    const frame = document.getElementById("centerFrameLabel")?.textContent || "frame";
    a.href = img.src;
    a.download = `${playerId||"player"}_${reportId||"report"}_${frame}_center.png`;
    a.click();
  });
}

function buildHiddenVideo(src) {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.playsInline = true;
  v.preload = "auto";
  v.muted = true;
  v.style.display = "none";
  document.body.appendChild(v);
  v.src = src;
  return v;
}

function initCenterView(){
  const parsed = state.center;
  if (!parsed) { console.warn("center_shift 데이터가 없습니다."); return; }

  centerState.canvas       = document.getElementById("centerCanvas");
  centerState.ctx          = centerState.canvas.getContext("2d");
  centerState.imgEl        = document.getElementById("centerPreview");
  centerState.slider       = document.getElementById("centerFrame");
  centerState.frameLabel   = document.getElementById("centerFrameLabel");
  centerState.leftBar      = document.getElementById("centerLeft");
  centerState.rightBar     = document.getElementById("centerRight");
  centerState.ratioTextBig = document.getElementById("centerRatioBig");

  centerState.frames = parsed.frames.slice();
  centerState.left   = parsed.left.slice();
  centerState.right  = parsed.right.slice();
  centerState.fps    = state.fps || 30;

  const firstF = centerState.frames[0] ?? 1;
  const lastF  = centerState.frames[centerState.frames.length - 1] ?? firstF;
  centerState.slider.min = String(firstF);
  centerState.slider.max = String(lastF);
  centerState.slider.step = "1";
  centerState.slider.value = String(firstF);
  centerState.frameLabel.textContent = String(firstF);
  text("centerMeta", String(firstF));

  const { playerId, reportId } = state.current;
  const base = joinUrl("./reports", playerId, reportId);
  const videoSrc   = state.summary?.assets?.report_video || joinUrl(base, "assets", "report_video.mp4");
  const overlaySrc = joinUrl(base, "assets", "center_shift.mp4");

  if (centerState.baseVideo) centerState.baseVideo.remove();
  if (centerState.overlayVideo) centerState.overlayVideo.remove();

  centerState.baseVideo    = buildHiddenVideo(videoSrc);
  centerState.overlayVideo = buildHiddenVideo(overlaySrc);

  const ensureMeta = Promise.all([
    new Promise(res => centerState.baseVideo.onloadedmetadata = res),
    new Promise(res => centerState.overlayVideo.onloadedmetadata = res),
  ]);

  ensureMeta.then(()=>{
    const vw = centerState.baseVideo.videoWidth  || 1280;
    const vh = centerState.baseVideo.videoHeight || 720;
    const dpr = window.devicePixelRatio || 1;
    centerState.canvas.width  = Math.floor(vw * dpr);
    centerState.canvas.height = Math.floor(vh * dpr);
    centerState.canvas.style.width = vw + "px";
    centerState.canvas.style.height= vh + "px";
    centerState.ctx.setTransform(dpr,0,0,dpr,0,0);

    centerState.ready = true;

    drawCenterFrame(firstF);
    updateCenterBarByFrame(firstF);
  });

  // rAF 디바운스: 슬라이더 전폭 드래그 최적화
  let scheduled = false;
  centerState.slider.addEventListener("input", ()=>{
    if (!centerState.ready) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{
      scheduled = false;
      const f = Number(centerState.slider.value);
      centerState.frameLabel.textContent = String(f);
      text("centerMeta", String(f));
      drawCenterFrame(f);
      updateCenterBarByFrame(f);
    });
  });
}

function frameToTime_center(frame) {
  const f = Math.max(1, Number(frame || 1));
  return (f - 1) / (centerState.fps || 30);
}
function seekBoth_center(timeSec){
  return new Promise((resolve)=>{
    let pending=2;
    const done=()=>{ if(--pending===0) resolve(); };
    const b=centerState.baseVideo, o=centerState.overlayVideo;

    const sb=()=>{ b.removeEventListener("seeked",sb); done(); };
    const so=()=>{ o.removeEventListener("seeked",so); done(); };

    b.pause(); o.pause();
    b.addEventListener("seeked", sb, {once:true});
    o.addEventListener("seeked", so, {once:true});

    if ("fastSeek" in HTMLMediaElement.prototype && typeof b.fastSeek==="function") {
      try { b.fastSeek(timeSec); } catch { b.currentTime=timeSec; }
    } else b.currentTime=timeSec;

    if ("fastSeek" in HTMLMediaElement.prototype && typeof o.fastSeek==="function") {
      try { o.fastSeek(timeSec); } catch { o.currentTime=timeSec; }
    } else o.currentTime=timeSec;
  });
}
async function drawCenterFrame(frame){
  centerState.reqId += 1;
  const myReq = centerState.reqId;

  const t = frameToTime_center(frame);
  await seekBoth_center(t);
  if (myReq !== centerState.reqId) return;

  const cvs = centerState.canvas;
  const ctx = centerState.ctx;
  const b = centerState.baseVideo;
  const o = centerState.overlayVideo;

  ctx.clearRect(0,0,cvs.width,cvs.height);
  if (b.readyState >= 2) ctx.drawImage(b, 0, 0, cvs.width, cvs.height);
  if (o.readyState >= 2) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.7;
    ctx.drawImage(o, 0, 0, cvs.width, cvs.height);
    ctx.restore();
  }

  // 종횡비 보존: 이미지 영역에서 잘림 방지 (height:auto)
  const dataUrl = cvs.toDataURL("image/jpeg", 0.9);
  centerState.imgEl.src = dataUrl;
}
function updateCenterBar(leftRatio, rightRatio){
  const L = Math.max(0, Number(leftRatio || 0));
  const R = Math.max(0, Number(rightRatio || 0));
  const sum = L + R || 10;
  const lp = (L / sum) * 100;
  const rp = 100 - lp;

  // 위치 스왑: 컨테이너가 row-reverse이므로,
  // - 시각 왼쪽(RED)=Right 비율 -> rightBar(width=rp)
  // - 시각 오른쪽(BLUE)=Left 비율 -> leftBar(width=lp)
  centerState.leftBar.style.width  = lp + "%";
  centerState.rightBar.style.width = rp + "%";

  // 하단 중앙에 크게: Right : Left
  if (centerState.ratioTextBig) {
    centerState.ratioTextBig.textContent = `Right ${R.toFixed(1)} : Left ${L.toFixed(1)} (총 10)`;
  }
}
function updateCenterBarByFrame(frame){
  const idx = Math.max(0, Math.min(centerState.frames.length - 1, Number(frame) - 1));
  updateCenterBar(centerState.left[idx], centerState.right[idx]);
}
