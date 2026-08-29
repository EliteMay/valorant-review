# VReview

**Current site version: v0.4.6**  
**Current Detector: v0.4.5**  
**Current Detector Feedback Package: v4**

VALORANTクリップから必要なキルSceneを抽出し、最終的にChatGPT Plusへ高fps解析パッケージを渡してAIM / Movementをレビューする個人用Webツールです。

## 現在の開発段階

現在はAI採点より先に、**キルScene自動検出の汎化性能改善**を優先しています。

```text
動画
↓
自動検出
↓
本命Scene / 要確認候補へ分類
↓
ユーザーが確認・ラベル付け
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
8. PrecisionよりRecallをやや優先する。ただし弱候補は本命Sceneと分離して操作性を落とさない
9. 採点対象v1はAIM + Movement
10. 採点基準はImmortal / Radiant上位レベル
11. Kill / Death結果だけで採点しない
12. 判断できない採点項目は `null` を許可する
13. AI返却は固定JSON Schema
14. サイト上に現在バージョンを常時表示する
15. README / 作業報告書もバージョン変更時に更新する
16. PC版New Reviewは左ナビ固定・中央動画固定・右Sceneペインのみスクロールを維持する

## New Review UI

PCでは動画読み込み後、以下の3領域で使います。

```text
左: ナビゲーション固定
中央: 動画 / Timeline / Scene追加操作を固定
右: 自動検出 / Scene一覧 / Feedback / AI Packageのみ縦スクロール
```

動画読み込み後は大きなアップロード枠を隠し、中央上部の `動画を変更` から別クリップへ切り替えられます。

980px以下では固定3ペインを解除し、通常の縦スクロールへ戻します。

## Detector構成

```text
v0.4.2 Base Detector
↓
v0.4.3 Scene Refiner
↓
v0.4.4 Recall Guard
↓
v0.4.5 Candidate Classifier
```

### v0.4.2 Base Detector

ブラウザ内で以下を解析します。

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

### v0.4.3 Scene Refiner

- 巨大Sceneを実戦密度の高い区間へ絞る
- キル根拠の弱い候補を除外する
- 短いSceneへPre-rollを追加する

### v0.4.4 Recall Guard

v0.4.3で本物キルまで消える例が複数クリップで確認されたため、

- Hard Dropされた候補をLOWとして復元
- Focus Window後ろ側に強い戦闘証拠が続く場合はScene終端を復元

するRecall優先レイヤーです。

### v0.4.5 Candidate Classifier

v0.4.4再検証5本では、**復元LOW候補5件中1件だけが本物キル、4件が誤検出**でした。

ただし1件は実際に見逃し防止へ役立ったため、LOW候補を再び完全削除するのではなく、

- `primary` — 本命Scene
- `weak` — 要確認候補

へ分類します。

要確認候補は右Scene一覧の折りたたみ領域へ分離し、通常利用時の邪魔を減らします。

#### 復元候補を本命へ戻す条件

`recovered-low-confidence` の候補でも、以下のどれかがある場合は本命扱いします。

- Shot証拠あり
- Combat Supportが2件以上
- Killfeedがあり、Audioと中央Motionも一定以上

それ以外は見逃し保険として `weak` に残します。

#### Shot証拠0の通常候補

v0.4.4再検証では、通常候補でも `shot_evidence_count = 0` のSceneが複数誤検出でした。

そのためv0.4.5では削除せず `weak` へ分離します。

`detector-diagnostics.json` には `candidateClassifier.primary / weak` を保存します。

## Detector v0.4.5 既知5クリップ再検証

同じ5クリップをDetector v0.4.5で再実行した結果:

- primary: **13件**
- weak: **7件**
- primary内 `kill`: **11件**
- primary内 `fight`: **1件**
- primary内 `false_positive`: **1件**

`fight`もレビュー対象として有効と数える場合、primaryの有効Scene率は **12 / 13 = 約92.3%**。

ユーザーメモ:

- ace: `完璧`
- 4k: `完璧`
- ace2: `いいかんじ`
- ace4-1: `最初のイラン`

ace4-1型の重複Sceneだけは継続して残っています。

weak 7件は今回ラベルが `unreviewed` のままだったため正式なPrecision計算には入れていませんが、確認画像上は明確な本人キルSceneには見えませんでした。

ただしこの5本はClassifier設計に使用した既知データでもあるため、**Detector v0.4.5はまだ完成扱いにしません**。

次は未使用クリップで汎化性能を確認します。

## v0.4.4再検証5本の結果

| クリップ | 結果 |
|---|---|
| ace4-1 | 1 false positive / 1 kill。重複問題は継続 |
| ace2 | 全キルを切り抜けた。Tail Recovery成功。不要Scene増加あり |
| ace | 復元LOW 1件が本物キル、別LOW 1件は誤検出 |
| 4k | 全キルを切り抜けた。復元LOW 2件は両方誤検出 |
| ace3 | 2 kill + 復元LOW 1件は誤検出。Tail Recoveryあり |

### 集計

- 復元LOW候補: **5件**
- 本物キル: **1件**
- 誤検出: **4件**
- 復元LOW候補Precision: **20%**

一方、ace / ace2ではRecall Guardが実際に見逃し改善へ役立ったため、Recall Guard自体は維持します。

## まだ残っている問題

- ace4-1型の重複 / 連キル境界
- fightだけのSceneをキルSceneと誤認するケース
- 長い連キルをどこで分割するか
- Death専用検出
- HUDスケール差
- Firefox / Chrome差
- 長尺動画性能

## Scene正解ラベル

各Sceneに以下を設定できます。

- `kill` — 欲しいキルScene
- `death` — 欲しいデスScene
- `fight` — 戦闘ではあるがキル/デスではない
- `false_positive` — 不要・誤検出
- `unreviewed` — 未確認

## 検出改善用ZIP v4

```text
vreview_feedback_<clip>.zip
├─ README.txt
├─ manifest.json
├─ auto-scenes.json
├─ corrected-scenes.json
├─ detector-diagnostics.json
├─ notes.txt
├─ auto-scenes/
└─ corrected-scenes/
```

Scene JSONには以下を保存します。

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

manifestには `counts.review_tiers` を追加し、primary / weak / manualの件数を直接確認できます。

確認用16コマ画像のラベルにも `PRIMARY / WEAK / MANUAL` を表示します。

診断には以下を含みます。

- events / suppressed
- refiner.dropped / adjusted
- recallGuard.recovered / expanded
- candidateClassifier.primary / weak

## 最終的なAIレビュー構想

Detectorが安定した後、各Sceneについて

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

ブラウザ内:

- 設定: localStorage
- Scene編集情報: localStorage
- 将来のレビュー履歴: IndexedDB予定

保存しないもの:

- 元動画
- APIキー
- パスワード

## 現在の実装状況

### 実装済み

- 基本UI
- 常時バージョン表示
- PC版固定3ペインレイアウト
- 動画固定表示 + 右Sceneペインのみスクロール
- 動画変更ボタン
- MP4 / WebM読み込み
- Scene手動追加 / 削除 / 時間調整
- Detector v0.4.2 Base
- Detector v0.4.3 Refiner
- Detector v0.4.4 Recall Guard
- Detector v0.4.5 Candidate Classifier
- 本命Scene / 要確認候補の分離表示
- Confidence表示
- Scene正解ラベル
- 検出改善用ZIP v4
- 確認用16コマ画像

### 改善中 / 未実装

- 未使用クリップでのv0.4.5汎化検証
- 重複Scene処理
- 長い連キルの自動分割
- Death専用検出
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
