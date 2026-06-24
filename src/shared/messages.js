// message names + defaults, kept in one place.
// hung off globalThis so the popup, content scripts and the worker can all read it.
;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});

  NS.MSG = {
    // page -> content script
    MANIFEST_FOUND: "DUALSUB_MANIFEST_FOUND",

    // popup <-> content script
    GET_STATE: "DUALSUB_GET_STATE",
    STATE_CHANGED: "DUALSUB_STATE_CHANGED",
    SET_SELECTION: "DUALSUB_SET_SELECTION",
    SET_DISPLAY: "DUALSUB_SET_DISPLAY",

    // content script <-> worker
    LOAD_SETTINGS: "DUALSUB_LOAD_SETTINGS",
    SAVE_SETTINGS: "DUALSUB_SAVE_SETTINGS",
    FETCH_TRACK: "DUALSUB_FETCH_TRACK",
  };

  // tag on our postMessage payloads so we ignore netflix's own messages
  NS.TAG = "__dualsub__";

  NS.DEFAULTS = {
    preferredPrimaryLang: "en",
    preferredSecondaryLang: "de",
    display: {
      primaryOnTop: true,
      fontScale: 1.0,
      verticalOffset: 60,
      gap: 4,
      background: true,
    },
  };
})(globalThis);
