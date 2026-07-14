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

/* ---------- 状態 ---------- */
const state = {
  audiences: [],
  selectedId: null,
  image: null,      // dataURL
  imageMime: "image/jpeg",
  cameraOn: false,
  stream: null,
  status: "idle",   // idle | loading | done | error
  result: null,
  error: "",
  editId: null
};

/* ---------- localStorage ---------- */
const LS = {
  aud: "yt_audiences_v1",
  key: "yt_api_key",
  model: "yt_model"
};
function loadAudiences() {
  try {
    const raw = localStorage.getItem(LS.aud);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) return list;
    }
  } catch (e) {}
  return DEFAULT_AUDIENCES.slice();
}
function saveAudiences() {
  try { localStorage.setItem(LS.aud, JSON.stringify(state.audiences)); } catch (e) {}
}
const getKey = () => { try { return localStorage.getItem(LS.key) || ""; } catch (e) { return ""; } };
const getModel = () => { try { return localStorage.getItem(LS.model) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; } };

/* ---------- ショートカット ---------- */
const $ = (id) => document.getElementById(id);
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
const selectedName = () => {
  const a = state.audiences.find((x) => x.id === state.selectedId);
  return a ? a.name : "";
};

/* ---------- カメラ ---------- */
async function startCamera() {
  state.error = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, audio: false
    });
    state.stream = stream;
    state.image = null; state.result = null; state.status = "idle";
    state.cameraOn = true;
    renderStage(); renderControls(); renderStatus(); syncCTA();
  } catch (e) {
    state.error = "カメラを開始できませんでした。ブラウザのカメラ利用を許可するか、「画像を選ぶ」からアップロードしてください。（PWAはhttps環境で動作します）";
    renderStatus();
  }
}
function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null; state.cameraOn = false;
  renderStage(); renderControls();
}
function capturePhoto() {
  const v = $("stage").querySelector("video");
  const c = $("canvas");
  if (!v) return;
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  state.image = c.toDataURL("image/jpeg", 0.9);
  state.imageMime = "image/jpeg";
  state.result = null; state.status = "idle";
  stopCamera();
  renderStage(); renderControls(); renderStatus(); syncCTA();
}
function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.image = reader.result;
    state.imageMime = file.type || "image/jpeg";
    state.result = null; state.status = "idle"; state.error = "";
    renderStage(); renderControls(); renderStatus(); syncCTA();
  };
  reader.readAsDataURL(file);
  e.target.value = "";
  stopCamera();
}
function resetImage() {
  state.image = null; state.result = null; state.status = "idle"; state.error = "";
  stopCamera();
  renderStage(); renderControls(); renderStatus(); syncCTA();
}

/* ---------- 説明生成（Anthropic API 直呼び出し） ---------- */
async function explain() {
  if (!state.image) return;
  const key = getKey();
  if (!key) { openSettings("説明するには、まず Anthropic APIキーを設定してください。"); return; }
  const audience = state.audiences.find((a) => a.id === state.selectedId) || state.audiences[0];
  if (!audience) return;

  state.status = "loading"; state.error = ""; state.result = null;
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
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: state.imageMime, data: base64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });
    const data = await res.json();

    if (data && data.type === "error") {
      const msg = (data.error && data.error.message) || "";
      if (res.status === 401) throw new Error("APIキーが正しくないようです。設定を確認してください。");
      throw new Error(msg || "APIからエラーが返りました。");
    }
    if (!data || !Array.isArray(data.content)) throw new Error("予期しない応答が返りました。");

    const text = data.content.filter((i) => i.type === "text").map((i) => i.text).join("\n");
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed = null;
    try { parsed = JSON.parse(clean); }
    catch (e) {
      const m = clean.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
    }

    if (parsed && (parsed.transcription || parsed.explanation)) {
      state.result = {
        transcription: parsed.transcription || "",
        explanation: parsed.explanation || "",
        caveats: parsed.caveats || ""
      };
    } else if (clean) {
      state.result = { transcription: "", explanation: clean, caveats: "" };
    } else {
      throw new Error("空の応答が返りました。");
    }
    state.status = "done"; state.error = "";
  } catch (e) {
    state.status = "error";
    state.error = (e && e.message) ? e.message : "読み取りに失敗しました。明るい場所で撮り直すか、もう一度お試しください。";
  }
  renderStatus(); syncCTA();
}

/* ---------- 描画 ---------- */
function renderStage() {
  const s = $("stage");
  s.innerHTML = "";
  if (state.cameraOn) {
    const v = document.createElement("video");
    v.setAttribute("playsinline", ""); v.muted = true; v.playsInline = true;
    s.appendChild(v);
    v.srcObject = state.stream;
    v.play().catch(() => {});
  } else if (state.image) {
    const img = document.createElement("img");
    img.src = state.image; img.alt = "撮影した文章";
    s.appendChild(img);
  } else {
    s.appendChild(el("div", "yt-empty",
      '<div class="ic">文</div><p>説明書・掲示・手紙・記事など<br>文章を写してください</p>'));
  }
}
function makeBtn(glyph, text, fn) {
  const b = el("button", "yt-btn", glyph ? `<span class="g">${glyph}</span> ${text}` : text);
  b.addEventListener("click", fn);
  return b;
}
function renderControls() {
  const c = $("controls");
  c.innerHTML = "";
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
  const wrap = $("chips");
  wrap.innerHTML = "";
  if (!state.audiences.length) {
    wrap.appendChild(el("p", "yt-mini", "対象者がありません。「対象者を管理」から追加してください。"));
    return;
  }
  state.audiences.forEach((a) => {
    const chip = el("button", "yt-chip" + (a.id === state.selectedId ? " on" : ""), a.name);
    chip.addEventListener("click", () => { state.selectedId = a.id; renderChips(); });
    wrap.appendChild(chip);
  });
}
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function renderStatus() {
  const area = $("statusArea");
  area.innerHTML = "";
  if (state.status === "loading") {
    area.appendChild(el("div", "yt-load",
      `<div class="yt-dots"><i></i><i></i><i></i></div><p>文字を読み取り、${esc(selectedName())}向けにまとめています…</p>`));
    return;
  }
  if (state.error) {
    area.appendChild(el("div", "yt-error", esc(state.error)));
  }
  if (state.status === "done" && state.result) {
    const r = state.result;
    const box = el("div", "yt-result");
    if (r.transcription) {
      box.appendChild(el("div", "yt-block",
        `<h3>読み取った原文 <span class="tag">そのまま</span></h3><div class="yt-orig">${esc(r.transcription)}</div>`));
    }
    box.appendChild(el("div", "yt-block",
      `<h3><span class="mk2">わかりやすい説明</span> <span class="tag">${esc(selectedName())}向け</span></h3><div class="yt-explain">${esc(r.explanation)}</div>`));
    if (r.caveats) {
      box.appendChild(el("div", "yt-caveat", `<b>補足・注意：</b>${esc(r.caveats)}`));
    }
    box.appendChild(el("p", "yt-mini",
      "※ 説明は上の原文の内容だけに基づいています。判読できない箇所や補足は原文・注意欄で確認してください。"));
    area.appendChild(box);
  }
}
function syncCTA() {
  const b = $("btnExplain");
  const busy = state.status === "loading";
  b.disabled = !state.image || busy || !state.selectedId;
  b.textContent = busy ? "読み取り中…" : "この文章を説明する";
}

/* ---------- 対象者の管理 ---------- */
function renderAudList() {
  const list = $("audList");
  list.innerHTML = "";
  state.audiences.forEach((a) => {
    const row = el("div", "yt-aud");
    const top = el("div", "yt-aud-top");
    top.appendChild(el("strong", null, esc(a.name)));
    const acts = el("div", "yt-aud-acts");
    const eBtn = el("button", "yt-tinybtn edit", "編集");
    eBtn.addEventListener("click", () => openEdit(a));
    const dBtn = el("button", "yt-tinybtn del", "削除");
    dBtn.addEventListener("click", () => deleteAudience(a.id));
    acts.appendChild(eBtn); acts.appendChild(dBtn);
    top.appendChild(acts);
    row.appendChild(top);
    row.appendChild(el("p", "yt-aud-desc", esc(a.description)));
    list.appendChild(row);
  });
}
function openAddForm() {
  state.editId = null;
  $("formTitle").textContent = "新しい対象者を追加";
  $("fName").value = ""; $("fDesc").value = "";
  $("btnSaveAud").textContent = "追加する";
  $("btnNewAud").classList.add("yt-hidden");
}
function openEdit(a) {
  state.editId = a.id;
  $("formTitle").textContent = "対象者を編集";
  $("fName").value = a.name; $("fDesc").value = a.description;
  $("btnSaveAud").textContent = "更新する";
  $("btnNewAud").classList.remove("yt-hidden");
  $("fName").focus();
}
function saveAudience() {
  const name = $("fName").value.trim();
  const desc = $("fDesc").value.trim();
  if (!name || !desc) return;
  if (state.editId) {
    state.audiences = state.audiences.map((a) =>
      a.id === state.editId ? { ...a, name, description: desc } : a);
  } else {
    const item = { id: "a" + Date.now(), name, description: desc };
    state.audiences = state.audiences.concat([item]);
    if (!state.selectedId) state.selectedId = item.id;
  }
  saveAudiences();
  openAddForm();
  renderAudList(); renderChips(); syncCTA();
}
function deleteAudience(id) {
  state.audiences = state.audiences.filter((a) => a.id !== id);
  saveAudiences();
  if (state.selectedId === id) state.selectedId = state.audiences[0] ? state.audiences[0].id : null;
  if (state.editId === id) openAddForm();
  renderAudList(); renderChips(); syncCTA();
}

/* ---------- モーダル ---------- */
function openManage() { openAddForm(); renderAudList(); $("manageOv").classList.remove("yt-hidden"); }
function closeManage() { $("manageOv").classList.add("yt-hidden"); }
function openSettings(msg) {
  const m = $("settingsMsg");
  if (msg) { m.textContent = msg; m.classList.remove("yt-hidden"); }
  else { m.classList.add("yt-hidden"); m.textContent = ""; }
  $("apiKey").value = getKey();
  $("modelName").value = getModel();
  $("settingsOv").classList.remove("yt-hidden");
}
function closeSettings() { $("settingsOv").classList.add("yt-hidden"); }
function saveSettings() {
  try {
    localStorage.setItem(LS.key, $("apiKey").value.trim());
    const m = $("modelName").value.trim();
    localStorage.setItem(LS.model, m || DEFAULT_MODEL);
  } catch (e) {}
  closeSettings();
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

  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.getAttribute("data-close") === "manage") closeManage();
      else closeSettings();
    });
  });
  document.querySelectorAll(".yt-ov").forEach((ov) => {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) {
        if (ov.getAttribute("data-ov") === "manage") closeManage();
        else closeSettings();
      }
    });
  });

  // PWA: サービスワーカー登録（https または localhost のみ）
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
