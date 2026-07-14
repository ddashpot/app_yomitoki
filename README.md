# よみとき — 文章カメラ（PWA）

文章をカメラで撮影し、原文に忠実なまま対象者に合わせて説明し、**オープンソース音声**で読み上げる PWA です。
設定（エンドポイント・トークン）と**読み解き結果**は **Google Drive** に保存できます。HTML + JavaScript のみで動きます。

## 読み上げについて（重要）

- ブラウザ内蔵の音声機能（Web Speech API）は**使いません**。
- オープンソースの **eSpeak NG** を WebAssembly 化したもの（`espeak-ng.js` / `espeak-ng.wasm`）を**同梱**し、
  テキストから音声(WAV)をアプリ内で生成して再生します。**オフラインでも読み上げ可能**です。
- ライセンスは **GPLv3**（同梱の `espeak-ng.LICENSE.txt`、原典 https://github.com/espeak-ng/espeak-ng ）。
- 読み上げ音声は eSpeak の言語コードで設定できます（既定 `ja`）。速度は再生時に選べます。
- eSpeak NG の音声は合成的（ロボット的）です。自然な音声が必要な場合は、別の OSS 音声モデルへ差し替え可能な構成にしています（`tts.js`）。

## ファイル構成（すべて同じフォルダに置く）

- `index.html` / `styles.css` / `app.js` — 画面・ロジック
- `tts.js` — 読み上げ（eSpeak NG ラッパー）
- `espeak-ng.js` / `espeak-ng.wasm` — 読み上げエンジン本体（約18MB）
- `espeak-ng.LICENSE.txt` — eSpeak NG のライセンス（GPLv3）
- `gdrive.js` — Google Drive 連携
- `manifest.json` / `sw.js` — PWA 設定・オフライン起動
- `icon-192.png` / `icon-512.png` / `icon-maskable-512.png` — アイコン

## 1. 配信（HTTPS 必須）

PWA・カメラ・サービスワーカー・Google 連携・WASM 読み込みは https が必要です（開発時は `localhost` も可）。
GitHub Pages / Cloudflare Pages / Netlify / Vercel などにフォルダごと置くのが簡単です。
ローカル確認: フォルダ内で `python3 -m http.server 8000` → `http://localhost:8000`。

## 2. API 設定（右上 ⚙）

- **API形式**: `Anthropic（Claude）` または `OpenAI 互換（Chat Completions）` を選択。
  - Anthropic … ボディは Messages 形式、画像は base64。`api.anthropic.com` では `x-api-key` とブラウザ直アクセス用ヘッダを付与。
  - OpenAI 互換 … ボディは Chat Completions 形式（`messages[].content` に `text` と `image_url` を格納、画像は data URL）。`Authorization: Bearer <トークン>` を付与。応答は `choices[0].message.content` から取り出します。OpenRouter・LM Studio・vLLM など OpenAI 互換サーバも同じ形式で使えます。
  - ※ 形式を切り替えるとエンドポイント／モデル欄の既定値を自動で入れ替えます（`gpt-4o` など）。
- **エンドポイント**: 既定は形式に応じて `.../v1/messages` または `.../v1/chat/completions`。
- **トークン**: API キー。
- **モデル**: 例 `claude-sonnet-5` / `gpt-4o` など、使う形式に合わせて。
- **読み上げ音声**: eSpeak 言語コード（既定 `ja`）。
- これらはこの端末に保存され、Google 接続中は Drive にも同期されます。

> ブラウザから直接呼ぶため、エンドポイントが**ブラウザからのアクセス（CORS）を許可**している必要があります。OpenAI 本家 API はブラウザ直呼び出しを想定していないため、CORS で失敗する場合はプロキシや OpenAI 互換サーバをご利用ください。

## 3. Google Drive 連携（任意・設定と結果を保存）

1. **Google Cloud Console** でプロジェクト作成 → **Google Drive API** を有効化。
2. **OAuth 同意画面** を設定。スコープ: `.../auth/drive.file`、`.../auth/drive.appdata`。
3. **OAuth クライアントID（ウェブアプリ）** を作成し、**承認済みの JavaScript 生成元** にアプリの URL を追加
   （例 `https://yourname.github.io`、ローカルは `http://localhost:8000`）。
4. **クライアントID**（`xxxx.apps.googleusercontent.com`）を ⚙ に入力 →「Googleに接続」。

保存先:
- 設定 … Drive の非表示アプリ領域に `yomitoki-config.json`
- 読み解き結果 … Drive 内フォルダ **「よみとき」** に `よみとき_日時_対象者.txt`（結果の下に「開く」リンク）

## 4. 使い方

1. 「カメラ」で撮影、または「画像を選ぶ」
2. 対象者を選ぶ（初期6種。「対象者を管理」で追加・編集・削除。特徴に応じて説明を自動調整）
3. 「この文章を説明する」→ 原文と説明を表示（接続時は Drive に自動保存）
4. 説明の下の「▶ 読み上げ」で音声再生（初回はエンジン読み込みに少し時間がかかります）

## 忠実性について

原文をそのまま文字起こしして先に表示し、説明は原文の内容だけに基づかせます。原文にない補足や判読不能箇所は「補足・注意」欄に分離します。

## 注意

- ブラウザから直接 API を呼ぶため、Anthropic では `anthropic-dangerous-direct-browser-access` を使用。共有端末にトークンを保存しないでください。
- 初回の読み上げ時に約18MB の WASM を読み込みます（以降はキャッシュされ高速・オフライン可）。
