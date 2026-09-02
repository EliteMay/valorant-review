# AGENTS.md

> Coding Agent向けの薄い入口です。仕様全文はここへ複製せず、各Source of Truthへ案内します。

## Read First

作業前に変更内容へ関係する範囲で次を確認してください。

1. `README.md`
2. `SPEC.md`
3. `PROJECT_LEARNINGS.md`
4. `作業報告書.md`
5. `project-meta.json`
6. `EliteMay/web-project-guide` の最新 `README.md` / `START_HERE.md` と関連章
7. 変更対象Code / Data / Tests

見た目を意味のある範囲で変更する場合は、最新GuideのVisual Quality Baseline / Domain-first Visual Researchを先に確認してください。

## Project

- Repository: `EliteMay/valorant-review`
- Purpose: VALORANT Clipから戦闘Scene候補を検出・修正し、Detector改善と将来のChatGPT AIM / Movement Reviewへつなげる。
- Main entry point: `review.html`
- Deployment: GitHub Pages `https://elitemay.github.io/valorant-review/`
- Project Profiles: `STATIC + MEDIA + AI-HANDOFF + TOOL`
- Adopted Guide Version: `project-meta.json` / `js/version.js` を確認する。
- Visual Direction: `review-workbench`

## Commands

```bash
node scripts/validate.mjs
node tests/storage.test.mjs
```

Browser / Media / Layout / Visual / IndexedDB / ZIPは `tests/BROWSER_CHECKLIST.md` を使い、実行できなかった確認を成功扱いにしません。

## Non-breakable Rules

詳細は `SPEC.md` を正本とします。

- GitHub Pages対応を維持する。
- OpenAI API等の有料APIを必須にしない。
- 元動画をユーザー操作なしに外部送信しない。
- 元動画をFeedback Queue / ZIPへ保存しない。
- Detector結果は必ず手動修正可能にする。
- PC版New Reviewは**中央Gameplay固定 + 右Scene InspectorのみScroll**を維持する。
- Gameplay / TimelineをReview画面のVisual Priority 1–2として維持する。
- 右Inspectorを巨大Panel / Cardの縦積みへ戻さない。
- Feedback画像・Package BlobをlocalStorageへ保存しない。QueueはIndexedDBを使う。
- 同じVideo FingerprintをQueueへ重複追加せず更新する。
- Batch ZIP生成失敗やExport成功を理由にQueueを自動削除しない。
- Detector Testのv4 / v5単体Feedback互換を維持する。
- Detector RuntimeをVersioned Patch JSへ戻さない。
- 既存保存データをMigration / Backupなしに破棄しない。
- Detector判定ロジック変更は複数ClipのRegression Evidenceなしに単一Clip最適化しない。
- 実ブラウザ / Screenshot未確認を完成・成功扱いしない。

## Architecture / File Ownership

| Area | Canonical file / directory | Notes |
|---|---|---|
| Runtime Version | `js/version.js` | App / Detector / Feedback / Batch / Schema / Guide / Build |
| Detector | `js/detector.js` | 単一Pipeline。Versioned Patchを増やさない |
| Draft Storage | `js/storage.js` | localStorage Schema v1 + legacy read compatibility |
| Feedback Queue | `js/feedback-library.js` | IndexedDB / max 20 clips / 350MB / source video禁止 |
| Scene UI | `js/ui.js` | Scene state / render / manual editing |
| Review controller | `js/app.js` | Video / Detector / Queue save / Batch export orchestration |
| Review composition | `review.html`, `css/layout.css`, `css/components.css` | Review Workbench / right inspector |
| Queue UI | `css/feedback-queue.css` | Saved feedback list / actions |
| Visual tokens | `css/base.css` | Color / type / shape tokens |
| Diagnostics | `js/diagnostics.js` | Local-only development diagnostics |
| Feedback Package | `js/feedback-package-v5.js` | Package v5 preparation / single ZIP / Batch v1 ZIP |
| Import Test | `js/detector-test.js` | v4/v5 single ZIP + Batch v1 validation / aggregate |
| Specification | `SPEC.md` | 現行Project仕様 |
| Long-term learnings | `PROJECT_LEARNINGS.md` | 再発防止価値の高い知見 |
| Tests | `scripts/`, `tests/` | Static / Regression / Browser / Visual checklist |

## High-risk Areas

- localStorage / Migration: Draft / Backup / legacy v0.5.0以前形式。
- IndexedDB: Feedback Queue transaction / quota / duplicate fingerprint / destructive clear。
- Media: Blob URL cleanup、Codec、Canvas frame extraction、長尺動画Performance。
- Detector: Recall / Precision trade-off、固定ROI、未知Clip汎化。
- AI-HANDOFF: Package / Batch Schema、Import Validation、元動画Privacy。
- ZIP: Batch構造、Path Validation、Memory負荷、Export失敗時のQueue保持。
- Layout: fixed gameplay + right-only scroll、低い縦解像度、Zoom。
- Visual: Card / Panel追加の積み重ねでGameplay hierarchyを弱めない。

## Visual Change Policy

意味のあるVisual変更では原則:

```text
Current UI確認
→ Target Type定義
→ 同じPrimary Taskの現行Toolを調査
→ KEEP / FIX / REMOVE
→ Design Direction
→ Implementation
→ Static Regression
→ Browser / Screenshot Visual Review
→ User Feedback
```

- 他Projectの成功例を最初からTemplateとしてコピーしない。
- Accent ColorやShadowだけで改善としない。
- 新機能追加時も`panel`をDefaultにせず、List / Divider / Inspector / Timeline等を意味で選ぶ。
- User Validation前のCandidateを`PROJECT_LEARNINGS.md`のSuccessへ昇格しない。

## Change Policy

- 小規模変更はSmallest Safe Changeを優先する。
- 複数ファイル・保存・Runtime・主要UI変更はBranch / PRを優先する。
- 大規模RewriteをDefaultにしない。ただしVisual Foundation自体が失敗している場合はGuideのFoundation Reset判断を使う。
- 一時Script / Debug / Workflowを残さない。
- 高コストBugは `PROJECT_LEARNINGS.md` とRegression Guardを更新する。
- AI生成Codeも最終CommitのStatic / Browser / Regression / Security基準を通す。

## Completion

- [ ] 要求された変更を実装
- [ ] `node scripts/validate.mjs`
- [ ] `node tests/storage.test.mjs`
- [ ] 該当するBrowser / Visual / IndexedDB / ZIP Checklistを確認、または未確認と記録
- [ ] 最終Commit / Merge CommitのCI / Pages結果を確認
- [ ] README / SPEC / 作業報告 / PROJECT_LEARNINGSを必要に応じて更新
- [ ] 未確認事項を明示
