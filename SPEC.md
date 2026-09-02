# VReview 仕様書

## 1. 概要

- Project: VReview
- Repository: `EliteMay/valorant-review`
- App Version: 0.7.0
- Detector Version: 0.5.0
- Feedback Package: 5
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

v0.7.0はDetector判定を変えず、Visual / Information Hierarchy / Review Workspaceを再設計する。

## 3. Primary Task

VReviewのPrimary Taskは次の繰り返しである。

```text
Gameplayを見る
↕
Timelineで時刻を確認する
↕
Scene候補を選ぶ
↕
Start / End / Labelを修正する
```

そのため、Visual Priorityは次とする。

1. Gameplay video
2. Event Timeline / Selected Scene
3. Scene Inspector
4. Detector controls
5. Feedback Export
6. Development / Secondary information

## 4. 主要利用フロー

```text
動画を選択
↓
同一動画のDraft / Backup確認
↓
DetectorでScene候補を自動検出
↓
primary / weakを確認
↓
映像を見ながら時間修正・手動追加・削除・正解Label
↓
Feedback Package生成
↓
Detector Testで複数ZIPを集計
↓
問題時はDiagnosticsをExport
```

AI採点用Packageは現在未実装。

## 5. 画面仕様

| 画面 | 目的 | 主操作 | 状態 |
|---|---|---|---|
| `index.html` | Review開始と直近Detector状態 | New Review / Detector Test / Diagnostics | Empty / Success |
| `review.html` | 動画解析・Scene編集 | 動画選択 / 検出 / 修正 / ZIP生成 | Loading / Empty / Error / Success |
| `detector-test.html` | Feedback ZIP集計 | ZIP Import / 精度比較 | Loading / Empty / Error / Success |
| `diagnostics.html` | Development Diagnostics | Export / Copy / Clear / Error確認 | Empty / Success / Error |
| `result.html` | 将来のAI結果Import | 未実装 | Development |
| `history.html` | 将来の履歴 | 未実装 | Development |
| `training.html` | 将来の練習集計 | 未実装 | Development |
| `settings.html` | 将来の設定 | 未実装 | Development |

## 6. Visual Direction — Review Workbench

### Target Type

- Primary Task: gameplayを見ながらSceneを検出・修正
- Content Model: video + timeline + inspector/list
- Audience: 個人利用 / VALORANT Player
- Usage Frequency: repeated
- Density: medium-high / high
- Primary Device: desktop
- Tone: technical / competitive / calm

### Domain Research

v0.7.0の意味のあるVisual変更前に、ゲームVODレビュー・動画Feedback・スポーツ映像解析・ゲームClip編集の現行Toolを比較した。

共通していた構造原理:

- Main mediaを最大Visualとして扱う。
- Timeline / Timestampをmediaへ密着させる。
- コメント・Scene・ToolはSide Inspector / Listとして扱う。
- 全情報を同強度のCardにしない。
- Decorative EffectよりSelected / Time / Event / Stateを明確にする。

### KEEP / FIX / REMOVE

KEEP:

- 暗色Theme
- VALORANT red accent
- `primary / weak`分類
- 中央動画固定 + 右PaneのみScroll
- Timelineを動画の近くに維持

FIX:

- Card / Panelの過剰使用
- 巨大Heading / StatによるDashboard Template感
- 右PaneのCard縦積み
- Primary Buttonの過剰強調
- Scene 1件あたりの過大な縦余白
- Development情報がPrimary Workflowと同等に見えるHierarchy

REMOVE:

- Review画面の大きな開発中AI Package Card
- Review画面の独立Development Support Card
- Sidebarの開発中機能一覧
- Dashboardの巨大Stat Card 4枚構成

### PC版New Review Layout

崩してはいけない主要UI仕様:

```text
左: compact Navigation固定
中央: Gameplay / Timeline / Clip Controls固定
右: Detector / Scene / Feedback Inspectorだけ縦Scroll
```

Review Workspaceは左右を別々のCardとして見せず、1つの連続したWorkbench Surfaceとして扱う。

980 CSS px以下では固定Workspaceを解除し通常縦Scrollへ戻す。

### Component Rule

- Cardは独立情報単位にだけ使用する。
- InspectorはSection + Divider中心。
- Sceneはcompact list-cardとし、Selectedを左Accent / Border / Backgroundで識別する。
- ButtonはPrimary / Secondary / Dangerの意味を保つ。
- Red accentはPrimary Action・Selected・重要Eventへ限定する。
- EyebrowはAccent乱用せず、Muted Mono Labelとして使う。
- Gradient / Glass / Glow /大量ShadowをVisual品質の代替にしない。

## 7. Data / Source of Truth

| データ | 正本 | ID | Schema | 保存先 |
|---|---|---|---|---|
| App / Detector / Feedback / Build / Guide Version | `js/version.js` | - | JS Object | Runtime |
| Project Guide / Profiles / Visual / Diagnostics policy | `project-meta.json` | - | JSON | GitHub |
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

## 8. 保存・復元

- 元動画そのものは保存しない。
- 動画Fingerprintは file name / size / lastModified / duration / resolution から作る。
- Scene / metaはStorage Schema v1 envelopeで保存する。
- v0.5.0以前のplain Array / Objectは後方互換で読み込む。
- 新規開始時は既存DraftをBackupへ退避する。
- Scene削除はUndo可能にする。
- Storage書込失敗を成功扱いせず画面へ表示する。
- 別タブ更新を検出した場合は競合警告を表示する。

v0.7.0のVisual変更ではStorage Schemaを変更しない。

## 9. Development Diagnostics

- Storage: `sessionStorage`
- Schema: `vreview-development-diagnostics` v1
- Breadcrumb上限: 120
- Error上限: 40
- Network failure上限: 30
- 外部自動送信: しない

記録対象:

- App / Build / Schema / Detector / Feedback / Guide Version
- Session / Route / Viewport /最小Browser summary
- 動画読込 / Draft復元 / Detector / Feedback Export等のBreadcrumb
- JS Error / Promise Rejection
- Storage / Import / sanitized network failure

記録禁止:

- Password / API Key / Token / Authorization / Cookie
- 元動画・画像・音声Body
- Feedbackメモ本文
- Scene内容本体
- File名 / Path
- Storage値本体

## 10. 外部依存

- OpenAI API: 不使用
- Backend: 不使用
- CDN: 主要機能では不使用
- DB: 不使用
- GitHub Pages: 利用
- Diagnostics Telemetry Server: 不使用

## 11. 崩してはいけない仕様

1. GitHub Pagesで利用可能な静的HTML / CSS / JavaScript構成を維持する。
2. 有料APIを必須にしない。
3. 元動画をユーザー操作なしに外部送信しない。
4. 公開GitHubへSecret / 元動画を保存しない。
5. Detector結果は必ず手動修正可能にする。
6. Recallを重視し、弱候補は`primary`と分離する。
7. PC版New Reviewの中央動画固定 + 右InspectorのみScrollを維持する。
8. Gameplay / TimelineをVisual Priority 1–2として維持する。
9. 右Inspectorを巨大Cardの縦積みへ戻さない。
10. AI採点対象v1はAIM + Movement。
11. AI結果は固定SchemaでImportし、判断不能項目は`null`を許可する。
12. 未実装機能を通常導線で完成済みのように見せない。
13. Versioned Patch JSを恒久構造へ戻さない。
14. 既存保存データをMigration / Backupなしに破棄しない。
15. Detector条件を単一Clipへ最適化しない。
16. 高コストBugは`PROJECT_LEARNINGS.md`とRegression Guardへ反映する。
17. Diagnosticsへ秘密情報・入力全文・Media Bodyを保存しない。
18. Static Validation成功をBrowser / Visual / User Validatedとして扱わない。

## 12. 互換性

- Existing localStorage: v0.5.0以前のplain Scene Array / Meta Objectを読めること。
- Feedback Package: Detector Testは少なくともv4 / v5を扱えること。
- URL: `index.html`, `review.html`, `detector-test.html`, `diagnostics.html`を維持する。
- GitHub Pages: repository subpath `/valorant-review/`で相対Pathが動くこと。
- Browser: Firefox / Chromiumを主対象とする。
- Detector: v0.7.0でもv0.5.0判定条件を維持する。

## 13. Development Process

Coding Agentを使う場合はRoot `AGENTS.md`を入口にする。

Visual変更では:

```text
Current UI理解
→ Target Type定義
→ Domain Research
→ KEEP / FIX / REMOVE
→ Visual Direction
→ Implementation
→ Static / Regression
→ Browser / Screenshot Visual Verification
→ User Feedback
```

Browser / Screenshotを確認できない場合はVisual未確認として記録する。

## 14. 現フェーズ完成条件

- [ ] 未使用クリップ群でRecall / Precisionを測定
- [ ] primary / weak分類が実用上安定
- [ ] Scene編集→保存→再読込→復元を実ブラウザ確認
- [ ] Feedback ZIP生成をFirefox / Chromiumで確認
- [ ] Diagnostics Export / Privacy / Ring BufferをFirefox / Chromiumで確認
- [ ] Review Workbenchを100 / 125 / 150% Zoomで確認
- [ ] 1920x1080で中央動画固定 + 右InspectorのみScrollを確認
- [ ] 低い縦解像度で主要操作が隠れないことを確認
- [ ] GitHub Pages公開URLで主要導線確認
- [ ] v0.7.0のVisualをユーザーが実画面で評価

## 15. 未確認・既知の制約

- Detector v0.5.0の未知クリップ汎化性能は検証継続中。
- ace4-1型の重複Sceneが残る。
- 長い連キルの適切な自動分割は未完成。
- Death専用検出は未完成。
- HUD Scale / aspect ratio差への耐性は限定的。
- Browser E2EはChecklist中心。
- Static / Pages成功と実Media / Visual挙動は別確認とする。
- v0.7.0 Review Workbenchの最終Visualは実ブラウザ / Screenshot未確認の間は完成評価しない。
