# VReview

VALORANTのクリップから戦闘シーンを抽出し、ChatGPT PlusでAIM / Movementをレビューするための個人用Webツールです。

## 目的

- VALORANTクリップからCombat Scene候補を自動検出する
- 自動検出結果をユーザーが確認・修正できるようにする
- 実クリップの自動検出結果とユーザー修正後の正解データを提出用ZIPへまとめ、検出ロジックを反復改善する
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
15. 自動検出精度の改善では、自動検出直後のデータとユーザー修正後データを両方保持し比較可能にする

## 基本フロー

```text
動画を選択
  ↓
Combat Scene自動検出
  ↓
ユーザー確認・手動修正
  ↓
必要に応じて検出改善用ZIPを作成
  ↓
実クリップを基準に検出ロジック改善
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
- 近接するSceneは自動結合候補を提示する
- 長すぎるSceneは自動分割候補を提示する
- 誤検出より見逃しを減らす方向で検出感度を設計する
- 現在の初期検出は音声ピーク + 低解像度映像差分を利用する
- 自動検出は完成精度ではなく、実クリップのフィードバックパッケージを使って改善を続ける

## 検出改善用パッケージ

New Review画面で自動検出後、ユーザーがSceneを正しい状態へ修正してから `検出改善用ZIPを作成` を押す。

ZIPには以下を含む。

```text
vreview_feedback_<clip>.zip
├─ README.txt
├─ manifest.json
├─ auto-scenes.json
├─ corrected-scenes.json
├─ detector-diagnostics.json
├─ notes.txt
├─ auto-scenes/
│  ├─ auto_01.jpg
│  └─ ...
└─ corrected-scenes/
   ├─ corrected_01.jpg
   └─ ...
```

### 内容

- `auto-scenes.json`: 自動検出直後のScene
- `corrected-scenes.json`: 削除・追加・時間修正後の正解Scene
- `detector-diagnostics.json`: 音声スコア、映像変化スコア、Combat候補イベント
- `auto-scenes/*.jpg`: 自動検出区間前後を含む16コマ確認画像
- `corrected-scenes/*.jpg`: 修正後区間前後を含む16コマ確認画像
- `notes.txt`: 誤検出傾向などのユーザーメモ

元動画そのものはZIPへ含めない。

## コンタクトシート

### 採点用（今後実装）

- Overview: 約5fpsで流れ確認用
- Detail: Auto / 30fps / 60fps
- 30fps: 5列 x 4行 = 20フレーム / シートを基本
- 60fps: 4列 x 4行 = 16フレーム / シートを基本
- 各フレームにFrame IDとタイムスタンプを焼き込む

### 検出改善用（実装済み）

- 1 Sceneにつき4列 x 4行の16コマ
- Scene開始約0.65秒前〜終了約0.65秒後を均等サンプリング
- PRE / IN / POST と時刻を画像へ表示

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
│  ├─ feedback-package.js
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

## 外部依存

- 検出改善用ZIP生成に JSZip 3.10.1 をCDNから読み込む
- APIキーは不要
- CDN読み込みに失敗した場合はZIP生成のみ利用できない

## GitHub Pages

静的HTML / CSS / JavaScriptで構成し、GitHub PagesからURLを開くだけで利用できる状態を目指す。

ブラウザのセキュリティ制約によりローカル動画の直接処理・フレーム抽出方法に制約が出る場合は、GitHub Pages互換を維持できる代替手段を優先する。

## v1 完成条件

- MP4 / WebM読み込み
- 動画情報取得
- Combat Scene自動検出
- Scene手動修正
- 検出改善用フィードバックZIP生成
- Detail 30 / 60fps切り替え
- 採点用コンタクトシート生成
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

## 現在の実装状況

### 実装済み

- 基本UI
- MP4 / WebM読み込み
- 動画プレビュー / メタ情報表示
- Scene手動追加・削除・開始終了調整
- 初期Combat Scene自動検出
- 自動検出Confidence表示
- 検出改善用ZIP生成
- 自動検出 / 修正後Sceneの確認用コンタクトシート
- 検出診断データ出力

### 未実装 / 改善中

- Combat Scene自動検出の実用精度への改善
- Scene結合 / 分割の本UI
- 自動30 / 60fps判定
- 採点用高fpsフレーム抽出
- 採点用Overview / Detailコンタクトシート
- ChatGPT採点用ZIP
- AI結果表示 / 履歴 / Training
