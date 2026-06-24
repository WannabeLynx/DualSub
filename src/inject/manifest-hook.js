// runs in the page itself (not the content-script world) and as early as possible.
//
// netflix downloads a manifest that lists every subtitle track for a title and runs it
// through JSON.parse. so we just wrap JSON.parse, look for anything carrying
// timedtexttracks, and pass it to the content script. reading the parsed object means
// we never have to deal with their msl encryption.
(function () {
  "use strict";

  const TAG = "__dualsub__";
  const origParse = JSON.parse;
  let lastSig = "";

  function forward(result) {
    try {
      const movieId = result.movieId;
      const tracks = result.timedtexttracks;
      if (movieId == null || !Array.isArray(tracks)) return;

      // JSON.parse runs all the time, only send when the title changes
      const sig = String(movieId) + ":" + tracks.length;
      if (sig === lastSig) return;
      lastSig = sig;

      console.debug("[DualSub] got manifest", movieId, tracks.length, "tracks");

      window.postMessage(
        {
          [TAG]: true,
          type: "DUALSUB_MANIFEST_FOUND",
          movieId: String(movieId),
          timedtexttracks: tracks,
        },
        "*"
      );
    } catch (e) {}
  }

  JSON.parse = function (text, reviver) {
    const result = origParse.call(this, text, reviver);
    try {
      if (result && typeof result === "object") {
        if (result.result && Array.isArray(result.result.timedtexttracks)) {
          forward(result.result);
        } else if (Array.isArray(result.timedtexttracks)) {
          forward(result);
        }
      }
    } catch (e) {
      // doesn't matter what we hit, give back the real result
    }
    return result;
  };
})();
