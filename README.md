# VReview

**Current site version: v0.4.5**  
**Current Detector: v0.4.4**

VALORANTクリップから必要なキルSceneを抽出し、最終的にChatGPT Plusへ高fps解析パッケージを渡してAIM / Movementをレビューする個人用Webツールです。

## 現在の開発段階

現在はAI採点より先に、**キルScene自動検出の汎化性能改善**を優先しています。

```text
動画
↓
自動検出
↓
ユーザーがScene確認・ラベル付け
↓
検出改善用ZIP
↓
複数クリップをまとめて比較
↓
共通失敗だけDetectorへ反映
```

## 崩してはいけない仕様

1. GitHub Pagesで動く静的Web構成
2. OpenAI APIなどの有料APIを必須にしない
3. AI採点は基本 `VReview -> ChatGPT Plus -> VReview` の手動受け渡し
4. APIキー・パスワード・元動画を公開リポジトリへ保存しない
5. 元動画をユーザー操作なしに外部送信しない
6. 自動検出は必ず手動修正可能にする
7. 連続キルは必要に応じて1Sceneへまとめる
8. 検出はPrecisionよりRecallをやや優先する。不要Sceneは削除できるが、見逃しは発見しにくいため
9. 採点対象v1はAIM + Movement
10. 採点基準はImmortal / Radiant上位レベル
11. Kill / Death結果だけで採点しない
12. 判断できない採点項目は `null` を許可する
13. AI返却は固定JSON Schema
14. サイト上に現在バージョンを常時表示する
15. README / 作業報告書もバージョン変更時に更新する
16. PC版New Reviewは動画を固定表示し、Scene確認側だけをスクロールできるレイアウトを維持する

# v0.4.5 UI

Detectorロジックはv0.4.4のまま変更せず、New Reviewの操作性を改善した版です。

PC表示では動画読み込み後、画面を以下の3領域として扱います。

```text
左: ナビゲーション固定
中央: 動画 / Timeline / Scene追加操作を固定
右: 自動検出 / Scene一覧 / Feedback / AI Packageだけ縦スクロール
```

動画読み込み後は大きなアップロード枠を隠し、中央動画がスクロールで画面外へ流れないようにしています。

中央上部に `動画を変更` ボタンを追加し、リロードせず別クリップへ切り替えられます。

980px以下では固定3ペインを解除し、従来通り縦並びでスクロールするレスポンシブ構成に戻します。

# Detector構成

```text
v0.4.2 Base Detector
↓
v0.4.3 Scene Refiner
↓
v0.4.4 Recall Guard
```

## v0.4.2 Base Detector

以下の軽量特徴をブラウザ内で解析します。

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

## v0.4.3 Scene Refiner

実クリップで見つかった以下を改善しました。

- 巨大Sceneを約6秒の実戦密度が高い区間へ絞る
- キル根拠の弱い候補を除外する
- 短いSceneへPre-rollを追加する

Pre-roll:

- Low: 約0.65秒
- Standard: 約0.90秒
- High: 約1.10秒

この版は44秒クリップでは3/3キル・誤検出0・手動修正0まで改善しました。

一方、追加のAce系クリップを複数検証した結果、Refinerが**本物のキルまで削除する / 長い連キルの後半を切る**ことが分かりました。

# Detector v0.4.4

v0.4.4はv0.4.3を置き換えるのではなく、後段に**Recall Guard**を追加した版です。

## 1. Hard Dropを完全破棄しない

v0.4.3で `no-shot-and-no-local-kill-confirmation` として削除された候補の中に、本物のキルが複数存在しました。

そのためv0.4.4では、削除候補にイベント証拠が残っている場合、

- LOW confidence
- `recovered-low-confidence`
- `needsReview`

としてScene一覧へ戻します。

つまり、誤検出が多少増えても見逃しを減らします。

LOW候補は必ずユーザーが確認し、

- `kill`
- `death`
- `fight`
- `false_positive`

を付けます。

## 2. 長い連キルの後半を復元

v0.4.3のFocus Windowは44秒クリップでは非常に有効でしたが、別のAceクリップでは

- 3キル目
- 4キル目

をFocus Window後ろ側から切り落としました。

v0.4.4ではFocus Window後方に、

- 短時間に3回以上のshot-hud
- Audio + Killfeed + Ammoが同時に強いKill-confirm
- 複数のKill-confirmとShot / Killfeedの組み合わせ

が残る場合、元Scene終端側を復元します。

診断データには `recallGuard.expanded` として記録します。

## 3. 削除候補の復元を診断可能にする

`detector-diagnostics.json` に以下を追加します。

```json
{
  "recallGuard": {
    "recovered": [],
    "expanded": []
  }
}
```

- `recovered`: v0.4.3で削除されたがLOW候補として戻したScene
- `expanded`: Focus Window後方を復元したScene

## 4. ほぼ同一の候補のみ統合

Scene同士が72%以上重複する場合だけ重複候補として統合します。

連キルSceneを無理にまとめすぎないよう、軽い重複では統合しません。

# v0.4.3複数クリップ検証で判明した共通問題

## 成功例

### 44.167秒 / 1920x1080

- 3Sceneすべて `kill`
- 誤検出0
- 手動追加0
- 時間手動修正0
- ユーザー評価: `文句なし`

### ace3 / 31.717秒 / 1724x1080

- 2Scene
- 両方 `kill`
- 連キルを正しく連キルSceneとして判断
- ユーザー評価: `完璧`

## 見逃し例

### 4k / 32.234秒 / 1724x1080

- 最終2Sceneは正しく検出
- 2キル目・3キル目を見逃し
- Base Detectorでは候補が存在したがv0.4.3 Refinerが2候補を削除

### ace / 42.634秒 / 1152x720

- 3つの最終キルSceneは検出
- 3キル目を1つ見逃し
- `29.10 - 35.05` のBase候補をv0.4.3が削除していた

### ace2 / 48.017秒 / 1724x1080

- 5Scene表示
- 3キル目・4キル目が抜けた
- Baseの `11.85 - 26.65` をv0.4.3が `14.35 - 21.15` へFocus Window化した結果、後半の強いShot / Kill-confirm群を切っていた

## 誤検出 / 重複例

### ace4-1 / 25.167秒 / 1724x1080

- Scene 1は `false_positive`
- Scene 2は `kill`
- Scene 1終盤のキルがScene 2にも含まれ、前側Sceneが冗長になった

重複Scene問題はまだデータが少ないため、v0.4.4では強い統合条件だけ入れ、今後も検証します。

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

v0.4.4で復元したLOW候補は最終Sceneとして出るため、通常のauto / corrected確認画像にも含まれます。

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
- refiner.dropped / adjusted
- recallGuard.recovered / expanded

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

# 現在の実装状況

## 実装済み

- 基本UI
- 常時バージョン表示
- PC版固定3ペインレイアウト
- 動画固定表示 + 右Sceneペインのみスクロール
- 動画変更ボタン
- MP4 / WebM読み込み
- 動画プレビュー / メタ情報
- Scene手動追加 / 削除 / 時間調整
- Detector v0.4.2 Base
- Detector v0.4.3 Refiner
- Detector v0.4.4 Recall Guard
- Confidence表示
- Scene正解ラベル
- 検出改善用ZIP v3
- 確認用16コマ画像
- 採用 / 抑制 / Refiner / Recall Guard診断

## 改善中 / 未実装

- v0.4.4の複数クリップ再検証
- LOW復元候補のPrecision改善
- 重複Scene処理
- Kill-confirm ROIそのものの精度改善
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
