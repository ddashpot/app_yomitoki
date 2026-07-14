"use strict";
/* Google Drive 連携ヘルパー
   - Google Identity Services (GIS) でアクセストークンを取得
   - drive.file: このアプリが作成したファイルの読み書き（読み解き結果の保存先フォルダ）
   - drive.appdata: 隠しアプリ領域（設定＝エンドポイント/トークンの保存先）
*/
const GDrive = (function () {
  const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata";
  let tokenClient = null;
  let accessToken = null;
  let clientId = null;
  let onChange = null;
  let folderId = null;

  function init(cid, changeCb) { clientId = cid; onChange = changeCb; }
  function isConnected() { return !!accessToken; }

  function gisReady() {
    return !!(window.google && google.accounts && google.accounts.oauth2);
  }
  function waitForGis(ms) {
    ms = ms || 4000;
    return new Promise((res) => {
      const t0 = Date.now();
      (function chk() {
        if (gisReady()) return res(true);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(chk, 150);
      })();
    });
  }

  async function ensureClient() {
    const ok = await waitForGis();
    if (!ok) throw new Error("Googleのスクリプトを読み込めませんでした（ネット接続をご確認ください）");
    if (!clientId) throw new Error("GoogleクライアントIDが未設定です");
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE, callback: () => {}
      });
    }
  }

  function connect(interactive) {
    return new Promise(async (resolve, reject) => {
      try { await ensureClient(); } catch (e) { return reject(e); }
      tokenClient.callback = (resp) => {
        if (resp && resp.error) { reject(new Error(resp.error)); return; }
        accessToken = resp.access_token;
        if (onChange) onChange(true);
        resolve(accessToken);
      };
      try {
        tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (e) { reject(e); }
    });
  }

  function disconnect() {
    try {
      if (accessToken && google.accounts.oauth2.revoke) {
        google.accounts.oauth2.revoke(accessToken, function () {});
      }
    } catch (e) {}
    accessToken = null; folderId = null;
    if (onChange) onChange(false);
  }

  async function apiFetch(url, opts) {
    opts = opts || {};
    if (!accessToken) await connect(false);
    opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + accessToken });
    let res = await fetch(url, opts);
    if (res.status === 401) {
      await connect(false);
      opts.headers.Authorization = "Bearer " + accessToken;
      res = await fetch(url, opts);
    }
    return res;
  }

  function multipart(meta, mime, content) {
    const b = "yt" + Date.now() + Math.random().toString(16).slice(2);
    const body =
      "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(meta) + "\r\n" +
      "--" + b + "\r\nContent-Type: " + mime + "; charset=UTF-8\r\n\r\n" +
      content + "\r\n--" + b + "--";
    return { boundary: b, body: body };
  }

  /* ---- 設定（appDataFolder の JSON） ---- */
  async function findConfigId() {
    const q = encodeURIComponent("name='yomitoki-config.json'");
    const res = await apiFetch(
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id,name)"
    );
    const data = await res.json();
    return (data.files && data.files[0]) ? data.files[0].id : null;
  }
  async function loadConfig() {
    const id = await findConfigId();
    if (!id) return null;
    const res = await apiFetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media");
    try { return await res.json(); } catch (e) { return null; }
  }
  async function saveConfig(obj) {
    const id = await findConfigId();
    const json = JSON.stringify(obj);
    if (id) {
      await apiFetch(
        "https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json }
      );
    } else {
      const mp = multipart({ name: "yomitoki-config.json", parents: ["appDataFolder"] }, "application/json", json);
      await apiFetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + mp.boundary }, body: mp.body }
      );
    }
  }

  /* ---- 読み解き結果（Drive内フォルダ「よみとき」） ---- */
  async function ensureFolder() {
    if (folderId) return folderId;
    const q = encodeURIComponent("name='よみとき' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const res = await apiFetch(
      "https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&fields=files(id,name)"
    );
    const data = await res.json();
    if (data.files && data.files[0]) { folderId = data.files[0].id; return folderId; }
    const res2 = await apiFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "よみとき", mimeType: "application/vnd.google-apps.folder" })
    });
    const d2 = await res2.json(); folderId = d2.id; return folderId;
  }
  async function saveResult(filename, text) {
    const parent = await ensureFolder();
    const mp = multipart({ name: filename, parents: [parent], mimeType: "text/plain" }, "text/plain", text);
    const res = await apiFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + mp.boundary }, body: mp.body }
    );
    return await res.json();
  }

  return {
    init: init, connect: connect, disconnect: disconnect, isConnected: isConnected,
    loadConfig: loadConfig, saveConfig: saveConfig, saveResult: saveResult
  };
})();
