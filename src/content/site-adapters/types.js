// adapter shape, so adding another site later (disney+, prime, ...) is just a new file.
// each one needs:
//   name
//   getVideo()
//   getPlayerContainer()    the element that goes fullscreen
//   nativeCaptionSelector()
//   isWatchPage()
//
// track listing/switching and subtitle capture are handled generically (the page agent
// for the player API, the service worker for the subtitle files), so an adapter only
// needs the DOM helpers above.
;(function (g) {
  (g.DualSub = g.DualSub || {}).SiteAdapterDoc = true;
})(globalThis);
