// worker: stores settings and fetches the subtitle files.
// the fetch has to happen here because in mv3 a content script uses the page's cors,
// so grabbing the file straight from *.nflxvideo.net gets blocked. the worker fetches
// with the extension's own host permissions instead.
importScripts("../shared/messages.js");

const MSG = globalThis.DualSub.MSG;
const DEFAULTS = globalThis.DualSub.DEFAULTS;

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

async function fetchTrack(url) {
  const r = await fetch(url, { credentials: "omit" });
  const text = await r.text();
  return { ok: r.ok, text: text };
}

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
  if (req.type === MSG.FETCH_TRACK) {
    fetchTrack(req.url)
      .then(sendResponse)
      .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
    return true;
  }
});
