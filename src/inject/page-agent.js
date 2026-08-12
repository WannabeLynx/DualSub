// Runs in the page's own JS world (MAIN) at document_start.
//
// Netflix parses the subtitle manifest in a realm content scripts can't reach, so we use
// Netflix's own player API instead — it lives on window.netflix, reachable only from a
// MAIN-world script. We expose track listing / switching to the isolated content script
// over window.postMessage, and a small window.dualsub console helper for debugging.
(function () {
  "use strict";

  const TAG = "__dualsub__";
  const DEBUG = false; // set true for verbose logging

  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ["%c[DualSub]", "color:#e50914;font-weight:bold"].concat([].slice.call(arguments))); } catch (e) {}
  }

  function player() {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI();
      const vp = api.videoPlayer;
      const ids = vp.getAllPlayerSessionIds() || [];
      for (let i = 0; i < ids.length; i++) {
        const p = vp.getVideoPlayerBySessionId(ids[i]);
        if (p && typeof p.getTimedTextTrackList === "function") return p;
      }
    } catch (e) {}
    return null;
  }

  function rawTracks(p) { try { return p.getTimedTextTrackList() || []; } catch (e) { return []; } }

  function normalize(p) {
    return rawTracks(p).map(function (t) {
      return {
        trackId: t.trackId,
        lang: t.bcp47 || "",
        label: t.displayName || t.bcp47 || "Unknown",
        isNone: !!t.isNoneTrack,
        forced: !!t.isForcedNarrative,
        image: !!t.isImageBased,
        kind: t.rawTrackType === "closedcaptions" ? "closedcaptions" : "subtitles",
        type: t.trackType || "",
      };
    });
  }

  function currentLang(p) {
    try { const c = p.getTimedTextTrack(); return c ? (c.isNoneTrack ? "NONE" : c.bcp47) : null; } catch (e) { return null; }
  }

  function movieId(p) {
    try { if (p && typeof p.getMovieId === "function") return String(p.getMovieId()); } catch (e) {}
    const m = location.pathname.match(/\/watch\/(\d+)/);
    return m ? m[1] : null;
  }

  function setTrack(p, trackId) {
    const list = rawTracks(p);
    let target = null;
    if (trackId === "NONE") target = list.filter(function (t) { return t.isNoneTrack; })[0];
    else target = list.filter(function (t) { return t.trackId === trackId; })[0];
    if (!target) return false;
    try { p.setTimedTextTrack(target); return true; } catch (e) { return false; }
  }

  // ---- request/response bridge for the content script ----
  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d[TAG] !== true || d.dir !== "toPage") return;
    const p = player();
    const reply = function (obj) { obj[TAG] = true; obj.dir = "toContent"; obj.reqId = d.reqId; window.postMessage(obj, "*"); };

    if (d.cmd === "getTracks") {
      reply({ cmd: "tracks", res: p ? { movieId: movieId(p), current: currentLang(p), tracks: normalize(p) } : null });
    } else if (d.cmd === "setTrack") {
      reply({ cmd: "setTrackDone", ok: p ? setTrack(p, d.trackId) : false });
    }
  });

  // ---- notify the content script when the title/episode changes ----
  let lastMovie = null;
  setInterval(function () {
    const p = player();
    if (!p) return;
    const m = movieId(p);
    if (m && m !== lastMovie) {
      lastMovie = m;
      window.postMessage({ [TAG]: true, dir: "toContent", cmd: "titleChanged", movieId: m }, "*");
    }
  }, 1000);

  // ---- console helpers (optional, for debugging) ----
  window.dualsub = {
    tracks: function () {
      const p = player();
      if (!p) { console.log("[DualSub] no player yet — press play first"); return; }
      const list = normalize(p).filter(function (t) { return !t.isNone; });
      console.log("[DualSub] " + list.length + " subtitle tracks:");
      list.forEach(function (t) {
        console.log("   " + t.lang + "\t" + t.label + (t.image ? "  [image]" : "") + (t.forced ? "  [forced]" : ""));
      });
      console.log("[DualSub] current:", currentLang(p));
      return list.map(function (t) { return t.lang; });
    },
    pick: function (lang) {
      const p = player();
      if (!p) { console.log("[DualSub] no player"); return; }
      const t = normalize(p).filter(function (x) { return !x.isNone && x.lang === lang; })[0];
      if (!t) { console.log("[DualSub] no track for '" + lang + "'"); return; }
      setTrack(p, t.trackId);
      console.log("[DualSub] picked '" + lang + "'");
    },
    none: function () { const p = player(); if (p) setTrack(p, "NONE"); console.log("[DualSub] subtitles off"); },
  };

  log("page agent ready");
})();
