# ChatGPT → Claude 実装引き継ぎ: VReview HenrikDev 戦績分析

更新日: 2026-10-17 / **Claude実行前に現行GitHub・CI・API公式仕様を再確認**

## 0. 目的と役割

ユーザーの目標: **VALORANTでK/DやMVPを取っても負ける原因を、自分の戦績・ラウンドイベント・将来的には録画から比較・検証できる個人用VReviewを作る。**

- ChatGPT担当: 技術調査、HenrikDev API実試合1件の接続検証、単一試合解析CLIの基礎、Mockテスト、機密情報境界、GitHub Draft PRを準備。
- Claude担当: この基礎と既存VReviewを継承し、実試合での指標検証 → 複数試合の安全な比較 → 本体画面との統合へ段階的に実装。
- 目標は実際に使える分析アプリ。コード追加だけでは完了しない。変化と指標の統計的関係を示すのと、負けた**原因を断定**することは別。

## 1. 現在の確定事実

- Repo: `EliteMay/valorant-review` / default: `main`。公開既存版 v0.12.1 は録画、Input Telemetry、Tracker Collector、GitHub Pagesを含む。
- PR #12: https://github.com/EliteMay/valorant-review/pull/12  
  `feat/henrik-match-probe-20261017` / **Draft・未マージ** / 基本API検証とMock 6件。
- PR #13: https://github.com/EliteMay/valorant-review/pull/13  
  `feat/henrik-personal-match-analysis-20261017` / **Draft・未マージ** / #12から派生、個人向け分析CLIとMock 8件。
- ChatGPT側で確認したCI: #12 の Linux Validate、Windows Electronとも `success`（head `dc219596932380eae39f744c5dc989b895250531`）。#13の引き継ぎ文書追加**前**のhead `acfde8ba7d676ac6dfcc60760e630cff57e7083d` でもLinux Validate、Windows Electronとも `success`。**新headに対して改めてチェックすること**。
- ユーザーが2026-10-17、自分のWindows PCでAPIキーを使って `GET /valorant/v4/match/ap/422d974d-cb1b-4193-ba8f-e1be8b0faeac` を実行。出力 `ok: true`、`players: 10`、`teams: 2`、`rounds: 24`、`kills: 180`。これは**基本接続と配列の存在確認のみ**であり、KDA・FK・FDの値が合っている証拠ではない。
- 利用するAPI: HenrikDev VALORANT API v4。公式仕様: https://docs.henrikdev.xyz/api-reference/valorant/get-match-details-v4 。Riotの公式APIではない。本人データの取り扱い・サービスの利用条件を遵守。
- **APIキー・Riot ID・PUUID・実レスポンスの全文はGitHubにも会話にも保存していない。Claudeにも送らない。**

## 2. 既存実装（ChatGPT作成）

| 対象 | 役割 |
|---|---|
| `scripts/henrik-match-probe.mjs` | 地域と試合UUIDの検証、秘密キーによる単一GET、15秒Timeout、リダイレクト不可、12MiBサイズ制限、レスポンス構造検証 |
| `scripts/henrik-match-analyze.mjs` | 自分のRiot IDからプレイヤー1人を特定し、K/D/A、参考ACS、エージェント、勝敗、FK/FDの計算 |
| `tests/henrik-match-probe.test.mjs` | API構造・入力・秘密情報・失敗系のオフラインテスト |
| `tests/henrik-match-analyze.test.mjs` | 個人分析の8件のオフラインテスト（結果・欠損・プライバシー等） |
| `docs/HENRIK_API_PROBE.md` | 安全なAPIキー設定と実API単一試合検証 |
| `docs/HENRIK_PERSONAL_MATCH_ANALYSIS.md` | Windowsで本人の集計を実行する手順、指標の解釈 |
| `SPEC.md` / `AGENTS.md` / `PROJECT_LEARNINGS.md` | 既存設計・破壊禁止事項・既知の問題と解決策 |

現状の解析はメモリ内のCLIだけ。本体UI連携、ローカルDB、複数試合の自動比較は**未実装**。Claudeが `main` のコードだけを見ると追加コードは見えないので、**必ずPR #13のhead/branch**を確認すること。

## 3. 最初のClaude作業（ここを先に完了）

**作業範囲:** 「単一試合の実データから、本人のKDA・勝敗・先制キル/デスを正しく測定できると確認する」。この検証が通るまでUI、SQLite、複数試合同期へ広げない。

1. `EliteMay/web-project-guide` 最新の `README.md` / `START_HERE.md` / 今回関係するOwner、VReviewの `AGENTS.md` / `SPEC.md` / `PROJECT_LEARNINGS.md` を実際に読み、現行PR・差分・CIを再取得する。
2. 現行`feat/henrik-personal-match-analysis-20261017`をベースに、**既存コードの仕様を把握**。Mockにしかない仮定は公式API v4仕様と照合する。
3. 初回の実APIはユーザーのPC上だけで行う。Claudeが自動実行できなければ、秘密情報を表示しない最短コマンドだけ案内。**キーをClaudeのチャット、GitHub、PR、stdout、CI secretsに送るよう指示しない。**
4. 実出力と仕様から、`player.team_id`・`player.stats`・`team.won`・`kill.round`・`kill.killer/victim.team`・`time_in_round_in_ms`などを検証する。返却値が異なれば**必要なフィールド名・値の型だけ**を匿名化した診断モードで確認し、実プレイヤー名/PUUID/生レスポンスは保持しない。
5. 欠損・同時刻・ラウンド番号・キルなしラウンド・チームキル・降参/途中抜け等で誤算しないようにする。`stats.score / rounds.length` は**参考ACSであり公式ACSとは断定しない**。FK/FDはラウンド最初の敵対キルに基づく定義を明示する。
6. 確認できた範囲の実装とRegressionテストを追加。実試合で確認した指標／未確認の指標を分離して記録。
7. 差分の整合性・Nodeテスト・Windows CIを確認し、Draft PRへ結果・変更・未確認事項・次の実施対象を記録する。**ユーザーの明示承認なしにマージ・公開しない**。

**第一段階の完了条件 (DoD):** 
- 正しいフィールド構造で本人1人を特定し、KDA/勝敗/FK/FDのうち**検証済み指標だけ**を表示。
- 実データと模擬テストの根拠が明示され、重要な失敗系のテストが成功。
- APIキー/個人識別子の漏洩がない。既存の録画・Collector・Pagesは壊していない。
- 必要なGitHub CIが成功し、実Windows操作の未確認点を完了済みに見せない。
- 次段階へ移れる状態をGitHub PRの更新で復元できる。

## 4. 第一段階の後の実装順（別の目標として分ける）

**Phase 2: 複数試合を安全に比較。** 本人の許可範囲とHenrikDevの利用規定に沿って、直近の試合を取り込み、match_idで重複防止。最初は少量かつ手動更新。SQLite等に必要な匿名化・正規化された指標だけ保存し、Backup/Restoreと既存データ保護を設計。MVP敗北・勝利・攻撃/防御・マップ/エージェント別の傾向を表示する。分析の母数と不確実性を常に見せる。

**Phase 3: VReview Electron UIへの統合。** 既存のRecorder / Tracker Collector / Video Reviewを保持し、表示・フィルタ・比較を追加。秘密キーはprivilegedなMain側だけで扱い、Rendererに露出しない。MeaningfulなUI変更前にGuideのVisual/Task Flow研究を行い、Windows実機と画面検証も必要。

**Phase 4: 録画との照合・高度分析。** ラウンドイベントと録画を時間同期して、視点移動やピークの改善仮説を検証。動画由来の推定と試合イベント由来の事実を混同しない。過剰なAI自動評価や有料APIを必須にしない。

ユーザーの新しい目標変更がない限り、上記の順序・追加料金0円・安全性を優先。Phase 2以降を一気に実装してPhase 1未確認を隠さない。

## 5. 重要な禁止事項・リスク

- 公開GitHub/Pages・Electron Renderer・ログにAPIキーや他プレイヤーの個人識別子を保存しない。
- Riot/Vanguardのメモリ・プロセス・通信内容を読み取らない。ゲーム入力自動化・オーバーレイでのリアルタイム指示もしない。
- Tracker.ggの非公開APIやDOM Scrapingを増やさない。HenrikDev側の同意・利用条件を優先。
- 現行`main`上の録画、WindowsネイティブHelper、NSIS配布、GitHub Pagesの互換性を失わない。
- 別ブランチの変更に対して `reset --hard`、force push、無断の上書き/削除をしない。
- `#12`と`#13`は依存関係がある。#13は現在`main`をbaseにしているため**#12の変更もdiffに含む**。マージ順序と必要ならPR base調整を理解して行う。
- 「CI successful」≠「ユーザーPCで正常に使えた」。各検証のレベルを区別する。

## 6. Claudeの開始チェックと実行例

Claude CodeがGitHubリポジトリを直接開けるなら、PR #13のbranchを選び、最初に `CLAUDE.md` とこの文書を読む。

ユーザーPCの既存クローン `D:\AI\vreview-api-test` を使う場合、作業ツリーに変更がないことを確認してから:

```powershell
cd D:\AI\vreview-api-test
git status --short
git fetch origin feat/henrik-personal-match-analysis-20261017
git switch -c feat/henrik-personal-match-analysis-20261017 FETCH_HEAD
npm test
```

既にローカルブランチが存在する場合は`git switch`、Dirtyならその変更を先に保護。勝手な上書きをしない。`npm test`は既存のWindows PowerShell / ネイティブヘルパーの検証を含むため、実行環境の条件を確認する。

最後に、PR URL・確認できた結果・未完了・追加費用の有無・**ユーザーが本当に行う必要のあることだけ**を日本語で報告する。
