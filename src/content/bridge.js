;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});
  const MSG = NS.MSG;
  const TAG = NS.TAG;
  const adapter = NS.getAdapter();

  function log() {
    if (!NS.DEBUG) return;
    try { console.log.apply(console, ["%c[DualSub]", "color:#e50914;font-weight:bold"].concat([].slice.call(arguments))); } catch (e) {}
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function langMatch(a, b) {
    if (!a || !b) return false;
    a = String(a).toLowerCase(); b = String(b).toLowerCase();
    return a === b || a.split("-")[0] === b.split("-")[0];
  }
  function exactLang(a, b) { return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase(); }

  const state = {
    movieId: null,
    tracks: [],                 // selectable text tracks (no image/none)
    selection: { primaryTrackId: null, secondaryTrackId: null },
    settings: null,
    cues: {},                   // trackId -> cues
    ready: false,
    busy: false,
    harvestedMovie: null,
  };
  let renderer = null;

  // ---- page agent (MAIN world) request/reply ----
  let reqSeq = 0;
  const pending = {};
  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d[TAG] !== true || d.dir !== "toContent") return;
    if (d.reqId && pending[d.reqId]) { const r = pending[d.reqId]; delete pending[d.reqId]; r(d); return; }
    if (d.cmd === "titleChanged") onTitleChanged(d.movieId);
  });
  function callPage(cmd, extra) {
    return new Promise(function (resolve) {
      const reqId = ++reqSeq;
      pending[reqId] = resolve;
      setTimeout(function () { if (pending[reqId]) { delete pending[reqId]; resolve(null); } }, 6000);
      window.postMessage(Object.assign({ [TAG]: true, dir: "toPage", cmd: cmd, reqId: reqId }, extra || {}), "*");
    });
  }

  // ---- service worker helpers ----
  function sw(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res);
        });
      } catch (e) { resolve(null); }
    });
  }
  function subsList() { return sw({ type: MSG.SUBS_LIST }).then(function (r) { return r || { captures: [] }; }); }
  function getSub(sel) { return sw(Object.assign({ type: MSG.GET_SUB }, sel)).then(function (r) { return (r && r.text) || null; }); }

  // ---- settings ----
  async function loadSettings() {
    const res = await sw({ type: MSG.LOAD_SETTINGS });
    state.settings = res || { defaults: NS.DEFAULTS, display: NS.DEFAULTS.display, perTitle: {} };
  }
  function saveSelection() {
    const patch = { perTitle: {} };
    patch.perTitle[state.movieId] = state.selection;
    sw({ type: MSG.SAVE_SETTINGS, patch: patch });
  }
  function saveDisplay(display) { sw({ type: MSG.SAVE_SETTINGS, patch: { display: display } }); }

  // ---- selection ----
  function trackById(id) { return state.tracks.find(function (t) { return t.trackId === id; }); }
  function resolveSelection() {
    const d = (state.settings && state.settings.defaults) || NS.DEFAULTS;
    const per = ((state.settings && state.settings.perTitle) || {})[state.movieId];
    const byLang = function (l) { return state.tracks.find(function (t) { return !t.forced && langMatch(t.lang, l); }); };
    let p = null, s = null;
    if (per) { p = trackById(per.primaryTrackId) || null; s = trackById(per.secondaryTrackId) || null; }
    if (!p) p = byLang(d.preferredPrimaryLang) || state.tracks[0] || null;
    if (!s) s = byLang(d.preferredSecondaryLang) || state.tracks.find(function (t) { return t !== p; }) || null;
    state.selection = { primaryTrackId: p ? p.trackId : null, secondaryTrackId: s ? s.trackId : null };
  }

  // ---- harvest: make Netflix fetch a track, capture it, return parsed cues ----
  async function harvestTrack(track) {
    if (!track) return [];
    // fast path: already captured for this title (e.g. the track that was on at page load)
    let caps = (await subsList()).captures || [];
    let cap = caps.filter(function (c) { return exactLang(c.lang, track.lang); }).slice(-1)[0];

    if (!cap) {
      // trigger a fetch by selecting the track, then wait for the new capture
      const beforeIds = {}; caps.forEach(function (c) { beforeIds[c.id] = true; });
      log("fetching", track.lang, "(" + track.label + ")…");
      await callPage("setTrack", { trackId: track.trackId });
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !cap) {
        await sleep(350);
        caps = (await subsList()).captures || [];
        const fresh = caps.filter(function (c) { return !beforeIds[c.id]; });
        if (fresh.length) cap = fresh.filter(function (c) { return exactLang(c.lang, track.lang); })[0] || fresh[fresh.length - 1];
      }
      // last resort: any capture whose language loosely matches
      if (!cap) cap = caps.filter(function (c) { return langMatch(c.lang, track.lang); }).slice(-1)[0] || null;
    }

    if (!cap) { log("no subtitle captured for", track.lang, "(" + track.label + ")"); return []; }
    const text = await getSub({ id: cap.id });
    if (!text) return [];
    const cues = NS.parseSubtitles(text, /^\s*(<\?xml|<tt[\s>])/.test(text) ? "ttml" : "webvtt");
    log("parsed", cues.length, "cues for", track.lang, "(" + track.label + ")");
    return cues;
  }

  function prehideNative() {
    if (document.getElementById("dualsub-prehide")) return;
    const st = document.createElement("style");
    st.id = "dualsub-prehide";
    st.textContent = ".player-timedtext{visibility:hidden!important}";
    (document.head || document.documentElement).appendChild(st);
  }

  // the actual harvest + render, no concurrency handling (callers serialize via withBusy)
  async function doHarvest() {
    prehideNative();
    const p = trackById(state.selection.primaryTrackId);
    const s = trackById(state.selection.secondaryTrackId);
    log("harvesting:", p ? p.lang : "-", "+", s ? s.lang : "-");

    const pc = await harvestTrack(p);
    const sc = p && s && s.trackId === p.trackId ? pc : await harvestTrack(s);
    state.cues[state.selection.primaryTrackId] = pc;
    state.cues[state.selection.secondaryTrackId] = sc;

    if ((pc && pc.length) || (sc && sc.length)) {
      await callPage("setTrack", { trackId: "NONE" }); // Netflix off; we draw both ourselves
      if (!renderer) renderer = new NS.Renderer(adapter);
      renderer.setDisplay((state.settings && state.settings.display) || NS.DEFAULTS.display);
      renderer.setCues(pc, sc);
      renderer.start();
      log("rendering", (pc || []).length, "+", (sc || []).length, "cues");
    } else {
      log("no cues harvested — leaving Netflix's own subtitles on");
      const st = document.getElementById("dualsub-prehide"); if (st) st.remove();
      if (p) await callPage("setTrack", { trackId: p.trackId });
    }
  }

  // ---- lifecycle (single serialized entry point) ----
  async function getTracksWithRetry() {
    for (let i = 0; i < 40; i++) {
      const r = await callPage("getTracks");
      if (r && r.res && r.res.tracks && r.res.tracks.length) return r.res;
      await sleep(500);
    }
    return null;
  }

  async function withBusy(fn) {
    if (state.busy) return;
    state.busy = true;
    try { await fn(); } finally { state.busy = false; }
  }

  // (re)load tracks for the current title and harvest; deduped so we don't redo a title
  function refresh() {
    return withBusy(async function () {
      if (!state.settings) await loadSettings();
      const info = await getTracksWithRetry();
      if (!info) { log("player API not available yet"); return; }
      const mid = info.movieId;
      if (mid && mid === state.harvestedMovie && renderer) return; // already done this title
      state.movieId = mid;
      state.ready = false;
      state.cues = {};
      if (renderer) renderer.stop();
      await sw({ type: MSG.CLEAR_SUBS });
      state.tracks = info.tracks.filter(function (t) { return !t.isNone && !t.image; });
      log("title", mid, "-", state.tracks.length, "text tracks");
      resolveSelection();
      await doHarvest();
      state.harvestedMovie = mid;
      state.ready = true;
      pushState();
    });
  }

  // re-harvest the current title after the user changes the language selection
  function reharvest() {
    return withBusy(async function () {
      state.ready = false;
      await doHarvest();
      state.ready = true;
      pushState();
    });
  }

  function onTitleChanged(movieId) {
    if (movieId && movieId === state.harvestedMovie) return;
    log("title changed ->", movieId);
    refresh();
  }

  // ---- popup interface ----
  function publicState() {
    return {
      movieId: state.movieId,
      ready: state.ready,
      tracks: state.tracks.map(function (t) {
        return { id: t.trackId, lang: t.lang, label: t.label, kind: t.kind, isForced: t.forced };
      }),
      selection: state.selection,
      display: (state.settings && state.settings.display) || NS.DEFAULTS.display,
    };
  }
  function pushState() {
    // reaches the popup if it's open; the worker ignores it
    try { chrome.runtime.sendMessage({ type: MSG.STATE_CHANGED, state: publicState() }); } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
    if (!req || !req.type) return;
    if (req.type === MSG.GET_STATE) { sendResponse(publicState()); return true; }
    if (req.type === MSG.SET_SELECTION) {
      state.selection = {
        primaryTrackId: req.primaryTrackId || null,
        secondaryTrackId: req.secondaryTrackId || null,
      };
      saveSelection();
      reharvest();
      sendResponse({ ok: true });
      return true;
    }
    if (req.type === MSG.SET_DISPLAY) {
      if (state.settings) state.settings.display = Object.assign({}, state.settings.display, req.display);
      saveDisplay(req.display);
      if (renderer) renderer.setDisplay(req.display);
      sendResponse({ ok: true });
      return true;
    }
  });

  refresh();
})(globalThis);
