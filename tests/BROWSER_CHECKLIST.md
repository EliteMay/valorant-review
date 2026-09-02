# VReview Browser / Visual Validation Checklist

`web-project-guide` v1.13.0 の `STATIC + MEDIA + AI-HANDOFF + TOOL` と Visual Quality Baseline用の手動確認項目です。

このファイルが存在するだけでは Browser / Visual Validated 扱いにしません。実施結果は `作業報告書.md` へ記録します。

## 対象

- Firefox 最新安定版
- Chromium系 最新安定版
- GitHub Pages: `https://elitemay.github.io/valorant-review/`

## Visual Review — First View

- [ ] Dashboardが巨大Hero + 巨大Stat Card群に戻っていない
- [ ] First Viewで `VReview → クリップをレビュー` のPrimary Actionが分かる
- [ ] 直近Detector値はcompactなMetric Stripとして見える
- [ ] Review Flow / Runtime / Troubleshootingの重要度差が分かる
- [ ] Red AccentがPrimary Action / Selected等へ限定されている
- [ ] Gradient / Glow / Glass /大量Shadowへ依存していない

## New Review — Workbench Hierarchy

- [ ] 動画読込後、Gameplay Videoが最大Visualとして最初に目に入る
- [ ] Timelineが動画の直下にある
- [ ] 右側がContinuous Inspectorとして見える
- [ ] Detector / Scene / FeedbackがDividerでGroupingされる
- [ ] Selected Sceneが明確に分かる
- [ ] Scene 1件の高さが過大でない
- [ ] Feedback QueueがScene Reviewより過剰に強く見えない
- [ ] Development / AI未実装情報がPrimary Workflowを占有しない

## New Review — Layout / Responsive

- [ ] 1920x1080 / 100%で左Navigation固定、中央動画固定、右Inspectorだけ縦Scroll
- [ ] 右InspectorをScrollしてもGameplay / Timelineが画面内に残る
- [ ] Feedback Queueが右Inspector内で操作可能
- [ ] 125% Zoomで主要Button / Timeline / Queue操作が隠れない
- [ ] 150% Zoomで主要Button / Timeline / Queue操作が隠れない
- [ ] 低い縦解像度でGameplay / Timeline / Scene / Queue操作が可能
- [ ] 980 CSS px以下で通常縦Scrollへ移行
- [ ] ページ全体に不要な横Scrollが出ない

## Video / Detector

- [ ] 実MP4を読み込める
- [ ] 実WebMを読み込める（Codec対応環境）
- [ ] 動画変更を繰り返してもPreviewが壊れない
- [ ] Detector開始→Progress→完了
- [ ] Detector開始→Cancel→手動Scene操作を継続可能
- [ ] Detector失敗時にError IDと手動復帰導線がある

## Scene Editing

- [ ] Scene追加
- [ ] Start / End入力
- [ ] 不正なStart / Endで既存Sceneが壊れない
- [ ] TimelineクリックでSeek
- [ ] Scene選択で動画位置へ移動
- [ ] Delete後「元に戻す」で復元
- [ ] weak折りたたみ状態維持
- [ ] Space / I / O / ← / → / Shift+←→ / Delete が機能

## Draft / Recovery

- [ ] Scene編集→再読込→同じ動画→Draft復元
- [ ] 新規開始→旧DraftがBackupへ残る
- [ ] Backup復元が可能
- [ ] localStorage失敗を成功扱いしない
- [ ] 同一動画を2タブで編集した時に競合警告

## Feedback Queue — IndexedDB

### Save / Update

- [ ] Clip Aを検出・修正後「このクリップの改善データを保存」でQueue 1件になる
- [ ] 保存時にZIPダウンロードが発生しない
- [ ] ページ再読込後もClip AがQueueに残る
- [ ] 同じClip Aを修正して再保存してもQueueは1件のまま更新される
- [ ] Clip Bを保存するとQueue 2件になる
- [ ] Clip Cを保存するとQueue 3件になる
- [ ] 件数と合計容量表示が更新される
- [ ] Queue Recordへ元動画Blob / File bodyが保存されていない
- [ ] Package JSONと生成したFull / ROI画像は保存されている
- [ ] Scene Draftは従来通りlocalStorageで、Feedback BlobをlocalStorageへ保存していない

### Delete / Failure

- [ ] 個別削除で対象だけ消える
- [ ] 「保存済みをすべて削除」は確認後に全件削除する
- [ ] Cancelした全削除ではデータが残る
- [ ] IndexedDB open / transaction失敗を成功表示しない
- [ ] IndexedDB保存失敗でもScene Draftが残る
- [ ] Quota不足で既存Queueを自動削除しない
- [ ] 20件上限を超える追加を拒否し、既存Queueを保持する
- [ ] App側350MB上限を超える追加を拒否し、既存Queueを保持する

## Feedback Batch ZIP

- [ ] Queueに3件以上ある状態で「保存済みをまとめてZIP作成」が有効
- [ ] 1回の操作で1つのBatch ZIPだけダウンロードされる
- [ ] ZIP名が `vreview_feedback_batch_*.zip`
- [ ] Rootに `batch-manifest.json` がある
- [ ] Rootに `README.txt` がある
- [ ] `batch-manifest.json` のschemaが `vreview-detector-feedback-batch`
- [ ] `clip_count` と実際のClip数が一致
- [ ] `clips/01_*`, `clips/02_*` ... に各Clip内容が分離される
- [ ] 各Clip Folderに `manifest.json` / `corrected-scenes.json` がある
- [ ] 各Clip FolderにFull / ROI画像がある
- [ ] 元動画そのものがBatch ZIPに入っていない
- [ ] ZIP生成成功後もQueueは残っている
- [ ] ZIP生成失敗時もQueueは残っている

## Detector Test

- [ ] v4単体Feedback ZIPをImport可能
- [ ] v5単体Feedback ZIPをImport可能
- [ ] 従来どおり複数の単体ZIPをまとめてImport可能
- [ ] v0.8.0 Batch ZIPを1個Importすると中の複数Clipが表へ出る
- [ ] Batch ZIP内各ClipのPrecision / Recallが個別計算される
- [ ] Batchの`clip_count`不一致を拒否
- [ ] Batch内folder重複を拒否
- [ ] 不正Pathを拒否
- [ ] 未対応Batch Versionを拒否
- [ ] 壊れたJSONを拒否
- [ ] 未確認Sceneがある場合、暫定値と表示
- [ ] Schema / Import失敗がDiagnosticsへ記録される

## Development Diagnostics

- [ ] Dashboard / New Review / Detector Test → Diagnosticsへ移動可能
- [ ] App Version / Build / Guide / Route / Session IDが表示される
- [ ] 動画選択→Detector→Feedback Save→Batch ExportがBreadcrumbへ記録される
- [ ] Feedback Queue ErrorがError ID付きで記録される
- [ ] Runtime Error / Promise rejectionがError一覧へ記録される
- [ ] `diagnostics.json`を書き出せる
- [ ] 診断JSONへ動画本体・Scene本文・Feedbackメモ本文・Storage値本体が含まれない
- [ ] Breadcrumb / Errorが上限を超えて無限増加しない

## GitHub Pages

- [ ] Dashboard → New Review → Detector Test → Diagnosticsのリンクが正常
- [ ] 公開URLが `/valorant-review/` で正常
- [ ] CSS / JS 404なし
- [ ] Consoleに重大Errorなし
- [ ] `localhost`やPC固有Pathを要求しない

## Verification State

完了時は作業報告へ対象Browser・Viewport / Zoom・日時・未確認項目を記載してください。

v0.8.0 Feedback Queue / Batch Exportは、Static CI成功だけではBrowser Validated扱いにしません。実動画を使ったIndexedDB保存・再読込・Batch ZIP生成・Detector Test Importまで確認して初めてBrowser Validatedとします。
