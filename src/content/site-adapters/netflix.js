// all the netflix-specific bits live here: manifest shape + dom selectors.
;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});

  // the url has shown up in two shapes depending on the netflix build
  function pickUrl(d) {
    if (!d) return null;
    if (d.downloadUrls && typeof d.downloadUrls === "object") {
      const vals = Object.values(d.downloadUrls);
      if (vals.length) return vals[0];
    }
    if (Array.isArray(d.urls) && d.urls.length) {
      const u = d.urls[0];
      return typeof u === "string" ? u : u.url || null;
    }
    return null;
  }

  // grab a webvtt url if there's one, else fall back to ttml/dfxp
  function extractFormats(ttDownloadables) {
    const formats = {};
    if (!ttDownloadables) return formats;
    for (const profile of Object.keys(ttDownloadables)) {
      const url = pickUrl(ttDownloadables[profile]);
      if (!url) continue;
      const p = profile.toLowerCase();
      if (p.indexOf("webvtt") !== -1) {
        if (!formats.webvtt) formats.webvtt = url;
      } else if (p.indexOf("dfxp") !== -1 || p.indexOf("imsc") !== -1 || p.indexOf("ttml") !== -1) {
        if (!formats.ttml) formats.ttml = url;
      }
    }
    return formats;
  }

  function normalizeTracks(rawTracks) {
    const out = [];
    for (const t of rawTracks || []) {
      if (t.isNoneTrack) continue; // the "off" entry
      const formats = extractFormats(t.ttDownloadables);
      if (!formats.webvtt && !formats.ttml) continue;
      out.push({
        id: t.new_track_id || t.id || t.language + ":" + (t.trackType || ""),
        lang: t.language || "und",
        label: t.languageDescription || t.language || "Unknown",
        kind: t.rawTrackType === "closedcaptions" ? "closedcaptions" : "subtitles",
        isForced: !!t.isForcedNarrative,
        formats: formats,
      });
    }
    return out;
  }

  const adapter = {
    name: "netflix",

    normalizeManifest(msg) {
      return {
        movieId: String(msg.movieId),
        tracks: normalizeTracks(msg.timedtexttracks),
      };
    },

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
