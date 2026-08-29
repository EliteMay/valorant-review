# VReview

**Current version: v0.4.1**

VALORANTのクリップからCombat Sceneを抽出し、ChatGPT PlusでAIM / Movementをレビューするための個人用Webツールです。

## 目的

- VALORANTクリップからCombat Scene候補を自動検出する
- 自動検出結果をユーザーが確認・修正できるようにする
- 自動検出結果とユーザー修正後の正解データを提出ZIPへまとめ、実クリップを使って検出器を反復改善する
- 将来的に戦闘区間を30〜60fps相当でフレーム化し、ChatGPTへ解析パッケージとして渡す
- ChatGPTから固定JSONで返されたAIM / Movement評価をVReviewへ読み込み、弱点と優先練習を表示する

## 崩してはいけない仕様

1. GitHub Pagesで利用できる静的構成を優先する
2. OpenAI APIなどの有料APIを必須にしない
3. APIキー・パスワードなどの秘密情報を公開リポジトリへ保存しない
4. AI解析は基本的に `VReview -> ChatGPT Plus -> VReview` の手動受け渡し方式とする
5. Combat Sceneは自動検出を基本とし、手動で追加・削除・開始終了調整・結合・分割できるようにする
6. 1クリップ内の全Combat Sceneをまとめて扱えるようにする
7. 採点対象v1はAIM + Movementとする
8. 採点基準はImmortal / Radiant上位レベルを基準とする
9. Kill / Deathの結果だけで採点しない
10. 映像から判断できない項目は無理に採点せず `null` を許可する
11. 元動画をユーザー操作なしに外部へアップロードしない
12. ユーザーデータや動画をGitHubへ自動保存しない
13. 検出改善では「自動検出直後」と「ユーザー修正後」の両データを保持する
14. サイト上へ現在のバージョンを常時表示し、変更時はREADME・作業報告書も更新する

## 基本フロー

```text
動画を選択
  ↓
Combat Scene自動検出
  ↓
ユーザー確認・手動修正
  ↓
検出改善用ZIPを作成
  ↓
実クリップを基準にDetectorを改善
  ↓
30 / 60fps採点用フレーム生成（今後）
  ↓
ChatGPT Plusへ解析パッケージを渡す（今後）
  ↓
固定JSONをVReviewへ読み込む（今後）
```

## Combat Scene Detector

### v0.4.1

2回目の実クリップ検証をもとに更新。

主な変更:

- 全画面Motion
- 中央領域Motion
- 右上Killfeed領域Motion
- **弾数HUD領域Motion**
- 上部中央のラウンド遷移UI Motion
- 音声RMS / Peak / Rise / Crest

を別々に計算してCombat判定へ利用する。

#### v0.4.1で改善した問題

1. Phoenixアビリティの誤検出
   - v0.4.0では約9.4〜13.35秒をCombatとして誤検出
   - 音声・中央映像だけでなく弾数HUD変化を追加し、銃撃らしさを補強
   - 音声だけ大きい、または疎な映像イベントだけ続くSceneは作りにくくした

2. 戦闘終了後UIの誤検出
   - v0.4.0では約18.55秒〜動画終了を別Sceneとして誤検出
   - Killfeed領域だけ変化してもCombat Sceneを作らない
   - Killfeedは音声/中央映像/弾数HUDなどのローカルCombat証拠がある場合のみ強い証拠として使う
   - ラウンド遷移時の上部中央UI変化も補助的に検出して抑制する

3. 解析間隔
   - 35秒以下: 0.16秒
   - 35〜75秒: 0.20秒
   - 75秒超: 0.25秒

### Scene範囲

- 最初のCombatイベント約0.7秒前から開始
- 最後のCombatイベント約0.8秒後まで
- 近いイベントは同一Sceneへまとめる
- 連続キルは無理に分割せず、1つのCombat Sceneとして扱ってよい

## 検出改善用ZIP

New Review画面で自動検出後、誤検出を削除・見逃しを追加・範囲を修正してから作成する。

```text
vreview_feedback_<clip>.zip
├─ README.txt
├─ manifest.json
├─ auto-scenes.json
├─ corrected-scenes.json
├─ detector-diagnostics.json
├─ notes.txt
├─ auto-scenes/
│  └─ auto_XX.jpg
└─ corrected-scenes/
   └─ corrected_XX.jpg
```

`detector-diagnostics.json` には以下を保存する。

- audio score / RMS / Peak / Rise / Crest
- overall motion
- center motion
- killfeed motion / excess / ratio / score
- ammo motion / excess / ratio / score
- top-center motion / score
- 採用したCombat event
- **抑制した候補eventと抑制理由**

これにより「なぜ拾ったか」だけでなく「なぜ拾わなかったか」も次回の改善材料にできる。

元動画そのものはZIPへ含めない。

## v1 採点対象

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

該当しない項目は0点ではなく `null` とする。

## 採点用コンタクトシート（今後実装）

- Overview: 約5fps
- Detail: Auto / 30fps / 60fps
- 30fps: 5列 x 4行 = 20フレーム/シートを基本
- 60fps: 4列 x 4行 = 16フレーム/シートを基本
- 各フレームにFrame IDとタイムスタンプを表示

## ページ構成

- Dashboard
- New Review
- Import / Result
- History
- Training
- Settings

PCでの動画解析を主用途とし、スマホは結果閲覧を中心にする。

## 保存方法

### ブラウザ保存

- 設定: localStorage
- レビュー結果・履歴: IndexedDBを優先予定
- Scene調整情報: ブラウザ内保存

### 保存しないもの

- 元動画
- APIキー
- パスワード
- 個人データをGitHubへ自動保存する処理

## ファイル構成

```text
/
├─ index.html
├─ review.html
├─ result.html
├─ history.html
├─ training.html
├─ settings.html
├─ css/
│  ├─ base.css
│  ├─ layout.css
│  └─ components.css
├─ js/
│  ├─ app.js
│  ├─ video.js
│  ├─ ui.js
│  ├─ storage.js
│  ├─ scene-detection-v040.js
│  ├─ scene-detection-v041.js
│  └─ feedback-package-v2.js
├─ README.md
└─ 作業報告書.md
```

旧Detectorファイルは比較・ロールバック用として当面残す。

## 外部依存

検出改善用ZIP生成は外部ZIPライブラリを使用せず、VReview内蔵のStore方式ZIP生成で完結する。

- APIキー不要
- ZIP生成にCDN不要
- 元動画の外部送信なし

## GitHub Pages

静的HTML / CSS / JavaScriptだけで利用できる構成を維持する。

## 現在の実装状況

### 実装済み

- 基本UI
- サイト上のバージョン表示
- MP4 / WebM読み込み
- 動画プレビュー / メタ情報表示
- Scene手動追加・削除・開始終了調整
- Combat Scene Detector v0.4.1
- Confidence表示
- 検出改善用ZIP生成
- 自動検出 / 修正後Sceneの16コマ確認画像
- 詳細な検出診断データ出力

### 未実装 / 改善中

- Combat Scene Detectorの複数クリップ検証
- Scene結合 / 分割の本UI
- 自動30 / 60fps判定
- 採点用高fpsフレーム抽出
- 採点用Overview / Detailコンタクトシート
- ChatGPT採点用ZIP
- prompt自動生成
- result JSON検証 / 表示
- History / Training / Settings本実装

## v1 完成条件

- 動画読み込み
- Combat Scene自動検出が実用精度に到達
- Scene手動修正
- 30 / 60fpsフレーム抽出
- 採点用コンタクトシート生成
- ChatGPT解析パッケージ生成
- 固定JSON結果読み込み
- AIM / Movement結果画面
- タイムスタンプジャンプ
- ローカル保存
- README / 作業報告書更新
- GitHub Pagesで主要機能が利用可能

## 優先順位

1. 操作性
2. 分かりやすさ
3. 軽量化
4. 保守・修正しやすさ
5. 見た目
