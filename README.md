# VReview

**Current version: v0.4.3**

VALORANTクリップから必要なキルSceneを抽出し、最終的にChatGPT Plusへ高fpsの解析パッケージを渡してAIM / Movementをレビューする個人用Webツールです。

## 現在の開発段階

現在はAI採点より先に、**キルScene自動検出の精度改善**を優先しています。

```text
動画
↓
自動検出
↓
ユーザーがScene確認・ラベル付け
↓
検出改善用ZIP
↓
ChatGPTで誤検出 / 見逃し / 範囲ズレを解析
↓
Detector更新
```

## 崩してはいけない仕様

1. GitHub Pagesで動く静的Web構成
2. OpenAI APIなどの有料APIを必須にしない
3. AI採点は基本 `VReview -> ChatGPT Plus -> VReview` の手動受け渡し
4. APIキー・パスワード・元動画を公開リポジトリへ保存しない
5. 元動画をユーザー操作なしに外部送信しない
6. 自動検出は必ず手動修正可能にする
7. 連続キルは必要に応じて1Sceneへまとめる
8. 採点対象v1はAIM + Movement
9. 採点基準はImmortal / Radiant上位レベル
10. Kill / Death結果だけで採点しない
11. 判断できない採点項目は `null` を許可する
12. AI返却は固定JSON Schema
13. サイト上に現在バージョンを常時表示する
14. README / 作業報告書もバージョン変更時に更新する

# Detector v0.4.3

v0.4.3は、v0.4.2の映像・音声解析結果を使い、**Scene生成後の範囲と信頼性を補正するRefiner**を追加した版です。

`scene-detection-v042.js` で候補を検出した後、`scene-detection-v043.js` で以下を行います。

## 1. 長すぎるSceneを再評価

v0.4.2の実クリップでは、キルScene自体は拾えていても、誤ったKill-confirm候補が連続して**0〜20秒の巨大Scene**になる例がありました。

v0.4.3では長いSceneの中を0.1秒単位で評価し、

- shot-hud
- combat-support
- killfeed-support
- 音声強度
- 中央映像変化

が密な区間を優先して、約6秒前後の実戦中心区間へ絞ります。

Kill-confirm単独の重みは小さくし、UI誤反応がScene全体を引き伸ばしにくいようにしています。

## 2. キル根拠の弱いSceneを除外

最新フィードバックでは、23〜27秒のSceneが `false_positive` と明示されました。

このSceneは

- `shot_evidence_count = 0`
- Kill-confirm候補はある
- しかし同時刻のKillfeed / Ammoによる本人キル根拠が弱い

という特徴でした。

v0.4.3では、射撃証拠が0件のSceneについて、

- 強いローカルKill-confirm
- Shotに近いKillfeed
- 密なCombat証拠

のどれも成立しない場合は候補から除外します。

## 3. Scene前時間を追加

AIでAIM / Movementを見るには、キル瞬間だけでなく

- 敵を見る前
- Peek
- Crosshair Placement
- 初期フリック

が必要です。

最新フィードバックで「4つ目はキルSceneの前がなさすぎる」と確認できたため、v0.4.3では短いSceneのStartを標準感度で**さらに約0.9秒前へ拡張**します。

感度別の追加前時間:

- Low: 約0.65秒
- Standard: 約0.90秒
- High: 約1.10秒

## 4. Refiner診断を保存

`detector-diagnostics.json` に新しく `refiner` を追加します。

```json
{
  "refiner": {
    "dropped": [],
    "adjusted": []
  }
}
```

これにより次回は、

- Detectorが最初に何を出したか
- Refinerが何を削除したか
- Start / Endをどう動かしたか

まで追跡できます。

# 最新実クリップ検証

## 44.167秒クリップ / Detector v0.4.2

ユーザーがSceneラベルを設定した初めてのFeedback Package v3。

### 自動検出

1. `0.00 - 20.00` / `kill`
   - キル自体は含む
   - **長すぎる**
   - 45個のAnchor候補が連結されていた

2. `23.05 - 26.95` / `false_positive`
   - 不要
   - `shot_evidence_count = 0`

3. `29.40 - 32.80` / `kill`
   - 正しくキルSceneを検出

4. `39.07 - 44.167` / `kill`
   - キルScene自体は検出
   - **キル前の時間が不足**

この結果をv0.4.3 Refinerの根拠にしています。

# Detector v0.4.2 基礎検出

v0.4.2では以下を解析します。

- 音声ピーク / トランジェント
- 画面中央Motion
- 右上Killfeed領域
- 右下Ammo HUD領域
- 下中央Kill-confirm領域
- 上中央Round UI領域

解析間隔:

- 35秒以下: 約0.12秒
- 35〜75秒: 約0.16秒
- 75秒超: 約0.22秒

v0.4.3ではこの基礎検出を維持したまま、Scene生成結果を追加補正しています。

# Scene正解ラベル

各Sceneに以下を設定できます。

- `kill` — 欲しいキルScene
- `death` — 欲しいデスScene
- `fight` — 戦闘ではあるがキル/デスではない
- `false_positive` — 不要・誤検出
- `unreviewed` — 未確認

# 検出改善用ZIP v3

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

主な保存内容:

- feedback_label
- detector_reason
- anchor_count
- shot_evidence_count
- events / suppressed
- killConfirmScore
- killfeedScore
- ammoScore
- topCenterScore
- v0.4.3 Refinerのdropped / adjusted

# 最終的なレビュー構想

自動検出が安定した後は各Sceneについて、

- Overview: 約5fps
- Detail: Auto / 30fps / 60fps
- Frame ID + timestamp付きコンタクトシート

を作成し、1クリップ内の全SceneをChatGPT Plusへまとめて渡します。

## AIM

- Crosshair Placement
- Initial Correction
- Flick
- Micro Adjustment
- First Shot Accuracy
- Tracking
- Target Switching

## Movement

- Stopping
- Shoot Timing
- Peek
- Strafe
- Reposition
- Movement Control

# 保存

## ブラウザ内

- 設定: localStorage
- Scene編集情報: localStorage
- 将来のレビュー履歴: IndexedDB予定

## 保存しない

- 元動画
- APIキー
- パスワード

# GitHub Pages

静的HTML / CSS / JavaScriptで構成し、GitHub Pagesから利用します。

# 現在の実装状況

## 実装済み

- 基本UI
- 常時バージョン表示
- MP4 / WebM読み込み
- 動画プレビュー / メタ情報
- Scene手動追加 / 削除 / 時間調整
- Detector v0.4.2基礎検出
- Detector v0.4.3 Refiner
- Confidence表示
- Scene正解ラベル
- 検出改善用ZIP v3
- 確認用16コマ画像
- 採用 / 抑制 / Refiner診断データ

## 改善中 / 未実装

- Detector v0.4.3の実クリップ再検証
- Kill-confirm ROIそのもののさらなる改善
- Death専用検出
- Scene結合 / 分割の本UI
- 自動30 / 60fps判定
- 採点用高fpsコンタクトシート
- ChatGPT採点用パッケージ
- result JSON検証 / 表示
- History / Training

# 優先順位

1. 操作性
2. 分かりやすさ
3. 軽量化
4. 保守・修正しやすさ
5. 見た目
