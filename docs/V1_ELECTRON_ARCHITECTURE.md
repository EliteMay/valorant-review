# VReview v1 Electron Architecture

## Goal

VReview v1 changes the product from a **scene-detector tuning workbench** into a **measurement-first aim consistency analyzer**.

The primary question is no longer “where is a kill scene?” but:

> What measurable input / aim / timing differences separate strong sessions from weak sessions?

## Non-goals

- Do not inject code into VALORANT.
- Do not read game process memory.
- Do not automate gameplay or send input to the game.
- Do not provide live tactical instructions during a match.
- Do not upload source video automatically.

The intended flow is passive recording followed by offline analysis.

## Process boundaries

```text
Renderer
  UI + MediaRecorder for explicit user-started display capture
  ↓ bounded IPC chunks
Preload
  explicit capability bridge
  ↓
Main
  window / settings / logs / update / task orchestration
  ↓
Analysis utility process (next phase)
  FFmpeg / frame decode / computer vision / metrics
  ↓
Native input helper
  mouse dx/dy + LMB + W/A/S/D timestamps only
  VALORANT foreground only
```

## Current foundation

The `electron-v1-foundation` branch introduces:

- secure BrowserWindow defaults
- single-instance handling
- atomic settings + backup
- bounded logs
- safe window-state restore
- desktop diagnostics
- controlled update checks
- task-state foundation
- Windows NSIS packaging configuration
- Settings screen that degrades safely on Web
- duel/session/analysis-run schema contracts
- passive Windows Raw Input telemetry
- explicit Start / Stop UI
- VALORANT foreground filter
- telemetry NDJSON session persistence
- Primary-screen Gameplay recording via Electron desktop capture
- MediaRecorder chunk streaming to Main-process disk sink
- Windows system-audio loopback
- gameplay.webm + recording.json in the same Session folder

## Gameplay recording boundary

v0.11.0 adds explicit user-started gameplay recording.

Capture path:

```text
review.html user gesture
↓
navigator.mediaDevices.getDisplayMedia
↓
Main setDisplayMediaRequestHandler
↓
Primary screen + Windows loopback audio
↓
MediaRecorder
↓
1-second Uint8Array chunks
↓
Preload IPC
↓
RecordingController file stream
```

Rules:

- Screen sources only; no process/window handle acquisition is required.
- Capture requests are granted only to the local `review.html` frame.
- Recording is local-only and never auto-uploaded.
- The source file is streamed to disk as `gameplay.webm`, not accumulated as one giant renderer Blob.
- Recording and telemetry share the same Session ID/folder.
- Navigation away from Review is blocked while MediaRecorder is active.
- App shutdown may mark the recording interrupted; normal user stop is the expected clean-finalization path.

## Input telemetry boundary

v0.10.0 implements a dedicated native helper instead of browser-level mouse events.

It records only:

- relative mouse dx/dy
- LMB down/up
- W/A/S/D down/up
- monotonic timestamps
- foreground VALORANT boolean needed to enforce capture; raw window title is not persisted

It intentionally does not use:

- SetWindowsHookEx
- ReadProcessMemory / WriteProcessMemory
- DLL injection
- synthetic input
- clipboard/text capture
- opening the VALORANT process for metadata; `OpenProcess` is intentionally forbidden in the telemetry helper

Renderer receives only aggregate counts/status. Raw events are written by the Electron main-process controller to the local telemetry session folder.

## Detector v0.5 status

Detector v0.5 remains a legacy baseline. Do not keep tuning per-clip thresholds as the main path to v1.

It can still be useful for:

- rough event candidates
- telemetry/video clock synchronization evidence
- legacy feedback comparison

It is not authoritative for:

- exact shot timestamps
- enemy-visible timestamps
- mouse correction timing
- duel boundaries

## Measurement pipeline target

```text
Video + passive input telemetry
↓
Clock synchronization
↓
Shot candidates
↓
Local 60fps+ decode around candidates
↓
Enemy visibility / duel boundaries
↓
Aim + movement metrics
↓
Matched strong-vs-weak duel comparison
↓
AI explanation using evidence IDs
```

## Data model

Canonical desktop concepts:

- Session — one imported/recorded gameplay session
- Duel — one combat interaction
- AnalysisRun — one reproducible analysis execution

Large derived frame caches are not canonical user data and must remain rebuildable.

## AI boundary

AI must not discover the source timeline from a long video as the only evidence source.

The analyzer should supply:

- confirmed/matched duel IDs
- numeric metrics
- telemetry
- key frames / short dense frame sequences
- uncertainty and sample counts

Strong/weak labels should be hidden during first-pass comparison where practical, then revealed after descriptive differences are produced.

## Validation gates

Desktop work is not complete from static CI alone.

Required later:

1. Windows install/uninstall smoke
2. Gameplay capture real-PC validation: minimized VReview + VALORANT foreground + system audio
3. packaged app launch
3. restart + settings/window restore
4. renderer crash recovery behavior
5. update check behavior
6. real video import
7. input telemetry real-PC validation and video synchronization
8. analysis-worker cancel/interruption recovery
9. strong/weak comparison on multiple sessions
10. diagnostic export privacy check
