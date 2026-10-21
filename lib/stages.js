// Turns a test type plus a few numbers into k6 ramping-vus stages. Pure: importable by Node and k6.
// ponytail: every type uses a fixed number of users (closed model); add arrival rate if slow responses hide load.

const stage = (seconds, target) => ({ duration: `${seconds}s`, target });
const users = (peak, factor) => Math.max(1, Math.round(peak * factor));

export function buildStages(cfg) {
  const { testType, peakUsers: peak, rampUpS, holdS, rampDownS } = cfg;
  switch (testType) {
    case 'smoke':
      return [stage(holdS, 1)];
    case 'stress': {
      const out = [];
      for (const f of cfg.stressSteps) out.push(stage(rampUpS, users(peak, f)), stage(holdS, users(peak, f)));
      out.push(stage(rampDownS, 0));
      return out;
    }
    case 'spike':
      return [
        stage(rampUpS, users(peak, 0.1)), // warm baseline
        stage(10, peak),
        stage(holdS, peak),
        stage(10, users(peak, 0.1)),
        stage(rampUpS, users(peak, 0.1)), // recovery observation
        stage(rampDownS, 0),
      ];
    case 'breakpoint':
      return [stage(holdS, peak)];
    case 'load':
    case 'soak':
      return [stage(rampUpS, peak), stage(holdS, peak), stage(rampDownS, 0)];
    default:
      throw new Error(`Unknown testType "${testType}"`);
  }
}
