# VReview Browser / Visual Validation Checklist

`web-project-guide` v1.13.0 の `STATIC + MEDIA + AI-HANDOFF + TOOL` と Visual Quality Baseline用の手動確認項目です。

このファイルが存在するだけでは Browser / Visual Validated 扱いにしません。実施結果は `作業報告書.md` へ記録します。

## 対象

- Firefox 最新安定版
- Chromium系 最新安定版
- GitHub Pages: `https://elitemay.github.io/valorant-review/`

## Visual Review — First View

- [ ] Dashboardが「巨大Hero + 巨大Stat Card群」に戻っていない
- [ ] First Viewで `VReview → クリップをレビュー` のPrimary Actionがすぐ分かる
- [ ] 直近Detector値は主役ではなくcompactなMetric Stripとして見える
- [ ] Review Flow / Runtime / Troubleshootingの重要度差が分かる
- [ ] Red AccentがPrimary Action / Selected等へ限定され、画面全体を赤で強調していない
- [ ] Gradient / Glow / Glass /大量Shadowへ依存していない
- [ ] Browser defaultとCustom UIが中途半端に混在して見えない

## New Review — Workbench Hierarchy

- [ ] 動画読込後、Gameplay Videoが最大Visualとして最初に目に入る
- [ ] Timelineが動画の直下にあり、別Cardへ分離されて見えない
- [ ] 右側が独立Cardの縦積みではなくContinuous Inspectorとして見える
- [ ] Detector / Scene / FeedbackはDividerでGroupingされ、全部同じ強度に見えない
- [ ] Selected Sceneが左Accent / Border / Backgroundで明確に分かる
- [ ] kill / death / fight / false positive / weakを色だけに依存せずLabel・位置・状態でも区別できる
- [ ] Scene 1件の高さが過大でなく、複数Sceneを続けて確認しやすい
- [ ] Development / AI未実装情報がReviewのPrimary Workflowを占有しない

## New Review — Layout / Responsive

- [ ] 1920x1080 / 100%で左Navigation固定、中央動画固定、右Inspectorだけ縦Scroll
- [ ] 中央動画・Timelineを操作中にページ本体が不要に縦Scrollしない
- [ ] 右InspectorをScrollしてもGameplay / Timelineが画面内に残る
- [ ] 125% Zoomで主要Button / Timeline / Inspectorが隠れない
- [ ] 150% Zoomで主要Button / Timeline / Inspectorが隠れない
- [ ] 低い縦解像度でGameplay / Timeline / Scene操作が可能
- [ ] 980 CSS px以下で固定Workspaceを解除し通常縦Scrollへ移行
- [ ] ページ全体に不要な横Scrollが出ない
- [ ] Sidebar Version表示が主要操作へ重ならない

## Typography / Component State

- [ ] 日本語 / 英語 /数字が混在してもHeading / Label / Dataの役割が分かる
- [ ] Mono Label / Timestampが小さすぎず読める
- [ ] ButtonのPrimary / Secondary / Danger差が分かる
- [ ] Hover / focus-visible / selected / disabledが見分けられる
- [ ] Keyboard focus indicatorが消えていない
- [ ] Contrast不足を雰囲気で隠していない

## Video / Detector

- [ ] 実MP4を読み込める
- [ ] 実WebMを読み込める（利用環境でCodec対応する場合）
- [ ] 動画変更を繰り返してもPreviewが壊れない
- [ ] Detector開始→Progress表示→完了
- [ ] Detector開始→Cancel→手動Scene操作を継続可能
- [ ] Detector失敗時にError IDと手動復帰導線がある

## Scene Editing

- [ ] Scene追加
- [ ] Start / End入力
- [ ] 不正なStart / Endで既存Sceneが壊れない
- [ ] TimelineクリックでSeek
- [ ] Scene選択で動画位置へ移動
- [ ] Delete後「元に戻す」で復元
- [ ] weak折りたたみを操作後も状態維持
- [ ] Space / I / O / ← / → / Shift+←→ / Delete が機能

## Draft / Recovery

- [ ] Scene編集→再読込→同じ動画を選択→Draft復元
- [ ] 新規開始を選ぶ→旧DraftがBackupへ残る
- [ ] main Draftがない状態でBackup復元が可能
- [ ] Storage利用不可/Quota失敗を成功扱いせず警告する
- [ ] 同一動画を2タブで編集した時に競合警告が出る

## Feedback Package

- [ ] Feedback ZIP生成成功
- [ ] ZIP内に `manifest.json` / `corrected-scenes.json` がある
- [ ] 元動画そのものがZIPへ入っていない
- [ ] Scene全画面画像でHUDがクロップされない
- [ ] ROI画像が生成される
- [ ] ZIP生成失敗時にError IDが表示され、Scene Draftは残る

## Detector Test

- [ ] v4 Feedback ZIPをImport可能
- [ ] v5 Feedback ZIPをImport可能
- [ ] 別形式ZIPをErrorとして拒否
- [ ] 壊れたJSONをErrorとして拒否
- [ ] 未確認Sceneがある場合、暫定値と表示
- [ ] 複数ZIPをまとめて集計可能
- [ ] Schema/Import失敗がDiagnosticsへ記録される

## Development Diagnostics

- [ ] Dashboard / New Review / Detector Test → Diagnosticsへ移動可能
- [ ] App Version / Build / Guide / Route / Session IDが表示される
- [ ] 動画選択→Detector→Feedback Exportの重要操作がBreadcrumbへ記録される
- [ ] Runtime Error / Promise rejectionがError一覧へ記録される
- [ ] Storage失敗がError一覧へ記録される
- [ ] `diagnostics.json`を書き出せる
- [ ] Clipboard対応Browserでは診断JSONをコピーできる
- [ ] Clear DiagnosticsでこのTabの診断履歴を消去できる
- [ ] 診断JSONへ動画本体・Scene本文・Feedbackメモ本文・Storage値本体が含まれない
- [ ] Breadcrumbが上限120件を超えて無限増加しない
- [ ] Errorが上限40件を超えて無限増加しない

## GitHub Pages

- [ ] Dashboard → New Review → Detector Test → Diagnosticsのリンクが正常
- [ ] 公開URLが `/valorant-review/` で正常
- [ ] CSS / JS 404なし
- [ ] Consoleに重大Errorなし
- [ ] `localhost`やPC固有Pathを要求しない

## Verification State

完了時は作業報告へ対象Browser・Viewport / Zoom・日時・未確認項目を記載してください。

UserがVisualへ明確な肯定Feedbackを出すまでは、v0.7.0 Review Workbenchを`PROJECT_LEARNINGS.md`のSuccessやValidated Visual Directionへ昇格しません。
