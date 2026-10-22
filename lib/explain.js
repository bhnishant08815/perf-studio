// Turns a finished run into plain sentences for someone new to performance testing.
// Pure and free of Node imports: the report (Node) and the status panel (browser) both use it.
// Returns plain text only; callers escape it before putting it in HTML.

const REFUSED_SHARE = 0.9; // this much 4xx and the test is really measuring "no"
const NONE_SHARE = 0.5; // this much silence and the site is effectively down
const SERVER_SHARE = 0.05; // above this, server errors are the story
const MANY_SHARE = 0.25; // refused or silent traffic above this is never described as "coping"
const FLAG_SHARE = 0.1; // an endpoint is named when this much of its traffic went wrong

const msText = (v) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} sec`);
const pctText = (v) => String(v >= 10 ? Math.round(v) : Number(v.toFixed(1)));

const KINDS = {
  '4xx': { all: 'every request was refused (answer type 4xx)', some: (n) => `${n}% of requests were refused (answer type 4xx)` },
  '5xx': { all: 'every request got a server error (answer type 5xx)', some: (n) => `${n}% of requests got a server error (answer type 5xx)` },
  none: { all: 'the site did not answer', some: (n) => `the site did not answer ${n}% of the time` },
};

// Endpoints where one bad answer type took at least FLAG_SHARE of their requests, worst first.
function flagged(endpoints) {
  return endpoints
    .map((e) => {
      const c = e.statusClasses ?? {};
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      // An endpoint with no failures (for example a 404 the user said to expect) has no bad answers.
      const [kind, count] = e.failPct === 0 ? ['4xx', 0] : Object.keys(KINDS).map((k) => [k, c[k] ?? 0]).sort((a, b) => b[1] - a[1])[0];
      return { name: e.name, kind, share: total ? count / total : 0 };
    })
    .filter((e) => e.share >= FLAG_SHARE)
    .sort((a, b) => b.share - a.share);
}

export function explainRun({ cfg, summary, stopped = false }) {
  const calls = cfg.endpoints?.length ?? 0;
  const did = `We sent up to ${cfg.peakUsers === 1 ? '1 person' : `${cfg.peakUsers} people`} at once to ${cfg.baseUrl}, visiting ${calls === 1 ? '1 page or API call' : `${calls} pages or API calls`}.`;
  const done = (headline, found, next) => ({ headline, did, found, next });

  if (stopped) return done('You stopped this test early, so these numbers cover only part of it.', ['Run it again and let it finish to get a result you can judge.'], ['Press Run test again.']);
  if (!summary?.requests) return done('No requests were sent, so there is no result.', ['The numbers are in the sections below.'], ['Check the address and press Run test again.']);

  const endpoints = summary.endpoints ?? [];
  const sums = { '4xx': 0, '5xx': 0, none: 0, all: 0 };
  for (const e of endpoints) {
    for (const [k, n] of Object.entries(e.statusClasses ?? {})) {
      sums.all += n;
      if (k in sums && e.failPct !== 0) sums[k] += n; // answers the user expected are not failures
    }
  }
  const share = (k) => (sums.all ? sums[k] / sums.all : 0);

  const { p95Ms: p95Limit = null, errorPct: errLimit = null } = cfg.thresholds ?? {};
  const slowMissed = p95Limit !== null && !(summary.p95Ms < p95Limit); // k6 rule is p(95)<limit
  const errMissed = errLimit !== null && summary.failPct > errLimit;
  const speedOk = p95Limit !== null && !slowMissed;

  const errLine = errMissed ? [`You asked for fewer than ${errLimit}% of requests to fail. ${pctText(summary.failPct)}% failed.`] : [];
  const problems = () => flagged(endpoints).slice(0, 2).map((e) => `${e.name}: ${e.share === 1 ? KINDS[e.kind].all : KINDS[e.kind].some(pctText(e.share * 100))}.`);
  const worst = flagged(endpoints).find((e) => e.kind === '4xx')?.name ?? 'the call';

  if (share('none') >= NONE_SHARE) {
    return done('The site did not answer, so there is nothing to measure yet.', [...errLine, ...problems()], ['Check that the website address is right and the site is switched on.', 'Try opening the address in your browser from this computer.']);
  }
  if (share('4xx') >= REFUSED_SHARE) {
    const speed = speedOk ? [`Speed was fine (the slowest 1 in 20 took ${msText(summary.p95Ms)}), but that only measures how fast the site said no.`] : [];
    return done('Nearly every request was refused by the site, so this test could not measure real speed.', [...errLine, ...problems(), ...speed], [
      `Check the address and the login details for ${worst}, then run again.`,
      'If the call needs a login, add it under Credentials.',
      ...(cfg.testType === 'smoke' ? [] : ['Run a Smoke test first; it is the quickest way to confirm requests work.']),
    ]);
  }
  if (share('5xx') > SERVER_SHARE) {
    return done('The site broke under this traffic: it answered with server errors.', [...errLine, ...problems()], ['Send these error times to the team that runs the site.', 'Run again with fewer people to find the level it can handle.']);
  }
  if (errMissed) {
    // "Coped" would mislead when a good share of the traffic was turned away.
    const headline = share('4xx') + share('none') >= MANY_SHARE ? 'Many requests were refused by the site, so some calls are being turned away.' : 'The site coped, but more requests failed than you allowed.';
    return done(headline, [...errLine, ...problems()], ['Open "Per page or API" below to see which call fails most.', 'If failures are expected, raise the limit in step 4.']);
  }
  if (slowMissed) {
    return done('The site stayed up but was slower than you wanted.', [`1 in 20 visits waited longer than ${msText(p95Limit)}. The slowest 1 in 20 took ${msText(summary.p95Ms)}.`], ['Open "Per page or API" below to see which call is slowest.', 'Run again with fewer people to find the level where it stays quick.']);
  }

  if (errLimit === null && summary.failPct > 0) {
    // Failures exist but the user set no limit for them, so never claim the site "handled" this.
    const speed = p95Limit !== null ? [`Slowest 1 in 20 took ${msText(summary.p95Ms)}, under your ${msText(p95Limit)}.`] : [];
    const headline = p95Limit === null ? 'Some requests failed. You set no limits, so this was not judged.' : 'The site stayed within your speed limit, but some requests failed and you set no limit for that.';
    const found = [...speed, ...problems()];
    return done(headline, found.length ? found : ['The numbers are in the sections below.'], ['Open "Per page or API" below to see which call fails most.', 'To have failures judged, set a limit for them in step 4.']);
  }

  const parts = [
    p95Limit !== null && `Slowest 1 in 20 took ${msText(summary.p95Ms)}, under your ${msText(p95Limit)}.`,
    errLimit !== null && `${pctText(summary.failPct)}% of requests failed, under your ${errLimit}%.`,
  ].filter(Boolean);
  const headline = p95Limit === null && errLimit === null
    ? 'The site handled this traffic. You set no limits, so nothing was judged.'
    : 'The site handled this traffic and met every limit you set.';
  return done(headline, [parts.join(' ') || 'The numbers are in the sections below.'], ['Run again with more people or a longer time to see how far it can go.']);
}
