/* Cron expression parser, describer and scheduler */
const Cron = (() => {
  const $ = (id) => document.getElementById(id);
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const FIELDS = [
    { key: "minute", label: "Minute", min: 0, max: 59 },
    { key: "hour", label: "Hour", min: 0, max: 23 },
    { key: "dom", label: "Day of month", min: 1, max: 31 },
    { key: "month", label: "Month", min: 1, max: 12, names: MONTHS, offset: 1 },
    { key: "dow", label: "Day of week", min: 0, max: 7, names: DAYS, offset: 0 },
  ];

  const MACROS = {
    "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
  };

  function toNum(tok, f) {
    const up = tok.toUpperCase();
    if (f.names && f.names.includes(up)) return f.names.indexOf(up) + f.offset;
    if (!/^\d+$/.test(tok)) throw new Error(`"${tok}" is not valid in the ${f.label.toLowerCase()} field`);
    const n = Number(tok);
    if (n < f.min || n > f.max) throw new Error(`${f.label} must be between ${f.min} and ${f.max} (got ${n})`);
    return n;
  }

  function parseField(src, f) {
    const set = new Set();
    for (const part of src.split(",")) {
      if (!part) throw new Error(`Empty list item in ${f.label.toLowerCase()}`);
      let [range, stepStr] = part.split("/");
      let step = 1;
      if (stepStr !== undefined) {
        if (!/^\d+$/.test(stepStr) || Number(stepStr) === 0) throw new Error(`Invalid step "/${stepStr}" in ${f.label.toLowerCase()}`);
        step = Number(stepStr);
      }
      let lo, hi;
      if (range === "*") { lo = f.min; hi = f.max; }
      else if (range.includes("-")) {
        const [a, b] = range.split("-");
        lo = toNum(a, f); hi = toNum(b, f);
        if (lo > hi) throw new Error(`Range ${range} in ${f.label.toLowerCase()} runs backwards`);
      } else {
        lo = toNum(range, f);
        hi = stepStr !== undefined ? f.max : lo;
      }
      for (let v = lo; v <= hi; v += step) set.add(f.key === "dow" && v === 7 ? 0 : v);
    }
    return set;
  }

  function parse(expr) {
    let s = expr.trim();
    if (MACROS[s.toLowerCase()]) s = MACROS[s.toLowerCase()];
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length !== 5) throw Object.assign(new Error(`Expected 5 fields, found ${parts.length}`), { parts });
    const out = { raw: parts };
    FIELDS.forEach((f, i) => {
      try { out[f.key] = parseField(parts[i], f); }
      catch (e) { e.fieldIndex = i; e.parts = parts; throw e; }
    });
    out.domStar = parts[2] === "*";
    out.dowStar = parts[4] === "*";
    return out;
  }

  /* ---- Human-readable description ---- */
  const pad = (n) => String(n).padStart(2, "0");
  const time12 = (h, m) => `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

  function listify(arr) {
    if (arr.length <= 2) return arr.join(" and ");
    return arr.slice(0, -1).join(", ") + ", and " + arr.slice(-1);
  }

  function describeSet(raw, set, f, fmt) {
    if (raw === "*") return null;
    const step = raw.match(/^\*\/(\d+)$/);
    if (step) return { step: Number(step[1]) };
    const vals = [...set].sort((a, b) => a - b);
    // compress contiguous runs
    const runs = [];
    for (const v of vals) {
      const last = runs[runs.length - 1];
      if (last && v === last[1] + 1) last[1] = v; else runs.push([v, v]);
    }
    return { text: listify(runs.map(([a, b]) => (b - a >= 2 ? `${fmt(a)} through ${fmt(b)}` : a === b ? fmt(a) : `${fmt(a)} and ${fmt(b)}`))), vals };
  }

  function describe(c) {
    const [rm, rh] = c.raw;
    const mins = [...c.minute].sort((a, b) => a - b);
    const hrs = [...c.hour].sort((a, b) => a - b);
    let when;

    if (rm === "*" && rh === "*") when = "Every minute";
    else if (mins.length === 1 && hrs.length === 1) when = `At ${time12(hrs[0], mins[0])}`;
    else if (mins.length === 1 && rh === "*") when = mins[0] === 0 ? "At the start of every hour" : `At ${pad(mins[0])} minutes past every hour`;
    else if (mins.length * hrs.length <= 6 && !/\//.test(rm + rh)) when = "At " + listify(hrs.flatMap((h) => mins.map((m) => time12(h, m))));
    else {
      const md = describeSet(rm, c.minute, FIELDS[0], (v) => String(v));
      const hd = describeSet(rh, c.hour, FIELDS[1], (v) => time12(v, 0).replace(":00", ""));
      let mPart = md === null ? "Every minute" : md.step ? `Every ${md.step} minutes` : mins.length === 1 ? `At minute ${mins[0]}` : `At minutes ${md.text}`;
      let hPart = "";
      if (hd) {
        if (hd.step) hPart = ` of every ${hd.step} hours`;
        else if (hd.vals.length > 1 && hd.vals[hd.vals.length - 1] - hd.vals[0] === hd.vals.length - 1) hPart = `, between ${time12(hd.vals[0], 0)} and ${time12(hd.vals[hd.vals.length - 1], 59)}`;
        else hPart = `, during the ${hd.text} hour${hd.vals.length > 1 ? "s" : ""}`;
      } else if (mins.length === 1 && md && !md.step) {
        mPart = `At ${pad(mins[0])} minutes past every hour`;
      }
      when = mPart + hPart;
      if (hd && hd.step && mins.length === 1) {
        when = `Every ${hd.step} hours, ${mins[0] === 0 ? "on the hour" : `at ${pad(mins[0])} minutes past`}`;
      }
    }

    const extra = [];
    const dd = describeSet(c.raw[2], c.dom, FIELDS[2], ordinal);
    const wd = describeSet(c.raw[4], c.dow, FIELDS[4], (v) => DAY_NAMES[v % 7]);
    if (dd && wd) extra.push(`on the ${dd.step ? `every ${dd.step}th day` : dd.text} of the month or on ${wd.text}`);
    else if (dd) extra.push(dd.step ? `every ${dd.step} days` : `on the ${dd.text} of the month`);
    else if (wd) extra.push(wd.step ? `every ${wd.step} days of the week` : `on ${wd.text}`);
    const mo = describeSet(c.raw[3], c.month, FIELDS[3], (v) => MONTH_NAMES[v - 1]);
    if (mo) extra.push(mo.step ? `every ${mo.step} months` : `in ${mo.text}`);

    return [when, ...extra].join(", ") + ".";
  }

  /* ---- Next run computation ---- */
  function getParts(d, utc) {
    return utc
      ? { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), w: d.getUTCDay() }
      : { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), w: d.getDay() };
  }

  function dayMatches(c, p) {
    const domOk = c.dom.has(p.d), dowOk = c.dow.has(p.w);
    if (c.domStar && c.dowStar) return true;
    if (c.domStar) return dowOk;
    if (c.dowStar) return domOk;
    return domOk || dowOk;
  }

  function nextRuns(c, count, utc, from = new Date()) {
    const runs = [];
    const t = new Date(from.getTime());
    t.setSeconds(0, 0);
    t.setTime(t.getTime() + 60000);
    const limit = from.getTime() + 5 * 366 * 864e5;
    while (runs.length < count && t.getTime() < limit) {
      const p = getParts(t, utc);
      if (!c.month.has(p.mo) || !dayMatches(c, p)) {
        // jump to next day at 00:00
        if (utc) t.setUTCHours(24, 0, 0, 0); else t.setHours(24, 0, 0, 0);
        continue;
      }
      if (!c.hour.has(p.h)) {
        if (utc) t.setUTCHours(p.h + 1, 0, 0, 0); else t.setHours(p.h + 1, 0, 0, 0);
        continue;
      }
      if (c.minute.has(p.mi)) runs.push(new Date(t.getTime()));
      t.setTime(t.getTime() + 60000);
    }
    return runs;
  }

  function relative(d) {
    const s = Math.round((d - Date.now()) / 1000);
    const units = [["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [u, n] of units) if (s >= n) { const v = Math.floor(s / n); return `in ${v} ${u}${v > 1 ? "s" : ""}`; }
    return "in under a minute";
  }

  /* ---- UI ---- */
  function render() {
    const expr = $("cronInput").value;
    const err = $("cronError");
    const tokens = expr.trim().split(/\s+/);
    let parsed = null, badField = -1;
    try {
      parsed = parse(expr);
      err.hidden = true;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      badField = e.fieldIndex ?? -1;
    }
    const shown = parsed ? parsed.raw : tokens;
    $("cronFields").innerHTML = FIELDS.map((f, i) =>
      `<div class="${i === badField ? "invalid" : ""}"><strong>${(shown[i] || "—").replace(/</g, "&lt;")}</strong><span>${f.label}</span></div>`).join("");

    if (!parsed) {
      $("cronHuman").textContent = "";
      $("cronRuns").innerHTML = "";
      return;
    }
    $("cronHuman").textContent = describe(parsed);
    const utc = $("cronTz").value === "UTC";
    const opts = { weekday: "short", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: utc ? "UTC" : undefined };
    const runs = nextRuns(parsed, 8, utc);
    $("cronRuns").innerHTML = runs.length
      ? runs.map((d) => `<li><span>${d.toLocaleString("en-GB", opts)}</span><span class="rel">${relative(d)}</span></li>`).join("")
      : '<li><span>No matching date in the next 5 years.</span></li>';
  }

  function init() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) $("cronTz").options[0].textContent = `Local (${tz})`;
    $("cronInput").addEventListener("input", render);
    $("cronTz").addEventListener("change", render);
    $("cronPresets").addEventListener("click", (e) => {
      if (e.target.dataset.v) { $("cronInput").value = e.target.dataset.v; render(); }
    });
    render();
    setInterval(render, 30000);
  }

  return { init, parse, describe, nextRuns };
})();
