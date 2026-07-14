"use strict";
/* よみとき 読み上げエンジン
   オープンソースの eSpeak NG（WebAssembly）を使用。ブラウザの音声合成(Web Speech API)は使いません。
   同梱の espeak-ng.js / espeak-ng.wasm を読み込み、テキストからWAVを生成して <audio> で再生します。
   ライセンス: GPLv3（espeak-ng.LICENSE.txt を参照 / https://github.com/espeak-ng/espeak-ng ） */
const TTS = (function () {
  const ENGINE = "./espeak-ng.js";
  let factoryP = null;   // ESモジュールの動的import（1回だけ）
  let audio = null;
  let curUrl = null;

  function supported() { return typeof WebAssembly === "object" && "Audio" in window; }

  function factory() {
    if (!factoryP) factoryP = import(ENGINE).then((m) => m.default);
    return factoryP;
  }
  // 起動時にエンジンのJS/WASMを先読みしてキャッシュさせる（初回再生を速く）
  function warmup() { try { factory(); } catch (e) {} }

  async function synth(text, voice, wpm) {
    const ESpeakNG = await factory();
    // 発話ごとに新しいインスタンスを生成し、main() が out.wav を書き出す
    const mod = await ESpeakNG({
      arguments: ["-v", voice || "ja", "-s", String(wpm || 175), "-w", "out.wav", text],
      print: function () {}, printErr: function () {}
    });
    return mod.FS.readFile("out.wav"); // Uint8Array (WAV)
  }

  async function play(text, opts) {
    opts = opts || {};
    stop();
    const wav = await synth(text, opts.voice, opts.wpm);
    const blob = new Blob([wav], { type: "audio/wav" });
    curUrl = URL.createObjectURL(blob);
    audio = new Audio(curUrl);
    if (opts.onend) audio.addEventListener("ended", opts.onend);
    if (opts.onerror) audio.addEventListener("error", opts.onerror);
    await audio.play();
    return audio;
  }

  function stop() {
    if (audio) { try { audio.pause(); } catch (e) {} audio = null; }
    if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = null; }
  }

  return { play: play, stop: stop, synth: synth, supported: supported, warmup: warmup };
})();
