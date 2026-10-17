# Claude Code 用入口（VReview）

このファイルは、ChatGPTが用意した安全な基礎実装をClaudeへ引き継ぐための入口です。勝手に仕様・正本・既存の優先度を置き換えないでください。

## 作業開始時に読む正本

1. `AGENTS.md` / `README.md` / `SPEC.md` / `PROJECT_LEARNINGS.md` / `作業報告書.md`
2. `docs/CLAUDE_HANDOFF_HENRIK.md`（今回の作業目標、現状、未確認事項、完了条件）
3. `docs/HENRIK_API_PROBE.md` / `docs/HENRIK_PERSONAL_MATCH_ANALYSIS.md`
4. `EliteMay/web-project-guide` の**最新** `README.md` / `START_HERE.md` と、今回の作業に関係するOwner Rule。記憶や古いチェックアウトを最新版とみなさない。
5. 既存テストと変更対象コード。現在のGitHub PR / ブランチ / CIも再取得する。

## 進め方

- 現在のHenrikDev機能は**Draft PR #12（基本API）とDraft PR #13（個人分析）**で開発中。両方とも `main` 未マージ。PR #13はPR #12のheadから派生。
- 既存のVReview（Electron録画、Input Telemetry、Tracker Collector、GitHub Pages）を維持。いきなり全面リライトしない。
- まず実試合のレスポンスと集計が合うか、個人情報を残さず検証。外部APIの仕様は公式情報で確認し、テストのMock成功を実API成功と混同しない。
- 追加料金0円を優先。ゲームプロセスへの侵入・メモリ読み取り・入力操作はしない。
- 秘密キー、Riot ID、PUUID、他人の生試合JSONをGitHub・PR・ログ・AIへの入力にコピーしない。
- 調査 → 最小実装 → テスト → Evidence記録 → Draft PR、の順に進める。既存変更の消去、無断マージ、公開、依存追加、データ削除は避ける。
- 不明点を推測で修正し続けず、エラー・実データの形・再現手順から原因を特定する。

**最初の実装対象と完了条件は必ず `docs/CLAUDE_HANDOFF_HENRIK.md` を参照してください。**
