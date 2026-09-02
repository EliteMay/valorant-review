# VReview 仕様書

## 1. 概要

- Project: VReview
- Repository: `EliteMay/valorant-review`
- App Version: 0.8.0
- Detector Version: 0.5.0
- Feedback Package: 5
- Feedback Batch Schema: 1
- Storage Schema: 1
- Diagnostics Schema: 1
- Guide Version: 1.13.0
- Profiles: STATIC + MEDIA + AI-HANDOFF + TOOL
- Runtime Version Source: `js/version.js`
- Project Metadata: `project-meta.json`
- Project Learnings: `PROJECT_LEARNINGS.md`
- Agent Router: `AGENTS.md`
- GitHub Pages: `https://elitemay.github.io/valorant-review/`

## 2. 目的

VALORANTクリップから戦闘Scene候補をブラウザ内で抽出し、ユーザーが映像を見ながら修正した正解データを使ってDetectorを改善する。

Detector安定後は、確定Sceneを高fpsフレームへ変換してChatGPT Plusへ手動提出し、AIM / Movementレビューへつなげる。

v0.8.0ではDetector判定条件を変更せず、Detector改善用Feedbackの受け渡しを次へ変更する。

```text
旧:
ClipごとにFeedback ZIPを作成・ダウンロード

新:
ClipごとにFeedback内容だけIndexedDBへ保存
→ 複数Clipを貯める
→ 最後に1回だけBatch ZIPを作成
```

## 3. Primary Task / Visual Priority

Primary Task:

```text
Gameplayを見る
↕
Timelineで時刻を確認する
↕
Scene候補を選ぶ
↕
Start / End / Labelを修正する
```

Visual Priority:

1. Gameplay video
2. Event Timeline / Selected Scene
3. Scene Inspector
4. Detector controls
5. Feedback Save / Batch Export
6. Development / Secondary information

## 4. 主要利用フロー

```text
動画を選択
↓
Draft / Backup確認
↓
DetectorでScene候補を自動検出
↓
primary / weakを確認
↓
時間修正・手動追加・削除・正解Label
↓
「このクリップの改善データを保存」
↓
Feedback Package v5相当の内容をIndexedDBへ保存
↓
別クリップを繰り返す
↓
「保存済みをまとめてZIP作成」
↓
vreview-detector-feedback-batch v1を1個ダウンロード
↓
ChatGPTへ提出 / Detector TestへImport
```

AI採点用Packageは現在未実装。

## 5. 画面仕様

| 画面 | 目的 | 主操作 | 状態 |
|---|---|---|---|
| `index.html` | Review開始と直近Detector状態 | New Review / Detector Test / Diagnostics | Empty / Success |
| `review.html` | 動画解析・Scene編集・Feedback Queue | 動画選択 / 検出 / 修正 / 保存 / Batch ZIP | Loading / Empty / Error / Success |
| `detector-test.html` | Feedback精度集計 | 単体ZIP / Batch ZIP Import | Loading / Empty / Error / Success |
| `diagnostics.html` | Development Diagnostics | Export / Copy / Clear | Empty / Success / Error |
| `result.html` | 将来のAI結果Import | 未実装 | Development |
| `history.html` | 将来の履歴 | 未実装 | Development |
| `training.html` | 将来の練習集計 | 未実装 | Development |
| `settings.html` | 将来の設定 | 未実装 | Development |

## 6. Review Workbench Layout

PC版New Review:

```text
左: compact Navigation固定
中央: Gameplay / Timeline / Clip Controls固定
右: Detector / Scene / Feedback Inspectorだけ縦Scroll
```

- Gameplay / Timelineを最大Visualとする。
- InspectorはSection + Divider中心。
- Feedback QueueはInspector内に置くが、Scene Reviewより強く見せない。
- 980 CSS px以下では固定Workspaceを解除し通常縦Scrollへ戻す。

## 7. Data / Source of Truth

| データ | 正本 | ID | Schema | 保存先 |
|---|---|---|---|---|
| App / Detector / Feedback / Build / Guide Version | `js/version.js` | - | JS Object | Runtime |
| Project metadata | `project-meta.json` | - | JSON | GitHub |
| 現行仕様 | `SPEC.md` | - | Markdown | GitHub |
| 長期学習 | `PROJECT_LEARNINGS.md` | PL-F / PL-S | Markdown | GitHub |
| Scene Draft | `js/ui.js` | Scene UUID | Storage Schema v1 | localStorage |
| Draft Meta | `js/app.js` | Video Fingerprint | Storage Schema v1 | localStorage |
| Feedback Queue | `js/feedback-library.js` | Video Fingerprint | Queue Schema v1 | IndexedDB |
| Feedback Package内容 | `js/feedback-package-v5.js` | Scene mapping ID | `vreview-detector-feedback` v5 | IndexedDB / ZIP |
| Feedback Batch | `js/feedback-package-v5.js` | Clip folder mapping | `vreview-detector-feedback-batch` v1 | Download ZIP |
| Detector diagnostics | `js/detector.js` | event timestamp | Package v5 | Queue / ZIP内JSON |
| Development Diagnostics | `js/diagnostics.js` | Session UUID | Diagnostics v1 | sessionStorage / JSON Export |

## 8. Scene Data

主要フィールド:

- `id`
- `start`
- `end`
- `source`: `auto | edited | manual`
- `confidence`
- `feedbackLabel`: `unreviewed | kill | death | fight | false_positive`
- `reviewTier`: `primary | weak`
- `fps`: `auto | 30 | 60`

## 9. Scene Draft保存

localStorageは小さい編集データ専用とする。

- Scene / Label
- Detector感度
- Feedbackメモ
- 直近Detector概要

条件:

- Storage Schema v1 envelopeを使う。
- v0.5.0以前のplain Array / Object形式を読み込める。
- 新規開始時は既存DraftをBackupへ退避する。
- Scene削除はUndo可能にする。
- 書込失敗を成功扱いしない。
- 別タブ更新時は競合警告を表示する。

## 10. Feedback Queue — IndexedDB

### 保存先

- Database: `vreview-feedback-library`
- Object Store: `packages`
- Queue Schema: v1
- Primary key: Video Fingerprint
- 最大件数: 20 clips
- App側合計上限: 350MB

### 保存内容

従来の1クリップFeedback Package v5でZIPへ入れていた内容を、ZIP化前の状態で保存する。

- `README.txt`
- `manifest.json`
- `auto-scenes.json`
- `corrected-scenes.json`
- `detector-diagnostics.json`
- `scene-image-map.json`
- `notes.txt`
- `scene-images/*_full.jpg`
- `scene-images/*_roi.jpg`

### 保存禁止

- 元動画Blob / File body
- Secret
- 無関係なBrowser Storage dump

### 同じ動画を保存し直す場合

Video Fingerprintをkeyにするため、同じ動画は新規追加ではなく既存Recordを更新する。

```text
Clip A save
→ Queue 1

Clip A edit + save again
→ Queue 1（更新）

Clip B save
→ Queue 2
```

### 失敗時

- IndexedDB open / transaction失敗でScene Draftを消さない。
- Quota不足時に既存Queueを自動削除しない。
- Browser storage estimateが利用可能なら保存前に容量不足を検出する。
- Queue読込失敗はError IDでDiagnosticsへ残す。

### 削除

- 個別削除を提供する。
- 全削除は確認Dialogを出す。
- Batch ZIP生成後は自動削除しない。

## 11. Feedback Package v5

`prepare()`とZIP生成を分離する。

```text
prepare()
→ JSON / generated images / manifestを作る
→ ZIP化しない

build()
→ 従来互換の単体ZIPが必要な場合だけprepare後にZIP化
```

Package Schema:

- `vreview-detector-feedback`
- Package Version: 5

Detector Testは既存v4 / v5単体ZIP互換を維持する。

## 12. Feedback Batch v1

Batch Schema:

`vreview-detector-feedback-batch`

Version: `1`

構造:

```text
vreview_feedback_batch_YYYYMMDD_HHmm.zip
├─ README.txt
├─ batch-manifest.json
└─ clips/
   ├─ 01_clip_a/
   │  ├─ manifest.json
   │  ├─ corrected-scenes.json
   │  ├─ detector-diagnostics.json
   │  └─ scene-images/...
   ├─ 02_clip_b/
   └─ ...
```

`batch-manifest.json`は少なくとも:

- schema
- version
- created_at
- app_version
- feedback_package_version
- clip_count
- total_uncompressed_bytes
- clips[] / folder mapping

を持つ。

Batch ZIPは最大20クリップを対象とし、生成失敗時もIndexedDB Queueを変更しない。

## 13. Detector Test Import

対応:

- Feedback Package v4
- Feedback Package v5
- Feedback Batch v1

Batch Import:

1. `batch-manifest.json`を検出
2. Batch Schema / Version / clip_count / folderをValidation
3. 各`clips/*/manifest.json`と`corrected-scenes.json`を読む
4. 各Clipを従来の1Recordとして集計

画像は精度集計に不要なためDetector TestでMemoryへ保持しない。

不正Path / 重複Folder / 不正JSON / 未対応VersionはErrorとして拒否する。

## 14. Development Diagnostics

- Storage: sessionStorage
- Schema: `vreview-development-diagnostics` v1
- Breadcrumb上限: 120
- Error上限: 40
- Network failure上限: 30
- 外部自動送信: しない

Feedback Queue関連Error ID:

- `FEEDBACK-LIBRARY-001`
- `FEEDBACK-SAVE-001`
- `FEEDBACK-BATCH-EXPORT-001`

Diagnosticsへ動画本体・Scene本文・Feedbackメモ本文・Storage値本体を保存しない。

## 15. 外部依存

- OpenAI API: 不使用
- Backend: 不使用
- CDN: 主要機能では不使用
- Remote DB: 不使用
- Browser IndexedDB: 利用
- GitHub Pages: 利用

## 16. 崩してはいけない仕様

1. GitHub Pages対応を維持する。
2. 有料APIを必須にしない。
3. 元動画をユーザー操作なしに外部送信しない。
4. 元動画をFeedback Queue / ZIPへ保存しない。
5. Detector結果は必ず手動修正可能にする。
6. `primary / weak`を分離する。
7. PC版New Reviewの中央動画固定 + 右InspectorのみScrollを維持する。
8. Gameplay / TimelineをVisual Priority 1–2とする。
9. Feedbackの画像 / BlobをlocalStorageへ保存しない。
10. 同じ動画FingerprintのQueue Recordを重複追加しない。
11. Batch ZIP失敗でQueueを消さない。
12. ZIP成功後も自動削除しない。
13. Detector Testのv4 / v5単体Feedback互換を維持する。
14. ImportデータをValidation前に信頼しない。
15. Versioned Patch JSを恒久構造へ戻さない。
16. 既存保存データをMigration / Backupなしに破棄しない。
17. Detector条件を単一Clipへ最適化しない。
18. Static Validation成功をBrowser / Visual / User Validatedとして扱わない。

## 17. 互換性

- Existing localStorage: v0.5.0以前のplain Scene Array / Meta Objectを読めること。
- Feedback Package: Detector Testはv4 / v5を扱えること。
- Feedback Batch: v1を扱えること。
- URL: `index.html`, `review.html`, `detector-test.html`, `diagnostics.html`を維持する。
- GitHub Pages: repository subpath `/valorant-review/`で相対Pathが動くこと。
- Browser: Firefox / Chromiumを主対象とする。
- Detector: v0.8.0でもv0.5.0判定条件を維持する。

## 18. 現フェーズ完成条件

- [ ] 未使用クリップ群でRecall / Precisionを測定
- [ ] Scene編集→保存→再読込→復元を実ブラウザ確認
- [ ] 1クリップFeedbackをIndexedDBへ保存できる
- [ ] ページ再読込後もQueueが残る
- [ ] 同じ動画の再保存で件数が増えず更新される
- [ ] 異なる3クリップをQueueへ保存できる
- [ ] Batch ZIPを1回で生成できる
- [ ] Batch ZIPへ元動画が入っていない
- [ ] Batch ZIPをDetector Testへ1個入れて複数Clipとして集計できる
- [ ] v4 / v5単体ZIPのDetector Test互換を確認
- [ ] Queue削除 / 全削除を確認
- [ ] Quota / IndexedDB失敗で既存Draft / Queueを破壊しない
- [ ] Firefox / ChromiumでFeedback Queue / Batch Exportを確認
- [ ] 100 / 125 / 150% ZoomでReview Workbenchを確認
- [ ] GitHub Pages公開URLで主要導線確認

## 19. 未確認・既知の制約

- IndexedDB容量はBrowser / Device環境に依存する。App側は350MB上限を設ける。
- Batch ZIPはStore methodで作成するため、生成時にMemory負荷がある。
- v0.8.0のIndexedDB Queue / Batch ZIPは実ブラウザ確認前はBrowser Validated扱いにしない。
- Detector v0.5.0の未知クリップ汎化性能は検証継続中。
- ace4-1型の重複Scene、長い連キル分割、Death専用検出、HUD Scale耐性は別課題。
