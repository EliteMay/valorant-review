# HenrikDev 個人試合分析（段階的プレビュー）

## 機能範囲

本人のRiot ID（名前 / タグ）に一致した**1試合の本人のデータだけ**を、HenrikDev API v4で読み取り専用取得して集計します。結果はメモリ内のみで解析し、ディスク・GitHub・チャットへ実試合JSONやAPIキーを自動保存・送信しません。

- K/D/A、マップ、エージェント、勝敗（確認可能なら）、参考ACS
- ファーストキル / ファーストデス: ラウンド内の時刻付き最初の敵チームへのキルから算出
- 同時刻、欠損、同チームキルは除外。解析対象ラウンド数も表示
- トレード率・攻守別成績・録画との同期は未実装
- 1試合から因果的な「負けた原因」を断定しない

## 試し方（Windows PowerShell）

既存のVReview検証用ディレクトリに変更を加えず、追加作業を別ブランチで試します。

```powershell
cd D:\AI\vreview-api-test
git status --short
git fetch origin feat/henrik-personal-match-analysis-20261017
git switch -c feat/henrik-personal-match-analysis-20261017 FETCH_HEAD
```

`git status --short` に出力がある場合は既存の作業が残っているため、切替前に変更内容を確認してください。すでに対象ブランチがある場合は `git switch feat/henrik-personal-match-analysis-20261017` を使用します。`reset --hard` や `force` は使用しないでください。

**キーやRiot IDはこのチャットに貼らず、PCだけで入力します。** 以下のコードは、処理の成功・失敗にかかわらず環境変数を消去します。

```powershell
$secret = Read-Host 'HenrikDev API Key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:HENRIKDEV_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Variable secret,ptr -ErrorAction SilentlyContinue
}

$env:VREVIEW_PLAYER_NAME = Read-Host '自分のRiot ID（#より前）'
$env:VREVIEW_PLAYER_TAG = Read-Host '自分のタグ（#より後）'
try {
  node scripts/henrik-match-analyze.mjs --region ap --match-id 422d974d-cb1b-4193-ba8f-e1be8b0faeac
} finally {
  Remove-Item Env:HENRIKDEV_API_KEY,Env:VREVIEW_PLAYER_NAME,Env:VREVIEW_PLAYER_TAG -ErrorAction SilentlyContinue
}
```

## 読み方と限界

- `estimatedAcs`: 全ラウンド数を分母にした `stats.score / rounds.length`。中途参加・途中退場等では公式ACSと一致しないことがあります。
- `opening.firstKills` / `firstDeaths`: 最初の有効な敵対キルイベントに対する当事者かどうかを集計。
- `opening.evaluatedRounds`: 先制キルの順序を判定できたラウンド数。キルイベントのないラウンドは対象外。
- `opening.excludedRounds`: キル情報があるが先制キルを決められなかったラウンド数。
- `null` / `未確認`: 推測で埋めていません。
- 実データの `PLAYER_NOT_FOUND` や未知フィールドが出た場合、個人情報入りの元レスポンスを貼らず、**エラーコードだけ**共有してください。

## 検証

```powershell
node --test tests/henrik-match-probe.test.mjs
node --test tests/henrik-match-analyze.test.mjs
```

Mock成功は実HenrikDev応答のフィールドを完全には保証しません。実試合での分析成功は別途確認します。

公式仕様: https://docs.henrikdev.xyz/api-reference/valorant/get-match-details-v4
