# VReview

**Current version: v0.4.2**

VALORANTクリップから必要なキルSceneを抽出し、最終的にChatGPT Plusへ高fpsの解析パッケージを渡してAIM / Movementをレビューする個人用Webツールです。

## 現在の開発段階

いまはAI採点より先に、**キルScene自動検出の精度改善**を優先しています。

実クリップで

```text
自動検出
↓
ユーザーが確認
↓
Sceneへ正解ラベルを付ける
↓
検出改善用ZIPを作成
↓
ChatGPTで失敗原因を解析
↓
Detectorを更新
```

という反復方式で改善します。

## 崩してはいけない仕様

1. GitHub Pagesで利用できる静的Web構成
2. OpenAI APIなどの有料APIを必須にしない
3. AI採点は基本 `VReview -> ChatGPT Plus -> VReview` の手動受け渡し
4. APIキー・パスワード・元動画を公開リポジトリへ保存しない
5. 元動画をユーザー操作なしに外部送信しない
6. 自動検出は必ず手動修正可能にする
7. 1クリップ内の連続キルは必要に応じて1Sceneへまとめる
8. 採点対象v1はAIM + Movement
9. 採点基準はImmortal / Radiant上位レベル
10. Kill / Deathの結果だけで採点しない
11. 判断できない採点項目は `null` を許可する
12. AI返却は固定JSON Schema
13. サイト上に現在バージョンを常時表示する
14. READMEと作業報告もバージョン変更時に更新する

## Detector v0.4.2

### 方針変更

v0.4.1までは「戦闘らしい場面」を広めに拾っていたため、実際にはキルしていない撃ち合いやリロード・UI変化もSceneになっていました。

v0.4.2では、**キル確認をScene生成の中心証拠に変更**しています。

### 利用する特徴

- 音声ピーク / トランジェント
- 画面中央の変化
- 右上キルフィード領域
- 右下弾数HUD領域
- **画面下中央のキル確認UI領域**
- 上中央のラウンドUI変化

### Scene生成

標準感度では主に、

- 下中央のキル確認UIが強く変化した
- または、キルフィード変化の近くに射撃証拠がある

場合をキルAnchorとしてSceneを作ります。

単なる

- アビリティ音
- リロード
- スコアボード
- ラウンド終了/購入フェーズ
- Killfeedだけの変化
- 撃ち合っただけ

はScene化しにくくします。

高感度のみ、キル確認UIが取れなかった場合の保険として密な射撃群も候補にできます。

### 解析間隔

- 35秒以下: 約0.12秒
- 35〜75秒: 約0.16秒
- 75秒超: 約0.22秒

## 実クリップで分かったこと

### クリップA: 23.067秒

旧版ではPhoenixアビリティを誤検出していました。

v0.4.1ではこの誤検出が消え、約14秒以降の連続キルを1Sceneへまとめることに成功しました。

ただしScene終端がラウンド終了側まで伸びる傾向が残っています。

### クリップB: 28.317秒

v0.4.1では4Scene検出。

ユーザーフィードバックでは、

- 1つ目のキル: 検出
- 2つ目のキル: ぎりぎり検出
- それ以外: 不要な切り抜き

という結果でした。

後半では射撃・HUD変化を「Combat」として拾っていましたが、欲しいキルSceneではありませんでした。

この結果を受け、v0.4.2ではCombat検出からKill-confirm中心へ変更しました。

## Scene正解ラベル

v0.4.2から各Sceneに以下を付けられます。

- `kill` — 欲しいキルScene
- `death` — 欲しいデスScene
- `fight` — 戦闘ではあるがキル/デスではない
- `false_positive` — 不要・誤検出
- `unreviewed` — 未確認

次回からメモ文章だけではなく、このラベルを機械的に比較してDetectorを改善します。

## 検出改善用ZIP v3

```text
vreview_feedback_<clip>.zip
├─ README.txt
├─ manifest.json
├─ auto-scenes.json
├─ corrected-scenes.json
├─ detector-diagnostics.json
├─ notes.txt
├─ auto-scenes/
│  └─ *.jpg
└─ corrected-scenes/
   └─ *.jpg
```

`corrected-scenes.json` には以下も保存します。

- `feedback_label`
- `detector_reason`
- `anchor_count`
- `shot_evidence_count`

`detector-diagnostics.json` には、

- 採用イベント
- 抑制イベント
- killConfirmScore
- killfeedScore
- ammoScore
- topCenterScore

などを保存します。

## 最終的なレビュー構想

自動検出が安定した後は、各Sceneについて

- Overview: 約5fps
- Detail: Auto / 30fps / 60fps
- Frame ID + timestamp付きコンタクトシート

を生成し、1クリップ内の全SceneをChatGPT Plusへまとめて渡します。

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

## 保存

### ブラウザ内

- 設定: localStorage
- Scene編集情報: localStorage
- 将来のレビュー履歴: IndexedDB予定

### 保存しない

- 元動画
- APIキー
- パスワード

## GitHub Pages

静的HTML / CSS / JavaScriptで構成し、GitHub Pagesから利用します。

## 現在の実装状況

### 実装済み

- 基本UI
- 常時バージョン表示
- MP4 / WebM読み込み
- 動画プレビュー / メタ情報
- Scene手動追加 / 削除 / 時間調整
- キルScene Detector v0.4.2
- Confidence表示
- Scene正解ラベル
- 検出改善用ZIP v3
- 確認用16コマ画像
- 採用 / 抑制診断データ

### 改善中 / 未実装

- Detector v0.4.2の実クリップ検証
- Death専用検出
- Scene結合 / 分割の本UI
- 自動30 / 60fps判定
- 採点用高fpsコンタクトシート
- ChatGPT採点用パッケージ
- result JSON検証 / 表示
- History / Training

## 優先順位

1. 操作性
2. 分かりやすさ
3. 軽量化
4. 保守・修正しやすさ
5. 見た目
