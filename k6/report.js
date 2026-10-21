// Turns k6 summary data into one self-contained, plain-language HTML page for non-technical readers.
// Ratings: good / ok / bad. Thresholds are in one place (RATE) so they are easy to tune.

const RATE = {
  failPct: [1, 5], // % of requests that failed
  medianS: [1, 2.5], // typical page load, seconds
  p95S: [1, 3], // slowest 1 in 20, seconds
  maxS: [3, 10], // single worst experience, seconds
};

const grade = (v, [good, ok]) => (v < good ? 'good' : v < ok ? 'ok' : 'bad');
const LABEL = { good: 'Good', ok: 'Needs attention', bad: 'Poor' };
const worst = (gs) => (gs.includes('bad') ? 'bad' : gs.includes('ok') ? 'ok' : 'good');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const secs = (ms) => (ms / 1000).toFixed(ms < 10000 ? 2 : 1);

export function buildReport(data, meta) {
  const m = data.metrics;
  const dur = m.http_req_duration.values;
  const failPct = (m.http_req_failed.values.rate || 0) * 100;
  const peakUsers = m.vus_max.values.max;
  const reqs = m.http_reqs.values;
  const mins = data.state.testRunDurationMs / 60000;

  const cards = [
    {
      q: 'Did the site stay up?',
      big: `${(100 - failPct).toFixed(2)}%`,
      g: grade(failPct, RATE.failPct),
      text: failPct === 0 ? 'Every request worked. Nobody saw an error.' : `${failPct.toFixed(2)}% of requests failed. Some visitors saw errors.`,
    },
    {
      q: 'How fast did pages feel?',
      big: `${secs(dur.med)} sec`,
      g: grade(dur.med / 1000, RATE.medianS),
      text: 'Half of all visitors waited less than this. Under 1 second feels instant.',
    },
    {
      q: 'How slow for the unlucky ones?',
      big: `${secs(dur['p(95)'])} sec`,
      g: grade(dur['p(95)'] / 1000, RATE.p95S),
      text: '1 in 20 visitors waited longer than this. This is the number to watch.',
    },
    {
      q: 'Worst single experience',
      big: `${secs(dur.max)} sec`,
      g: grade(dur.max / 1000, RATE.maxS),
      text: 'The slowest request in the whole test. One-off spikes can be network noise.',
    },
  ];

  const overall = worst(cards.map((c) => c.g));
  const verdict = {
    good: ['Ready', 'The site handled this crowd well.'],
    ok: ['Mostly fine, needs attention', 'The site stayed up, but some visitors had a slow experience.'],
    bad: ['Not ready', 'Visitors would notice problems at this level of traffic.'],
  }[overall];

  const card = (c) => `
    <section class="card ${c.g}">
      <h3>${c.q}</h3>
      <div class="big">${c.big}</div>
      <div class="tag">${LABEL[c.g]}</div>
      <p>${c.text}</p>
    </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Load Test Report</title>
<style>
:root{--bg:#f6f7f9;--fg:#17181a;--mut:#5b6068;--card:#fff;--line:#e2e5ea;--good:#0a7d3c;--ok:#a35f00;--bad:#b3261e;--gbg:#e6f4ec;--obg:#fdf0d9;--bbg:#fbe6e4}
@media(prefers-color-scheme:dark){:root{--bg:#121316;--fg:#f1f2f4;--mut:#a3a8b0;--card:#1b1d21;--line:#2c2f35;--good:#5fd18b;--ok:#f0b45a;--bad:#ff8a80;--gbg:#14291d;--obg:#2e2411;--bbg:#32171a}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:960px;margin:auto}h1{margin:0 0 4px;font-size:24px}.sub{color:var(--mut);margin:0 0 20px}
.verdict{padding:20px;border-radius:12px;border:1px solid var(--line);margin-bottom:20px}
.verdict.good{background:var(--gbg)}.verdict.ok{background:var(--obg)}.verdict.bad{background:var(--bbg)}
.verdict h2{margin:0 0 4px;font-size:22px}.verdict p{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--line);border-radius:12px;padding:16px}
.card.good{border-top-color:var(--good)}.card.ok{border-top-color:var(--ok)}.card.bad{border-top-color:var(--bad)}
.card h3{margin:0 0 8px;font-size:15px;color:var(--mut);font-weight:600}.big{font-size:32px;font-weight:700}
.tag{font-weight:600;margin:2px 0 8px}.good .tag{color:var(--good)}.ok .tag{color:var(--ok)}.bad .tag{color:var(--bad)}
.card p{margin:0;color:var(--mut);font-size:14px}
.facts{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:20px}
.facts h2,details h2{font-size:16px;margin:0 0 8px}.facts ul{margin:0;padding-left:20px}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}summary{cursor:pointer;font-weight:600}
dt{font-weight:600;margin-top:10px}dd{margin:0;color:var(--mut)}
</style></head><body><main>
<h1>Website Load Test Report</h1>
<p class="sub">${esc(meta.url)} &middot; ${esc(new Date().toLocaleString())}</p>
<section class="verdict ${overall}"><h2>${verdict[0]}</h2><p>${verdict[1]}</p></section>
<div class="grid">${cards.map(card).join('')}</div>
<section class="facts"><h2>What we tested</h2><ul>
<li>We simulated up to <b>${peakUsers} people</b> using the site at the same time.</li>
<li>The test ran for <b>${mins.toFixed(1)} minutes</b> and made <b>${reqs.count.toLocaleString()} requests</b> (about ${reqs.rate.toFixed(0)} per second).</li>
<li>What was tested: ${esc((meta.endpoints || []).join(', '))}.${meta.loggedIn ? ' A login step ran first.' : ''}</li>
</ul></section>
<details><summary>Plain English glossary</summary>
<dl>
<dt>Load test</dt><dd>We send many fake visitors to the site at once to see if it slows down or breaks.</dd>
<dt>Request</dt><dd>One thing a browser asks the site for, such as the page or a picture.</dd>
<dt>Half of visitors / 1 in 20</dt><dd>Averages hide bad experiences, so we also report how slow the unlucky 5% had it.</dd>
<dt>Good / Needs attention / Poor</dt><dd>Under 1 second is good for page speed. Under 1% failures is good for reliability.</dd>
</dl></details>
</main></body></html>`;
}
