# VReview 仕様書

## 1. 概要

- Project: VReview
- App Version: 0.6.0
- Detector Version: 0.5.0
- Guide Version: 1.8.0
- Profiles: STATIC + MEDIA + AI-HANDOFF + TOOL
- Runtime Version Source: `js/version.js`
- Project Metadata: `project-meta.json`
- Project Learnings: `PROJECT_LEARNINGS.md`
- Agent Router: `AGENTS.md`

## 2. 目的

VALORANTクリップから戦闘Scene候補をブラウザ内で抽出し、ユーザーが修正した正解データを使ってDetectorを改善する。Detector安定後は、Sceneを高fpsフレームへ変換してChatGPT Plusへ手動提出し、AIM / Movementレビューへつなげる。

v0.6.0ではDetector判定ロジックを変更せず、Guide v1.8.0で追加されたProject Memory / Development Observability / Agent向け入口を導入する。

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
↓
問題時はDiagnosticsをExportして原因調査
```

AI採点用Packageは現在未実装。

## 4. 画面仕様

| 画面 | 目的 | 主操作 | 状態 |
|---|---|---|---|
| `index.html` | 現在状態と主要導線 | New Review / Detector Test / Diagnostics | Empty / Success |
| `review.html` | 動画解析とScene編集 | 動画選択 / 検出 / 修正 / ZIP生成 | Loading / Empty / Error / Success |
| `detector-test.html` | Feedback ZIP集計 | ZIP Import / 精度確認 | Loading / Empty / Error / Success |
| `diagnostics.html` | Development Diagnostics | Export / Copy / Clear / Error確認 | Empty / Success / Error |
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

## 5. Data / Source of Truth

| データ | 正本 | ID | Schema | 保存先 |
|---|---|---|---|---|
| App / Detector / Feedback / Build / Guide Version | `js/version.js` | - | JS Object | Runtime |
| Project Guide / Profiles / Diagnostics policy | `project-meta.json` | - | JSON | GitHub |
| 現行Project仕様 | `SPEC.md` | - | Markdown | GitHub |
| 長期学習 | `PROJECT_LEARNINGS.md` | PL-F / PL-S | Markdown | GitHub |
| Scene Draft | `VReviewUI` | Scene UUID | Storage Schema v1 | localStorage |
| Draft Meta | `app.js` | Video Fingerprint | Storage Schema v1 | localStorage |
| Development Diagnostics | `diagnostics.js` | Session UUID | Diagnostics Schema v1 | sessionStorage / JSON Export |
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

## 7. Development Diagnostics

### 目的

ユーザーが「何をしたら壊れたか」を毎回説明し直さなくても、Version・環境・直前操作・Errorから原因調査を開始できるようにする。

### 保存

- Storage: `sessionStorage`
- Schema: `vreview-development-diagnostics` v1
- Breadcrumb上限: 120
- Error上限: 40
- Network failure上限: 30
- 外部自動送信: しない

### 記録対象

- App / Build / Storage Schema / Detector / Feedback / Guide Version
- Session開始・Route
- Viewport / language / online /最小Platform summary
- Feature Detection
- 動画読込の開始 / 成功 / 失敗
- Draft / Backup復元
- Detector開始 / 完了 / Cancel / Failure
- Feedback Export開始 / 完了 / Failure
- Detector Test Import / Schema failure
- JS Error / Unhandled Promise Rejection
- Storage failure / tab conflict
- sanitized network failure
- Storage件数・概算容量Summary

### 記録禁止

- Password / API Key / Token / Authorization / Cookie
- 元動画・画像・音声Body
- Feedbackメモ本文
- Scene内容本体
- File名 / File Path
- localStorage / sessionStorageの値本体
- URL Query / Fragment全文

### Export

`diagnostics.html`から`diagnostics.json`を生成可能にする。

Error表示は可能な範囲で短いError IDを併記し、Diagnostics内のErrorと対応できるようにする。

## 8. 外部依存

- OpenAI API: 不使用
- Backend: 不使用
- CDN: 主要機能では不使用
- DB: 不使用
- GitHub Pages: 利用
- Diagnostics Telemetry Server: 不使用

外部Serviceがなくても、動画選択・Scene手動編集・Diagnostics Exportは利用可能であることを優先する。

## 9. 崩してはいけない仕様

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
13. Detector条件を単一Clipだけへ最適化せず、複数Clip Regression Evidenceで評価する。
14. 高コストBugは`PROJECT_LEARNINGS.md`とRegression Guardへ反映する。
15. Diagnosticsへ秘密情報・ユーザー入力全文・Media Bodyを保存しない。
16. Diagnosticsを無制限保存しない。
17. Diagnosticsをユーザー同意なしに外部自動送信しない。
18. Static Validation成功をBrowser / Real-device / User Validatedとして扱わない。

## 10. 互換性

- Existing localStorage: v0.5.0以前のplain Scene Array / Meta Objectを読めること。
- Feedback Package: Detector Testは少なくともv4 / v5の既存Packageを扱えること。
- URL: `index.html`, `review.html`, `detector-test.html`を維持する。
- Diagnostics URL: `diagnostics.html`を維持する。
- GitHub Pages: repository subpath `/vreview/`で相対Pathが動くこと。
- Browser: Firefox / Chromiumを主対象とする。実Media Codec差は実ブラウザ確認が必要。
- Detector: v0.6.0基盤改修ではv0.5.0判定条件を維持する。

## 11. Development Process

Coding Agentを使う場合はRoot `AGENTS.md`を入口にする。仕様全文をAGENTSへ重複させず、`SPEC.md` / `PROJECT_LEARNINGS.md` / 最新`web-project-guide`へ案内する。

高コストBugの修正では原則:

```text
Runtime Diagnostic / Feedback Evidence
↓
Root Cause
↓
Fix
↓
Regression Guard
↓
PROJECT_LEARNINGS.md
↓
複数Projectへ一般化できる場合だけweb-project-guideへ還元
```

## 12. 完成条件

現在のDetector開発フェーズでは、少なくとも以下を満たすまでDetector完成扱いにしない。

- [ ] 未使用クリップ群でRecall / Precisionを測定
- [ ] 重大な見逃しパターンが複数再現しない
- [ ] primary / weak分類が実用上安定
- [ ] Scene編集→保存→再読込→復元が実ブラウザで確認済み
- [ ] Feedback ZIP生成をFirefox / Chromiumで確認
- [ ] Diagnostics Export / Privacy / Ring BufferをFirefox / Chromiumで確認
- [ ] GitHub Pages公開URLで主要導線確認

AIレビュー機能の完成条件は別フェーズで追加する。

## 13. 未確認・既知の制約

- Detector v0.5.0の未知クリップ汎化性能は検証継続中。
- ace4-1型の重複Sceneが残る。
- 長い連キルの適切な自動分割は未完成。
- Death専用検出は未完成。
- HUD Scale / aspect ratio差への耐性は限定的。
- Browser E2EはChecklist中心で、Static Validation成功をBrowser確認済みとは扱わない。
- GitHub Pages build成功と実利用時Media / Diagnostics挙動は別確認とする。
