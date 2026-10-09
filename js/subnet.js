/* IPv4 / CIDR helpers and the Subnet Calculator panel */
const Subnet = (() => {
  const MAX_ROWS = 1024;

  function ipToInt(ip) {
    const parts = ip.trim().split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const v = Number(p);
      if (v > 255) return null;
      n = n * 256 + v;
    }
    return n;
  }

  function intToIp(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }

  function maskInt(prefix) {
    return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  }

  function parse(cidr) {
    const m = String(cidr).trim().match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
    if (!m) return { error: "Use the form a.b.c.d/nn, e.g. 10.0.0.0/16" };
    const ip = ipToInt(m[1]);
    if (ip === null) return { error: `"${m[1]}" is not a valid IPv4 address` };
    const prefix = m[2] === undefined ? 32 : Number(m[2]);
    if (prefix > 32) return { error: "Prefix length must be between 0 and 32" };
    const mask = maskInt(prefix);
    const network = (ip & mask) >>> 0;
    const size = 2 ** (32 - prefix);
    const broadcast = network + size - 1;
    return { ip, prefix, mask, network, broadcast, size, aligned: ip === network };
  }

  function classify(n) {
    const inRange = (base, p) => ((n & maskInt(p)) >>> 0) === ipToInt(base);
    if (inRange("10.0.0.0", 8) || inRange("172.16.0.0", 12) || inRange("192.168.0.0", 16)) return "Private (RFC 1918)";
    if (inRange("100.64.0.0", 10)) return "Carrier-grade NAT (RFC 6598)";
    if (inRange("127.0.0.0", 8)) return "Loopback";
    if (inRange("169.254.0.0", 16)) return "Link-local";
    if (inRange("224.0.0.0", 4)) return "Multicast";
    return "Public";
  }

  function usable(net, reserveCloud) {
    if (net.prefix === 32) return { first: net.network, last: net.network, count: 1 };
    if (net.prefix === 31) return { first: net.network, last: net.broadcast, count: 2 };
    // Classic: network + broadcast. AWS / Azure: network, +1 router, +2 DNS, +3 reserved, broadcast.
    const headReserve = reserveCloud ? 4 : 1;
    const count = Math.max(0, net.size - headReserve - 1);
    return { first: net.network + headReserve, last: net.broadcast - 1, count };
  }

  function overlaps(a, b) {
    return a.network <= b.broadcast && b.network <= a.broadcast;
  }

  /* ---------- UI ---------- */
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString("en-US");

  function renderStats(net) {
    const wildcard = (~net.mask) >>> 0;
    const u = usable(net, false);
    const rows = [
      ["Network address", `${intToIp(net.network)}/${net.prefix}`],
      ["Broadcast", intToIp(net.broadcast)],
      ["Subnet mask", intToIp(net.mask)],
      ["Wildcard mask", intToIp(wildcard)],
      ["First usable", intToIp(u.first)],
      ["Last usable", intToIp(u.last)],
      ["Total addresses", fmt(net.size)],
      ["Usable hosts", fmt(u.count)],
      ["Address type", classify(net.network)],
      ["Hex", "0x" + net.network.toString(16).padStart(8, "0").toUpperCase()],
    ];
    $("cidrStats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

    const bin = net.ip.toString(2).padStart(32, "0");
    let html = "";
    for (let o = 0; o < 4; o++) {
      html += '<span class="octet">';
      for (let i = o * 8; i < o * 8 + 8; i++) {
        html += `<span class="b ${i < net.prefix ? "n" : "h"}">${bin[i]}</span>`;
      }
      html += "</span>";
    }
    html += `<span class="bits-legend">${net.prefix} network bits · ${32 - net.prefix} host bits</span>`;
    $("cidrBits").innerHTML = html;
  }

  function renderSplit(net) {
    const sel = $("splitPrefix");
    const prev = Number(sel.value);
    const options = [];
    for (let p = net.prefix; p <= 32; p++) options.push(p);
    const fallback = Math.min(32, net.prefix + (net.prefix <= 16 ? 8 : net.prefix <= 24 ? 2 : 0));
    const chosen = options.includes(prev) && prev >= net.prefix ? prev : fallback;
    sel.innerHTML = options.map((p) => {
      const count = 2 ** (p - net.prefix);
      return `<option value="${p}" ${p === chosen ? "selected" : ""}>/${p} — ${fmt(count)} subnet${count > 1 ? "s" : ""}</option>`;
    }).join("");

    const p = chosen;
    const reserve = $("cloudReserve").checked;
    const count = 2 ** (p - net.prefix);
    const step = 2 ** (32 - p);
    const shown = Math.min(count, MAX_ROWS);
    const rows = [];
    for (let i = 0; i < shown; i++) {
      const sub = parse(`${intToIp(net.network + i * step)}/${p}`);
      const u = usable(sub, reserve);
      rows.push({ i: i + 1, cidr: `${intToIp(sub.network)}/${p}`, range: u.count ? `${intToIp(u.first)} – ${intToIp(u.last)}` : "—", hosts: u.count });
    }
    $("splitTable").querySelector("tbody").innerHTML = rows
      .map((r) => `<tr><td>${r.i}</td><td>${r.cidr}</td><td>${r.range}</td><td>${fmt(r.hosts)}</td></tr>`)
      .join("");
    const perHost = rows[0] ? rows[0].hosts : 0;
    $("splitSummary").textContent = `${fmt(count)} × /${p} · ${fmt(perHost)} usable hosts each` + (count > shown ? ` · showing first ${fmt(shown)}` : "");
    Subnet._rows = rows;
  }

  function renderOverlap() {
    const lines = $("overlapInput").value.split(/\n/).map((s) => s.trim()).filter(Boolean);
    const nets = [];
    const out = [];
    for (const l of lines) {
      const n = parse(l);
      if (n.error) out.push(`<li class="warn"><code>${escapeHtml(l)}</code> — ${n.error}</li>`);
      else nets.push({ label: `${intToIp(n.network)}/${n.prefix}`, ...n });
    }
    const conflicts = [];
    for (let i = 0; i < nets.length; i++) {
      for (let j = i + 1; j < nets.length; j++) {
        if (overlaps(nets[i], nets[j])) {
          const [a, b] = nets[i].size >= nets[j].size ? [nets[i], nets[j]] : [nets[j], nets[i]];
          const how = a.size === b.size ? "is identical to" : "contains";
          conflicts.push(`<li class="bad"><code>${a.label}</code> ${how} <code>${b.label}</code></li>`);
        }
      }
    }
    if (nets.length > 1 && conflicts.length === 0) out.unshift(`<li class="ok">No overlaps across ${nets.length} ranges — safe to peer.</li>`);
    if (nets.length <= 1 && out.length === 0) out.push('<li class="warn">Enter at least two CIDR blocks.</li>');
    $("overlapResult").innerHTML = conflicts.join("") + out.join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function update() {
    const net = parse($("cidrInput").value);
    const err = $("cidrError");
    if (net.error) {
      err.textContent = net.error;
      err.hidden = false;
      return;
    }
    err.hidden = net.aligned;
    if (!net.aligned) err.textContent = `Host bits are set — the network address is ${intToIp(net.network)}/${net.prefix}.`;
    renderStats(net);
    renderSplit(net);
  }

  function init() {
    $("cidrInput").addEventListener("input", update);
    $("splitPrefix").addEventListener("change", update);
    $("cloudReserve").addEventListener("change", update);
    $("overlapInput").addEventListener("input", renderOverlap);
    $("cidrPresets").addEventListener("click", (e) => {
      if (e.target.dataset.v) { $("cidrInput").value = e.target.dataset.v; update(); }
    });
    $("copySubnets").addEventListener("click", () => {
      const csv = ["index,cidr,usable_range,hosts", ...(Subnet._rows || []).map((r) => `${r.i},${r.cidr},"${r.range}",${r.hosts}`)].join("\n");
      App.copy(csv, "Subnets copied as CSV");
    });
    update();
    renderOverlap();
  }

  return { init, parse, intToIp, ipToInt, usable, overlaps };
})();
