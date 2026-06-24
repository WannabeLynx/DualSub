// Popup UI: pick the two languages + tweak display. Talks to the content bridge in
// the active tab; live-updates from STATE_CHANGED broadcasts (DESIGN.md §5).
(function () {
  const MSG = globalThis.DualSub.MSG;
  const els = {};

  function trackLabel(t) {
    return (
      t.label +
      (t.kind === "closedcaptions" ? " [CC]" : "") +
      (t.isForced ? " (forced)" : "")
    );
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function sendToTab(msg) {
    const tab = await activeTab();
    if (!tab) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      return null; // content script not present on this page
    }
  }

  function fillSelect(sel, tracks, selectedId) {
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— none —";
    sel.appendChild(none);
    tracks.forEach(function (t) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = trackLabel(t);
      if (t.id === selectedId) o.selected = true;
      sel.appendChild(o);
    });
  }

  function render(state) {
    if (!state || !state.ready || !state.tracks || !state.tracks.length) {
      els.status.textContent =
        "Open a Netflix title and press play to load its subtitle tracks, then reopen this popup.";
      els.main.style.display = "none";
      return;
    }
    els.status.textContent = "";
    els.main.style.display = "block";

    fillSelect(els.primary, state.tracks, state.selection.primaryTrackId);
    fillSelect(els.secondary, state.tracks, state.selection.secondaryTrackId);

    const d = state.display || {};
    els.primaryOnTop.checked = d.primaryOnTop !== false;
    els.background.checked = d.background !== false;
    els.fontScale.value = d.fontScale || 1;
    els.verticalOffset.value = d.verticalOffset || 0;
  }

  function pushSelection() {
    sendToTab({
      type: MSG.SET_SELECTION,
      primaryTrackId: els.primary.value || null,
      secondaryTrackId: els.secondary.value || null,
    });
  }

  function pushDisplay() {
    sendToTab({
      type: MSG.SET_DISPLAY,
      display: {
        primaryOnTop: els.primaryOnTop.checked,
        background: els.background.checked,
        fontScale: parseFloat(els.fontScale.value),
        verticalOffset: parseInt(els.verticalOffset.value, 10),
      },
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    els.status = document.getElementById("status");
    els.main = document.getElementById("main");
    els.primary = document.getElementById("primary");
    els.secondary = document.getElementById("secondary");
    els.primaryOnTop = document.getElementById("primaryOnTop");
    els.background = document.getElementById("background");
    els.fontScale = document.getElementById("fontScale");
    els.verticalOffset = document.getElementById("verticalOffset");

    els.primary.addEventListener("change", pushSelection);
    els.secondary.addEventListener("change", pushSelection);
    [els.primaryOnTop, els.background, els.fontScale, els.verticalOffset].forEach(function (e) {
      e.addEventListener("input", pushDisplay);
    });

    render(await sendToTab({ type: MSG.GET_STATE }));
  });

  // Live updates while the popup is open (tracks arrive, selection changes).
  chrome.runtime.onMessage.addListener(function (req) {
    if (req && req.type === MSG.STATE_CHANGED) render(req.state);
  });
})();
