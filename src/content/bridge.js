// the glue in the content script:
// - takes the manifest the page hook found
// - keeps track of state and which two languages are picked
// - fetches + parses those two tracks (through the worker, cors reasons)
// - drives the renderer and answers the popup
;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});
  const MSG = NS.MSG;
  const TAG = NS.TAG;
  const adapter = NS.getAdapter();

  const state = {
    movieId: null,
    tracks: [],
    selection: { primaryTrackId: null, secondaryTrackId: null },
    settings: null, // { defaults, display, perTitle }
    cues: {}, // trackId -> cues
    ready: false,
  };
  let renderer = null;

  // ---- settings (saved by the worker) ----
  async function loadSettings() {
    const res = await chrome.runtime
      .sendMessage({ type: MSG.LOAD_SETTINGS, movieId: state.movieId })
      .catch(function () { return null; });
    state.settings = res || { defaults: NS.DEFAULTS, display: NS.DEFAULTS.display, perTitle: {} };
  }
  function saveSelection() {
    const patch = { perTitle: {} };
    patch.perTitle[state.movieId] = state.selection;
    chrome.runtime.sendMessage({ type: MSG.SAVE_SETTINGS, patch: patch }).catch(function () {});
  }
  function saveDisplay(display) {
    chrome.runtime.sendMessage({ type: MSG.SAVE_SETTINGS, patch: { display: display } }).catch(function () {});
  }

  // figure out which two tracks to show: per-title choice first, then preferred langs,
  // then just whatever's there.
  function resolveSelection() {
    const d = (state.settings && state.settings.defaults) || NS.DEFAULTS;
    const per = ((state.settings && state.settings.perTitle) || {})[state.movieId];
    const byId = function (id) { return state.tracks.find(function (t) { return t.id === id; }); };
    const byLang = function (lang) {
      return state.tracks.find(function (t) { return t.lang === lang && !t.isForced; });
    };
    let p = null, s = null;
    if (per) { p = byId(per.primaryTrackId) || null; s = byId(per.secondaryTrackId) || null; }
    if (!p) p = byLang(d.preferredPrimaryLang) || state.tracks[0] || null;
    if (!s) s = byLang(d.preferredSecondaryLang) || state.tracks.find(function (t) { return t !== p; }) || null;
    state.selection = {
      primaryTrackId: p ? p.id : null,
      secondaryTrackId: s ? s.id : null,
    };
  }

  // ---- fetch + parse ----
  async function fetchTrack(track) {
    const useVtt = !!track.formats.webvtt;
    const url = useVtt ? track.formats.webvtt : track.formats.ttml;
    if (!url) return [];
    const res = await chrome.runtime
      .sendMessage({ type: MSG.FETCH_TRACK, url: url })
      .catch(function () { return null; });
    if (!res || !res.ok || !res.text) return [];
    return NS.parseSubtitles(res.text, useVtt ? "webvtt" : "ttml");
  }

  async function ensureCues(trackId) {
    if (!trackId) return null;
    if (state.cues[trackId]) return state.cues[trackId];
    const track = state.tracks.find(function (t) { return t.id === trackId; });
    if (!track) return null;
    state.cues[trackId] = await fetchTrack(track);
    return state.cues[trackId];
  }

  async function applySelection() {
    if (!renderer) renderer = new NS.Renderer(adapter);
    const sel = state.selection;
    const pair = await Promise.all([ensureCues(sel.primaryTrackId), ensureCues(sel.secondaryTrackId)]);
    renderer.setDisplay((state.settings && state.settings.display) || NS.DEFAULTS.display);
    renderer.setCues(pair[0], pair[1]);
    renderer.start();
  }

  // ---- what the popup sees ----
  function publicState() {
    return {
      movieId: state.movieId,
      ready: state.ready,
      tracks: state.tracks.map(function (t) {
        return { id: t.id, lang: t.lang, label: t.label, kind: t.kind, isForced: t.isForced };
      }),
      selection: state.selection,
      display: (state.settings && state.settings.display) || NS.DEFAULTS.display,
    };
  }
  function pushState() {
    chrome.runtime.sendMessage({ type: MSG.STATE_CHANGED, state: publicState() }).catch(function () {});
  }

  async function onManifest(msg) {
    const norm = adapter.normalizeManifest(msg);
    if (!norm.tracks.length) return;
    const isNew = norm.movieId !== state.movieId;
    state.movieId = norm.movieId;
    state.tracks = norm.tracks;
    if (isNew) state.cues = {};
    if (!state.settings) await loadSettings();
    resolveSelection();
    state.ready = true;
    await applySelection();
    pushState();
  }

  // page -> here
  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d[TAG] !== true) return;
    if (d.type === MSG.MANIFEST_FOUND) onManifest(d);
  });

  // popup -> here
  chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
    if (!req || !req.type) return;
    if (req.type === MSG.GET_STATE) {
      sendResponse(publicState());
      return true;
    }
    if (req.type === MSG.SET_SELECTION) {
      state.selection = {
        primaryTrackId: req.primaryTrackId || null,
        secondaryTrackId: req.secondaryTrackId || null,
      };
      saveSelection();
      applySelection().then(pushState);
      sendResponse({ ok: true });
      return true;
    }
    if (req.type === MSG.SET_DISPLAY) {
      if (state.settings) {
        state.settings.display = Object.assign({}, state.settings.display, req.display);
      }
      saveDisplay(req.display);
      if (renderer) renderer.setDisplay(req.display);
      sendResponse({ ok: true });
      return true;
    }
  });
})(globalThis);
