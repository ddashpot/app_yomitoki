"use strict";

/* ---------- 初期データ ---------- */
const DEFAULT_AUDIENCES = [
  { id: "p_kids", name: "小学生", description: "小学生。やさしい言葉と短い文で。むずかしい漢字や専門用語は身近な言葉に言いかえ、たとえ話を交える。" },
  { id: "p_jhs", name: "中学生", description: "中学生。基本的な用語は使ってよいが、専門用語には短い説明を添える。理由や仕組みも軽く触れる。" },
  { id: "p_adult", name: "一般の大人", description: "その分野の専門知識がない一般の大人。専門用語はかみくだき、結論と要点を先に示す。" },
  { id: "p_senior", name: "高齢の方", description: "高齢の方。丁寧に、具体例を交えて。手続き・期限・金額など大事な点ははっきり明示する。" },
  { id: "p_novice", name: "予備知識のない人", description: "その話題の前提知識がまったくない人。背景から順を追って、専門用語を避けて説明する。" },
  { id: "p_learner", name: "日本語学習者", description: "日本語を学習中の人。やさしい日本語で、短く明確に。難しい語には言いかえを添える。" }
];
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_FORMAT = "anthropic";
const DEFAULT_TTS_VOICE = "ja";

/* ---------- 状態 ---------- */
const state = {
  audiences: [], selectedId: null,
  image: null, imageMime: "image/jpeg",
  cameraOn: false, stream: null,
  status: "idle", result: null, error: "", editId: null,
  driveSaved: null, driveErr: ""
};

/* ---------- localStorage ---------- */
const LS = { aud: "yt_audiences_v1", key: "yt_token", model: "yt_model", ep: "yt_endpoint", cid: "yt_gclient", tts: "yt_tts_voice", fmt: "yt_api_format" };
function lsGet(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function loadAudiences() {
  try { const raw = localStorage.getItem(LS.aud); if (raw) { const l = JSON.parse(raw); if (Array.isArray(l) && l.length) return l; } } catch (e) {}
  return DEFAULT_AUDIENCES.slice();
}
function saveAudiences() { lsSet(LS.aud, JSON.stringify(state.audiences)); }
const getToken = () => lsGet(LS.key, "");
const getModel = () => lsGet(LS.model, DEFAULT_MODEL);
const getEndpoint = () => lsGet(LS.ep, DEFAULT_ENDPOINT);
const getClientId = () => lsGet(LS.cid, "");
const getTtsVoice = () => lsGet(LS.tts, DEFAULT_TTS_VOICE);
const getFormat = () => lsGet(LS.fmt, DEFAULT_FORMAT);

/* ---------- ショートカット ---------- */
const $ = (id) => document.getElementById(id);
function el(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const audienceById = (id) => state.audiences.find((a) => a.id === id);
const selectedName = () => { const a = audienceById(state.selectedId); return a ? a.name : ""; };

/* ---------- カメラ ---------- */
async function startCamera() {
  state.error = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    state.stream = stream; state.image = null; state.result = null; state.status = "idle"; state.cameraOn = true;
    renderStage(); renderControls(); renderStatus(); syncCTA();
  } catch (e) {
    state.error = "カメラを開始できませんでした。ブラウザのカメラ利用を許可するか、「画像を選ぶ」からアップロードしてください。（PWAはhttps環境で動作します）";
    renderStatus();
  }
}
function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null; state.cameraOn = false; renderStage(); renderControls();
}
function capturePhoto() {
  const v = $("stage").querySelector("video"); const c = $("canvas");
  if (!v) return;
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  state.image = c.toDataURL("image/jpeg", 0.9); state.imageMime = "image/jpeg";
  state.result = null; state.status = "idle"; stopCamera();
  renderStage(); renderControls(); renderStatus(); syncCTA();
}
function onFile(e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.image = reader.result; state.imageMime = file.type || "image/jpeg";
    state.result = null; state.status = "idle"; state.error = "";
    renderStage(); renderControls(); renderStatus(); syncCTA();
  };
  reader.readAsDataURL(file); e.target.value = ""; stopCamera();
}
function resetImage() {
  stopSpeak();
  state.image = null; state.result = null; state.status = "idle"; state.error = "";
  state.driveSaved = null; state.driveErr = "";
  stopCamera(); renderStage(); renderControls(); renderStatus(); syncCTA();
}

/* ---------- 説明生成 ---------- */
async function explain() {
  if (!state.image) return;
  const token = getToken();
  if (!token) { openSettings("説明するには、まず「トークン」を設定してください。"); return; }
  const audience = audienceById(state.selectedId) || state.audiences[0];
  if (!audience) return;

  stopSpeak();
  state.status = "loading"; state.error = ""; state.result = null; state.driveSaved = null; state.driveErr = "";
  renderStatus(); syncCTA();

  const base64 = state.image.split(",")[1];
  const prompt =
`この画像には文章が写っています。次の手順で作業し、必ず最後に指定のJSONだけを出力してください（前置き・後書き・マークダウンのコードフェンス ` + "```" + ` は一切書かないこと）。

【手順】
1. transcription: 画像内の文章を、改行や記号もできる限り原文どおりに文字起こしする。読み取れない箇所は［判読不能］と記す。勝手に補ったり要約したりしない。
2. explanation: 上で文字起こしした原文の内容【だけ】に基づいて、下記の対象者に向けてわかりやすく説明する。原文に書かれていない情報・推測・一般常識の補足は説明本文に混ぜない。対象者の特徴に合わせて、説明の長さ・言葉のむずかしさ・具体例の量を自分で適切に調整する。
3. caveats: 原文だけでは意味が取りづらい点、判読できなかった点、または誤解を避けるための注意があれば簡潔に書く。なければ空文字 "" にする。

【対象者】
名前: ${audience.name}
特徴: ${audience.description}

【出力（このJSONオブジェクトのみ・改行はJSON文字列として\\nでエスケープ）】
{"transcription":"...","explanation":"...","caveats":"..."}`;

  try {
    const endpoint = getEndpoint();
    const fmt = getFormat();
    let host = "";
    try { host = new URL(endpoint).host; } catch (e) { throw new Error("エンドポイントのURLが正しくありません。"); }

    let headers, body;
    if (fmt === "openai") {
      // OpenAI 互換（Chat Completions）: 画像は data URL、応答は choices[].message.content
      headers = { "content-type": "application/json", "authorization": "Bearer " + token };
      body = {
        model: getModel(), max_tokens: 1500,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: state.image } }
        ] }]
      };
    } else {
      // Anthropic（Messages）
      const isAnthropic = /(^|\.)api\.anthropic\.com$/.test(host);
      headers = { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" };
      if (isAnthropic) headers["anthropic-dangerous-direct-browser-access"] = "true";
      body = {
        model: getModel(), max_tokens: 1500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: state.imageMime, data: base64 } },
          { type: "text", text: prompt }
        ] }]
      };
    }

    const res = await fetch(endpoint, { method: "POST", headers: headers, body: JSON.stringify(body) });
    const data = await res.json();

    if (!res.ok || (data && data.error)) {
      if (res.status === 401 || res.status === 403) throw new Error("トークンが正しくないか、権限がありません。設定を確認してください。");
      const em = data && data.error ? (data.error.message || data.error) : ("HTTP " + res.status);
      throw new Error(typeof em === "string" ? em : JSON.stringify(em));
    }

    let outText = "";
    if (fmt === "openai") {
      const msg = (((data.choices || [])[0]) || {}).message || {};
      outText = msg.content || "";
      if (Array.isArray(outText)) outText = outText.map((p) => (p && p.text) ? p.text : "").join("\n");
    } else {
      if (!Array.isArray(data.content)) throw new Error("予期しない応答が返りました。");
      outText = data.content.filter((i) => i.type === "text").map((i) => i.text).join("\n");
    }

    const clean = String(outText).replace(/```json|```/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(clean); }
    catch (e) { const m = clean.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} } }

    if (parsed && (parsed.transcription || parsed.explanation)) {
      state.result = { transcription: parsed.transcription || "", explanation: parsed.explanation || "", caveats: parsed.caveats || "" };
    } else if (clean) {
      state.result = { transcription: "", explanation: clean, caveats: "" };
    } else { throw new Error("空の応答が返りました。"); }

    state.status = "done"; state.error = "";
    renderStatus(); syncCTA();
    saveResultToDrive(audience);
  } catch (e) {
    state.status = "error";
    state.error = (e && e.message) ? e.message : "読み取りに失敗しました。明るい場所で撮り直すか、もう一度お試しください。";
    renderStatus(); syncCTA();
  }
}

/* ---------- 結果をDriveへ保存 ---------- */
function pad(n) { return String(n).padStart(2, "0"); }
function stamp() { const d = new Date(); return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()); }
function human() { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40); }
function buildResultText(r, a) {
  return [
    "【よみとき】読み解き結果", "日時: " + human(), "対象者: " + a.name, "特徴: " + a.description, "",
    "■ 読み取った原文", r.transcription || "(なし)", "",
    "■ わかりやすい説明（" + a.name + "向け）", r.explanation || "",
    r.caveats ? "\n■ 補足・注意\n" + r.caveats : ""
  ].join("\n");
}
async function saveResultToDrive(audience) {
  if (!GDrive.isConnected()) return;
  try {
    const fname = "よみとき_" + stamp() + "_" + safeName(audience.name) + ".txt";
    const info = await GDrive.saveResult(fname, buildResultText(state.result, audience));
    state.driveSaved = (info && info.webViewLink) ? info.webViewLink : true;
    state.driveErr = "";
  } catch (e) {
    state.driveSaved = null; state.driveErr = "Google Driveへの保存に失敗しました。";
  }
  renderStatus();
}

/* ---------- 読み上げ（eSpeak NG / オープンソース） ---------- */
let ttsMode = "idle";   // idle | loading | playing
let ttsWpm = 175;       // eSpeak words-per-minute
let ttsBtnRef = null;
function renderTtsBtn() {
  if (!ttsBtnRef) return;
  let label = '<span class="g">▶</span> 読み上げ';
  if (ttsMode === "loading") label = "音声を生成中…";
  else if (ttsMode === "playing") label = '<span class="g">■</span> 停止';
  ttsBtnRef.innerHTML = label;
  ttsBtnRef.classList.toggle("playing", ttsMode === "playing");
  ttsBtnRef.disabled = (ttsMode === "loading");
}
function stopSpeak() { try { TTS.stop(); } catch (e) {} ttsMode = "idle"; renderTtsBtn(); }
async function toggleSpeak() {
  if (ttsMode === "playing" || ttsMode === "loading") { stopSpeak(); return; }
  const r = state.result; if (!r) return;
  if (!TTS.supported()) { state.error = "この端末は読み上げに対応していません。"; renderStatus(); return; }
  let text = r.explanation || "";
  if (r.caveats) text += "。補足。" + r.caveats;

  ttsMode = "loading"; renderTtsBtn();
  try {
    await TTS.play(text, {
      voice: getTtsVoice(), wpm: ttsWpm,
      onend: () => { ttsMode = "idle"; renderTtsBtn(); },
      onerror: () => { ttsMode = "idle"; renderTtsBtn(); }
    });
    ttsMode = "playing"; renderTtsBtn();
  } catch (e) {
    ttsMode = "idle";
    state.error = "読み上げ音声の生成に失敗しました。時間をおいて再度お試しください。";
    renderStatus();
  }
}

/* ---------- 描画 ---------- */
function renderStage() {
  const s = $("stage"); s.innerHTML = "";
  if (state.cameraOn) {
    const v = document.createElement("video");
    v.setAttribute("playsinline", ""); v.muted = true; v.playsInline = true;
    s.appendChild(v); v.srcObject = state.stream; v.play().catch(() => {});
  } else if (state.image) {
    const img = document.createElement("img"); img.src = state.image; img.alt = "撮影した文章"; s.appendChild(img);
  } else {
    s.appendChild(el("div", "yt-empty", '<div class="ic">文</div><p>説明書・掲示・手紙・記事など<br>文章を写してください</p>'));
  }
}
function makeBtn(glyph, text, fn) {
  const b = el("button", "yt-btn", glyph ? '<span class="g">' + glyph + "</span> " + text : text);
  b.addEventListener("click", fn); return b;
}
function renderControls() {
  const c = $("controls"); c.innerHTML = "";
  if (state.cameraOn) {
    c.appendChild(makeBtn("●", "撮影する", capturePhoto));
    c.appendChild(makeBtn("", "やめる", stopCamera));
  } else {
    c.appendChild(makeBtn("◉", "カメラ", startCamera));
    c.appendChild(makeBtn("▤", "画像を選ぶ", () => $("fileInput").click()));
    if (state.image) c.appendChild(makeBtn("", "消す", resetImage));
  }
}
function renderChips() {
  const wrap = $("chips"); wrap.innerHTML = "";
  if (!state.audiences.length) { wrap.appendChild(el("p", "yt-mini", "対象者がありません。「対象者を管理」から追加してください。")); return; }
  state.audiences.forEach((a) => {
    const chip = el("button", "yt-chip" + (a.id === state.selectedId ? " on" : ""), esc(a.name));
    chip.addEventListener("click", () => { state.selectedId = a.id; renderChips(); syncCTA(); });
    wrap.appendChild(chip);
  });
}
function renderStatus() {
  const area = $("statusArea"); area.innerHTML = ""; ttsBtnRef = null;

  if (state.status === "loading") {
    area.appendChild(el("div", "yt-load",
      '<div class="yt-dots"><i></i><i></i><i></i></div><p>文字を読み取り、' + esc(selectedName()) + "向けにまとめています…</p>"));
    return;
  }
  if (state.error) area.appendChild(el("div", "yt-error", esc(state.error)));

  if (state.status === "done" && state.result) {
    const r = state.result; const box = el("div", "yt-result");

    if (r.transcription) {
      box.appendChild(el("div", "yt-block",
        '<h3>読み取った原文 <span class="tag">そのまま</span></h3><div class="yt-orig">' + esc(r.transcription) + "</div>"));
    }

    const exp = el("div", "yt-block",
      '<h3><span class="mk2">わかりやすい説明</span> <span class="tag">' + esc(selectedName()) + '向け</span></h3><div class="yt-explain">' + esc(r.explanation) + "</div>");
    const tools = el("div", "yt-tools");
    const readBtn = el("button", "yt-tool");
    readBtn.innerHTML = '<span class="g">▶</span> 読み上げ';
    readBtn.addEventListener("click", toggleSpeak);
    ttsBtnRef = readBtn;
    const speed = el("select", "yt-speed");
    [["130", "ゆっくり"], ["175", "標準"], ["210", "はやめ"], ["260", "はやい"]].forEach(([v, label]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = label;
      if (parseInt(v, 10) === ttsWpm) o.selected = true; speed.appendChild(o);
    });
    speed.addEventListener("change", (e) => {
      ttsWpm = parseInt(e.target.value, 10);
      if (ttsMode === "playing" || ttsMode === "loading") { stopSpeak(); toggleSpeak(); }
    });
    const engineTag = el("span", "yt-engine", "eSpeak NG");
    tools.appendChild(readBtn); tools.appendChild(speed); tools.appendChild(engineTag);
    exp.appendChild(tools);
    box.appendChild(exp);

    if (r.caveats) box.appendChild(el("div", "yt-caveat", "<b>補足・注意：</b>" + esc(r.caveats)));

    if (state.driveSaved) {
      const note = el("div", "yt-drive ok");
      if (typeof state.driveSaved === "string") {
        note.innerHTML = 'Google Drive に保存しました ✓ &nbsp;<a href="' + esc(state.driveSaved) + '" target="_blank" rel="noopener">開く</a>';
      } else { note.textContent = "Google Drive に保存しました ✓"; }
      box.appendChild(note);
    } else if (state.driveErr) {
      box.appendChild(el("div", "yt-drive err", esc(state.driveErr)));
    }

    box.appendChild(el("p", "yt-mini",
      "※ 説明は上の原文の内容だけに基づいています。判読できない箇所や補足は原文・注意欄で確認してください。読み上げはオープンソースの eSpeak NG を使用しています。"));
    area.appendChild(box);
    renderTtsBtn();
  }
}
function syncCTA() {
  const b = $("btnExplain"); const busy = state.status === "loading";
  b.disabled = !state.image || busy || !state.selectedId;
  b.textContent = busy ? "読み取り中…" : "この文章を説明する";
}

/* ---------- 対象者の管理 ---------- */
function renderAudList() {
  const list = $("audList"); list.innerHTML = "";
  state.audiences.forEach((a) => {
    const row = el("div", "yt-aud");
    const top = el("div", "yt-aud-top");
    top.appendChild(el("strong", null, esc(a.name)));
    const acts = el("div", "yt-aud-acts");
    const eBtn = el("button", "yt-tinybtn edit", "編集"); eBtn.addEventListener("click", () => openEdit(a));
    const dBtn = el("button", "yt-tinybtn del", "削除"); dBtn.addEventListener("click", () => deleteAudience(a.id));
    acts.appendChild(eBtn); acts.appendChild(dBtn); top.appendChild(acts);
    row.appendChild(top); row.appendChild(el("p", "yt-aud-desc", esc(a.description)));
    list.appendChild(row);
  });
}
function openAddForm() {
  state.editId = null; $("formTitle").textContent = "新しい対象者を追加";
  $("fName").value = ""; $("fDesc").value = ""; $("btnSaveAud").textContent = "追加する";
  $("btnNewAud").classList.add("yt-hidden");
}
function openEdit(a) {
  state.editId = a.id; $("formTitle").textContent = "対象者を編集";
  $("fName").value = a.name; $("fDesc").value = a.description;
  $("btnSaveAud").textContent = "更新する"; $("btnNewAud").classList.remove("yt-hidden"); $("fName").focus();
}
function saveAudience() {
  const name = $("fName").value.trim(); const desc = $("fDesc").value.trim();
  if (!name || !desc) return;
  if (state.editId) {
    state.audiences = state.audiences.map((a) => a.id === state.editId ? { ...a, name, description: desc } : a);
  } else {
    const item = { id: "a" + Date.now(), name, description: desc };
    state.audiences = state.audiences.concat([item]);
    if (!state.selectedId) state.selectedId = item.id;
  }
  saveAudiences(); openAddForm(); renderAudList(); renderChips(); syncCTA();
}
function deleteAudience(id) {
  state.audiences = state.audiences.filter((a) => a.id !== id); saveAudiences();
  if (state.selectedId === id) state.selectedId = state.audiences[0] ? state.audiences[0].id : null;
  if (state.editId === id) openAddForm();
  renderAudList(); renderChips(); syncCTA();
}

/* ---------- モーダル ---------- */
function openManage() { openAddForm(); renderAudList(); $("manageOv").classList.remove("yt-hidden"); }
function closeManage() { $("manageOv").classList.add("yt-hidden"); }
function showSettingsMsg(msg) {
  const m = $("settingsMsg");
  if (msg) { m.textContent = msg; m.classList.remove("yt-hidden"); } else { m.classList.add("yt-hidden"); m.textContent = ""; }
}
function openSettings(msg) {
  showSettingsMsg(msg || "");
  $("gClientId").value = getClientId();
  $("apiFormat").value = getFormat();
  $("endpoint").value = getEndpoint();
  $("apiKey").value = getToken();
  $("modelName").value = getModel();
  $("ttsVoice").value = getTtsVoice();
  updateDriveUI(GDrive.isConnected());
  $("settingsOv").classList.remove("yt-hidden");
}
function closeSettings() { $("settingsOv").classList.add("yt-hidden"); }
function saveSettings() {
  lsSet(LS.fmt, $("apiFormat").value || DEFAULT_FORMAT);
  lsSet(LS.ep, $("endpoint").value.trim() || DEFAULT_ENDPOINT);
  lsSet(LS.key, $("apiKey").value.trim());
  lsSet(LS.model, $("modelName").value.trim() || DEFAULT_MODEL);
  lsSet(LS.cid, $("gClientId").value.trim());
  lsSet(LS.tts, $("ttsVoice").value.trim() || DEFAULT_TTS_VOICE);
  if (GDrive.isConnected()) {
    GDrive.saveConfig({ format: getFormat(), endpoint: getEndpoint(), token: getToken(), model: getModel(), ttsVoice: getTtsVoice() })
      .then(() => showSettingsMsg("保存し、Google Drive に同期しました ✓"))
      .catch(() => showSettingsMsg("端末に保存しました（Drive同期は失敗）。"));
    setTimeout(closeSettings, 700);
  } else {
    closeSettings();
  }
}

/* ---------- Google 連携 ---------- */
function updateDriveUI(connected) {
  const st = $("gState"); const conn = $("btnGConnect"); const dis = $("btnGDisconnect");
  if (!st) return;
  if (connected) {
    st.textContent = "状態: 接続済み ✓（設定と結果を Drive に保存します）";
    conn.textContent = "再接続"; dis.classList.remove("yt-hidden");
  } else {
    st.textContent = "状態: 未接続";
    conn.textContent = "Googleに接続"; dis.classList.add("yt-hidden");
  }
}
function applyConfig(cfg) {
  if (!cfg) return;
  if (cfg.format) lsSet(LS.fmt, cfg.format);
  if (cfg.endpoint) lsSet(LS.ep, cfg.endpoint);
  if (cfg.token) lsSet(LS.key, cfg.token);
  if (cfg.model) lsSet(LS.model, cfg.model);
  if (cfg.ttsVoice) lsSet(LS.tts, cfg.ttsVoice);
}
async function connectGoogle() {
  const cid = $("gClientId").value.trim();
  if (!cid) { showSettingsMsg("先に GoogleクライアントID を入力してください。"); return; }
  lsSet(LS.cid, cid);
  GDrive.init(cid, updateDriveUI);
  showSettingsMsg("Googleに接続しています…");
  try {
    await GDrive.connect(true);
    const cfg = await GDrive.loadConfig();
    if (cfg) {
      applyConfig(cfg);
      $("apiFormat").value = getFormat();
      $("endpoint").value = getEndpoint(); $("apiKey").value = getToken();
      $("modelName").value = getModel(); $("ttsVoice").value = getTtsVoice();
      showSettingsMsg("接続しました。Drive の設定を読み込みました ✓");
    } else {
      await GDrive.saveConfig({ format: getFormat(), endpoint: getEndpoint(), token: getToken(), model: getModel(), ttsVoice: getTtsVoice() });
      showSettingsMsg("接続しました。現在の設定を Drive に保存しました ✓");
    }
  } catch (e) {
    showSettingsMsg("Google接続に失敗しました: " + (e && e.message ? e.message : "不明なエラー"));
  }
}
function disconnectGoogle() { GDrive.disconnect(); showSettingsMsg("接続を解除しました。"); }
async function trySilentConnect() {
  const cid = getClientId(); if (!cid) return;
  GDrive.init(cid, updateDriveUI);
  try { await GDrive.connect(false); const cfg = await GDrive.loadConfig(); applyConfig(cfg); } catch (e) {}
}

/* ---------- 初期化 ---------- */
function init() {
  state.audiences = loadAudiences();
  state.selectedId = state.audiences[0] ? state.audiences[0].id : null;
  renderStage(); renderControls(); renderChips(); renderStatus(); syncCTA();

  $("fileInput").addEventListener("change", onFile);
  $("btnExplain").addEventListener("click", explain);
  $("btnManage").addEventListener("click", openManage);
  $("btnSettings").addEventListener("click", () => openSettings(""));
  $("btnSaveAud").addEventListener("click", saveAudience);
  $("btnNewAud").addEventListener("click", openAddForm);
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnGConnect").addEventListener("click", connectGoogle);
  $("btnGDisconnect").addEventListener("click", disconnectGoogle);

  $("apiFormat").addEventListener("change", (e) => {
    const cur = $("endpoint").value.trim();
    if (cur === "" || cur === DEFAULT_ENDPOINT || cur === OPENAI_ENDPOINT) {
      $("endpoint").value = (e.target.value === "openai") ? OPENAI_ENDPOINT : DEFAULT_ENDPOINT;
    }
    if (e.target.value === "openai" && ($("modelName").value.trim() === "" || $("modelName").value.trim() === DEFAULT_MODEL)) {
      $("modelName").value = "gpt-4o";
    }
  });

  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => { b.getAttribute("data-close") === "manage" ? closeManage() : closeSettings(); });
  });
  document.querySelectorAll(".yt-ov").forEach((ov) => {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) { ov.getAttribute("data-ov") === "manage" ? closeManage() : closeSettings(); }
    });
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
  }

  // 読み上げエンジンを先読み（初回の待ち時間を短縮）
  try { if (window.TTS && TTS.supported()) TTS.warmup(); } catch (e) {}

  trySilentConnect();
}
document.addEventListener("DOMContentLoaded", init);
