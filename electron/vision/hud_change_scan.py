"""Offline OpenCV ROI change candidates. Not HP, shield or kill recognition."""
import argparse
import json
import math
import os
from pathlib import Path
import sys

try:
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({"ok": False, "error": "OpenCV (cv2) not installed. See requirements-vision.txt."}))
    sys.exit(2)

ROIS = {
    "hp_shield_area": (0.20, 0.89, 0.48, 0.995),
    "killfeed_area": (0.67, 0.035, 0.995, 0.30),
}
MAX_PER_ROI = 15

def features(frame, roi):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = roi
    crop = frame[int(y1*h):max(int(y1*h)+1,int(y2*h)),
                 int(x1*w):max(int(x1*w)+1,int(x2*w))]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(cv2.resize(gray, (160, 64)), (5, 5), 0)

def save_evidence(frame, roi, path):
    h, w = frame.shape[:2]
    scale = min(1.0, 960/w)
    shot = cv2.resize(frame, (round(w*scale), round(h*scale)))
    sh, sw = shot.shape[:2]
    x1, y1, x2, y2 = roi
    cv2.rectangle(shot, (int(sw*x1), int(sh*y1)), (int(sw*x2), int(sh*y2)), (0,180,255), 2)
    if not cv2.imwrite(str(path), shot, [cv2.IMWRITE_JPEG_QUALITY, 84]):
        raise RuntimeError("Evidence image write failed")

def analyze(video_path, output_dir, start, end, sample_fps):
    output_dir.mkdir(parents=True,exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("OpenCV could not decode this video")
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("Video fps unknown")
        duration = frame_count / fps
        if end > duration + 0.1:
            raise ValueError("Analysis range exceeds source duration")
        actual_fps = min(fps, sample_fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(start*fps)))
        previous = {}
        last_change = {key: -100 for key in ROIS}
        events = {key: [] for key in ROIS}
        samples = 0
        next_time = start
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            index = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
            time_sec = index/fps
            if time_sec >= end:
                break
            if time_sec + 1e-6 < next_time:
                continue
            next_time = time_sec + 1/actual_fps
            samples += 1
            for key, roi in ROIS.items():
                now = features(frame, roi)
                old = previous.get(key)
                previous[key] = now
                if old is None:
                    continue
                fraction = float(np.mean(cv2.absdiff(now, old) >= 34))
                if fraction < 0.085 or time_sec-last_change[key] < 0.33:
                    continue
                if len(events[key]) >= MAX_PER_ROI:
                    continue
                last_change[key] = time_sec
                filename = f"{key}_{len(events[key])+1:02d}.jpg"
                save_evidence(frame, roi, output_dir / filename)
                events[key].append({
                    "time_seconds": round(time_sec,4),
                    "change_fraction": round(fraction,4),
                    "evidence": filename,
                    "classification": "visual_change_candidate",
                    "confirmed": False
                })
        result = {
            "schema": "vreview-roi-motion-candidates",
            "version": 1, "engine": "opencv",
            "opencv_version": cv2.__version__,
            "source_filename": video_path.name,
            "source_fps_estimate": round(fps,5),
            "duration_seconds_estimate": round(duration,4),
            "range_seconds": [start,end],
            "sampling_fps_effective": round(actual_fps,4),
            "samples_evaluated": samples,
            "regions": ROIS, "events": events,
            "limitations": [
                "Only pixel-change candidates. Not confirmed kills, HP, shield or damage.",
                "HUD region defaults are uncalibrated and may be inaccurate.",
                "Camera motion and visual effects can cause false positives.",
                "Frame index timestamps are approximate for variable-frame-rate video."
            ]
        }
        temporary = output_dir / "summary.json.tmp"
        temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        os.replace(temporary,output_dir / "summary.json")
        return result
    finally:
        cap.release()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--start",type=float,required=True)
    parser.add_argument("--end",type=float,required=True)
    parser.add_argument("--fps",type=float,default=10)
    args = parser.parse_args()
    try:
        if not all(math.isfinite(v) for v in [args.start,args.end,args.fps]):
            raise ValueError("Non-finite scan settings")
        if args.start < 0 or args.end <= args.start or args.end-args.start > 30 or args.fps < 1 or args.fps > 30:
            raise ValueError("Range: <=30 seconds; sampling: 1..30 fps")
        if not args.video.is_file():
            raise ValueError("Video not found")
        args.output.mkdir(parents=True,exist_ok=True)
        result = analyze(args.video,args.output,args.start,args.end,args.fps)
        print(json.dumps({"ok":True,"summary":result},ensure_ascii=False))
    except (ValueError,OSError,RuntimeError) as e:
        print(json.dumps({"ok":False,"error":str(e)},ensure_ascii=False))
        sys.exit(2)

if __name__=="__main__":
    main()
