/* =========================================
 * 경로/상수
 * ========================================= */
const PATHS = {
  players: new URL('data/players.json', location.href).toString(),
  index:   new URL('reports/index.json', location.href).toString(),
  reportBase(playerId, reportId) {
    // 보고서 폴더 루트
    const base = new URL(`reports/${playerId}/${reportId}/`, location.href).toString();
    return {
      base,
      main:  base + 'preprocessed_video.mp4',
      // 드롭다운 value 그대로 쓰기 위해 상대 파일명만 전달할 수도 있습니다.
      overlay: (fname) => fname ? (base + fname) : ''
    };
  }
};

// 캐시가 말썽일 때 브라우저 캐시를 우회
const FETCH_OPTS = { cache: 'no-store' };

/* =========================================
 * 공통 DOM
 * ========================================= */
const video        = document.getElementById('mainVideo');
const overlayVid   = document.getElementById('overlayVid');
const canvas       = document.getElementById('overlayCanvas');
const ctx          = canvas.getContext('2d');
const timeLabel    = document.getElementById('timeLabel');
const seek         = document.getElementById('seek');
const overlaySel   = document.getElementById('overlaySelect');
const overlayOpacity = document.getElementById('overlayOpacity');
const overlayBlend = document.getElementById('overlayBlend');

const reportListEl = document.getElementById('report-list');

/* =========================================
 * 유틸: JSON 로드(에러 UI 포함)
 * ========================================= */
async function fetchJSON(url) {
  try {
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} @ ${url}`);
    }
    return await res.json();
  } catch (err) {
    console.error('[fetchJSON] failed:', err);
    throw err;
  }
}

function showSidebarError(msg) {
  reportListEl.innerHTML = `
    <div style="color:#ff8c8c; line-height:1.4">
      ⚠️ 로딩 실패: ${msg}<br/>
      <small style="color:#bbb">
        경로 확인: <code>data/players.json</code>, <code>reports/index.json</code><br/>
        (대소문자/폴더 위치/브랜치 Pages 설정/JSON 문법)
      </small>
    </div>
  `;
}

/* =========================================
 * 사이즈 정합(비디오 ↔ 캔버스/오버레이)
 * ========================================= */
function resizeLayersToVideo() {
  if (!video) return;
  const rect = video.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;

  [canvas, overlayVid].forEach(el => {
    if (!el) return;
    el.style.width  = rect.width + 'px';
    el.style.height = rect.height + 'px';
  });

  const pxW = Math.max(1, Math.round(rect.width  * dpr));
  const pxH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pxW)  canvas.width  = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

video?.addEventListener('loadedmetadata', () => {
  // 원본 비율 고정이 필요하면 아래 주석 해제
  // document.getElementById('player').style.aspectRatio =
  //   `${video.videoWidth} / ${video.videoHeight}`;
  resizeLayersToVideo();
});
window.addEventListener('resize', resizeLayersToVideo);
document.addEventListener('fullscreenchange', resizeLayersToVideo);

/* =========================================
 * 오버레이 컨트롤/동기화
 * ========================================= */
function setOverlaySource(urlOrEmpty) {
  if (!urlOrEmpty) {
    overlayVid.removeAttribute('src');
    overlayVid.style.display = 'none';
    return;
  }
  overlayVid.src = urlOrEmpty;
  overlayVid.style.display = '';
  overlayVid.currentTime = video.currentTime || 0;
  if (!video.paused) overlayVid.play().catch(()=>{});
}

// 초기값 반영
overlayVid.style.opacity = String((Number(overlayOpacity?.value ?? 70))/100);
overlayVid.style.mixBlendMode = overlayBlend?.value || 'screen';

overlayOpacity?.addEventListener('input', e => {
  overlayVid.style.opacity = String((Number(e.target.value ?? 70))/100);
});
overlayBlend?.addEventListener('change', e => {
  overlayVid.style.mixBlendMode = e.target.value || 'normal';
});
overlaySel?.addEventListener('change', () => {
  // 현재 선택된 리포트 컨텍스트가 있다면 그 경로에 맞춰 세팅
  if (CURRENT && CURRENT.paths) {
    setOverlaySource(CURRENT.paths.overlay(overlaySel.value));
  }
});

/* =========================================
 * 시킹 동기화
 * ========================================= */
seek?.addEventListener('input', () => {
  if (!video.duration || !isFinite(video.duration)) return;
  const ratio = Number(seek.value) / Number(seek.max || 1000);
  video.currentTime = ratio * video.duration;
  overlayVid.currentTime = video.currentTime;
});
function updateSeekAndLabel() {
  if (video.duration && isFinite(video.duration)) {
    const ratio = video.currentTime / video.duration;
    seek.value = Math.round(ratio * Number(seek.max || 1000));
    timeLabel.textContent = `t = ${video.currentTime.toFixed(2)}s`;
  } else {
    seek.value = 0;
    timeLabel.textContent = '';
  }
}
video.addEventListener('timeupdate', () => {
  if (Math.abs((overlayVid.currentTime || 0) - video.currentTime) > 0.05) {
    overlayVid.currentTime = video.currentTime;
  }
  updateSeekAndLabel();
});
video.addEventListener('play',  () => overlayVid.play().catch(()=>{}));
video.addEventListener('pause', () => overlayVid.pause());

/* =========================================
 * 사이드바: 리포트 트리 렌더
 * ========================================= */
let CURRENT = null; // { playerId, reportId, paths }

function renderReportTree(indexData, playersMap) {
  // index.json 예상 형태 여러 가지를 허용:
  // 1) { "reports": [ {player_id, report_id, date?, ...}, ... ] }
  // 2) [ {player_id, report_id, ...}, ... ]
  // 3) { "<player_id>": ["<report_id>", ...], ... }
  let entries = [];
  if (Array.isArray(indexData)) {
    entries = indexData;
  } else if (Array.isArray(indexData.reports)) {
    entries = indexData.reports;
  } else {
    // object map 형태
    for (const [pid, arr] of Object.entries(indexData || {})) {
      if (Array.isArray(arr)) {
        for (const rid of arr) entries.push({ player_id: pid, report_id: rid });
      }
    }
  }

  // players.json은 { "<player_id>": { name, team, number, ... }, ... } 형태 가정
  // 혹은 players 배열일 수도 있으니 보완
  const playersById = (() => {
    if (!playersMap) return {};
    if (Array.isArray(playersMap)) {
      const obj = {};
      for (const p of playersMap) {
        if (p && (p.player_id || p.id)) {
          obj[p.player_id || p.id] = p;
        }
      }
      return obj;
    }
    return playersMap;
  })();

  // 그룹핑: team -> player -> reports
  const tree = {};
  for (const e of entries) {
    const pid = e.player_id || e.playerId || e.pid;
    const rid = e.report_id || e.reportId || e.rid;
    if (!pid || !rid) continue;

    const pinfo = playersById[pid] || {};
    const team  = pinfo.team || 'Unknown Team';
    const name  = pinfo.name || pinfo.player_name || pid;
    const num   = pinfo.number != null ? ` #${pinfo.number}` : '';

    tree[team] ??= {};
    tree[team][pid] ??= { label: `${name}${num}`, reports: [] };
    tree[team][pid].reports.push({ rid, date: e.date || '' });
  }

  // 렌더
  const frag = document.createDocumentFragment();
  for (const [team, players] of Object.entries(tree)) {
    const teamEl = document.createElement('details');
    teamEl.open = true;
    const sum = document.createElement('summary');
    sum.textContent = team;
    teamEl.appendChild(sum);

    for (const [pid, info] of Object.entries(players)) {
      const playerEl = document.createElement('details');
      playerEl.open = true;
      const ps = document.createElement('summary');
      ps.textContent = info.label;
      playerEl.appendChild(ps);

      const ul = document.createElement('ul');
      ul.style.listStyle = 'none';
      ul.style.padding = '4px 0 8px 12px';
      info.reports.sort((a,b)=> String(a.rid).localeCompare(String(b.rid)));
      for (const r of info.reports) {
        const li = document.createElement('li');
        const a  = document.createElement('a');
        a.href = 'javascript:void(0)';
        a.textContent = r.rid + (r.date ? `  (${r.date})` : '');
        a.style.display = 'inline-block';
        a.style.padding = '2px 0';
        a.addEventListener('click', () => onSelectReport(pid, r.rid));
        li.appendChild(a);
        ul.appendChild(li);
      }
      playerEl.appendChild(ul);
      teamEl.appendChild(playerEl);
    }
    frag.appendChild(teamEl);
  }

  reportListEl.innerHTML = '';
  reportListEl.appendChild(frag);

  if (!entries.length) {
    reportListEl.innerHTML = `
      <div style="color:#e6e9ef">
        목록이 비어 있습니다.<br/>
        <small style="color:#98a2b3">reports/index.json 내용을 확인해 주세요.</small>
      </div>`;
  }
}

/* =========================================
 * 리포트 선택 시 로딩
 * ========================================= */
function onSelectReport(playerId, reportId) {
  const paths = PATHS.reportBase(playerId, reportId);
  CURRENT = { playerId, reportId, paths };

  // 비디오/오버레이 세팅
  video.src = paths.main;

  // 현재 드롭다운 값에 맞춰 오버레이 세팅
  const ovFile = overlaySel?.value || '';
  setOverlaySource(paths.overlay(ovFile));

  // 카드/차트/원본 JSON 등은 필요 시 여기서 추가 로드
  // 예:
  // loadSummary(paths.base + 'result/summary.json');
  // loadSeries(paths.base + 'result/series.json');
}

/* =========================================
 * 초기화
 * ========================================= */
async function init() {
  // 사이드바 프리로더는 index.html에 "로딩 중..."으로 표시되어 있음
  try {
    const [players, indexData] = await Promise.all([
      fetchJSON(PATHS.players),
      fetchJSON(PATHS.index)
    ]);
    renderReportTree(indexData, players);
  } catch (err) {
    showSidebarError(err.message || String(err));
  }

  // 초기 사이즈 정합
  resizeLayersToVideo();

  // 오버레이 UI 초기값 반영(이미 위에서 적용)
}

init();
