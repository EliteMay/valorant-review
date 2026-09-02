# PROJECT LEARNINGS

このファイルは、VReviewで発生した再発防止価値の高い失敗と、今後も再利用したい成功パターンを長期的に残す正本です。

`作業報告書.md` は「今回何を変更したか」、このファイルは「VReviewから何を学んだか」を記録します。

## Failure

### PL-F-001 Detector RuntimeをVersion Patchで積み重ねた

- Date: 2026-08-30
- Status: resolved
- Severity: high
- Cost: high
- Symptom: `scene-detection-v042.js → v043 → v044 → v045`を順番に読み、同じglobal実装を上書きしていた。
- Expected: Detectorの責務・現在実装・Regression原因が1つのPipelineから追える。
- Actual: 前Versionの削除を次Versionで復活させる等、Patch同士が打ち消し合った。
- Trigger / Reproduction: Detector精度改善を1ClipごとのPatch JSとして追加し続ける。
- Root Cause: 検出Pipelineの責務分解より、直近失敗への即時Patchを優先した。
- Final Fix: `js/detector.js`の単一Pipelineへ統合し、旧Versioned Runtimeを削除。
- Affected files / systems: Detector Runtime / review.html / validation
- Detection method: Repository構造レビュー、script読込順確認。
- Regression Guard: `scripts/validate.mjs`でlegacy Versioned Detector再混入を検査。
- Prevention: Runtime Pathを安定させ、Versionは`js/version.js`で管理する。
- Related Issue / PR / Commit: v0.5.0基盤改修
- Guide candidate: yes
- Guide note: Versioned Patch Runtime / Stable Runtimeの共通ルールへ還元済み。

### PL-F-002 Feedback ZIPが外部JSZip CDNに依存して作成不能になった

- Date: 2026-08-29
- Status: resolved
- Severity: high
- Cost: medium
- Symptom: 「ZIPライブラリを読み込めませんでした」となり提出用ZIPを作れなかった。
- Expected: GitHub Pages上で外部Providerなしでも主要Feedback Exportが動く。
- Actual: CDN読込失敗で主要フローが停止した。
- Trigger / Reproduction: JSZip CDNが読めない環境・Cacheされた旧Runtime。
- Root Cause: 主要機能を外部Script 1つへ依存させ、Fallbackがなかった。
- Final Fix: 外部CDN依存を削除し、Browser内だけでZIPを生成する実装へ変更。Cache revisionも更新。
- Affected files / systems: Feedback Package / review.html / cache
- Detection method: 実ブラウザのError表示。
- Regression Guard: Feedback Package RuntimeをRepository内に保持し、Static reference validationを行う。
- Prevention: 主要Exportはlocal-first。第三者Scriptを使う場合はFailure State / Fallbackを先に決める。
- Related Issue / PR / Commit: Feedback Package v2以降
- Guide candidate: yes
- Guide note: Progressive Enhancement / One External Provider Assumptionへ還元済み。

### PL-F-003 誤検出除去を強くしすぎて本物のキルSceneを削除した

- Date: 2026-08-29
- Status: monitoring
- Severity: high
- Cost: high
- Symptom: v0.4.3 Refinerが誤検出を減らした一方、別Clipの本物の2〜3キル目まで削除した。
- Expected: Precisionを改善しても重大なRecall低下を起こさない。
- Actual: 既知Clipでは成功した条件が未知Clipで本物をHard Dropした。
- Trigger / Reproduction: `no-shot-and-no-local-kill-confirmation`等の強い削除条件を少数Clipで調整。
- Root Cause: 1本失敗するたび即閾値を変え、Regression Datasetが十分になる前に最適化した。
- Final Fix: Recall Guardを追加し、削除ではなく`primary / weak`の二段階へ分類。複数Clipをまとめて評価するDetector Testを追加。
- Affected files / systems: Detector / Scene Classifier / Detector Test
- Detection method: Feedback ZIP比較、ユーザー正解ラベル。
- Regression Guard: 複数ClipのPrecision / Recall / primary Precisionを同時評価し、単一ClipだけでDetector条件を確定しない。
- Prevention: Detector変更前にRegression Datasetを集め、Hypothesis・結果・Keep/Revertを記録する。
- Related Issue / PR / Commit: v0.4.3〜v0.4.6
- Guide candidate: yes
- Guide note: Regression Dataset / Human-in-the-loopの実例。

### PL-F-004 Static Validation成功をBrowser動作確認と混同しやすかった

- Date: 2026-08-30
- Status: monitoring
- Severity: medium
- Cost: medium
- Symptom: GitHub Actions / Pages deploy成功後も、実動画・ZIP生成・固定Pane等は未確認のまま残った。
- Expected: Static / Browser / User validationを別状態として扱う。
- Actual: CI成功だけで完成に近い印象を与えやすかった。
- Trigger / Reproduction: Media / Canvas / Browser StorageをStatic Checkだけで評価する。
- Root Cause: Verification Stateの分離が弱かった。
- Final Fix: Browser Checklistと作業報告のVerification Stateを明示。
- Affected files / systems: Testing / Documentation / Release判断
- Detection method: Guide監査。
- Regression Guard: `tests/BROWSER_CHECKLIST.md`と作業報告で未確認を残す。
- Prevention: Static Validated / Browser Validated / User Validatedを別に記録する。
- Related Issue / PR / Commit: v0.5.1 Guide準拠改修
- Guide candidate: yes
- Guide note: Development Observability / Visual Verificationとも整合。

### PL-F-005 全情報をPanel / Card化して動画レビューToolのHierarchyを失った

- Date: 2026-09-02
- Status: monitoring
- Severity: medium
- Cost: high
- Symptom: 機能は使えるが、Dashboard・Review画面ともCard / Panel / Eyebrow /大きいButtonが反復し、「動画解析Tool」よりGenericなAI Dashboard Templateに見えた。
- Expected: Gameplayが主役で、TimelineとScene Inspectorを素早く往復できる高密度Review Workbenchに見える。
- Actual: 動画、Detector、Scene、Feedback、開発中機能が似たSurface強度で並び、重要度の差が弱かった。Scene 1件の縦幅も大きく確認速度を落としていた。
- Trigger / Reproduction: 新機能を追加するたび独立`panel`として縦に積み、見た目の修正をSpacing / Color / Card追加中心で繰り返す。
- Root Cause: Domain固有のPrimary Taskより、汎用Dashboard Componentを先に使った。Visual変更前の同種Tool調査とKEEP / FIX / REMOVEが不足していた。
- Final Fix: `web-project-guide` v1.13.0のDomain-first Visual Researchを実施し、Review WorkbenchへFoundation Reset。中央のGameplay + TimelineをVisual Priority 1–2、右側をContinuous Inspectorへ変更し、開発中CardをPrimary Workflowから除外した。
- Affected files / systems: `index.html`, `review.html`, `css/base.css`, `css/layout.css`, `css/components.css`, development pages
- Detection method: ユーザーからの見た目修正要求、Guide Visual Quality監査、同種Video Review Tool比較。
- Regression Guard: `scripts/validate.mjs`でReview Workbenchの必須DOM構造を確認し、`tests/BROWSER_CHECKLIST.md`でVideo Priority / Inspector / right-only scroll / Zoom / low-heightをVisual Reviewする。
- Prevention: 意味のあるVisual変更では先にTarget Type → Domain Research → KEEP / FIX / REMOVEを行う。Panel追加をDefaultにせず、Section / List / Timeline / InspectorをContent semanticsで使い分ける。
- Related Issue / PR / Commit: v0.7.0 visual-workbench redesign
- Guide candidate: no
- Guide note: Domain-first Visual Research / Visual Foundation ResetはGuide v1.13.0へ既に存在するため、VReview固有Evidenceとして残す。

---

## Success

### PL-S-001 primary / weakの二段階表示でRecall保険と操作性を両立

- Date: 2026-08-29
- Goal / Problem: 本物のScene見逃しを防ぎつつ、弱い候補が主一覧を埋める問題を減らす。
- Adopted Pattern: Hard Dropではなく`primary`と`weak`へ分類し、weakを折りたたみ表示。
- Why it worked: 見逃し防止の候補を保持したまま、通常確認では本命だけを優先できた。
- Trade-off: weak候補の確認作業は残る。
- Reuse when: 自動検出が完全決定的ではなく、false negativeのコストが高い場合。
- Avoid when: 全結果が決定的でConfidence分類が不要な処理。
- Related files / tests: `js/detector.js`, `js/ui.js`, Feedback Package, Detector Test
- Guide candidate: yes
- Guide note: Human-in-the-loop / Confidence / 要確認候補の実例。

### PL-S-002 動画固定 + 右Scene PaneのみScrollでレビュー作業が安定した

- Date: 2026-08-29
- Goal / Problem: Scene一覧を操作すると動画まで画面外へ流れ、確認作業がしにくかった。
- Adopted Pattern: PC版は左Navigation固定・中央動画固定・右Scene Paneだけ縦Scroll。小画面では通常縦Scrollへ戻す。
- Why it worked: Scene編集時も映像とTimelineを常に見ながら操作できる。
- Trade-off: 低い縦解像度・Zoomでは固定Paneの実ブラウザ確認が必要。
- Reuse when: 主対象を見ながら横の編集Paneを長く操作するTool UI。
- Avoid when: Mobile中心、または中央Content自体を長くScrollするサイト。
- Related files / tests: `css/layout.css`, `review.html`, `tests/BROWSER_CHECKLIST.md`
- Guide candidate: yes
- Guide note: fixed/stickyは目的が明確なら有効だがSmall viewport testが必須。

### PL-S-003 Feedback Packageへ診断値・正解ラベル・ROI画像をまとめた

- Date: 2026-08-30
- Goal / Problem: 「精度が悪い」という説明だけではDetectorの原因を特定しにくかった。
- Adopted Pattern: 自動Scene、修正後Scene、正解Label、Detector diagnostics、Event優先画像、ROI画像をVersion付きPackageへまとめる。
- Why it worked: 誤検出・見逃し・時間ズレを機械的に比較し、Clipごとの根拠を残せた。
- Trade-off: Package生成時間と画像容量が増えるためdedupeと上限が必要。
- Reuse when: Detector / Parser / AI補助処理を実例で改善するProject。
- Avoid when: 入力と出力が小さく、単純JSONだけで十分な処理。
- Related files / tests: `js/feedback-package-v5.js`, `data/detector-feedback-schema.json`, `js/detector-test.js`
- Guide candidate: yes
- Guide note: Diagnostic Package / Regression Datasetへ再利用可能。

---

## Guide Feedback Queue

| ID | Type | Summary | Evidence | Next action |
|---|---|---|---|---|
| PL-F-003 | failure | Detector閾値を単一Clipで即修正すると過学習しやすい | 複数Clipでv0.4.3 Recall低下 | 未知Clip群の定量検証後にGuideへ追加検討 |
| PL-S-002 | success | 主対象固定 + 編集PaneのみScroll | VReview Scene編集UI | 他Tool Projectでも再利用例が増えたら一般化 |
