# Perf Studio

A local page to run load tests with k6 and watch them live in Grafana. No npm packages needed.

## Prerequisites
- Node 22, k6 (`winget install GrafanaLabs.k6`), Docker Desktop (only for the live graphs)

## Use
1. `npm start`, then open http://localhost:4173
2. Import your API list in the left panel (or type calls by hand), tick the calls to test, pick a test type, set the traffic, tick the permission box, press **Run test**.
3. Optional live graphs: start Docker Desktop, run `npm run grafana` once, tick "Show live graphs", then use the link on the status panel (Grafana is at http://localhost:3000).
4. Stop the graphs stack with `docker compose -f grafana/docker-compose.yml down`.

## Import an API list
| Format | Notes |
|---|---|
| Postman collection v2.0 or v2.1 (JSON) | Folders become groups. Collection variables, bearer, basic and API key auth, raw, urlencoded and GraphQL bodies are imported |
| OpenAPI 3 or Swagger 2 (JSON) | Server address, tags as groups, example bodies. Path values without an example become `1` |
| Plain list | `[{"method": "GET", "path": "/items", "name": "...", "group": "..."}]` |

- YAML files are not supported yet: export as JSON.
- One website per test. Calls on another host are shown but cannot be ticked.
- At most 50 calls per test. The panel remembers your last import and ticks on this computer.
- The page warns before you run: a website address that already holds a page, calls with gaps to fill in (such as :round_id), calls that change data, and a login call you have not set up. Gaps are filled once in "Values the calls need". "Select safe reads only" ticks the GET calls that need no value.
- "Things to check" lists what needs your attention: a `{{variable}}` with no value, a path value set to 1, a form data body or an auth type that was not imported.

## Reading the report
- **In short (top box):** what happened in plain words, which limit was missed and why, and what to try next.
- **Key numbers:** the verdict, speed and failures. Cards marked "Within / Over your limit" are judged against the limits you set.
- **Over time:** people, requests per second, response time and failures every 5 seconds. Response time is the window average; Grafana shows the slow 1 in 20 per window.
- **Per page or API:** which call is slowest, how each one answered (status codes), and a full table (p50, p90, p95, p99, slowest).
- **Compared with last run:** shown when an earlier run has the same name, so you can see if a change helped.
- **Save as PDF:** the button at the top prints a clean copy.

## Where things are
| Path | What |
|---|---|
| `runs/<id>/report.html` | Plain language report for each run |
| `runs/<id>/config.json`, `run.json`, `summary.json`, `timeline.json` | What was run, the result, the numbers, the 5 second timeline |
| `grafana/` | Prometheus and Grafana setup, dashboard `perf-studio` |

## Limits
| Limit | Value |
|---|---|
| People at the same time | 500 |
| Total test length | 2 hours |
| Pages or API calls per test | 50 |
| Tests at once | 1 |

## Safety
- The server listens on this computer only.
- **Credentials section:** pick no sign in, a login call, a Bearer token, an API key or Basic (username and password). The login call is the older "needs a login first" box, now inside this section. Fixed credentials are sent on every call and win over a header an imported call carries. The report shows only the type, never the value.
- Login details, credentials, headers and imported tokens are saved in plain text in `runs/` and in the browser's storage. Use test accounts only. The report never shows them.
- `npm test` runs all tests (the k6 ones need k6 installed).
