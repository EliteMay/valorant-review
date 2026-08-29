# VReview

VALORANTのクリップから戦闘シーンを抽出し、ChatGPT PlusでAIM / Movementをレビューするための個人用Webツールです。

## 目的

- VALORANTクリップからCombat Scene候補を自動検出する
- 自動検出結果をユーザーが確認・修正できるようにする
- 戦闘区間を30〜60fps相当でフレーム化し、ChatGPTが時系列を読み取りやすいコンタクトシートを生成する
- 1クリップ内の全Sceneを1つの解析パッケージへまとめる
- ChatGPT Plusへ手動投入し、固定JSON形式で返された採点結果をサイトへ読み込む
- AIM / Movementの弱点、良かった点、優先練習項目を見やすく表示する

## 崩してはいけない仕様

1. GitHub Pagesで利用できる静的構成を優先する
2. OpenAI APIなどの有料APIを必須にしない
3. APIキー・パスワードなどの秘密情報を公開リポジトリへ保存しない
4. AI解析は基本的に `VReview -> ChatGPT Plus -> VReview` の手動受け渡し方式とする
5. Combat Sceneは自動検出を基本とし、必ず手動で追加・削除・開始終了調整・結合・分割できるようにする
6. 1クリップ内の全Combat Sceneをまとめて解析できるようにする
7. 詳細フレームは標準30fps、必要な高速戦闘では60fpsを使用する
8. 採点対象v1はAIM + Movementとする
9. 採点基準はImmortal / Radiant上位レベルを基準とする
10. Kill / Deathの結果だけで採点しない
11. 映像から判断できない項目は無理に採点せず `null` を許可する
12. AI返却データは固定JSON Schemaに従う
13. 元動画をユーザー操作なしに外部へアップロードしない
14. ユーザーデータや動画をGitHubリポジトリへ自動保存しない

## 基本フロー

```text
動画を選択
  ↓
Combat Scene自動検出
  ↓
ユーザー確認・手動修正
  ↓
各Sceneを30 / 60fpsで詳細フレーム化
  ↓
Overview + Detailコンタクトシート生成
  ↓
ChatGPT解析パッケージ生成
  ↓
ChatGPT Plusへ手動投入
  ↓
固定JSONを受け取る
  ↓
VReviewへ読み込み
  ↓
AIM / Movement採点・Scene別分析・練習優先度表示
```

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

## Combat Scene仕様

- 自動検出後にユーザー確認を必須とする
- Scene開始目安: 最初の戦闘イベント約0.7秒前
- Scene終了目安: 最後の戦闘イベント約0.8秒後
- 近い戦闘候補は約1.5秒以内なら同一Sceneとしてまとめる
- 長すぎるSceneは約6秒を目安に分割する
- 誤検出より見逃しを減らす方向で検出感度を設計する
- 検出感度は「低い / 標準 / 高い」から選択できる
- 自動検出SceneにはHIGH / MEDIUM / LOWのConfidenceを表示する
- 自動検出後も開始・終了を0.1秒単位で手動修正できる
- 漏れたSceneは手動追加できる

### 現在の自動検出方式

v1初期実装では、外部APIやAIを使わずブラウザ内だけで以下を組み合わせて候補を検出します。

1. Web Audio APIで約0.05秒単位の音量・急激な立ち上がり・ピークを計測
2. 動画を約0.25〜0.30秒間隔で低解像度Canvasへ描画
3. 前フレームとの差分と画面中央付近の差分から視点・映像変化を計測
4. 音声スコアと映像スコアを合成して戦闘イベント候補を作成
5. 近いイベントをまとめてCombat Scene化

これはVALORANT専用の学習済みモデルではなくヒューリスティック検出です。銃声・被弾・大きな視点移動が多い場面を拾いやすい一方、スキル音・大きなカメラ移動などを誤検出する可能性があります。そのため自動結果は確定扱いせず、必ずユーザーが確認・修正する設計です。

### コンタクトシート

- Overview: 約5fpsで流れ確認用
- Detail: Auto / 30fps / 60fps
- 30fps: 5列 x 4行 = 20フレーム / シートを基本
- 60fps: 4列 x 4行 = 16フレーム / シートを基本
- 各フレームにFrame IDとタイムスタンプを焼き込む

## ページ構成

- Dashboard
- New Review
- Import Result
- Review Result
- History
- Training
- Settings

PCでの動画解析を主用途とし、スマホは結果閲覧を中心にする。

## 保存方法

### ブラウザ保存

- 設定: localStorage
- レビュー結果・履歴: IndexedDBを優先
- Scene調整情報: ブラウザ内へ自動保存

### 保存しないもの

- 元動画そのもの
- APIキー
- 個人データを含む解析パッケージ

元動画を使った作業再開時は、ユーザーに同じ動画を再選択してもらう。

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
│  ├─ scene-detection.js
│  ├─ contact-sheet.js
│  ├─ package-builder.js
│  ├─ result-parser.js
│  ├─ storage.js
│  └─ ui.js
├─ data/
│  ├─ score-schema.json
│  └─ prompt-template.json
├─ README.md
└─ 作業報告書.md
```

必要に応じて実装段階で整理するが、巨大な単一HTML / JSへ集約しない。

## GitHub Pages

静的HTML / CSS / JavaScriptで構成し、GitHub PagesからURLを開くだけで利用できる状態を目指す。

ブラウザのセキュリティ制約によりローカル動画の直接処理・フレーム抽出方法に制約が出る場合は、GitHub Pages互換を維持できる代替手段を優先する。

## v1 完成条件

- MP4 / WebM読み込み
- 動画情報取得
- Combat Scene自動検出
- Scene手動修正
- Detail 30 / 60fps切り替え
- コンタクトシート生成
- ChatGPT解析パッケージ生成
- prompt自動生成
- result JSON読み込み / 貼り付け
- AIM / Movement採点表示
- Scene別レビュー表示
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

## 現在の実装状況 / 既知の問題

### 実装済み

- MP4 / WebM読み込み
- 動画プレビュー・メタ情報表示
- Combat Sceneヒューリスティック自動検出
- 自動検出の感度切り替え
- 自動SceneのConfidence表示
- Scene手動追加・削除・開始終了調整
- Sceneタイムライン表示

### 未実装

- Scene結合 / 分割の手動操作
- 自動30 / 60fps判定
- 高fpsフレーム抽出
- Overview / Detailコンタクトシート生成
- ChatGPT解析パッケージZIP生成
- prompt自動生成
- AI結果JSONのSchema検証・本表示
- 履歴・Training集計の本実装

### 未確認

- GitHub Pages上での各ブラウザ実動作
- Firefox / ChromeでのWeb Audio動画デコード差
- 実際のVALORANTクリップに対する検出精度
- 長いクリップでの解析速度・メモリ使用量
