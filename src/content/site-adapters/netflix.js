// Netflix-specific DOM bits. Track listing/switching now goes through Netflix's player API
// (see page-agent.js); this adapter just locates the video, the element that goes
// fullscreen, and the native caption node so the renderer can attach and hide them.
;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});

  const adapter = {
    name: "netflix",

    getVideo() {
      return document.querySelector("video");
    },

    getPlayerContainer() {
      const v = this.getVideo();
      if (!v) return null;
      return (
        v.closest('[data-uia="video-canvas"]') ||
        v.closest(".watch-video--player-view") ||
        v.closest(".watch-video") ||
        v.parentElement
      );
    },

    nativeCaptionSelector() {
      return ".player-timedtext";
    },

    isWatchPage() {
      return location.pathname.indexOf("/watch") === 0 || !!this.getVideo();
    },
  };

  NS.NetflixAdapter = adapter;
  NS.getAdapter = function () {
    return adapter;
  };
})(globalThis);
