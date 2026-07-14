// よみとき CORS プロキシ（Cloudflare Worker）
// ブラウザ(PWA)から直接呼べない API ゲートウェイに、CORS を付けて中継します。
// クライアントの Authorization ヘッダ（トークン）はそのまま上流へ転送します。
// 上流URLは wrangler.jsonc の vars.UPSTREAM で設定します。

const DEFAULT_UPSTREAM = "https://auth-gtw.ddashpot.com";
const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "authorization, content-type, accept";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const cors = corsHeaders(origin);

    // プリフライト
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // 簡易ヘルスチェック
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "yomitoki-cors-proxy" }, 200, cors);
    }

    // オープンプロキシ化を防ぐため API パスのみ中継
    if (!url.pathname.startsWith("/v1/")) {
      return json({ error: "Not found. Use /v1/... paths." }, 404, cors);
    }

    const upstreamBase = (env && env.UPSTREAM ? env.UPSTREAM : DEFAULT_UPSTREAM).replace(/\/+$/, "");
    const target = upstreamBase + url.pathname + url.search;

    // 必要なヘッダのみ転送（Host などは fetch が上流向けに設定する）
    const fwd = new Headers();
    const auth = request.headers.get("Authorization");
    if (auth) fwd.set("Authorization", auth);
    const ct = request.headers.get("Content-Type");
    if (ct) fwd.set("Content-Type", ct);
    const accept = request.headers.get("Accept");
    if (accept) fwd.set("Accept", accept);

    const hasBody = request.method !== "GET" && request.method !== "HEAD";

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: fwd,
        body: hasBody ? request.body : undefined,
        // ストリーミング本文を転送する場合に必要
        ...(hasBody ? { duplex: "half" } : {}),
      });
    } catch (err) {
      return json({ error: "Upstream fetch failed", detail: String(err) }, 502, cors);
    }

    // 上流応答をそのまま流しつつ CORS を付与
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("Cache-Control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
