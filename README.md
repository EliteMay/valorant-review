# VReview

VALORANTのクリップから戦闘Sceneを抽出し、最終的にChatGPT Plusへ高fps解析パッケージを渡してAIM / Movementをレビューする個人用Webツールです。

## 現在のバージョン

バージョン番号は `js/version.js` を唯一の表示元として管理します。

- VReview: **v0.5.0**
- Detector: **v0.5.0**
- Feedback Package: **v5**

## 現在の開発段階

AI採点機能より先に、**キルScene自動検出の汎化性能と、検出結果を修正・検証しやすい作業環境**を固めています。

```text
動画を選択
↓
Detector v0.5.0
↓
本命Scene / 要確認候補
↓
ユーザー確認・時間修正・ラベル付け
↓
Feedback Package v5
↓
Detector Testで複数ZIPを集計
↓
共通失敗だけ次のDetectorへ反映
```

## 崩してはいけない仕様

1. GitHub Pagesで利用できる静的HTML / CSS / JavaScript構成を維持する
2. OpenAI APIなどの有料APIを必須にしない
3. AI採点は基本 `VReview -> ChatGPT Plus -> VReview` の手動受け渡し方式
4. APIキー・パスワード・元動画を公開リポジトリへ保存しない
5. 元動画をユーザー操作なしに外部送信しない
6. 自動検出結果は必ず手動修正できる
7. PrecisionよりRecallをやや優先するが、弱候補は本命Sceneと分離する
8. PC版New Reviewは **左ナビ固定 / 中央動画固定 / 右Sceneペインのみスクロール** を維持する
9. 採点対象v1はAIM + Movement
10. 採点基準はImmortal / Radiant上位レベル
11. Kill / Death結果だけで採点しない
12. 判断できない採点項目は `null` を許可する
13. AI返却データは固定JSON Schemaにする
14. 現在バージョンをサイト上へ常時表示する
15. 未実装機能を完成済み機能のように見せない

## v0.5.0 基盤改修

v0.4系ではDetectorを

```text
v0.4.2 -> v0.4.3 -> v0.4.4 -> v0.4.5
```

のように別JSで順番に上書きしていました。

v0.5.0ではこの構造を廃止し、`js/detector.js` の単一Pipelineへ統合しました。

内部処理は以下の順です。

```text
Audio / Visual Analysis
↓
Evidence Builder
↓
Base Scene Builder
↓
Scene Refiner
↓
Recall Guard
↓
Candidate Classifier
↓
primary / weak
```

今後は過去版Detector JSを上書きして修正するのではなく、このPipeline内の担当処理を修正します。

## Detector v0.5.0

ブラウザ内で主に以下を利用します。

- 音声ピーク / トランジェント
- 画面中央Motion
- 右上Killfeed領域
- 右下Ammo HUD領域
- 下中央Kill Confirm領域
- 上中央Round UI領域

### Scene分類

- `primary` — 本命Scene
- `weak` — 見逃し防止用の要確認候補
- `manual` — ユーザーが手動追加したScene

### 解析キャンセル

v0.5.0から解析中にキャンセルできます。

長尺動画では解析間隔を自動的に少し広げ、警告を表示します。

## New Review

PCでは動画読み込み後、以下の3領域になります。

```text
左: ナビゲーション固定
中央: 動画 / Timeline / Scene追加操作を固定
右: 自動検出 / Scene一覧 / Feedbackのみ縦スクロール
```

### Scene操作

- 自動検出
- 本命 / 要確認候補の分離表示
- Scene再生
- Start / End直接入力
- Start / End ±0.1秒
- Scene削除
- 手動Scene追加
- 正解ラベル設定
- タイムラインクリックでシーク
- 現在再生位置Playhead表示
- Scene選択表示

### キーボード

- `Space`: 再生 / 停止
- `I`: 現在位置をScene開始候補へ
- `O`: 現在位置をScene終了候補へ
- `← / →`: ±0.1秒
- `Shift + ← / →`: ±0.5秒
- `Delete`: 選択Scene削除

## 途中保存

元動画そのものは保存しません。

動画の以下からFingerprintを作り、Scene編集を動画ごとに `localStorage` へ保存します。

- ファイル名
- ファイルサイズ
- lastModified
- 動画時間
- 解像度

同じ動画を再選択すると、前回Sceneを復元するか確認します。

保存対象:

- Scene範囲
- Sceneラベル
- 本命 / weak情報
- 検出感度
- Feedbackメモ

Detectorの巨大な診断データはlocalStorageへ保存しません。Feedback ZIPを再作成する場合は自動検出を再実行します。

## Feedback Package v5

```text
vreview_feedback_<clip>.zip
├─ README.txt
├─ manifest.json
├─ auto-scenes.json
├─ corrected-scenes.json
├─ detector-diagnostics.json
├─ scene-image-map.json
├─ notes.txt
└─ scene-images/
   ├─ scene_001_full.jpg
   ├─ scene_001_roi.jpg
   └─ ...
```

### v5変更点

- auto / correctedで同じ範囲のScene画像を二重生成しない
- 全画面画像を `contain` で描画し、HUDをクロップしない
- 均等16枚よりDetectorイベント時刻を優先してフレーム取得
- Killfeed / Ammo / Kill Confirm / Round UIのROI拡大画像を追加
- `scene-image-map.json` でSceneと共有画像を対応付ける

Scene JSONには以下を含みます。

- `feedback_label`
- `review_tier`
- `needs_review`
- `weak_reason`
- `detector_reason`
- `recall_guard`
- `classifier_index`
- `classifier_evidence`
- `anchor_count`
- `shot_evidence_count`

## Detector Test

`detector-test.html` へ複数のVReview Feedback ZIPをまとめて入れると、以下を自動集計します。

- Precision
- Recall
- primary Precision
- TP / FP / FN
- weakへ落ちた有効Scene数
- 未確認ラベル数
- Detectorバージョン別集計

Recallでは、`manual` で追加された `kill / death / fight` を見逃しとして扱います。

これは元動画なしでDetector自体を再実行する回帰テストではありません。**提出結果の定量比較ツール**です。

## GitHub Actions

`.github/workflows/validate.yml` でpushごとに以下を確認します。

- JavaScript / MJSの構文
- HTMLから参照しているローカルファイルの存在
- `review.html` が現行 `js/detector.js` を読み込んでいること
- `review.html` がFeedback Package v5を読み込んでいること
- 旧versioned Detectorを読み込んでいないこと

## GitHub Pages

公開URL:

`https://elitemay.github.io/vreview/`

GitHub Pagesでそのまま開ける構成を維持します。

## ファイル構成

```text
/
├─ index.html
├─ review.html
├─ detector-test.html
├─ result.html          # 開発中
├─ history.html         # 開発中
├─ training.html        # 開発中
├─ settings.html        # 開発中
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
├─ .github/workflows/
│  └─ validate.yml
├─ README.md
└─ 作業報告書.md
```

旧Detector / Feedback Package JSはGit履歴に残っているため、本番フォルダから削除しました。

## 未実装 / 改善中

- 未使用クリップでDetector v0.5.0の汎化検証
- ace4-1型の重複Scene処理
- 長い連キルの適切な自動分割
- Death専用検出
- HUD Scale / アスペクト比差への耐性
- 固定ROIの自動キャリブレーション
- 長尺動画のさらなる高速化
- Timeline上でStart / Endを直接ドラッグするハンドル
- Auto 30 / 60fps判定
- ChatGPT採点用高fpsパッケージ
- result JSON読み込み / 表示
- History
- Training
- Settings

未実装のResult / History / Training / Settingsは通常ナビから外し、直接アクセス時も開発中であることを明示します。

## 最終AIレビュー構想

Detector安定後、1クリップ内の全Sceneについて

- Overview: 約5fps
- Detail: Auto / 30fps / 60fps
- Frame ID + timestamp付きコンタクトシート

を生成し、ChatGPT Plusへまとめて渡します。

### AIM

- Crosshair Placement
- Initial Correction
- Flick
- Micro Adjustment
- First Shot Accuracy
- Tracking
- Target Switching

### Movement

- Stopping
- Shoot Timing
- Peek
- Strafe
- Reposition
- Movement Control

## 優先順位

1. 操作性
2. 分かりやすさ
3. 軽量化
4. 保守・修正しやすさ
5. 見た目
