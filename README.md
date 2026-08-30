# VReview

VALORANTクリップから戦闘Scene候補を抽出し、ユーザーが修正した結果を使ってDetectorを改善する個人用Webツールです。

最終的には、確定したSceneを高fpsフレームへ変換してChatGPT Plusへ手動提出し、AIM / Movementレビューへつなげます。

## 公開URL

https://elitemay.github.io/vreview/

GitHub Pagesで直接利用します。Node.jsやローカルサーバーは通常利用には不要です。

## 現在の状態

- VReview: **v0.5.1**
- Detector: **v0.5.0**
- Feedback Package: **v5**
- Adopted Web Project Guide: **v1.1.0**
- Profiles: **STATIC + MEDIA + AI-HANDOFF + TOOL**

表示VersionのRuntime正本は [`js/version.js`](js/version.js) です。上記はREADME更新時点のSnapshotです。

Project metadata: [`project-meta.json`](project-meta.json)  
Current specification: [`SPEC.md`](SPEC.md)  
Work history / verification: [`作業報告書.md`](作業報告書.md)

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
- 旧Draft Backup / Restore
- Scene削除Undo
- Storage失敗・別タブ競合の警告
- Detector改善用Feedback ZIP生成

PC版は、**左Navigation固定 / 中央動画固定 / 右Scene Paneのみ縦Scroll**を主要操作仕様として維持します。

### Detector Test

複数のVReview Feedback ZIPを読み込み、以下を集計します。

- Precision
- Recall
- primary Precision
- TP / FP / FN
- weakへ落ちた有効Scene
- Detector Version別集計

Import前に `data/detector-feedback-schema.json` を使って、Package Version・Scene値・Label・Tier等をValidationします。

## 基本的な使い方

1. `New Review`でVALORANTクリップを選ぶ
2. `キルSceneを自動検出`を実行
3. 本命Sceneと要確認候補を確認
4. 誤検出は`不要・誤検出`、見逃しは手動追加、範囲ズレはStart / Endを修正
5. `検出改善用ZIPを作成`
6. 複数ZIPを`Detector Test`へ入れて傾向を確認
7. 必要な場合はZIPをChatGPTへ渡してDetector改善に利用

## 保存

### localStorage

小さい編集データのみ保存します。

- Scene Draft
- Scene Label
- Detector感度
- Feedbackメモ
- 直近Detector概要

Storage Schemaはv1です。v0.5.0以前のplain Array / Object形式も読み込めるよう後方互換を維持しています。

新規開始時は既存DraftをBackupへ退避します。

### 保存しないもの

- 元動画
- API Key
- Password / Token
- Detectorの巨大診断データ

元動画を使った作業再開時は同じ動画を再選択します。

## 外部サービス

現在の主要機能はBackend / DB / CDN / OpenAI APIを必要としません。

将来のAIレビューも、追加API料金を必須にせず、基本は

```text
VReview
↓
ChatGPT Plusへ手動提出
↓
固定JSONをVReviewへImport
```

とする予定です。

## 崩してはいけない仕様

詳細は [`SPEC.md`](SPEC.md) を正本とします。特に重要なものは以下です。

- GitHub Pages対応を維持
- 有料APIを必須にしない
- 元動画を勝手に外部送信しない
- Detector結果を必ず手動修正可能にする
- weak候補をprimaryと分離する
- PC版New Reviewの固定動画 + 右Pane Scrollを維持
- Versioned Patch JSを再び積み上げない
- 保存データをMigration / Backupなしに破棄しない
- 未実装機能を完成済みのように見せない

## ファイル構成

```text
/
├─ index.html
├─ review.html
├─ detector-test.html
├─ SPEC.md
├─ project-meta.json
├─ data/
│  └─ detector-feedback-schema.json
├─ css/
│  ├─ base.css
│  ├─ layout.css
│  └─ components.css
├─ js/
│  ├─ version.js
│  ├─ app.js
│  ├─ video.js
│  ├─ ui.js
│  ├─ storage.js
│  ├─ detector.js
│  ├─ detector-test.js
│  └─ feedback-package-v5.js
├─ scripts/
│  └─ validate.mjs
├─ tests/
│  ├─ storage.test.mjs
│  └─ BROWSER_CHECKLIST.md
├─ .github/workflows/
│  └─ validate.yml
└─ 作業報告書.md
```

`feedback-package-v5.js`の`v5`は旧Runtimeを上書きするPatch番号ではなく、ユーザーへ出力するFeedback Package Format Versionを表します。Detector Runtimeは`js/detector.js`へ一本化済みです。

## Validation

GitHub Actionsでpush / pull request時に以下を確認します。

- JavaScript / MJS構文
- 必須ファイル
- JSON構文
- HTMLローカル参照
- Cache Busting Version整合
- HTML ID重複
- Project Guide / Profile metadata
- Storage / Feedback Schema Version整合
- 旧Versioned Detector再混入
- localhost / PC固有Path
- 代表的なSecret Token混入
- Storage後方互換Regression Test

ローカルでNode.jsがある場合のみ、開発確認として次を実行できます。

```bash
node scripts/validate.mjs
node tests/storage.test.mjs
```

## 未実装 / 既知の課題

- 未使用クリップでDetector v0.5.0の汎化検証
- ace4-1型の重複Scene
- 長い連キルの自動分割
- Death専用検出
- HUD Scale / aspect ratio差
- 固定ROI自動キャリブレーション
- 長尺動画のさらなる高速化
- Timeline Start / Endドラッグハンドル
- ChatGPT採点用30 / 60fps Package
- AI result JSON Import / History / Training

Static Validation成功だけではBrowser Validated扱いにしません。Firefox / Chromiumの実Media・Layout確認項目は [`tests/BROWSER_CHECKLIST.md`](tests/BROWSER_CHECKLIST.md) に分離しています。
