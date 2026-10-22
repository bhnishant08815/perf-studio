// Builds the plain language report.html in Node after k6 exits, from summary.json, the timeline
// and the previous run with the same name. Never prints header values, bodies or login details.
import { THEME_CSS } from './theme.js';
import { CHART_CSS, barChart, esc, fmtClock, lineChart, stackedBar } from './charts.js';
import { describeShape, fmtDuration } from './form.js';
import { maskQuery } from './config.js';
import { explainRun } from './explain.js';

const RATE = { medianMs: [1000, 2500], maxMs: [3000, 10000], checksPct: [99, 95] };
const grade = (v, [good, ok]) => (v < good ? 'good' : v < ok ? 'ok' : 'bad');
const LABEL = { good: 'Good', ok: 'Needs attention', bad: 'Poor', info: '' };
const worst = (gs) => (gs.includes('bad') ? 'bad' : gs.includes('ok') ? 'ok' : 'good');
const TYPES = { smoke: 'Smoke (quick check)', load: 'Load (normal busy day)', stress: 'Stress (past normal)', spike: 'Spike (sudden rush)', soak: 'Soak (long steady run)', breakpoint: 'Breakpoint (until it breaks)' };
const STATUS_NAMES = { '2xx': 'Worked (2xx)', '3xx': 'Redirected (3xx)', '4xx': 'Client error (4xx)', '5xx': 'Server error (5xx)', none: 'No answer' };
const STATUS_ORDER = ['2xx', '3xx', '4xx', '5xx', 'none'];

export const ms = (v) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} sec`);
const pct = (v) => `${v.toFixed(2)}%`;
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
// Each chart gets a visible caption; the svg <title> alone is only read by screen readers and hover.
const fig = (title, svg) => `<figure><figcaption>${esc(title)}</figcaption>${svg}</figure>`;
// Axis numbers: whole numbers stay whole (0, 20, 40), small steps keep one decimal (0.5).
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const limitLine = (value) => (value === null ? undefined : { value, label: 'Your limit' });
const rpsOf =(s) => (s.durationS > 0 ? s.requests / s.durationS : 0);

function keyCards(s, lim) {
  const card = (q, big, g, text, tag) => ({ q, big, g, text, tag });
  // Cards judged against the user's own limit say so, so a high but allowed failure rate never reads as plain "Good".
  const vsLimit = (g) => (g === 'good' ? 'Within your limit' : 'Over your limit');
  const noErr = lim.errorPct === null; // a limit left empty is not judged
  const noP95 = lim.p95Ms === null;
  return [
    noErr
      ? card('Did the site stay up?', `${(100 - s.failPct).toFixed(2)}%`, 'info', s.failPct === 0 ? 'Every request worked. Nobody saw an error.' : `${pct(s.failPct)} of requests failed. You set no limit for this.`)
      : card('Did the site stay up?', `${(100 - s.failPct).toFixed(2)}%`, s.failPct <= lim.errorPct ? 'good' : 'bad', s.failPct === 0 ? 'Every request worked. Nobody saw an error.' : `${pct(s.failPct)} of requests failed. Your limit was ${lim.errorPct}%.`, vsLimit(s.failPct <= lim.errorPct ? 'good' : 'bad')),
    card('How fast did pages feel?', ms(s.p50Ms), grade(s.p50Ms, RATE.medianMs), 'Half of all visits were faster than this. Under 1 second feels instant.'),
    noP95
      ? card('How slow for the unlucky ones?', ms(s.p95Ms), 'info', '1 in 20 visits waited longer than this. You set no limit for this.')
      : card('How slow for the unlucky ones?', ms(s.p95Ms), s.p95Ms <= lim.p95Ms ? 'good' : 'bad', `1 in 20 visits waited longer than this. Your limit was ${ms(lim.p95Ms)}.`, vsLimit(s.p95Ms <= lim.p95Ms ? 'good' : 'bad')),
    card('Worst single experience', ms(s.maxMs), grade(s.maxMs, RATE.maxMs), 'The slowest request in the whole test. One-off spikes can be network noise.'),
    card('Requests per second', rpsOf(s).toFixed(1), 'info', 'How much work the site handled each second, on average.'),
    card('Checks passed', pct(s.checksPassPct ?? 0), (s.checksPassPct ?? 0) >= RATE.checksPct[0] ? 'good' : (s.checksPassPct ?? 0) >= RATE.checksPct[1] ? 'ok' : 'bad', 'Answers that had the expected status code.'),
    card('Data downloaded', mb(s.dataReceivedBytes ?? 0), 'info', 'Compare with your internet speed: a slow connection can limit the test.'),
  ];
}

function verdictOf(passed, cards, lim, stopped) {
  // The user's own stop, or no limits to judge by, must not read as a verdict on the site.
  if (stopped) return { overall: 'ok', label: 'Stopped early' };
  if (lim.p95Ms === null && lim.errorPct === null) return { overall: 'ok', label: 'Results, no limits set' };
  let overall = worst(cards.filter((c) => c.g !== 'info').map((c) => c.g));
  if (passed === false) overall = 'bad'; // k6 says a limit was missed, so never show a green verdict
  else if (passed === true && overall === 'bad' && (lim.p95Ms !== null || lim.errorPct !== null)) overall = 'ok';
  const label = { good: 'Ready', ok: 'Mostly fine, needs attention', bad: 'Not ready' }[overall];
  return { overall, label };
}

// A cell is html, or { html, v } for a numeric or sortable cell (v is the raw value for sorting).
// Sortable tables get focusable headers; sorting runs in the one inline script at the end of the page.
const table = (head, rows, rowClass = '', sortable = false) => {
  const th = (h, i) => (sortable ? `<th${i ? ' class="num"' : ''} data-sort tabindex="0" aria-sort="none">${h}</th>` : `<th>${h}</th>`);
  const td = (c) => (typeof c === 'object' ? `<td${typeof c.v === 'number' ? ' class="num"' : ''} data-v="${esc(c.v)}">${c.html}</td>` : `<td>${c}</td>`);
  return `<div class="tw"><table class="data"><thead><tr>${head.map(th).join('')}</tr></thead><tbody>${rows.map((r) => `<tr${rowClass ? ` class="${rowClass}"` : ''}>${r.map(td).join('')}</tr>`).join('')}</tbody></table></div>`;
};

function overTime(timeline, lim) {
  if (!timeline?.length) return '<p class="muted">No timeline data for this run. It may have been stopped in its first seconds.</p>';
  const pts = (key) => timeline.map((p) => [p.t, p[key]]);
  const charts = [
    lineChart({ title: 'People on the site', series: [{ label: 'People', points: pts('users') }], formatY: (v) => String(Math.round(v)) }),
    lineChart({ title: 'Requests per second', series: [{ label: 'Requests per second', points: pts('rps') }], formatY: num }),
    lineChart({
      title: 'Response time',
      series: [
        { label: 'Average in each 5 seconds', points: pts('avgMs') },
        { label: 'Slow 1 in 20, so far', points: pts('p95SoFarMs') },
      ],
      formatY: ms,
      limit: limitLine(lim.p95Ms),
    }),
    lineChart({ title: 'Share of requests that failed', series: [{ label: 'Failed', points: pts('failPct') }], formatY: (v) => `${num(v)}%`, limit: limitLine(lim.errorPct) }),
  ];
  const titles = ['People on the site', 'Requests per second', 'Response time', 'Share of requests that failed'];
  return charts.map((svg, i) => fig(titles[i], svg)).join('') + '<p class="muted">Response time is the average of each 5 second window. The "slow 1 in 20" line covers the whole test so far. Grafana shows it per window.</p>';
}

function perEndpoint(eps, lim) {
  if (!eps?.length) return '<p class="muted">No per call numbers for this run.</p>';
  const sorted = [...eps].sort((a, b) => b.p95Ms - a.p95Ms);
  const present = STATUS_ORDER.filter((k) => sorted.some((e) => (e.statusClasses?.[k] ?? 0) > 0));
  const bars = barChart({ title: 'Slow 1 in 20, per page or API (slowest first)', items: sorted.map((e) => ({ label: e.name, value: e.p95Ms })), formatValue: ms, limit: limitLine(lim.p95Ms) });
  const stacks = stackedBar({ title: 'How each page or API answered', items: sorted.map((e) => ({ label: e.name, parts: e.statusClasses })), order: present.length ? present : ['2xx'], names: STATUS_NAMES });
  const c = (html, v) => ({ html, v }); // v: raw value the sort script reads
  const rows = sorted.map((e) => [
    c(`<b>${esc(e.name)}</b><br><span class="muted">${esc(e.method)} ${esc(maskQuery(e.path))}</span>`, e.name),
    c(e.requests.toLocaleString('en'), e.requests),
    c(`<span class="${lim.errorPct !== null && e.failPct > lim.errorPct ? 'bad' : ''}">${pct(e.failPct)}</span>`, e.failPct),
    c(ms(e.avgMs), e.avgMs),
    c(ms(e.p50Ms), e.p50Ms),
    c(ms(e.p90Ms), e.p90Ms),
    c(`<span class="${lim.p95Ms !== null && e.p95Ms > lim.p95Ms ? 'bad' : ''}">${ms(e.p95Ms)}</span>`, e.p95Ms),
    c(ms(e.p99Ms), e.p99Ms),
    c(ms(e.maxMs), e.maxMs),
  ]);
  const slowOver = lim.p95Ms != null && sorted[0].p95Ms > lim.p95Ms;
  const slowest = `<div class="callout${slowOver ? ' is-warning' : ''}">Slowest call: ${esc(sorted[0].name)} (${ms(sorted[0].p95Ms)} at p95)</div>`;
  return `${slowest}${fig('Slow 1 in 20, per page or API (slowest first)', bars)}${fig('How each page or API answered', stacks)}${table(['Page or API', 'Requests', 'Failed', 'Average', 'Typical (p50)', 'p90', 'Slow 1 in 20 (p95)', 'Slow 1 in 100 (p99)', 'Slowest'], rows, 'ep-row', true)}`;
}

function limitsSection(limits) {
  if (!limits) return '<p class="muted">Limits were not recorded for this run.</p>';
  if (!limits.length) return '<p class="muted">You set no limits for this run.</p>';
  const line = (l) =>
    l.what === 'p95'
      ? `Slowest 1 in 20 visits: ${Math.round(l.actual)} ms. You allowed up to ${l.limit} ms.`
      : `Failed requests: ${l.actual.toFixed(2)}%. You allowed up to ${l.limit}%.`;
  return `<ul class="limits">${limits.map((l) => `<li class="${l.ok ? 'good' : 'bad'}"><span class="tag">${l.ok ? 'Met' : 'Missed'}</span> ${esc(line(l))}</li>`).join('')}</ul>`;
}

function compare(now, before) {
  const rows = [
    ['Requests per second', rpsOf(before), rpsOf(now), (v) => v.toFixed(1), ['more', 'less']],
    ['Slow 1 in 20 (p95)', before.p95Ms, now.p95Ms, ms, ['slower', 'faster']],
    ['Failed requests', before.failPct, now.failPct, pct, ['worse', 'better']],
    ['Slowest request', before.maxMs, now.maxMs, ms, ['slower', 'faster']],
  ].map(([what, b, n, f, [up, down]]) => {
    if (!(b > 0)) return [what, f(b), f(n), 'n/a', ''];
    const d = ((n - b) / b) * 100;
    const word = Math.abs(d) < 2 ? 'about the same' : d > 0 ? up : down;
    return [what, f(b), f(n), `${d > 0 ? '+' : ''}${Math.round(d)}%`, word];
  });
  // Limits: judged only on the kinds both runs had; one row, Met only when every shared limit was met.
  if (before.limits?.length && now.limits?.length) {
    const shared = before.limits.filter((l) => now.limits.some((n) => n.what === l.what)).map((l) => l.what);
    if (shared.length) {
      const met = (ls) => ls.filter((l) => shared.includes(l.what)).every((l) => l.ok);
      const [b, n] = [met(before.limits), met(now.limits)];
      rows.push(['Your limits', b ? 'Met' : 'Missed', n ? 'Met' : 'Missed', '', b === n ? 'about the same' : n ? 'better' : 'worse']);
    }
  }
  return table(['Measure', 'Last run', 'This run', 'Change', 'In words'], rows);
}

export function buildReport({ run, summary: s, timeline, previous }) {
  const cfg = run.config;
  const lim = cfg.thresholds;
  const cards = keyCards(s, lim);
  const stopped = run.status === 'stopped';
  const { overall, label } = verdictOf(s.passed, cards, lim, stopped);
  const why = explainRun({ cfg, summary: s, stopped });
  const list = (tag, items) => `<${tag} class="plain">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</${tag}>`;
  const settings = [
    ['Website', esc(cfg.baseUrl), 'The address every call is sent to.'],
    ['Kind of test', esc(TYPES[cfg.testType] ?? cfg.testType), 'The shape of traffic: steady, a sudden rush, or pushing until it breaks.'],
    ['Most people at the same time', String(cfg.peakUsers), 'The most simulated visitors on the site at once.'],
    ['Time to build up', fmtDuration(cfg.rampUpS), 'How long visitors were added gradually.'],
    ['Time at full traffic', fmtDuration(cfg.holdS), 'How long the busiest level was held.'],
    ['Time to wind down', fmtDuration(cfg.rampDownS), 'How long visitors were removed gradually.'],
    ['Pause between actions', `${cfg.thinkTimeS} sec`, 'The wait each visitor takes between calls, like a real person reading.'],
    ['Limits you set', [lim.p95Ms !== null && `Slowest 1 in 20 under ${lim.p95Ms} ms`, lim.errorPct !== null && `failed requests under ${lim.errorPct}%`].filter(Boolean).join(', ') || 'None', 'The lines the site had to stay under for a pass.'],
    ['Login step first', cfg.auth ? 'Yes' : 'No', 'Whether each visitor signed in before the other calls.'],
    ['Credentials', { bearer: 'Bearer token', apikey: 'API key', basic: 'Username and password' }[cfg.credentials?.type] ?? 'None', 'How the calls proved who they were. Only the type is shown, never the secret.'], // type only, never the secret
    ['Pages or API calls tested', String(cfg.endpoints.length), 'How many different pages or API calls were hit.'],
    ['Actual length', fmtDuration(Math.round(s.durationS ?? 0)), 'How long the test really ran.'],
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Load Test Report</title>
<link rel="icon" href="data:,">
<style>
${THEME_CSS}
${CHART_CSS}
body{padding:24px 16px}main{max-width:1000px;margin:auto}h1{margin:0 0 4px;font-size:24px;font-weight:600}.sub{color:var(--text-2);margin:0 0 16px}
h2{font-size:16px;font-weight:600;margin:0 0 12px}section{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
.top{display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap}
.verdict{border-top:4px solid var(--neutral)}.verdict.good{border-top-color:var(--healthy)}.verdict.ok{border-top-color:var(--warning)}.verdict.bad{border-top-color:var(--critical)}
.verdict.good h2{color:var(--healthy)}.verdict.ok h2{color:var(--warning)}.verdict.bad h2{color:var(--critical)}
.verdict p{margin:0 0 6px}.verdict h3{font-size:14px;margin:12px 0 0}.lead{font-size:16px}.plain{margin:4px 0 0;padding-left:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{background:var(--surface-muted);border:1px solid var(--border);border-top:4px solid var(--neutral);border-radius:8px;padding:14px}
.card.good{border-top-color:var(--healthy)}.card.ok{border-top-color:var(--warning)}.card.bad{border-top-color:var(--critical)}
.card h3{margin:0 0 6px;font-size:12px;color:var(--text-2);font-weight:600}.card .num{text-align:left}.card p{margin:4px 0 0}
.tag{font-weight:600}.good .tag{color:var(--healthy)}.ok .tag{color:var(--warning)}.bad .tag{color:var(--critical)}
.muted{color:var(--text-2);font-size:12px}
figure{margin:0 0 24px;overflow-x:auto}figure .viz{min-width:600px}figcaption{font-weight:600;font-size:14px;margin:0 0 6px}.tw{overflow-x:auto}
table.data td{vertical-align:top}table.data th.num{text-align:right}
th[data-sort]{cursor:pointer;white-space:nowrap}th[data-sort]:focus-visible{outline:2px solid var(--live);outline-offset:-2px}
th[aria-sort=ascending]::after{content:" \\2191"}th[aria-sort=descending]::after{content:" \\2193"}
td .bad,span.bad{color:var(--critical);font-weight:600}
.callout{margin:0 0 16px;font-weight:600}
.limits{list-style:none;margin:0;padding:0}.limits li{padding:6px 0}
dt{font-weight:600;margin-top:10px}dd{margin:0;color:var(--text-2)}
@media print{.print{display:none}section{break-inside:avoid}figure{break-inside:avoid}}
</style></head><body><main>
<div class="top"><div><h1>Website Load Test Report</h1>
<p class="sub">${esc(run.name)} &middot; ${esc(cfg.baseUrl)} &middot; ${esc(new Date(run.startedAt).toLocaleString('en-GB'))}</p></div>
<button class="btn print" type="button" onclick="window.print()">Save as PDF</button></div>

<section class="verdict ${overall}"><h2>${label}</h2>
<p class="lead">${esc(why.headline)}</p><p class="muted">${esc(why.did)}</p>
<h3>What we found</h3>${list('ul', why.found)}
<h3>What to do next</h3>${list('ol', why.next)}</section>

<section><h2>Key numbers</h2><div class="grid">${cards
    .map((c) => `<div class="card ${c.g === 'info' ? '' : c.g}"><h3>${c.q}</h3><div class="metric"><span class="metric-value num">${esc(c.big)}</span>${c.g === 'info' ? '' : `<span class="tag">${c.tag ?? LABEL[c.g]}</span>`}</div><p class="muted">${c.text}</p></div>`)
    .join('')}</div></section>

<section><h2>What we tested</h2><p>${esc(describeShape(cfg))}</p>${table(['Setting', 'Value', 'What it means'], settings)}</section>

<section><h2>Over time</h2>${overTime(timeline, lim)}</section>

<section><h2>Per page or API</h2>${perEndpoint(s.endpoints, lim)}</section>

<section><h2>Your limits</h2>${limitsSection(s.limits)}</section>

${previous?.summary ? `<section><h2>Compared with last run</h2><p class="muted">The last run with the same name, so you can see if a change made things better or worse.</p>${compare(s, previous.summary)}</section>` : ''}

<section><details><summary><b>Plain English glossary</b></summary><dl>
<dt>Load test</dt><dd>We send many simulated visitors to the site at once to see if it slows down or breaks.</dd>
<dt>Request</dt><dd>One thing a browser or app asks the site for, such as a page or an API answer.</dd>
<dt>Typical (p50), slow 1 in 20 (p95), slow 1 in 100 (p99)</dt><dd>Half of visits were faster than p50. Only 1 in 20 were slower than p95. Averages hide bad experiences, so we show these.</dd>
<dt>Status code</dt><dd>The site's short answer: 2xx worked, 3xx redirected, 4xx the request was wrong or not allowed, 5xx the server failed.</dd>
<dt>Limit</dt><dd>A line you set under Advanced, "What counts as good". If the site goes past it, the test is marked as missed. A missed limit does not always mean the site is slow: it can also mean requests failed.</dd>
<dt>Refused request (4xx)</dt><dd>The site answered "no". Usual causes: wrong address, missing login, or details the site does not accept.</dd>
<dt>Checks</dt><dd>Our own test that each answer had the expected status code.</dd>
</dl></details></section>
<p class="muted">Times shown as minutes:seconds from the start (for example ${fmtClock(65)} is 1 minute 5 seconds in).</p>
</main>
<script>
document.querySelectorAll('th[data-sort]').forEach(function (th) {
  function sort() {
    var asc = th.getAttribute('aria-sort') !== 'ascending', body = th.closest('table').tBodies[0], i = th.cellIndex;
    th.closest('tr').querySelectorAll('th').forEach(function (h) { h.setAttribute('aria-sort', 'none'); });
    th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
    Array.from(body.rows).sort(function (x, y) {
      var a = x.cells[i].dataset.v, b = y.cells[i].dataset.v, d = Number(a) - Number(b);
      if (isNaN(d)) d = a.localeCompare(b);
      return asc ? d : -d;
    }).forEach(function (r) { body.appendChild(r); });
  }
  th.addEventListener('click', sort);
  th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
});
</script>
</body></html>`;
}
