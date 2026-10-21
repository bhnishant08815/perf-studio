// Small inline SVG charts for the report and the live status panel. Pure: returns strings.
// Colors come from CSS classes (CHART_CSS), so light and dark mode swap in one place.
// Specs follow the dataviz skill: 2px lines, 8px end dots with a 2px surface ring, hairline solid
// grid, bars at most 16px thick with a 4px rounded data end, 2px gaps between stacked segments.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;
export const fmtClock = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

// A round step (1, 2 or 5 times a power of ten) giving about `count` intervals.
function niceStep(span, count) {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
const ticks = (from, to, step) => {
  const out = [];
  for (let v = Math.ceil(from / step) * step; v <= to + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};

const open = (w, h, title) =>
  `<svg class="viz" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`;

function legend(entries, x, y) {
  let cx = x;
  const parts = entries.map(([cls, label, kind]) => {
    const mark = kind === 'line' ? `<line class="line ${cls}" x1="${cx}" y1="${y - 4}" x2="${cx + 16}" y2="${y - 4}"/>` : `<rect class="${cls}" x="${cx}" y="${y - 9}" width="10" height="10" rx="2"/>`;
    const text = `<text class="axis ink" x="${cx + 20}" y="${y}">${esc(label)}</text>`;
    cx += 28 + String(label).length * 6.5;
    return mark + text;
  });
  return `<g class="legend">${parts.join('')}</g>`;
}

export function lineChart({ title, series, formatY, formatX = fmtClock, limit, width = 720, height = 220 }) {
  const m = { l: 60, r: 16, t: series.length > 1 || limit ? 30 : 14, b: 28 };
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]).filter((y) => y !== null && y !== undefined);
  const x0 = Math.min(...xs, 0);
  const x1 = Math.max(...xs, x0 + 1);
  const yTop = Math.max(...ys, limit?.value ?? 0, 0) * 1.05 || 1;
  const yStep = niceStep(yTop, 4);
  const yMax = Math.ceil(yTop / yStep) * yStep;
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const X = (x) => r1(m.l + ((x - x0) / (x1 - x0)) * pw);
  const Y = (y) => r1(m.t + ph - (y / yMax) * ph);

  let out = open(width, height, title);
  for (const v of ticks(0, yMax, yStep)) {
    out += `<line class="grid" x1="${m.l}" x2="${width - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(formatY(v))}</text>`;
  }
  // Time axis: round steps of 5, 10, 15, 30 seconds or whole minutes.
  const span = x1 - x0;
  const xStep = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find((s) => span / s <= 6) ?? niceStep(span, 5);
  for (const v of ticks(x0, x1, xStep)) {
    out += `<text class="axis" x="${X(v)}" y="${height - 8}" text-anchor="middle">${esc(formatX(v))}</text>`;
  }
  if (limit) {
    out += `<line class="limit" x1="${m.l}" x2="${width - m.r}" y1="${Y(limit.value)}" y2="${Y(limit.value)}"/>`;
    out += `<text class="axis" x="${width - m.r}" y="${Y(limit.value) - 5}" text-anchor="end">${esc(`${limit.label} ${formatY(limit.value)}`)}</text>`;
  }
  series.forEach((s, i) => {
    const cls = `s${i + 1}`;
    // A null value (no requests in that window) breaks the line instead of drawing a fake zero.
    let seg = [];
    const flush = () => {
      if (seg.length) out += `<path class="line ${cls}" d="${seg.map(([x, y], j) => `${j ? 'L' : 'M'}${X(x)} ${Y(y)}`).join(' ')}"/>`;
      seg = [];
    };
    for (const p of s.points) (p[1] === null || p[1] === undefined ? flush() : seg.push(p));
    flush();
    const real = s.points.filter((p) => p[1] !== null && p[1] !== undefined);
    const last = real.at(-1);
    if (last) out += `<circle class="dot ${cls}" cx="${X(last[0])}" cy="${Y(last[1])}" r="4"/>`;
    for (const [x, y] of real) out += `<circle class="hit" cx="${X(x)}" cy="${Y(y)}" r="7"><title>${esc(`${s.label}, ${formatX(x)}: ${formatY(y)}`)}</title></circle>`;
  });
  if (series.length > 1) out += legend(series.map((s, i) => [`s${i + 1}`, s.label, 'line']), m.l, 16);
  return `${out}</svg>`;
}

const roundedEnd = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  if (w <= 0) return '';
  return `M${r1(x)} ${r1(y)} h${r1(w - rr)} a${rr} ${rr} 0 0 1 ${rr} ${rr} v${r1(h - 2 * rr)} a${rr} ${rr} 0 0 1 ${-rr} ${rr} h${r1(-(w - rr))} z`;
};
const short = (s, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function barChart({ title, items, formatValue, limit, width = 720 }) {
  const rowH = 30;
  const barH = 16;
  const labelW = 210;
  const valueW = 80;
  const top = limit ? 26 : 8;
  const height = top + items.length * rowH + 8;
  const pw = width - labelW - valueW;
  const max = Math.max(...items.map((d) => d.value), limit?.value ?? 0, 0) * 1.05 || 1;
  const W = (v) => (v / max) * pw;
  let out = open(width, height, title);
  items.forEach((d, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    out += `<text class="axis ink" x="${labelW - 8}" y="${y + barH - 4}" text-anchor="end">${esc(short(d.label))}<title>${esc(d.label)}</title></text>`;
    out += `<path class="bar" d="${roundedEnd(labelW, y, Math.max(W(d.value), 1), barH, 4)}"><title>${esc(`${d.label}: ${formatValue(d.value)}`)}</title></path>`;
    out += `<text class="axis ink" x="${r1(labelW + W(d.value) + 6)}" y="${y + barH - 4}">${esc(formatValue(d.value))}</text>`;
  });
  if (limit) {
    const x = r1(labelW + W(limit.value));
    out += `<line class="limit" x1="${x}" x2="${x}" y1="${top - 6}" y2="${height - 4}"/><text class="axis" x="${x}" y="${top - 10}" text-anchor="middle">${esc(`${limit.label} ${formatValue(limit.value)}`)}</text>`;
  }
  return `${out}</svg>`;
}

const STATUS_CLASS = { '2xx': 'st-good', '3xx': 'st-info', '4xx': 'st-warn', '5xx': 'st-crit', none: 'st-serious' };

export function stackedBar({ title, items, order, names, width = 720 }) {
  const rowH = 30;
  const barH = 16;
  const labelW = 210;
  const top = 28;
  const height = top + items.length * rowH + 8;
  const pw = width - labelW - 16;
  let out = open(width, height, title);
  out += legend(order.map((k) => [STATUS_CLASS[k] ?? 's1', names[k] ?? k, 'box']), labelW, 16);
  items.forEach((d, i) => {
    const y = top + i * rowH + (rowH - barH) / 2;
    const total = order.reduce((s, k) => s + (d.parts[k] ?? 0), 0);
    out += `<text class="axis ink" x="${labelW - 8}" y="${y + barH - 4}" text-anchor="end">${esc(short(d.label))}<title>${esc(d.label)}</title></text>`;
    if (!total) return;
    const used = order.filter((k) => (d.parts[k] ?? 0) > 0);
    let x = labelW;
    used.forEach((k, j) => {
      const w = (d.parts[k] / total) * pw;
      const gap = j < used.length - 1 ? 2 : 0; // surface gap between touching segments
      const pct = ((d.parts[k] / total) * 100).toFixed(1);
      out += `<rect class="seg ${STATUS_CLASS[k] ?? 's1'}" x="${r1(x)}" y="${y}" width="${r1(Math.max(w - gap, 1))}" height="${barH}"><title>${esc(`${d.label}: ${names[k] ?? k} ${d.parts[k]} (${pct}%)`)}</title></rect>`;
      x += w;
    });
  });
  return `${out}</svg>`;
}

export const CHART_CSS = `
.viz{--v-surface:#fcfcfb;--v-grid:#e6e5e1;--v-ink:#0b0b0b;--v-ink2:#52514e;--v-s1:#2a78d6;--v-s2:#eb6834;--v-good:#0ca30c;--v-warn:#fab219;--v-serious:#ec835a;--v-crit:#d03b3b;--v-info:#86b6ef;display:block;font-family:system-ui,Segoe UI,sans-serif;overflow:visible}
@media (prefers-color-scheme: dark){.viz{--v-surface:#1a1a19;--v-grid:#33332f;--v-ink:#f0efec;--v-ink2:#c3c2b7;--v-s1:#3987e5;--v-s2:#d95926;--v-info:#5598e7}}
.viz .grid{stroke:var(--v-grid);stroke-width:1}
.viz .axis{fill:var(--v-ink2);font-size:11px}.viz .axis.ink{fill:var(--v-ink);font-size:12px}
.viz .line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.viz .line.s1{stroke:var(--v-s1)}.viz .line.s2{stroke:var(--v-s2)}
.viz .dot{stroke:var(--v-surface);stroke-width:2}.viz .dot.s1{fill:var(--v-s1)}.viz .dot.s2{fill:var(--v-s2)}
.viz .hit{fill:transparent}.viz .hit:hover{fill:var(--v-grid);fill-opacity:.6}
.viz .limit{stroke:var(--v-ink2);stroke-width:1.5;stroke-dasharray:5 4}
.viz .bar{fill:var(--v-s1)}.viz rect.s1{fill:var(--v-s1)}.viz rect.s2{fill:var(--v-s2)}
.viz .st-good{fill:var(--v-good)}.viz .st-info{fill:var(--v-info)}.viz .st-warn{fill:var(--v-warn)}.viz .st-crit{fill:var(--v-crit)}.viz .st-serious{fill:var(--v-serious)}
`;
