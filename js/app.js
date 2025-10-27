/* ===========================
 * 공통 DOM
 * =========================== */
const video = document.getElementById('mainVideo');
const overlayVid = document.getElementById('overlayVid');
const canvas = document.getElementById('overlayCanvas');
const ctx = canvas.getContext('2d');

const timeLabel = document.getElementById('timeLabel');
const seek = document.getElementById('seek');
const overlaySelect = document.getElementById('overlaySelect');
const overlayOpacity = document.getElementById('overlayOpacity');
const overlayBlend = document.getElementById('overlayBlend');

/* ===========================
 * 레이어 크기 동기화 (핵심)
 * =========================== */
function resizeLayersToVideo() {
  if (!video) return;

  // 현재 표시 크기
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // 오버레이(비디오/캔버스) 보이는 크기 통일
  [canvas, overlayVid].forEach(el => {
    if (!el) return;
    el.style.width  = rect.width + 'px';
    el.style.height = rect.height + 'px';
  });

  // 캔버스 내부 픽셀 크기(DPR 보정)
  const pxW = Math.max(1, Math.round(rect.width  * dpr));
  const pxH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 메타데이터 로드/리사이즈/전체화면 전환 시 갱신
video?.addEventListener('loadedmetadata', () => {
  // 원본 비율을 컨테이너에 고정하려면 주석 해제
  // document.getElementById('player').style.aspectRatio =
  //   `${video.videoWidth} / ${video.videoHeight}`;
  resizeLayersToVideo();
});
window.addEventListener('resize', resizeLayersToVideo);
document.addEventListener('fullscreenchange', resizeLayersToVideo);

/* ===========================
 * 오버레이 컨트롤
 * =========================== */
function setOverlaySource(relativePath) {
  if (!relativePath) {
    overlayVid.removeAttribute('src');
    overlayVid.style.display = 'none';
    return;
  }
  overlayVid.src = relativePath;
  overlayVid.style.display = '';
  // 메인 비디오와 동기화
  overlayVid.currentTime = video.currentTime || 0;
  if (!video.paused) overlayVid.play().catch(()=>{});
}

overlaySelect?.addEventListener('change', () => {
  setOverlaySource(overlaySelect.value);
});

// opacity (0~100)
overlayOpacity?.addEventListener('input', e => {
  const v = Number(e.target.value ?? 70) / 100;
  overlayVid.style.opacity = String(v);
});

// blend
overlayBlend?.addEventListener('change', e => {
  overlayVid.style.mixBlendMode = e.target.value || 'normal';
});

// 초기값 반영
overlayVid.style.opacity = String((Number(overlayOpacity?.value ?? 70))/100);
overlayVid.style.mixBlendMode = overlayBlend?.value || 'screen';

/* ===========================
 * 시킹/재생 동기화
 * =========================== */
// 슬라이더 -> 비디오
seek?.addEventListener('input', () => {
  if (!video.duration || !isFinite(video.duration)) return;
  const ratio = Number(seek.value) / Number(seek.max || 1000);
  video.currentTime = ratio * video.duration;
  overlayVid.currentTime = video.currentTime;
});

// 비디오 -> 슬라이더/타임라벨
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
  // 오버레이 타임라인 맞추기
  if (Math.abs((overlayVid.currentTime || 0) - video.currentTime) > 0.05) {
    overlayVid.currentTime = video.currentTime;
  }
  updateSeekAndLabel();
});
video.addEventListener('play', () => { overlayVid.play().catch(()=>{}); });
video.addEventListener('pause', () => { overlayVid.pause(); });

/* ===========================
 * 캔버스(스켈레톤 등) 그리기 준비 유틸
 * =========================== */
function getVideoScale() {
  const rect = video.getBoundingClientRect();
  return {
    sx: rect.width  / (video.videoWidth  || rect.width  || 1),
    sy: rect.height / (video.videoHeight || rect.height || 1)
  };
}
// 예시: 프레임마다 캔버스 갱신 시 호출
function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
// 예시: 좌표 [{x,y,score}, ...]를 그릴 때
function drawKeypoints(points) {
  const { sx, sy } = getVideoScale();
  ctx.fillStyle = 'lime';
  for (const p of points) {
    const x = p.x * sx;
    const y = p.y * sy;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI*2);
    ctx.fill();
  }
}

/* ===========================
 * 데모/초기화 (필요 시 교체)
 * 실제 프로젝트에서는 선택된 리포트의 경로를 넣어 주세요.
 * =========================== */
// TODO: 실제 로딩 로직에서 아래 소스 경로를 설정하세요.
const demoMainSrc = '';           // 예: 'reports/0001/10_20251027/preprocessed_video.mp4'
const demoOverlaySrc = 'skeleton.mp4';

(function init() {
  // 데모/초기값: 페이지 로드 즉시 사이즈 정합 준비
  resizeLayersToVideo();

  if (demoMainSrc) video.src = demoMainSrc;
  setOverlaySource(demoOverlaySrc);

  // 필요 시 차트 초기화/리포트 트리 로딩은 여기서…
  // TODO: loadReportIndex(); loadPlayerMap(); drawCharts();
})();
