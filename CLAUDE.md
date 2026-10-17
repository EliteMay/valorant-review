# Claude Code 用入口（VReview）

このファイルは、ChatGPTを主担当として開発し、難所だけClaudeに相談する際の入口です。Claudeは指示された範囲の専門的な調査・修正を支援します。勝手に仕様・正本・既存の優先度を置き換えないでください。

## 最新の役割分担（2026-10-17、ユーザー指定）

- **ChatGPTが通常の調査、実装、テスト、GitHub管理、結果のレビューを担当する。** 必要な判断ができる限りClaudeへの丸投げをしない。
- **Claudeへの依頼は難しい技術課題、原因が特定できない障害、追加の専門的なレビューが有益な場合に限る。** 先にChatGPT側で現象・再現条件・ログ・仮説・失敗した検証・期待する成果物を整理し、Claudeが無駄な再調査をせずに検証できるようにする。
- Claudeへ依頼できる接続手段が利用できない場合、ChatGPTがGitHubのPR・依頼文・安全に匿名化した診断結果を整え、ユーザーによるClaudeへの受け渡しを最小限にする。直接接続していないのにClaudeへ依頼済みと宣言しない。
- Claudeの提案・実装はChatGPTが差分・テスト・実データの根拠をレビューしてから採用する。重要な設計やユーザー意図はChatGPTが管理する。
- 以前のClaude引き継ぎ書は過去の経緯として残す。現行運用に関してこの節を優先する。

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
