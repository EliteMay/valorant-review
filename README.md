# VReview

VALORANTクリップをブラウザ内で確認し、戦闘Scene候補を自動検出・手動修正しながらDetectorを改善する個人用Webツールです。

最終的には、確定Sceneを高fpsフレームへ変換してChatGPT Plusへ手動提出し、AIM / Movementレビューへつなげます。

## 公開URL

https://elitemay.github.io/valorant-review/

GitHub Pagesで直接利用します。通常利用にNode.js・Backend・有料APIは不要です。

## 現在の状態

- VReview: **v0.7.0**
- Detector: **v0.5.0**
- Feedback Package: **v5**
- Storage Schema: **v1**
- Diagnostics Schema: **v1**
- Adopted Web Project Guide: **v1.13.0**
- Profiles: **STATIC + MEDIA + AI-HANDOFF + TOOL**
- Visual Direction: **Review Workbench**

v0.7.0は見た目・Information Hierarchy・Workspace構造の改修です。Detectorの判定条件はv0.5.0から変更していません。

Runtime Versionの正本は [`js/version.js`](js/version.js) です。

- Project metadata: [`project-meta.json`](project-meta.json)
- Current specification: [`SPEC.md`](SPEC.md)
- Long-term project learnings: [`PROJECT_LEARNINGS.md`](PROJECT_LEARNINGS.md)
- Coding agent router: [`AGENTS.md`](AGENTS.md)
- Work history / verification: [`作業報告書.md`](作業報告書.md)

## Visual Direction

v0.7.0では `web-project-guide` v1.13.0 のVisual Quality Baseline / Domain-first Visual Researchに従い、ゲーム動画レビュー・動画フィードバック・スポーツ映像解析Toolを調査してからUIを再設計しました。

採用した方向:

```text
左: compact navigation
中央: gameplay video + event timeline + clip controls
右: continuous scene inspector
```

重要な原則:

- 動画を画面の主役にする。
- Timelineを動画へ密着させる。
- 右側はCardの縦積みではなくInspector / Listとして高密度にする。
- Accent ColorよりTimestamp / Selected / Event / Stateを優先して見せる。
- PC版は中央動画を固定し、右Scene Inspectorだけ縦Scrollする。
- 980 CSS px以下では固定Workspaceを解除し通常縦Scrollへ戻す。
- 未実装機能は通常のReview作業面から外す。

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
- Detector改善用Feedback ZIP生成
- Error ID
- Local Development Diagnostics

### Detector Test

複数のFeedback ZIPをまとめて読み込み、以下を集計します。

- Precision
- Recall
- primary Precision
- TP / FP / FN
- weakへ落ちた有効Scene
- Detector Version別集計

Import前に [`data/detector-feedback-schema.json`](data/detector-feedback-schema.json) でPackage / Scene / Label / Tier等をValidationします。

### Diagnostics

[`diagnostics.html`](diagnostics.html) で、このTabの診断情報を確認・Exportできます。

記録対象:

- App / Build / Schema / Detector / Feedback / Guide Version
- Route / Viewport / Browserの最小Summary
- 重要操作Breadcrumb
- JavaScript Error / Promise Rejection
- Storage / Import / Network FailureのSanitized Summary

記録しないもの:

- 元動画・画像・音声本体
- Scene内容本体
- Feedbackメモ本文
- File名 / Path
- localStorage / sessionStorage値本体
- Password / API Key / Token / Cookie / Authorization

Diagnosticsは`sessionStorage`の上限付きRing Bufferで、自動外部送信しません。

## 基本フロー

1. `New Review`でVALORANTクリップを開く
2. `自動検出`を実行
3. 動画・Timelineを見ながら右InspectorでSceneを確認
4. 誤検出は`不要・誤検出`、見逃しは手動追加、範囲ズレはStart / Endを修正
5. `検出改善用ZIPを作成`
6. 複数ZIPを`Detector Test`で比較
7. 不具合時は`Diagnostics`から診断JSONを出力

## 保存

### localStorage

小さい編集データのみ保存します。

- Scene Draft / Label
- Detector感度
- Feedbackメモ
- 直近Detector概要

Storage Schemaはv1です。v0.5.0以前のplain Array / Object形式も読める後方互換を維持しています。

### sessionStorage

Development Diagnosticsの直近Sessionのみ保存します。

### 保存しないもの

- 元動画
- API Key / Password / Token
- Media body
- 巨大Detector diagnostics

## 外部サービス

現在の主要機能はBackend / DB / CDN / OpenAI APIを必要としません。

将来のAIレビューも基本は次の手動フローを予定しています。

```text
VReview
↓
ChatGPT Plusへ手動提出
↓
固定JSONをVReviewへImport
```

## 崩してはいけない仕様

詳細は [`SPEC.md`](SPEC.md) を正本とします。

- GitHub Pages対応を維持する。
- 有料APIを必須にしない。
- 元動画を勝手に外部送信しない。
- Detector結果は必ず手動修正可能にする。
- `primary / weak`を分離する。
- PC版New Reviewの**中央動画固定 + 右InspectorのみScroll**を維持する。
- 動画・TimelineをReview画面のVisual Priority 1とする。
- 右Inspectorを巨大Cardの縦積みへ戻さない。
- Versioned Patch JSを再び積み上げない。
- 保存データをMigration / Backupなしに破棄しない。
- Detector条件を単一Clipだけへ過学習させない。
- 未実装機能を完成済みのように見せない。
- Static Validation成功をBrowser / Visual / User Validation済みとして扱わない。

## Validation

GitHub Actionsでpush / pull request時に以下を確認します。

- JavaScript / MJS構文
- 必須ファイル / JSON
- HTML local references / duplicate ID
- Cache Build整合
- Project Guide / Profile metadata
- Storage / Feedback / Diagnostics Schema整合
- Diagnostics wiring / privacy policy
- Review Workbenchの必須構造
- 旧Versioned Detector再混入
- localhost / PC固有Path /代表的Secret Token
- Storage後方互換Regression Test

ローカルでNode.jsがある場合:

```bash
node scripts/validate.mjs
node tests/storage.test.mjs
```

Visual変更はStatic Validationだけでは完成扱いにしません。Firefox / Chromium / Zoom / low-height / right-only scroll等の手動項目は [`tests/BROWSER_CHECKLIST.md`](tests/BROWSER_CHECKLIST.md) に分離しています。

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
- v0.7.0 Review Workbenchの実ブラウザVisual Validation
