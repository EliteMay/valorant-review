# VReview

VALORANTクリップをブラウザ内で確認し、戦闘Scene候補を自動検出・手動修正しながらDetectorを改善する個人用Webツールです。

最終的には、確定Sceneを高fpsフレームへ変換してChatGPT Plusへ手動提出し、AIM / Movementレビューへつなげます。

## 公開URL

https://elitemay.github.io/valorant-review/

GitHub Pagesで直接利用します。通常利用にNode.js・Backend・有料APIは不要です。

## 現在の状態

- VReview: **v0.8.0**
- Detector: **v0.5.0**
- Feedback Package: **v5**
- Feedback Batch Schema: **v1**
- Storage Schema: **v1**
- Diagnostics Schema: **v1**
- Adopted Web Project Guide: **v1.13.0**
- Profiles: **STATIC + MEDIA + AI-HANDOFF + TOOL**
- Visual Direction: **Review Workbench**

v0.8.0はDetector条件を変えず、Feedback提出を「1クリップごとにZIPをダウンロード」から「複数クリップを端末へ保存し、最後に1回だけZIP化」へ変更します。Detectorは引き続きv0.5.0です。

Runtime Versionの正本は [`js/version.js`](js/version.js) です。

- Project metadata: [`project-meta.json`](project-meta.json)
- Current specification: [`SPEC.md`](SPEC.md)
- Long-term project learnings: [`PROJECT_LEARNINGS.md`](PROJECT_LEARNINGS.md)
- Coding agent router: [`AGENTS.md`](AGENTS.md)
- Work history / verification: [`作業報告書.md`](作業報告書.md)

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

- Precision
- Recall
- primary Precision
- TP / FP / FN
- weakへ落ちた有効Scene
- Detector Version別集計

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
