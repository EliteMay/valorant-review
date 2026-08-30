# VReview Browser Validation Checklist

`web-project-guide` v1.1.0 の `STATIC + MEDIA + AI-HANDOFF + TOOL` 用手動確認項目です。

このファイルが存在するだけでは Browser Validated 扱いにしません。実施結果は `作業報告書.md` へ記録します。

## 対象

- Firefox 最新安定版
- Chromium系 最新安定版
- GitHub Pages: `https://elitemay.github.io/vreview/`

## New Review — Layout

- [ ] 1920x1080 / 100%で左Navigation固定、中央動画固定、右Paneだけ縦Scroll
- [ ] 125% Zoomで主要Buttonが隠れない
- [ ] 150% Zoomで主要Buttonが隠れない
- [ ] 低い縦解像度相当で動画・Timeline・右Pane操作が可能
- [ ] 980px以下で固定3Paneを解除し通常縦Scrollへ移行
- [ ] ページ全体に不要な横Scrollが出ない
- [ ] Sidebar内Version表示が主要操作へ重ならない

## Video / Detector

- [ ] 実MP4を読み込める
- [ ] 実WebMを読み込める（利用環境でCodec対応する場合）
- [ ] 動画変更を繰り返してもPreviewが壊れない
- [ ] Detector開始→Progress表示→完了
- [ ] Detector開始→Cancel→手動Scene操作を継続可能
- [ ] Detector失敗時にError表示と手動復帰導線がある

## Scene Editing

- [ ] Scene追加
- [ ] Start / End入力
- [ ] 不正なStart / Endで既存Sceneが壊れない
- [ ] TimelineクリックでSeek
- [ ] Scene選択で動画位置へ移動
- [ ] Delete後「元に戻す」で復元
- [ ] weak折りたたみを操作後も状態維持
- [ ] Space / I / O / ← / → / Shift+←→ / Delete が機能
- [ ] Keyboard focusが視認できる

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

## Detector Test

- [ ] v4 Feedback ZIPをImport可能
- [ ] v5 Feedback ZIPをImport可能
- [ ] 別形式ZIPをErrorとして拒否
- [ ] 壊れたJSONをErrorとして拒否
- [ ] 未確認Sceneがある場合、暫定値と表示
- [ ] 複数ZIPをまとめて集計可能

## GitHub Pages

- [ ] Dashboard → New Review → Detector Testのリンクが正常
- [ ] CSS / JS 404なし
- [ ] Consoleに重大Errorなし
- [ ] `localhost`やPC固有Pathを要求しない

## Verification State

完了時は作業報告へ対象ブラウザ・日時・未確認項目を記載してください。
