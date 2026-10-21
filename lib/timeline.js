// Turns k6 REST API snapshots (GET /v1/metrics) into 5 second windows for the charts.
// Pure: used by the runner (Node) and safe in the browser.

const sampleOf = (body, id) => body?.data?.find((m) => m.id === id)?.attributes?.sample ?? {};

export function parseMetrics(body) {
  const reqs = sampleOf(body, 'http_reqs').count ?? 0;
  const dur = sampleOf(body, 'http_req_duration');
  return {
    users: sampleOf(body, 'vus').value ?? 0,
    reqs,
    // The REST API only gives the rate for http_req_failed (no counts). Every request adds one
    // http_req_failed sample, so failed requests = rate x request count.
    failed: Math.round((sampleOf(body, 'http_req_failed').rate ?? 0) * reqs),
    avgMs: dur.avg ?? 0,
    p95Ms: dur['p(95)'] ?? 0,
  };
}

export function toPoint(prev, next, tS, dtS) {
  const newReqs = next.reqs - prev.reqs;
  return {
    t: tS,
    users: next.users,
    rps: newReqs / dtS,
    failPct: newReqs > 0 ? ((next.failed - prev.failed) / newReqs) * 100 : 0,
    // k6 only exposes the running average, so recover this window's average from the totals.
    avgMs: newReqs > 0 ? (next.avgMs * next.reqs - prev.avgMs * prev.reqs) / newReqs : null,
    p95SoFarMs: next.p95Ms,
  };
}
