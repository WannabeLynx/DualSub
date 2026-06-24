// adapter shape, so adding another site later (disney+, prime, ...) is just a new file.
// each one needs:
//   name
//   normalizeManifest(msg) -> { movieId, tracks }
//   getVideo()
//   getPlayerContainer()    the element that goes fullscreen
//   nativeCaptionSelector()
//   isWatchPage()
//
// a track is { id, lang, label, kind, isForced, formats:{webvtt?, ttml?} }
;(function (g) {
  (g.DualSub = g.DualSub || {}).SiteAdapterDoc = true;
})(globalThis);
