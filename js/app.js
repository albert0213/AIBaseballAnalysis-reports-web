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

  // 차트 인스턴스
  chartRotation: null,
  chartCenter:   null,

  // 파싱 결과
  rot: null,   // {frames, shoulder, hip, separation, fps}
  center: null, // {frames, left, right}

  // 스냅샷 저장
  lastSnapshot: null // {dataUrl, t, frame}
};

// ================== 초기 로드 ==================
window.addEventListener("DOMContentLoaded", async ()=>{
  wireTopNav();
  wireOverlayControls();
  wirePlaybackControls();
  wireSubViewButtons();
  wireRotationPreviewButtons();

  try { await loadPlayers(); } catch(e){ console.warn("players.json 로드 실패:", e); }
  await loadIndex();

  // 라우터
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

  // 사이드바는 서브페이지에서도 유지
  const viewMain = document.getElementById("view-main");
  const viewRot  = document.getElementById("view-rotation");
  const viewCen  = document.getElementById("view-center");

  if (hash.startsWith("#/rotation")) {
    viewRot?.classList.add("active");
    // 데이터가 있을 때만(리포트 오픈 후) 차트 렌더
    if (state.rot) buildRotationChart();
  } else if (hash.startsWith("#/center")) {
    viewCen?.classList.add("active");
    if (state.center) buildCenterChart();
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

    // fps
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

    // 메타 후 준비
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

    // ---- 서브페이지용 데이터 파싱 ----
    state.rot = parseRotation(series, state.fps);   // 어깨·골반
    state.center = parseCenterShift(series);        // 좌/우 비율 등

    // 현재 라우트에 맞춰 즉시 렌더
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
  return {
    fps,
    frames: blk.frame,
    shoulder: blk.shoulder_deg,
    hip: blk.hip_deg,
    separation: blk.separation_deg ?? null
  };
}
function parseCenterShift(series){
  const blk = series?.series?.center_shift;
  if (!blk?.frame) return null;
  return {
    frames: blk.frame,
    left: blk.left_ratio ?? null,
    right: blk.right_ratio ?? null
  };
}

// ================== 회전 차트 (x=frame, y=deg, 한 축에 shoulder/hip) ==================
function buildRotationChart(){
  const parsed = state.rot;
  const el = document.getElementById("chart-rotation");
  if (!parsed || !el) return;

  const ctx = el.getContext("2d");
  if (state.chartRotation){ state.chartRotation.destroy(); state.chartRotation=null; }

  // (x,y) 페어 구성 — x축을 확실하게 "프레임"으로 고정
  const S = parsed.frames.map((f,i)=> ({ x: Number(f), y: Number(parsed.shoulder[i] ?? 0) }));
  const H = parsed.frames.map((f,i)=> ({ x: Number(f), y: Number(parsed.hip[i] ?? 0) }));
  const SEP = parsed.separation ? parsed.frames.map((f,i)=> ({ x:Number(f), y:Number(parsed.separation[i]??0) })) : null;

  state.chartRotation = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label:"Shoulder (deg)", data:S, pointRadius:0, borderWidth:2 },
        { label:"Hip (deg)",       data:H, pointRadius:0, borderWidth:2 },
        ...(SEP? [{ label:"Separation (deg)", data:SEP, pointRadius:0, borderWidth:2 }]:[])
      ]
    },
    options: {
      responsive:true, animation:false, parsing:false, maintainAspectRatio:false,
      plugins:{ legend:{display:true}, tooltip:{enabled:true} },
      scales:{
        x:{ type:"linear", title:{ display:true, text:"Frame" } },
        y:{ type:"linear", title:{ display:true, text:"Angle (deg)" } }
      },
      onClick: async (evt)=>{
        // 가까운 데이터 포인트 찾기
        const p = state.chartRotation.getElementsAtEventForMode(evt, 'nearest', { intersect:false }, true)[0];
        if (!p) return;
        const ds = state.chartRotation.data.datasets[p.datasetIndex].data;
        const point = ds[p.index];
        const frame = Number(point.x);
        const t = (frame - 1) / (state.rot?.fps || state.fps || 30);

        // 1) shoulder_hip_rotation 오버레이 적용 + 시킹
        await gotoTimeAndOverlay(t, "shoulder_hip_rotation.mp4");

        // 2) 스냅샷 생성
        try {
          const dataUrl = await captureCompositePNG();
          setRotationPreview(dataUrl, t, frame);
        } catch(e){
          console.warn("스냅샷 실패:", e);
          setRotationPreview(null, t, frame);
        }
      }
    }
  });
}

// ================== 센터시프트 차트 (옵션) ==================
function buildCenterChart(){
  const parsed = state.center;
  const el = document.getElementById("chart-center");
  if (!parsed || !el) return;

  const ctx=el.getContext("2d");
  if (state.chartCenter){ state.chartCenter.destroy(); state.chartCenter=null; }

  const L = parsed.left ? parsed.frames.map((f,i)=> ({x:Number(f), y:Number(parsed.left[i] ?? 0)})) : [];
  const R = parsed.right? parsed.frames.map((f,i)=> ({x:Number(f), y:Number(parsed.right[i]?? 0)})) : [];

  state.chartCenter = new Chart(ctx, {
    type:"line",
    data:{ datasets:[
      { label:"Left ratio",  data:L, pointRadius:0, borderWidth:2 },
      { label:"Right ratio", data:R, pointRadius:0, borderWidth:2 }
    ]},
    options:{
      responsive:true, animation:false, parsing:false, maintainAspectRatio:false,
      plugins:{ legend:{display:true}, tooltip:{enabled:true} },
      scales:{
        x:{ type:"linear", title:{display:true, text:"Frame"} },
        y:{ type:"linear", title:{display:true, text:"Ratio"} }
      }
    }
  });
}

// ================== 그래프 → 시킹 & 스냅샷 ==================
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
async function captureCompositePNG(){
  const video = state.video;
  const overlay = state.overlayVid;
  if (!video) throw new Error("video 없음");

  const rect = video.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  const off = document.createElement("canvas");
  off.width = Math.floor(w*dpr);
  off.height= Math.floor(h*dpr);
  const ctx = off.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);

  // 본편
  ctx.drawImage(video, 0,0,w,h);

  // 오버레이 (단순 투명 합성)
  if (overlay && overlay.src && overlay.readyState >= 2){
    const opacity = Number(overlay.style.opacity || "0.7");
    if (opacity > 0){
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlay, 0,0,w,h);
      ctx.restore();
    }
  }

  // 라벨
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.fillRect(8,8,220,30);
  ctx.fillStyle="#fff"; ctx.font="14px system-ui, sans-serif";
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
