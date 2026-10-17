# HenrikDev API 単一試合検証

## 目的と安全性

VReviewに戦績を統合する前に、**自分の試合1件**だけでHenrikDev API v4の実データ形式を確かめます。この段階では試合履歴の一括取得、DB保存、Electronへのキー受け渡しは行いません。

- 対象API: GET https://api.henrikdev.xyz/valorant/v4/match/{affinity}/{match_id}
- region: ap / eu / na / kr（日本は通常ap）
- 認証: APIキーをAuthorizationヘッダーに付与
- 応答: metadata、players、teams、rounds、killsの有無と件数だけ表示
- キー・名前・PUUID・生の試合データは出力・保存しません。
- リトライや自動連続アクセスは行わず、ゲームプロセスへもアクセスしません。

## Windows PowerShellから試す

1. 自身のデータを使うこととAPI利用条件を確認します。
2. [HenrikDev Dashboard](https://api.henrikdev.xyz/dashboard/) で無料Basicキーを発行します。Discord参加を求められる場合があります。
3. キーはチャット・GitHub・ソースコード・ブラウザ画面へ貼らず、ローカルのPowerShellで非表示入力します。

```powershell
$secret = Read-Host 'HenrikDev API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:HENRIKDEV_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Variable secret,ptr -ErrorAction SilentlyContinue
}

# 自分の実際の試合UUIDに差し替える
node scripts/henrik-match-probe.mjs --region ap --match-id 11111111-2222-3333-4444-555555555555

# 完了後にこのPowerShellセッションの環境変数を削除
Remove-Item Env:HENRIKDEV_API_KEY -ErrorAction SilentlyContinue
```

成功時は人数・ラウンド数・キルイベント数・metadataの**フィールド名だけ**が表示されます。
401は認証、403は権限、404は試合ID・地域・API未収録、429は利用制限を確認します。データ構造が想定外ならSCHEMA_MISMATCHになります。

## ダミーテスト（実APIを呼ばない）

```powershell
node --test tests/henrik-match-probe.test.mjs
```

ダミーテストの成功は外部APIの認証・実データ取得成功を意味しません。**実APIは本人のキーによる実行まで未確認**です。

## 次の段階への移行条件

APIの現行利用条件と本人同意、実レスポンスの正常系・欠損系、データ保持方法を実測で判断します。次の機能開発は別PRとし、キーは公開Web/Rendererへ埋め込まず、Electron Main側の境界を使います。

参考: [HenrikDev公式リポジトリ](https://github.com/Henrik-3/unofficial-valorant-api) / [API v4仕様](https://docs.henrikdev.xyz/api-reference/valorant/get-match-details-v4) / [Riot VALORANT APIポリシー](https://developer.riotgames.com/docs/valorant)
