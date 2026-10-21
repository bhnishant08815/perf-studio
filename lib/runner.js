// Starts, tracks and stops k6 runs. One run at a time. k6 is spawned with an args array (no shell).
// Final status comes from the k6 exit code: 0 passed, 99 thresholds crossed (failed), anything else error.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ID_RE = /^[a-z0-9-]+$/;
const LOG_LINES = 40;
const fwd = (p) => p.replaceAll('\\', '/');

export function buildK6Args(cfg, { runId, runDir, apiPort }) {
  const args = ['run', '--address', `127.0.0.1:${apiPort}`, '--tag', `testid=${runId}`];
  const env = { CONFIG_PATH: `${fwd(runDir)}/config.json`, RUN_DIR: fwd(runDir) };
  if (cfg.grafana.enabled) {
    args.push('--out', 'experimental-prometheus-rw');
    env.K6_PROMETHEUS_RW_SERVER_URL = cfg.grafana.url;
    env.K6_PROMETHEUS_RW_TREND_STATS = 'p(50),p(95),p(99),max';
  }
  args.push('k6/test.js');
  return { args, env };
}

const newId = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + randomBytes(2).toString('hex');

export class RunManager {
  #runs = new Map();
  #active = null; // { id, child, stopRequested }

  constructor({ runsDir, k6Bin, root, apiPort = 6565 }) {
    Object.assign(this, { runsDir, k6Bin, root, apiPort });
    mkdirSync(runsDir, { recursive: true });
    for (const id of readdirSync(runsDir).filter((d) => ID_RE.test(d))) {
      try {
        const run = JSON.parse(readFileSync(join(runsDir, id, 'run.json'), 'utf8'));
        if (run.status === 'running') Object.assign(run, { status: 'error', logTail: [...run.logTail, 'Server restarted while this run was active.'] });
        this.#runs.set(id, run);
      } catch {
        // folder without run.json: ignore
      }
    }
  }

  start(cfg) {
    if (this.#active) throw Object.assign(new Error('A test is already running'), { code: 'BUSY' });
    const id = newId();
    const runDir = join(this.runsDir, id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'config.json'), JSON.stringify(cfg));

    const run = { id, name: cfg.name, status: 'running', startedAt: new Date().toISOString(), config: cfg, logTail: [] };
    this.#runs.set(id, run);
    const { args, env } = buildK6Args(cfg, { runId: id, runDir, apiPort: this.apiPort });
    const child = spawn(this.k6Bin, args, { cwd: this.root, env: { ...process.env, ...env } });
    const active = { id, child, stopRequested: false };
    this.#active = active;

    const log = (line) => {
      run.logTail.push(line);
      if (run.logTail.length > LOG_LINES) run.logTail.shift();
    };
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.on('data', (d) => {
        const parts = (rest + d).split(/\r?\n/);
        rest = parts.pop();
        parts.filter(Boolean).forEach(log);
      });
    }
    let ended = false;
    const finish = (code, why) => {
      if (ended) return;
      ended = true;
      if (why) log(why);
      run.status = active.stopRequested ? 'stopped' : code === 0 ? 'passed' : code === 99 ? 'failed' : 'error';
      run.endedAt = new Date().toISOString();
      const summaryFile = join(runDir, 'summary.json');
      if (existsSync(summaryFile)) run.summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
      writeFileSync(join(runDir, 'run.json'), JSON.stringify(run));
      this.#active = null;
    };
    child.on('error', (e) => finish(-1, `Could not start k6: ${e.message}`));
    child.on('close', (code) => finish(code));
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(run));
    return { id };
  }

  get(id) {
    return this.#runs.get(id);
  }

  list() {
    return [...this.#runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async stop(id) {
    const a = this.#active;
    if (!a || a.id !== id) return false;
    a.stopRequested = true;
    try {
      const res = await fetch(`http://127.0.0.1:${this.apiPort}/v1/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: { type: 'status', id: 'default', attributes: { stopped: true } } }),
      });
      if (!res.ok) a.child.kill();
    } catch {
      a.child.kill();
    }
    return true;
  }

  /** Kill the active k6 (server exit), so a dead server never leaves load running. */
  shutdown() {
    if (!this.#active) return;
    this.#active.stopRequested = true;
    this.#active.child.kill();
  }

  reportPath(id) {
    if (!ID_RE.test(id)) return undefined;
    const p = join(this.runsDir, id, 'report.html');
    return existsSync(p) ? p : undefined;
  }
}
