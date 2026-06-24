// turn webvtt or ttml/dfxp into [{start, end, text}] (seconds).
;(function (g) {
  const NS = (g.DualSub = g.DualSub || {});

  // HH:MM:SS.mmm or MM:SS.mmm, comma or dot for the fraction
  function clockToSeconds(ts) {
    if (!ts) return null;
    const m = String(ts).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
    if (!m) return null;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const min = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    const ms = parseInt((m[4] + "000").slice(0, 3), 10);
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  function decodeEntities(s) {
    return s
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&amp;/g, "&");
  }

  function stripTags(s) {
    return decodeEntities(s.replace(/<[^>]*>/g, "")).trim();
  }

  function parseVTT(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, "").split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.split("\n");
      const idx = lines.findIndex(function (l) { return l.indexOf("-->") !== -1; });
      if (idx < 0) continue;
      const parts = lines[idx].split("-->");
      const start = clockToSeconds(parts[0]);
      const end = clockToSeconds(parts[1]);
      if (start == null || end == null) continue;
      const body = lines.slice(idx + 1).map(stripTags).filter(Boolean).join("\n");
      if (body) cues.push({ start: start, end: end, text: body });
    }
    cues.sort(function (a, b) { return a.start - b.start; });
    return cues;
  }

  function ttmlTimeToSeconds(v) {
    if (!v) return null;
    v = String(v).trim();
    if (/s$/.test(v)) return parseFloat(v);
    if (/t$/.test(v)) return parseFloat(v) / 10000000; // ticks, netflix runs at 10MHz
    return clockToSeconds(v);
  }

  function parseTTML(text) {
    const cues = [];
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const ps = doc.getElementsByTagName("p");
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const start = ttmlTimeToSeconds(p.getAttribute("begin"));
      const end = ttmlTimeToSeconds(p.getAttribute("end"));
      if (start == null || end == null) continue;
      let inner = "";
      p.childNodes.forEach(function (n) {
        if (n.nodeType === 3) inner += n.textContent;
        else if (n.nodeName.toLowerCase() === "br") inner += "\n";
        else inner += n.textContent;
      });
      const body = decodeEntities(inner).replace(/[ \t]+\n/g, "\n").trim();
      if (body) cues.push({ start: start, end: end, text: body });
    }
    cues.sort(function (a, b) { return a.start - b.start; });
    return cues;
  }

  NS.parseSubtitles = function (text, format) {
    if (!text) return [];
    if (format === "ttml") return parseTTML(text);
    if (/^\s*(<\?xml|<tt[\s>])/.test(text)) return parseTTML(text); // sniff, just in case
    return parseVTT(text);
  };
})(globalThis);
