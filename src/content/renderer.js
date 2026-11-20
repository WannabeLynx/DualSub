// draws the two subtitle rows over the player and keeps them lined up with the video.
// only writes to the dom when the line on screen actually changes.
;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});

  // last cue that covers t. binary search, then scan back a few in case cues overlap.
  function findActiveCue(cues, t) {
    if (!cues || !cues.length) return null;
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    for (let i = ans; i >= 0 && i > ans - 6; i--) {
      if (cues[i].start <= t && cues[i].end >= t) return cues[i];
    }
    return null;
  }

  class Renderer {
    constructor(adapter) {
      this.adapter = adapter;
      this.video = null;
      this.container = null;
      this.overlay = null;
      this.rowPrimary = null;
      this.rowSecondary = null;
      this.styleEl = null;
      this.primaryCues = null;
      this.secondaryCues = null;
      this.display = Object.assign({}, NS.DEFAULTS.display);
      this._running = false;
      this._lastP = null;
      this._lastS = null;
      this._frame = 0;
      this._onFsChange = () => this.mount();
    }

    setCues(primaryCues, secondaryCues) {
      this.primaryCues = primaryCues || null;
      this.secondaryCues = secondaryCues || null;
      this._lastP = this._lastS = " "; // force a redraw
      this.tick();
    }

    setDisplay(display) {
      Object.assign(this.display, display || {});
      this.applyStyle();
    }

    injectStyle() {
      if (this.styleEl && this.styleEl.isConnected) return;
      const st = document.createElement("style");
      st.id = "dualsub-style";
      st.textContent =
        "#dualsub-overlay{position:absolute;left:0;right:0;bottom:0;z-index:2147483000;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:flex-end;" +
        "width:100%;pointer-events:none;text-align:center;}" +
        "#dualsub-overlay .dualsub-row{max-width:90%;margin:0;line-height:1.25;" +
        "font-family:'Netflix Sans',Helvetica,Arial,sans-serif;font-weight:500;color:#fff;" +
        "white-space:pre-line;text-shadow:0 0 4px #000,0 0 4px #000,0 1px 2px #000;}" +
        "#dualsub-overlay .dualsub-row.dualsub-bg span{background:rgba(0,0,0,.55);" +
        "padding:.08em .35em;border-radius:3px;-webkit-box-decoration-break:clone;box-decoration-break:clone;}" +
        "#dualsub-overlay .dualsub-row:empty{display:none;}" +
        ".dualsub-hide-native{display:none!important;}";
      (document.head || document.documentElement).appendChild(st);
      this.styleEl = st;
    }

    ensureOverlay() {
      this.injectStyle();
      if (this.overlay && this.overlay.isConnected) return;
      const o = document.createElement("div");
      o.id = "dualsub-overlay";
      const p = document.createElement("div");
      p.className = "dualsub-row dualsub-primary";
      const s = document.createElement("div");
      s.className = "dualsub-row dualsub-secondary";
      o.appendChild(p);
      o.appendChild(s);
      this.overlay = o;
      this.rowPrimary = p;
      this.rowSecondary = s;
      this.applyStyle();
    }

    applyStyle() {
      if (!this.overlay) return;
      const d = this.display;
      const base = 2.5 * (d.fontScale || 1); // vh so it scales with the player size
      this.overlay.style.bottom = (d.verticalOffset || 0) + "px";
      const rows = [this.rowPrimary, this.rowSecondary];
      for (const row of rows) {
        row.style.fontSize = base + "vh";
        row.classList.toggle("dualsub-bg", d.background !== false);
      }
      // which language sits on top
      const top = d.primaryOnTop ? this.rowPrimary : this.rowSecondary;
      const bottom = d.primaryOnTop ? this.rowSecondary : this.rowPrimary;
      this.overlay.appendChild(top);
      this.overlay.appendChild(bottom);

      top.style.display = "";
      bottom.style.display = "block";
      bottom.style.minHeight = "2lh";
      top.style.marginBottom = (d.gap || 4) + "px";
      bottom.style.marginBottom = "0px";
    }

    hideNative() {
      const sel = this.adapter.nativeCaptionSelector();
      if (!sel) return;
      document.querySelectorAll(sel).forEach(function (el) {
        el.classList.add("dualsub-hide-native");
      });
    }

    // attach the overlay to whatever element actually goes fullscreen
    mount() {
      this.video = this.adapter.getVideo();
      if (!this.video) return false;
      this.ensureOverlay();
      const fsel = document.fullscreenElement;
      const container =
        fsel && fsel.contains(this.video) ? fsel : this.adapter.getPlayerContainer();
      if (!container) return false;
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
      if (this.overlay.parentElement !== container) container.appendChild(this.overlay);
      this.container = container;
      this.hideNative();
      return true;
    }

    setRowText(row, cue, last) {
      const text = cue ? cue.text : "";
      if (text === last) return last;
      row.textContent = "";
      if (text) {
        const span = document.createElement("span");
        span.textContent = text;
        row.appendChild(span);
      }
      return text;
    }

    tick() {
      if (!this.video) return;
      const t = this.video.currentTime;
      this._lastP = this.setRowText(this.rowPrimary, findActiveCue(this.primaryCues, t), this._lastP);
      this._lastS = this.setRowText(this.rowSecondary, findActiveCue(this.secondaryCues, t), this._lastS);
    }

    start() {
      if (this._running) {
        this.mount();
        return;
      }
      this._running = true;
      this.mount();
      document.addEventListener("fullscreenchange", this._onFsChange, true);
      const loop = () => {
        if (!this._running) return;
        // netflix tears down and rebuilds the video/overlay when you jump around,
        // so every half second or so check we're still attached
        if (++this._frame % 30 === 0) {
          if (!this.video || !this.video.isConnected || !this.overlay || !this.overlay.isConnected) {
            this.mount();
          } else {
            this.hideNative(); // their caption node can come back
          }
        }
        this.tick();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() {
      this._running = false;
      document.removeEventListener("fullscreenchange", this._onFsChange, true);
      if (this.rowPrimary) this.rowPrimary.textContent = "";
      if (this.rowSecondary) this.rowSecondary.textContent = "";
    }
  }

  NS.Renderer = Renderer;
})(globalThis);
