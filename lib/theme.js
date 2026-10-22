// Shared "Swiss Precision" theme tokens and base classes for the app page and the report.
// Pure: one CSS string, runs in browser and Node. Light values are also re-declared for print.

const LIGHT = '--canvas:#F1F3F0;--surface:#FFFFFF;--surface-muted:#F7F8F6;--border:#DDE2DC;--text:#29332C;--text-2:#687269;--accent:#52745B;--live:#4779A8;--healthy:#356B4A;--warning:#946B2D;--critical:#A3443E;--neutral:#737B74;';
const DARK = '--canvas:#171B18;--surface:#202621;--surface-muted:#262D27;--border:#343D35;--text:#E6EAE5;--text-2:#A1ACA1;--accent:#A1BDA3;--live:#82B6E8;--healthy:#83C99A;--warning:#E6BD72;--critical:#F09B92;--neutral:#A1AAA2;';

export const THEME_CSS = `
:root{${LIGHT}color-scheme:light dark;--sans:Inter,Geist,system-ui,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,Consolas,monospace}
@media (prefers-color-scheme: dark){:root{${DARK}}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--text);font:14px/1.5 var(--sans);font-variant-numeric:tabular-nums}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;font-size:14px;font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 16px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font:inherit;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s}
.btn:hover{background:var(--surface-muted)}
.btn:focus-visible{outline:2px solid var(--live);outline-offset:2px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--canvas)}
.btn-primary:hover{background:var(--accent);filter:brightness(.95)}
.btn-danger{border-color:var(--critical);color:var(--critical)}
.badge{display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid var(--neutral);border-radius:6px;color:var(--text);font-size:12px;font-weight:600}
.badge.is-idle,.badge.is-off,.badge.is-stopped{border-color:var(--neutral)}
.badge.is-running{color:var(--live);border-color:var(--live)}
.badge.is-passed{color:var(--healthy);border-color:var(--healthy)}
.badge.is-failed,.badge.is-error{color:var(--critical);border-color:var(--critical)}
.callout{padding:12px 16px;border:1px solid var(--border);border-left:4px solid var(--neutral);border-radius:6px;background:var(--surface-muted)}
.callout.is-warning{border-left-color:var(--warning)}
.callout.is-critical{border-left-color:var(--critical)}
.hint{margin:4px 0 8px;color:var(--text-2);font-size:12px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono)}
.metric{display:flex;flex-direction:column;gap:4px}
.metric-value{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.metric-unit{margin-left:4px;color:var(--text-2);font-size:12px;font-weight:400}
.metric-help{color:var(--text-2);font-size:12px}
table.data{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
table.data th,table.data td{padding:8px 12px;border-bottom:1px solid var(--border);text-align:left}
table.data .num{text-align:right}
table.data th{color:var(--text-2);font-size:12px;font-weight:600}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
@media print{:root{${LIGHT}color-scheme:light}body{background:#fff}}
`;
