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

## Project

- Purpose: VALORANT Clipから戦闘Scene候補を検出・修正し、Detector改善と将来のChatGPT AIM / Movement Reviewへつなげる。
- Main entry point: `review.html`
- Deployment: GitHub Pages
- Project Profiles: `STATIC + MEDIA + AI-HANDOFF + TOOL`
- Adopted Guide Version: `project-meta.json` / `js/version.js` を確認する。

## Commands

```bash
node scripts/validate.mjs
node tests/storage.test.mjs
```

Browser / Media / Layoutは `tests/BROWSER_CHECKLIST.md` を使い、実行できなかった確認を成功扱いにしません。

## Non-breakable Rules

詳細は `SPEC.md` を正本とします。

- GitHub Pages対応を維持する。
- OpenAI API等の有料APIを必須にしない。
- 元動画をユーザー操作なしに外部送信しない。
- Detector結果は必ず手動修正可能にする。
- PC版New Reviewは中央動画固定 + 右Scene PaneのみScrollを維持する。
- Detector RuntimeをVersioned Patch JSへ戻さない。
- 既存保存データをMigration / Backupなしに破棄しない。
- Detector判定ロジック変更は複数ClipのRegression Evidenceなしに単一Clip最適化しない。
- 実ブラウザ未確認を確認済みと扱わない。

## Architecture / File Ownership

| Area | Canonical file / directory | Notes |
|---|---|---|
| Runtime Version | `js/version.js` | App / Detector / Feedback / Schema / Guide / Build |
| Detector | `js/detector.js` | 単一Pipeline。Versioned Patchを増やさない |
| Storage | `js/storage.js` | Storage Schema v1 + legacy read compatibility |
| Scene UI | `js/ui.js` | Scene state / render / manual editing |
| Review controller | `js/app.js` | Video / Detector / Feedback orchestration |
| Diagnostics | `js/diagnostics.js` | Local-only development diagnostics |
| Feedback Package | `js/feedback-package-v5.js` | Package Format v5 |
| Import Test | `js/detector-test.js` | Feedback ZIP validation / aggregate |
| Specification | `SPEC.md` | 現行Project仕様 |
| Long-term learnings | `PROJECT_LEARNINGS.md` | 再発防止価値の高い知見 |
| Tests | `scripts/`, `tests/` | Static / Regression / Browser checklist |

## High-risk Areas

- Storage / Migration: Draft / Backup / legacy v0.5.0以前形式。
- Media: Blob URL cleanup、Codec、Canvas frame extraction、長尺動画Performance。
- Detector: Recall / Precision trade-off、固定ROI、未知Clip汎化。
- AI-HANDOFF: ZIP / JSON Version、Import Validation、元動画Privacy。
- Layout: fixed video + right-only scroll、低い縦解像度、Zoom。

## Change Policy

- 小規模変更はSmallest Safe Changeを優先する。
- 複数ファイル・保存・Runtime・主要UI変更はBranch / PRを優先する。
- 大規模RewriteをDefaultにしない。
- 一時Script / Debug / Workflowを残さない。
- 高コストBugは `PROJECT_LEARNINGS.md` とRegression Guardを更新する。
- AI生成Codeも最終CommitのStatic / Browser / Regression / Security基準を通す。

## Completion

- [ ] 要求された変更を実装
- [ ] `node scripts/validate.mjs`
- [ ] `node tests/storage.test.mjs`
- [ ] 該当するBrowser Checklistを確認、または未確認と記録
- [ ] 最終Commit / Merge CommitのCI / Pages結果を確認
- [ ] README / SPEC / 作業報告 / PROJECT_LEARNINGSを必要に応じて更新
- [ ] 未確認事項を明示
