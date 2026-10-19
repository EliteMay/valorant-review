"""Standalone opt-in runtime test: use the isolated OpenCV Python interpreter."""
import importlib.util
from pathlib import Path
import tempfile
import subprocess
import sys
import cv2
import numpy as np

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hud_scan", root/"electron"/"vision"/"hud_change_scan.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with tempfile.TemporaryDirectory(prefix="vreview-cv-test-") as tmp:
    base = Path(tmp)
    def create(name, changing):
        filename = base/name
        video = cv2.VideoWriter(str(filename), cv2.VideoWriter_fourcc(*"mp4v"), 60, (640,360))
        assert video.isOpened(), "VideoWriter codec unavailable"
        for i in range(240):
            frame = np.zeros((360,640,3),dtype=np.uint8)
            if changing and i>=60:
                cv2.rectangle(frame,(145,328),(285,353),(255,255,255),-1)
            if changing and i>=120:
                cv2.rectangle(frame,(460,25),(625,80),(100,255,80),-1)
            video.write(frame)
        video.release()
        return filename
    source = create("changes.mp4",True)
    changed = mod.analyze(source,base/"changed",0,4,10)
    assert changed["events"]["hp_shield_area"],"Missing synthetic HP region change"
    assert changed["events"]["killfeed_area"],"Missing synthetic killfeed region change"
    assert (base/"changed"/"summary.json").is_file()
    assert all((base/"changed"/e["evidence"]).is_file() for group in changed["events"].values() for e in group)
    for group in changed["events"].values():
        for event in group:
            assert event["confirmed"] is False
    stable = mod.analyze(create("stable.mp4",False),base/"stable",0,4,10)
    assert not any(stable["events"].values()), "False positives in stable synthetic video"
    subprocess.run(["node",str(root/"tests"/"vision-scan-cli.test.cjs"),str(source),sys.executable],cwd=root,check=True)
    print("OpenCV synthetic motion scan: passed", {k:len(v) for k,v in changed["events"].items()})
