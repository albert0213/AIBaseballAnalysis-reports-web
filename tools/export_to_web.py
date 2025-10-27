# -*- coding: utf-8 -*-
"""
사용법 (PowerShell / CMD):
  python tools/export_to_web.py "C:/path/to/report_data" "./reports"
- 왼쪽: 원본 데이터 루트(report_data)
- 오른쪽: 웹 리포지토리 내 대상 폴더(reports)

기능:
- player_id/report_id 별로 summary.json, series.json을 복사
- 영상/오버레이 mp4를 assets/ 아래로 복사 및 표준 파일명으로 정리
- reports/index.json 자동 생성
"""
import os, sys, json, shutil
from pathlib import Path

SRC = Path(sys.argv[1]).resolve()
DST = Path(sys.argv[2]).resolve()
DST.mkdir(parents=True, exist_ok=True)

def safe_copy(src: Path, dst: Path):
    if src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dst))
        return True
    return False

report_index = []  # index.json에 들어갈 목록

for player_dir in sorted(SRC.iterdir()):
    if not player_dir.is_dir(): 
        continue
    player_id = player_dir.name

    for report_dir in sorted(player_dir.iterdir()):
        if not report_dir.is_dir():
            continue
        report_id = report_dir.name

        # 원본 경로들
        result_dir = report_dir / "result"
        summary_src = result_dir / "summary.json"
        series_src  = result_dir / "series.json"

        # 대상 경로들
        out_base   = DST / player_id / report_id
        assets_dir = out_base / "assets"
        out_summary = out_base / "summary.json"
        out_series  = out_base / "series.json"

        # summary/series 복사
        ok_summary = safe_copy(summary_src, out_summary)
        ok_series  = safe_copy(series_src, out_series)

        # 영상/오버레이 복사
        # report_video.mp4는 preprocessed_video.mp4를 표준 파일명으로 복사
        _ = safe_copy(report_dir / "preprocessed_video.mp4", assets_dir / "report_video.mp4")
        _ = safe_copy(result_dir / "skeleton.mp4",            assets_dir / "skeleton.mp4")
        _ = safe_copy(result_dir / "hand_trace.mp4",          assets_dir / "hand_trace.mp4")
        _ = safe_copy(result_dir / "head_stability.mp4",      assets_dir / "head_stability.mp4")
        _ = safe_copy(result_dir / "center_shift.mp4",        assets_dir / "center_shift.mp4")
        _ = safe_copy(result_dir / "shoulder_hip_rotation.mp4", assets_dir / "shoulder_hip_rotation.mp4")

        # index 등록 (summary가 있는 것만 우선)
        if ok_summary:
            # title은 summary.json에 있으면 더 좋지만, 여기선 간단히 report_id 사용
            report_index.append({
                "player_id": player_id,
                "report_id": report_id,
                "title": report_id
            })

# index.json 저장
with open(DST / "index.json", "w", encoding="utf-8") as f:
    json.dump(report_index, f, ensure_ascii=False, indent=2)

print(f"[완료] {SRC} -> {DST} 변환 및 index.json 생성")
print(f"총 {len(report_index)}개 리포트가 index에 포함되었습니다.")
