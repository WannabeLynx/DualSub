// Service worker: stores settings, and captures the subtitle files Netflix fetches.
importScripts("../shared/messages.js");

const MSG = globalThis.DualSub.MSG;
const DEFAULTS = globalThis.DualSub.DEFAULTS;
const DEBUG = globalThis.DualSub.DEBUG;
function dlog() { if (DEBUG) try { console.log.apply(console, arguments); } catch (e) {} }

// ---------------- settings ----------------
async function getSettings() {
  const sync = await chrome.storage.sync.get(["defaults", "display"]);
  const local = await chrome.storage.local.get(["perTitle"]);
  return {
    defaults: Object.assign({}, DEFAULTS, sync.defaults),
    display: Object.assign({}, DEFAULTS.display, sync.display),
    perTitle: local.perTitle || {},
  };
}

async function saveSettings(patch) {
  patch = patch || {};
  if (patch.display) {
    const cur = (await chrome.storage.sync.get("display")).display || {};
    await chrome.storage.sync.set({ display: Object.assign({}, DEFAULTS.display, cur, patch.display) });
  }
  if (patch.defaults) {
    const cur = (await chrome.storage.sync.get("defaults")).defaults || {};
    await chrome.storage.sync.set({ defaults: Object.assign({}, cur, patch.defaults) });
  }
  if (patch.perTitle) {
    const cur = (await chrome.storage.local.get("perTitle")).perTitle || {};
    Object.assign(cur, patch.perTitle);
    await chrome.storage.local.set({ perTitle: cur });
  }
}

const CAPS = [];
const SNIFFED = {};
let WEBREQUEST_OK = false;
let WEBREQUEST_ERR = null;

function keyOf(url) {
  try {
    const u = new URL(url);
    return "v=" + (u.searchParams.get("v") || "?") + "|t=" + (u.searchParams.get("t") || "").slice(0, 12);
  } catch (e) { return url.slice(0, 80); }
}

function langOf(text) {
  const m = text.slice(0, 3000).match(/xml:lang="([^"]+)"/i);
  return m ? m[1] : "";
}

async function sniffAndMaybeCapture(url) {
  const key = keyOf(url);
  if (SNIFFED[key]) return;
  SNIFFED[key] = true;
  try {
    // classify cheaply from the first bytes so we don't download media segments
    const r = await fetch(url, { credentials: "omit" });
    const reader = r.body && r.body.getReader ? r.body.getReader() : null;
    let head = "";
    if (reader) {
      const first = await reader.read();
      const bytes = (first.value || new Uint8Array()).slice(0, 96);
      for (let i = 0; i < bytes.length; i++) { const b = bytes[i]; head += b >= 32 && b < 127 ? String.fromCharCode(b) : "."; }
    }
    const textish = head.indexOf("WEBVTT") !== -1 || head.indexOf("<?xml") !== -1 || head.indexOf("<tt") !== -1;
    if (!textish) { try { if (reader) reader.cancel(); } catch (e) {} return; }

    try { if (reader) reader.cancel(); } catch (e) {}
    const full = await fetch(url, { credentials: "omit" });
    const txt = await full.text();
    const lang = langOf(txt);
    CAPS.push({ id: CAPS.length, lang: lang, text: txt, ts: Date.now() });
    dlog("[DualSub] captured subtitle lang='" + lang + "' len=" + txt.length + " (total " + CAPS.length + ")");
  } catch (e) {
    dlog("[DualSub] sniff error:", String(e).slice(0, 80));
  }
}

try {
  chrome.webRequest.onBeforeRequest.addListener(
    function (d) { sniffAndMaybeCapture(d.url); },
    { urls: ["*://*.nflxvideo.net/*"] }
  );
  WEBREQUEST_OK = true;
} catch (e) { WEBREQUEST_ERR = String(e).slice(0, 120); }

function langMatch(a, b) {
  if (!a || !b) return false;
  a = a.toLowerCase(); b = b.toLowerCase();
  return a === b || a.split("-")[0] === b.split("-")[0];
}

// ---------------- messaging ----------------
chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
  if (!req || !req.type) return;

  if (req.type === MSG.LOAD_SETTINGS) {
    getSettings().then(sendResponse);
    return true;
  }
  if (req.type === MSG.SAVE_SETTINGS) {
    saveSettings(req.patch).then(function () { sendResponse({ ok: true }); });
    return true;
  }
  if (req.type === MSG.SUBS_LIST) {
    sendResponse({
      webRequestOk: WEBREQUEST_OK,
      webRequestErr: WEBREQUEST_ERR,
      captures: CAPS.map(function (c) { return { id: c.id, lang: c.lang, len: c.text.length }; }),
    });
    return true;
  }
  if (req.type === MSG.GET_SUB) {
    let cap = null;
    if (req.id != null) cap = CAPS[req.id] || null;
    else if (req.lang) {
      for (let i = CAPS.length - 1; i >= 0; i--) { if (langMatch(CAPS[i].lang, req.lang)) { cap = CAPS[i]; break; } }
    }
    sendResponse({ text: cap ? cap.text : null, lang: cap ? cap.lang : null });
    return true;
  }
  if (req.type === MSG.CLEAR_SUBS) {
    CAPS.length = 0;
    sendResponse({ ok: true });
    return true;
  }
});
