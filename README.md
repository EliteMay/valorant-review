# VReview

VALORANTの強い時・弱い時の差を客観的に測ることを目標にした個人用レビュー / AIM分析ツールです。現行Web Reviewを維持しつつ、v0.9.0からElectron Desktop基盤へ移行し、v0.10.0でPassive Input Telemetryを追加し、v0.11.0でGameplay録画とTelemetryを1ボタンで同時記録できるようにしました。

最終的には、動画・受動Input Telemetry・Duel単位の指標を同期し、Strong / Weak Sessionを統計比較したEvidenceをAIへ渡してAIM / Movementレビューへつなげます。

## 公開URL

https://elitemay.github.io/valorant-review/

GitHub Pagesで直接利用します。通常利用にNode.js・Backend・有料APIは不要です。

## 現在の状態

- VReview: **v0.11.0**
- Detector: **v0.5.0**
- Feedback Package: **v5**
- Feedback Batch Schema: **v1**
- Storage Schema: **v1**
- Diagnostics Schema: **v1**
- Adopted Web Project Guide: **v1.22.0**
- Profiles: **STATIC + MEDIA + AI-HANDOFF + TOOL**
- Visual Direction: **Review Workbench**

v0.10.0ではDetector v0.5.0をLegacy baselineのまま維持し、Windows Raw InputでMouse dx/dy・LMB・W/A/S/Dを記録するPassive Input Telemetryを追加します。

v0.10.1ではアプリ内Updateを修正し、`Update確認・適用`から新しいReleaseをダウンロード → 適用 → 再起動できるようにしました。

v0.10.2ではTelemetryのVALORANT判定から`OpenProcess`を削除し、公開Windows APIのForeground Window titleだけで記録可否を判定するSafe Telemetryへ変更しました。ゲームProcess Handleを開きません。

v0.11.0ではGameplay録画を追加し、`New Review`の「録画＋入力 開始」からPrimary画面のWebM録画・Windows System Audio・Input Telemetryを同じSessionへ保存します。

Runtime Versionの正本は [`js/version.js`](js/version.js) です。

- Project metadata: [`project-meta.json`](project-meta.json)
- Current specification: [`SPEC.md`](SPEC.md)
- Long-term project learnings: [`PROJECT_LEARNINGS.md`](PROJECT_LEARNINGS.md)
- Coding agent router: [`AGENTS.md`](AGENTS.md)
- Work history / verification: [`作業報告書.md`](作業報告書.md)

## Electron Desktop Foundation

v0.10.0では最終Electron化に向け、以下を実装しています。

- Secure BrowserWindow: `contextIsolation=true / sandbox=true / nodeIntegration=false`
- Single Instance
- Atomic Settings + Backup
- Bounded local log
- Window State保存 / 画面外復元防止
- Desktop Diagnostics
- Controlled Update check
- Task Registry
- Windows NSIS build workflow
- Electron専用の設定画面
- `Session / Duel / AnalysisRun` Schema
- Passive Input Telemetry: Mouse dx/dy / LMB / W/A/S/D
- VALORANT foreground限定記録
- Telemetry session JSON / NDJSON保存
- Gameplay録画: Primary画面 / WebM / 60fps目標 / Windows System Audio
- 録画とTelemetryを同じSession folderへ保存

詳細: [`docs/V1_ELECTRON_ARCHITECTURE.md`](docs/V1_ELECTRON_ARCHITECTURE.md)

Electron版の最終Analysis Engineでは、ゲームへのInjection・Memory Read・入力自動化を行わず、Passive recording → Offline analysisを前提にします。

## Gameplay Session Recording

Electron版の`New Review`で **「録画＋入力 開始」** を押すと、Gameplay録画とInput Telemetryをまとめて開始します。

同じSession folderへ保存:

- `gameplay.webm` — Primary画面の録画
- `recording.json` — 録画Format / Resolution / FPS / Audio等
- `telemetry.ndjson` — Mouse / LMB / WASD timestamp
- `telemetry-session.json` — Telemetry manifest
- `session.json` — 録画とTelemetryを結ぶSession manifest

録画方針:

- Target: 1920×1080 / 60fps
- Format: WebM
- Windows System Audio loopbackを含める
- VReviewを最小化しても録画継続できるよう`backgroundThrottling=false`
- Game process memory / Injection / Input Automationは使わない
- 録画中はReview pageから別ページへ移動しないようUIでGuardする

現段階では録画とTelemetryを同じSessionへ保存しますが、Frame-accurateなClock sync / FFmpeg解析は次Phaseです。

## Input Telemetry

Electron版の`New Review`から「記録開始」を押し、その後VALORANTへ戻ると入力を記録します。

保存対象:

- Mouse相対移動量 `dx / dy`
- 左クリック `LMB down / up`
- `W / A / S / D down / up`
- 高精度timestamp
- VALORANT foreground状態

保存しないもの:

- 文字入力
- Clipboard
- 他アプリのKey入力
- VALORANT Process Memory
- 自動操作 / Injection

SessionごとにElectronのuserData配下へ`telemetry-session.json`と`telemetry.ndjson`を保存します。次Phaseで録画動画と時刻同期します。

## 基本フロー

```text
Clip Aを検出・修正
→ このクリップの改善データを保存

Clip Bを検出・修正
→ このクリップの改善データを保存

Clip Cを検出・修正
→ このクリップの改善データを保存

最後
→ 保存済みをまとめてZIP作成
→ 1つのBatch ZIPをChatGPTへ渡す
```

同じ動画を保存し直した場合は、その動画Fingerprintの保存データを更新するため重複しません。別動画を保存すると件数が増えます。

Batch ZIPは`Detector Test`へそのまま1個ドロップでき、中の複数クリップを個別Feedbackとして集計します。従来のv4 / v5単体Feedback ZIPも引き続きImportできます。

## 現在使える機能

### New Review

- Gameplay録画 + Input Telemetry同時記録（Electron）
- MP4 / WebM読み込み
- キルScene候補の自動検出
- `primary` / `weak`候補の分離
- Scene手動追加・削除・範囲修正
- Scene正解ラベル
- Timeline seek / Playhead
- Detector解析キャンセル
- 動画ごとのScene Draft保存
- Draft Backup / Restore
- Scene削除Undo
- Storage失敗・別タブ競合警告
- Feedback Package v5相当の内容をIndexedDBへ保存
- 保存済みFeedbackの件数・容量表示
- 保存済みFeedbackの個別削除 / 全削除
- 複数Feedbackを1つのBatch ZIPへExport
- Error ID / Local Development Diagnostics

### Feedback Queue

Feedback Queueは [`js/feedback-library.js`](js/feedback-library.js) が管理します。

保存先:

- **IndexedDB**: `vreview-feedback-library`
- 最大20クリップ
- 合計最大350MB
- 同じ動画Fingerprintは上書き更新

保存するもの:

- `manifest.json`
- `auto-scenes.json`
- `corrected-scenes.json`
- `detector-diagnostics.json`
- `scene-image-map.json`
- `notes.txt`
- 全画面確認シート
- ROI確認シート

保存しないもの:

- 元動画本体
- API Key / Password / Token

ZIPを作成してもQueueは自動削除しません。ダウンロードを確認してから個別削除または「保存済みをすべて削除」を使います。

### Detector Test

以下を読み込めます。

- 従来のFeedback Package v4 / v5 ZIP
- `vreview-detector-feedback-batch` v1 のBatch ZIP

集計:

- Strict Precision / Strict Recall（auto-scenesと修正後Ground Truthを時刻照合）
- Loose Recall（イベント自体を概ね拾えたか）
- 平均Boundary Error
- TP / FP / FN
- Duplicate / Merge / Split
- v4等でauto-scenesが無い場合のみLegacy集計

Import前に [`data/detector-feedback-schema.json`](data/detector-feedback-schema.json) でPackage / Batch / Scene / Label / TierをValidationします。

### Diagnostics

[`diagnostics.html`](diagnostics.html) で、このTabの診断情報を確認・Exportできます。動画本体・Scene本文・Feedbackメモ本文・Storage値そのものはDiagnosticsへ保存せず、自動外部送信もしません。

## 保存

### localStorage

小さい編集データのみ保存します。

- Scene Draft / Label
- Detector感度
- Feedbackメモ
- 直近Detector概要

Storage Schemaはv1です。v0.5.0以前のplain Array / Object形式も読める後方互換を維持しています。

### IndexedDB

Feedback QueueのJSON・生成画像・診断Package内容を保存します。大きいBlobをlocalStorageへ入れません。

### sessionStorage

Development Diagnosticsの直近Sessionのみ保存します。

## Visual Direction

PC版New Reviewは以下を維持します。

```text
左: compact navigation
中央: gameplay video + event timeline + clip controls
右: continuous scene inspector
```

- 動画を最大Visualにする。
- Timelineを動画直下に置く。
- 右Inspectorだけ縦Scrollする。
- 980 CSS px以下では通常縦Scrollへ戻す。
- 右Inspectorを巨大Cardの縦積みへ戻さない。

## 崩してはいけない仕様

詳細は [`SPEC.md`](SPEC.md) を正本とします。

- GitHub Pages対応を維持する。
- 有料APIを必須にしない。
- 元動画を勝手に外部送信・IndexedDB保存・Feedback ZIP格納しない。
- Detector結果は必ず手動修正可能にする。
- `primary / weak`を分離する。
- PC版New Reviewの中央動画固定 + 右InspectorのみScrollを維持する。
- Feedback画像 / Package BlobをlocalStorageへ保存しない。
- 同じ動画のQueue保存を重複追加せず更新する。
- Batch ZIP生成失敗で保存済みQueueを消さない。
- v4 / v5単体FeedbackのDetector Test互換を維持する。
- Versioned Patch JSを再び積み上げない。
- 保存データをMigration / Backupなしに破棄しない。
- Detector条件を単一Clipだけへ過学習させない。
- Static Validation成功をBrowser / Visual / User Validation済みとして扱わない。

## Validation

GitHub Actionsでpush / pull request時に以下を確認します。

- JavaScript / MJS構文
- 必須ファイル / JSON / HTML参照
- Cache Build整合
- Project Guide / Profile metadata
- Storage / Feedback / Batch / Diagnostics Schema整合
- IndexedDB Feedback Queue契約
- Batch ZIP / Detector Test配線
- Review Workbench必須構造
- 旧Versioned Detector再混入
- localhost / PC固有Path /代表的Secret Token
- Storage後方互換Regression Test
- Temporal Detector Metrics Regression Test
- Electron security / settings / Windows build contract
- Telemetry allowlist / privacy Regression Test
- Native Raw Input HelperのWindows build

Browser / IndexedDB / Media / ZIPの実動作はStatic CIと分離し、[`tests/BROWSER_CHECKLIST.md`](tests/BROWSER_CHECKLIST.md)で確認します。

## 未実装 / 既知の課題

- 未使用クリップ群でDetector v0.5.0の汎化検証
- ace4-1型の重複Scene
- 長い連キルの自動分割
- Death専用検出
- HUD Scale / aspect ratio差
- 固定ROI自動キャリブレーション
- 長尺動画Performance
- Timeline Start / Endドラッグハンドル
- ChatGPT採点用30 / 60fps Package
- AI result JSON Import / History / Training
- v0.8.0 IndexedDB Queue / Batch ZIPの実ブラウザ検証
