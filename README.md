# Perf Studio

A local page to run load tests with k6 and watch them live in Grafana. No npm packages needed.

## Prerequisites
- Node 22, k6 (`winget install GrafanaLabs.k6`), Docker Desktop (only for the live graphs)

## Use
1. `npm start`, then open http://localhost:4173
2. Enter the website address and the pages or API calls, pick a test type, set the traffic, tick the permission box, press **Run test**.
3. Optional live graphs: `npm run grafana` once, tick "Show live graphs", then use the link on the status panel (Grafana is at http://localhost:3000).
4. Stop the graphs stack with `docker compose -f grafana/docker-compose.yml down`.

## Where things are
| Path | What |
|---|---|
| `runs/<id>/report.html` | Plain language report for each run |
| `runs/<id>/config.json`, `run.json` | What was run and the result |
| `grafana/` | Prometheus and Grafana setup, dashboard `perf-studio` |

## Limits
| Limit | Value |
|---|---|
| People at the same time | 500 |
| Total test length | 2 hours |
| Pages or API calls per test | 20 |
| Tests at once | 1 |

## Safety
- The server listens on this computer only.
- Login details and headers are saved in plain text in `runs/`. Use test accounts only.
- `npm test` runs all tests (the k6 ones need k6 installed).
