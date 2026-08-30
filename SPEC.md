# VReview 仕様書

## 1. 概要

- Project: VReview
- Guide Version: 1.1.0
- Profiles: STATIC + MEDIA + AI-HANDOFF + TOOL
- Runtime Version Source: `js/version.js`
- Project Metadata: `project-meta.json`

## 2. 目的

VALORANTクリップから戦闘Scene候補をブラウザ内で抽出し、ユーザーが修正した正解データを使ってDetectorを改善する。Detector安定後は、Sceneを高fpsフレームへ変換してChatGPT Plusへ手動提出し、AIM / Movementレビューへつなげる。

## 3. 主要利用フロー

```text
動画を選択
↓
同一動画のDraft / Backup確認
↓
DetectorでScene候補を自動検出
↓
primary / weakを確認
↓
時間修正・手動追加・削除・正解ラベル
↓
Feedback Package生成
↓
Detector Testで複数ZIPを集計
```

AI採点用Packageは現在未実装。

## 4. 画面仕様

| 画面 | 目的 | 主操作 | 状態 |
|---|---|---|---|
| `index.html` | 現在状態と主要導線 | New Review / Detector Test | Empty / Success |
| `review.html` | 動画解析とScene編集 | 動画選択 / 検出 / 修正 / ZIP生成 | Loading / Empty / Error / Success |
| `detector-test.html` | Feedback ZIP集計 | ZIP Import / 精度確認 | Loading / Empty / Error / Success |
| `result.html` | 将来のAI結果Import | 未実装 | Development |
| `history.html` | 将来の履歴 | 未実装 | Development |
| `training.html` | 将来の練習集計 | 未実装 | Development |
| `settings.html` | 将来の設定 | 未実装 | Development |

### PC版New Review Layout

崩してはいけない主要UI仕様:

```text
左: Navigation固定
中央: 動画 / Timeline / Scene追加操作を固定
右: Detector / Scene / Feedback Paneだけ縦Scroll
```

980 CSS px以下では固定3Paneを解除し通常縦Scrollへ戻す。

## 5. データ仕様

| データ | 正本 | ID | Schema | 保存先 |
|---|---|---|---|---|
| App / Detector / Feedback Version | `js/version.js` | - | JS Object | Runtime |
| Project Guide / Profiles | `project-meta.json` | - | JSON | GitHub |
| Scene Draft | `VReviewUI` | Scene UUID | Storage Schema v1 | localStorage |
| Draft Meta | `app.js` | Video Fingerprint | Storage Schema v1 | localStorage |
| Feedback Package | `feedback-package-v5.js` | Scene mapping ID | `vreview-detector-feedback` | Download ZIP |
| Detector diagnostics | `detector.js` | timestamp/event | Package v5 | ZIP内JSON |

### Scene主要フィールド

- `id`
- `start`
- `end`
- `source`: `auto | edited | manual`
- `confidence`
- `feedbackLabel`: `unreviewed | kill | death | fight | false_positive`
- `reviewTier`: `primary | weak`
- `fps`: `auto | 30 | 60`

## 6. 保存・復元

- 元動画そのものは保存しない。
- 動画Fingerprintは file name / size / lastModified / duration / resolution から作る。
- Scene / metaはStorage Schema v1 envelopeで保存する。
- v0.5.0以前のplain Array / Objectは後方互換で読み込む。
- 新規開始時、既存DraftはBackupへ退避してからmain Draftを初期化する。
- Scene削除はUndo可能にする。
- Storage書込失敗は画面へ表示し、成功扱いしない。
- 別タブ更新を検出した場合は競合警告を表示する。

## 7. 外部依存

- OpenAI API: 不使用
- Backend: 不使用
- CDN: 主要機能では不使用
- DB: 不使用
- GitHub Pages: 利用

外部Serviceがなくても、動画選択・Scene手動編集は利用可能であることを優先する。

## 8. 崩してはいけない仕様

1. GitHub Pagesで利用可能な静的HTML / CSS / JavaScript構成を維持する。
2. OpenAI API等の有料APIを必須にしない。
3. 元動画をユーザー操作なしに外部送信しない。
4. 公開GitHubへAPI Key / Password / Token / 元動画を保存しない。
5. Detector結果は必ず手動修正可能にする。
6. PrecisionよりRecallをやや優先するが、弱候補はprimaryと分離する。
7. PC版New Reviewの固定動画 + 右Pane Scrollを維持する。
8. AI採点対象v1はAIM + Movement。
9. AI結果は固定SchemaでImportし、判断不能項目は`null`を許可する。
10. 未実装機能を通常導線で完成済みのように見せない。
11. Versioned Patch JSを再び恒久構造へ戻さない。
12. 既存保存データをMigration / Backupなしに破棄しない。

## 9. 互換性

- Existing localStorage: v0.5.0以前のplain Scene Array / Meta Objectを読めること。
- Feedback Package: Detector Testは少なくともv4 / v5の既存Packageを扱えること。
- URL: `index.html`, `review.html`, `detector-test.html`を維持する。
- GitHub Pages: repository subpath `/vreview/`で相対Pathが動くこと。
- Browser: Firefox / Chromiumを主対象とする。実Media Codec差は実ブラウザ確認が必要。

## 10. 完成条件

現在のDetector開発フェーズでは、少なくとも以下を満たすまでDetector完成扱いにしない。

- [ ] 未使用クリップ群でRecall / Precisionを測定
- [ ] 重大な見逃しパターンが複数再現しない
- [ ] primary / weak分類が実用上安定
- [ ] Scene編集→保存→再読込→復元が実ブラウザで確認済み
- [ ] Feedback ZIP生成をFirefox / Chromiumで確認
- [ ] GitHub Pages公開URLで主要導線確認

AIレビュー機能の完成条件は別フェーズで追加する。

## 11. 未確認・既知の制約

- Detector v0.5.0の未知クリップ汎化性能は検証継続中。
- ace4-1型の重複Sceneが残る。
- 長い連キルの適切な自動分割は未完成。
- Death専用検出は未完成。
- HUD Scale / aspect ratio差への耐性は限定的。
- Browser E2Eは今後追加対象。Static Validation成功をBrowser確認済みとは扱わない。
- GitHub Pages build成功と実利用時Media挙動は別確認とする。
