// Builds the plain language report.html in Node after k6 exits, from summary.json, the timeline
// and the previous run with the same name. Never prints header values, bodies or login details.
import { CHART_CSS, barChart, esc, fmtClock, lineChart, stackedBar } from './charts.js';
import { describeShape, fmtDuration } from './form.js';
import { maskQuery } from './config.js';

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

function verdictOf(passed, cards, lim) {
  let overall = worst(cards.filter((c) => c.g !== 'info').map((c) => c.g));
  if (passed === false) overall = 'bad'; // k6 says a limit was missed, so never show a green verdict
  else if (passed === true && overall === 'bad' && (lim.p95Ms !== null || lim.errorPct !== null)) overall = 'ok';
  const text = {
    good: ['Ready', 'The site handled this crowd well and met your limits.'],
    ok: ['Mostly fine, needs attention', 'The site met your limits, but some visitors had a slow experience.'],
    bad: ['Not ready', 'The site missed at least one of the limits you set.'],
  }[overall];
  if (lim.p95Ms === null && lim.errorPct === null) {
    // Nothing was set to judge, so say what the numbers show instead of claiming limits were met.
    text[1] = { good: 'The site handled this crowd well.', ok: 'Some visitors had a slow experience.', bad: 'The numbers below show problems.' }[overall];
  }
  return { overall, text };
}

const table = (head, rows, rowClass = '') =>
  `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr${rowClass ? ` class="${rowClass}"` : ''}>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

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
  const rows = sorted.map((e) => [
    `<b>${esc(e.name)}</b><br><span class="muted">${esc(e.method)} ${esc(maskQuery(e.path))}</span>`,
    e.requests.toLocaleString('en'),
    `<span class="${lim.errorPct !== null && e.failPct > lim.errorPct ? 'bad' : ''}">${pct(e.failPct)}</span>`,
    ms(e.avgMs),
    ms(e.p50Ms),
    ms(e.p90Ms),
    `<span class="${lim.p95Ms !== null && e.p95Ms > lim.p95Ms ? 'bad' : ''}">${ms(e.p95Ms)}</span>`,
    ms(e.p99Ms),
    ms(e.maxMs),
  ]);
  return `${fig('Slow 1 in 20, per page or API (slowest first)', bars)}${fig('How each page or API answered', stacks)}${table(['Page or API', 'Requests', 'Failed', 'Average', 'Typical (p50)', 'p90', 'Slow 1 in 20 (p95)', 'Slow 1 in 100 (p99)', 'Slowest'], rows, 'ep-row')}`;
}

function limitsSection(limits) {
  if (!limits) return '<p class="muted">Limits were not recorded for this run.</p>';
  if (!limits.length) return '<p class="muted">You set no limits for this run.</p>';
  const line = (l) =>
    l.what === 'p95'
      ? `Slowest 1 in 20 under ${l.limit} ms: ${Math.round(l.actual)} ms, ${l.ok ? 'met' : 'missed'}`
      : `Failed requests under ${l.limit}%: ${l.actual.toFixed(2)}%, ${l.ok ? 'met' : 'missed'}`;
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
  return table(['Measure', 'Last run', 'This run', 'Change', 'In words'], rows);
}

export function buildReport({ run, summary: s, timeline, previous }) {
  const cfg = run.config;
  const lim = cfg.thresholds;
  const cards = keyCards(s, lim);
  const { overall, text } = verdictOf(s.passed, cards, lim);
  const settings = [
    ['Website', esc(cfg.baseUrl)],
    ['Kind of test', esc(TYPES[cfg.testType] ?? cfg.testType)],
    ['Most people at the same time', String(cfg.peakUsers)],
    ['Time to build up', fmtDuration(cfg.rampUpS)],
    ['Time at full traffic', fmtDuration(cfg.holdS)],
    ['Time to wind down', fmtDuration(cfg.rampDownS)],
    ['Pause between actions', `${cfg.thinkTimeS} sec`],
    ['Limits you set', [lim.p95Ms !== null && `Slowest 1 in 20 under ${lim.p95Ms} ms`, lim.errorPct !== null && `failed requests under ${lim.errorPct}%`].filter(Boolean).join(', ') || 'None'],
    ['Login step first', cfg.auth ? 'Yes' : 'No'],
    ['Pages or API calls tested', String(cfg.endpoints.length)],
    ['Actual length', fmtDuration(Math.round(s.durationS ?? 0))],
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Load Test Report</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#f6f7f9;--fg:#17181a;--mut:#5b6068;--card:#fff;--line:#e2e5ea;--good:#0a7d3c;--ok:#a35f00;--bad:#b3261e;--gbg:#e6f4ec;--obg:#fdf0d9;--bbg:#fbe6e4}
@media(prefers-color-scheme:dark){:root{--bg:#121316;--fg:#f1f2f4;--mut:#a3a8b0;--card:#1b1d21;--line:#2c2f35;--good:#5fd18b;--ok:#f0b45a;--bad:#ff8a80;--gbg:#14291d;--obg:#2e2411;--bbg:#32171a}}
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:1000px;margin:auto}h1{margin:0 0 4px;font-size:24px}.sub{color:var(--mut);margin:0 0 16px}
h2{font-size:18px;margin:0 0 12px}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
.top{display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap}
.print{padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;cursor:pointer}
.verdict.good{background:var(--gbg)}.verdict.ok{background:var(--obg)}.verdict.bad{background:var(--bbg)}.verdict p{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{border:1px solid var(--line);border-top:4px solid var(--line);border-radius:12px;padding:14px}
.card.good{border-top-color:var(--good)}.card.ok{border-top-color:var(--ok)}.card.bad{border-top-color:var(--bad)}
.card h3{margin:0 0 6px;font-size:14px;color:var(--mut);font-weight:600}.big{font-size:28px;font-weight:700}
.tag{font-weight:600}.good .tag,.good>.tag{color:var(--good)}.ok .tag{color:var(--ok)}.bad .tag{color:var(--bad)}
.card p{margin:4px 0 0;color:var(--mut);font-size:14px}.muted{color:var(--mut);font-size:14px}
figure{margin:0 0 24px;overflow-x:auto}figure .viz{min-width:600px}figcaption{font-weight:600;font-size:15px;margin:0 0 6px}.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600}
td .bad,span.bad{color:var(--bad);font-weight:600}
.limits{list-style:none;margin:0;padding:0}.limits li{padding:6px 0}
dt{font-weight:600;margin-top:10px}dd{margin:0;color:var(--mut)}
${CHART_CSS}
@media print{body{background:#fff;padding:0}.print{display:none}section{break-inside:avoid;border-color:#ccc}figure{break-inside:avoid}}
</style></head><body><main>
<div class="top"><div><h1>Website Load Test Report</h1>
<p class="sub">${esc(run.name)} &middot; ${esc(cfg.baseUrl)} &middot; ${esc(new Date(run.startedAt).toLocaleString('en-GB'))}</p></div>
<button class="print" type="button" onclick="window.print()">Save as PDF</button></div>

<section class="verdict ${overall}"><h2>${text[0]}</h2><p>${text[1]}</p></section>

<section><h2>Key numbers</h2><div class="grid">${cards
    .map((c) => `<div class="card ${c.g === 'info' ? '' : c.g}"><h3>${c.q}</h3><div class="big">${esc(c.big)}</div>${c.g === 'info' ? '' : `<div class="tag">${c.tag ?? LABEL[c.g]}</div>`}<p>${c.text}</p></div>`)
    .join('')}</div></section>

<section><h2>What we tested</h2><p>${esc(describeShape(cfg))}</p>${table(['Setting', 'Value'], settings)}</section>

<section><h2>Over time</h2>${overTime(timeline, lim)}</section>

<section><h2>Per page or API</h2>${perEndpoint(s.endpoints, lim)}</section>

<section><h2>Your limits</h2>${limitsSection(s.limits)}</section>

${previous?.summary ? `<section><h2>Compared with last run</h2><p class="muted">The last run with the same name, so you can see if a change made things better or worse.</p>${compare(s, previous.summary)}</section>` : ''}

<section><details><summary><b>Plain English glossary</b></summary><dl>
<dt>Load test</dt><dd>We send many simulated visitors to the site at once to see if it slows down or breaks.</dd>
<dt>Request</dt><dd>One thing a browser or app asks the site for, such as a page or an API answer.</dd>
<dt>Typical (p50), slow 1 in 20 (p95), slow 1 in 100 (p99)</dt><dd>Half of visits were faster than p50. Only 1 in 20 were slower than p95. Averages hide bad experiences, so we show these.</dd>
<dt>Status code</dt><dd>The site's short answer: 2xx worked, 3xx redirected, 4xx the request was wrong or not allowed, 5xx the server failed.</dd>
<dt>Checks</dt><dd>Our own test that each answer had the expected status code.</dd>
</dl></details></section>
<p class="muted">Times shown as minutes:seconds from the start (for example ${fmtClock(65)} is 1 minute 5 seconds in).</p>
</main></body></html>`;
}
