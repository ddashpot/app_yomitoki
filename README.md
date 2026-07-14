# よみとき CORS プロキシ（Cloudflare Worker）

ブラウザ（PWA）から直接呼べない API ゲートウェイに **CORS を付けて中継**する Worker です。
`auth-gtw.ddashpot.com` のように、サーバからは叩けてもブラウザから CORS で弾かれる宛先を通せるようにします。

- クライアントの `Authorization`（トークン）はそのまま上流へ転送します（プロキシ自体はトークンを保存しません）。
- 中継するのは `/v1/...` パスのみ（オープンプロキシ化の防止）。
- 上流URLは `wrangler.jsonc` の `vars.UPSTREAM` で設定します（既定 `https://auth-gtw.ddashpot.com`）。

## 必要なもの

- Node.js（18 以上推奨）
- Cloudflare アカウント（無料枠で可）

## デプロイ手順

```bash
cd cf-proxy
npm install
npx wrangler login      # ブラウザでCloudflareにログイン
npm run deploy          # = npx wrangler deploy
```

デプロイに成功すると、次のような URL が表示されます:

```
https://yomitoki-cors-proxy.<あなたのサブドメイン>.workers.dev
```

## アプリ側の設定（よみとき）

⚙設定で、エンドポイントをプロキシ経由に変更します（パスはそのまま `/v1/chat/completions`）。

- API形式: **OpenAI 互換**
- エンドポイント: `https://yomitoki-cors-proxy.<あなたのサブドメイン>.workers.dev/v1/chat/completions`
- トークン: これまでどおり（`agk_...`）
- モデル: `google-ai-studio/gemini-2.0-flash` など

## 動作確認

```bash
# ヘルスチェック
curl https://yomitoki-cors-proxy.<...>.workers.dev/health

# 実リクエスト（トークンとモデルは自分のものに）
curl -X POST "https://yomitoki-cors-proxy.<...>.workers.dev/v1/chat/completions" \
  -H "Authorization: Bearer <あなたのトークン>" \
  -H "Content-Type: application/json" \
  -d '{"model":"google-ai-studio/gemini-2.0-flash","messages":[{"role":"user","content":"hi"}]}'
```

ブラウザからのプリフライト確認:

```bash
curl -i -X OPTIONS "https://yomitoki-cors-proxy.<...>.workers.dev/v1/chat/completions" \
  -H "Origin: https://yourname.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
# → 204 と Access-Control-Allow-* ヘッダが返ればOK
```

## 上流を変えたい場合

`wrangler.jsonc` の `vars.UPSTREAM` を書き換えて再デプロイ、
または Cloudflare ダッシュボードの Variables で `UPSTREAM` を設定します。

## ローカル実行

```bash
npm run dev   # http://localhost:8787 で起動
```

## 注意

- トークンはクライアント→プロキシ→上流へ素通しします。プロキシURLを知る第三者が有効なトークンを持っていれば利用できてしまう点は、通常のAPIと同じです。心配な場合は `Access-Control-Allow-Origin` を自分のアプリのオリジンに限定する、簡易な合言葉ヘッダを要求するなどの追加対策が可能です（必要なら対応します）。
- 会話でトークンを共有された場合は、念のため再発行をおすすめします。
