export const REPORT_CSS = `
  @page { size: A4 landscape; margin:0; }
  :root {
    --ink:#26384a;
    --muted:#718196;
    --line:#d7dee7;
    --surface:#f5f8fb;
    --green:#57967f;
    --green-soft:#e8f3ee;
    --yellow:#c99732;
    --yellow-soft:#fff5dc;
    --red:#b85c5c;
    --red-soft:#fdecec;
    --blue:#5b7fa3;
    --white:#fff;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; background:var(--white); }
  body {
    color:var(--ink);
    font:9.5pt Arial,"Noto Sans CJK TC",sans-serif;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  h1,h2,h3,p { margin-top:0; }
  h1 { margin-bottom:1mm; font-size:20pt; line-height:1.1; }
  h2 { margin-bottom:3mm; font-size:13pt; line-height:1.2; }
  h3 { margin-bottom:2mm; font-size:10pt; line-height:1.25; }
  .report-document { width:100%; }
  .report-page {
    position:relative;
    width:297mm;
    min-height:210mm;
    background:var(--white);
    padding:11mm 12mm 9mm;
    break-after:page;
    display:flex;
    flex-direction:column;
  }
  .report-page:last-child { break-after:auto; }
  .report-page-head {
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap:8mm;
    padding-bottom:4mm;
    border-bottom:1px solid var(--line);
  }
  .report-kicker {
    margin-bottom:1.5mm;
    color:var(--green);
    font-size:7.5pt;
    font-weight:700;
    letter-spacing:.12em;
    text-transform:uppercase;
  }
  .report-title { margin:0; }
  .report-page-context { margin-top:1.2mm; color:var(--muted); font-size:9pt; font-weight:700; overflow-wrap:anywhere; }
  .report-meta { color:var(--muted); font-size:8pt; white-space:nowrap; }
  .report-body { flex:1; min-height:0; padding-top:5mm; }
  .report-footer {
    position:absolute;
    left:12mm;
    right:12mm;
    bottom:9mm;
    display:flex;
    justify-content:space-between;
    gap:8mm;
    padding-top:3mm;
    color:var(--muted);
    font-size:7.5pt;
  }
  .card {
    border:1px solid var(--line);
    border-radius:4mm;
    background:var(--white);
    padding:4mm;
    break-inside:avoid;
  }
  .card-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4mm; }
  .metric-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:3mm; }
  .metric-card-label { color:var(--muted); font-size:7.5pt; font-weight:700; text-transform:uppercase; }
  .metric-card-value { margin-top:1.5mm; font-size:18pt; font-weight:800; line-height:1; }
  .metric-card-detail { margin-top:1.5mm; color:var(--muted); font-size:8pt; }
  .metric-card.yellow { background:var(--yellow-soft); }
  .metric-card.red { background:var(--red-soft); }
  .metric-card.green { background:var(--green-soft); }
  .status-badge {
    display:inline-flex;
    align-items:center;
    border-radius:99px;
    padding:1.2mm 2.4mm;
    font-size:8pt;
    font-weight:700;
  }
  .status-badge.green { color:var(--green); background:var(--green-soft); }
  .status-badge.yellow { color:#8a641c; background:var(--yellow-soft); }
  .status-badge.red { color:var(--red); background:var(--red-soft); }
  .status-badge.neutral { color:var(--muted); background:var(--surface); }
  .progress-track { height:3mm; border-radius:99px; overflow:hidden; background:#e6ecf2; }
  .progress-fill { height:100%; background:var(--green); }
  .progress-fill.yellow { background:var(--yellow); }
  .progress-fill.red { background:var(--red); }
  table { width:100%; border-collapse:collapse; }
  thead { display:table-header-group; }
  tr,.keep-together { break-inside:avoid; }
  th,td { padding:2.4mm; border-bottom:1px solid var(--line); vertical-align:top; }
  th {
    color:var(--muted);
    font-size:7.5pt;
    letter-spacing:.04em;
    text-align:left;
    text-transform:uppercase;
  }
  .empty-state {
    border:1px dashed var(--line);
    border-radius:3mm;
    padding:6mm;
    color:var(--muted);
    text-align:center;
  }
  .project-brief-grid { display:grid; grid-template-columns:1.25fr .75fr 1.1fr; gap:4mm; margin-bottom:4mm; }
  .project-identity-card h2 { margin-bottom:1.5mm; font-size:17pt; }
  .project-code { margin-bottom:3mm; color:var(--muted); text-transform:capitalize; }
  .project-progress-card { display:flex; flex-direction:column; justify-content:center; }
  .project-progress-value { margin:2mm 0 3mm; font-size:27pt; font-weight:800; }
  .project-context-card { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3mm; margin:0; }
  .project-context-card div { min-width:0; }
  .project-context-card dt { color:var(--muted); font-size:7.5pt; font-weight:700; text-transform:uppercase; }
  .project-context-card dd { margin:1mm 0 0; font-weight:700; overflow-wrap:anywhere; }
  .project-update-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4mm; }
  .project-summary-flow [data-pdf-flow-items] { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4mm; align-items:start; }
  .project-summary-flow [data-flow-kind="project-brief"],.project-summary-flow [data-pdf-fragment] { grid-column:1 / -1; }
  .project-update-card { min-height:62mm; }
  .project-update-card.risk { border-color:#e5b5b5; background:linear-gradient(180deg,var(--red-soft),var(--white) 38%); }
  .report-list { margin:0; padding-left:5mm; }
  .report-list li { margin-bottom:2.2mm; line-height:1.35; }
  .section-update-note { margin:0 0 2mm; color:var(--muted); font-size:7.5pt; line-height:1.3; text-align:right; }
  .milestone-timeline { position:relative; display:grid; grid-template-columns:repeat(var(--count),minmax(0,1fr)); gap:7mm; padding:17mm 4mm 0; }
  .milestone-timeline::before { content:""; position:absolute; top:10mm; left:7%; right:7%; height:1px; background:var(--line); }
  .milestone-step { position:relative; min-width:0; padding:5mm 4mm; border:1px solid var(--line); border-radius:4mm; background:var(--white); text-align:center; }
  .milestone-dot { position:absolute; top:-13mm; left:50%; width:5mm; height:5mm; border:1.2mm solid var(--white); border-radius:50%; background:var(--muted); box-shadow:0 0 0 1px var(--line); transform:translateX(-50%); }
  .milestone-dot.green { background:var(--green); } .milestone-dot.yellow { background:var(--yellow); } .milestone-dot.red { background:var(--red); }
  .milestone-step time { display:block; margin:2mm 0; color:var(--muted); }
  .milestone-list { list-style:none; margin:0; padding:0; }
  .milestone-row { display:grid; grid-template-columns:34mm minmax(0,1fr) 28mm; align-items:center; gap:5mm; padding:4mm; border-bottom:1px solid var(--line); }
  .milestone-row time { color:var(--muted); }
  .milestone-flow [data-pdf-flow-items] { gap:2mm; }
  .gantt-grid { display:grid; gap:2.5mm; }
  .gantt-grid [data-pdf-flow-items] { display:grid; gap:2.5mm; }
  .gantt-repeat { min-height:5mm; }
  .gantt-axis { display:flex; justify-content:space-between; margin-left:53mm; padding:0 32mm 1mm 0; color:var(--muted); font-size:7.5pt; }
  .gantt-row { display:grid; grid-template-columns:48mm minmax(0,1fr) 28mm; align-items:center; gap:5mm; min-height:13mm; }
  .gantt-label { min-width:0; }
  .gantt-label strong,.gantt-label small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gantt-label small { margin-top:1mm; color:var(--muted); font-size:7pt; }
  .gantt-track { position:relative; height:8mm; border-radius:2mm; background:repeating-linear-gradient(90deg,#f0f4f7 0,#f0f4f7 calc(10% - 1px),#dfe7ee calc(10% - 1px),#dfe7ee 10%); }
  .gantt-track.unscheduled { display:flex; align-items:center; justify-content:center; background:var(--surface); }
  .gantt-bar { position:absolute; top:1mm; height:6mm; min-width:4mm; overflow:hidden; border-radius:1.5mm; background:#dfe5ea; }
  .gantt-completed { display:block; height:100%; background:var(--green); opacity:.9; }
  .gantt-bar.yellow .gantt-completed { background:var(--yellow); } .gantt-bar.red .gantt-completed { background:var(--red); }
  .gantt-bar b { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:6.5pt; color:var(--ink); }
  .gantt-state { text-align:right; }
  .project-resource-grid > [data-pdf-flow-items] { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5mm; align-items:start; }
  .project-resource-grid.single > [data-pdf-flow-items] { grid-template-columns:1fr; }
  .project-resource-grid [data-pdf-fragment] { grid-column:1 / -1; }
  .resource-card { min-width:0; }
  .resource-card td { overflow-wrap:anywhere; }
  .budget-metrics { margin-bottom:5mm; }
  .budget-comparison { padding:6mm; }
  .budget-bar-row { display:grid; grid-template-columns:22mm minmax(0,1fr) 36mm; align-items:center; gap:4mm; margin:4mm 0; }
  .budget-bar-row strong { text-align:right; }
  .budget-track { height:6mm; overflow:hidden; border-radius:99px; background:#e6ecf2; }
  .budget-track i { display:block; height:100%; background:var(--blue); }
  .budget-track i.actual { background:var(--green); } .budget-track i.red { background:var(--red); }
  .budget-flow [data-pdf-flow-items] { gap:4mm; }
  .overview-unit + .overview-unit { margin-top:4mm; }
  .overview-unit-head { display:flex; justify-content:space-between; align-items:flex-start; gap:6mm; margin-bottom:3mm; }
  .overview-unit-head h2 { margin-bottom:0; }
  .overview-note { color:var(--muted); font-size:7.5pt; }
  .health-metrics { margin-bottom:3mm; }
  .portfolio-progress-card { display:grid; grid-template-columns:54mm minmax(0,1fr); align-items:center; gap:6mm; padding:3mm 4mm; }
  .portfolio-progress-card strong { display:block; margin-top:1mm; font-size:16pt; }
  .weekly-trend-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4mm; }
  .trend-card { min-width:0; padding:3mm; }
  .trend-card.risk { border-color:#e5b5b5; }
  .trend-card-head { display:flex; justify-content:space-between; gap:4mm; }
  .trend-card-head h3 { margin-bottom:.7mm; }
  .trend-card-head span,.trend-card-head small { color:var(--muted); font-size:7pt; }
  .trend-card-head > strong { font-size:15pt; white-space:nowrap; }
  .weekly-trend-svg { display:block; width:100%; height:37mm; margin-top:1mm; }
  .trend-axis { stroke:var(--line); stroke-width:1; }
  .trend-line { fill:none; stroke:var(--green); stroke-width:3; }
  .weekly-trend-svg.red .trend-line { stroke:var(--red); }
  .trend-dot { fill:var(--green); stroke:var(--white); stroke-width:2; }
  .weekly-trend-svg.red .trend-dot { fill:var(--red); }
  .trend-label,.trend-value { fill:var(--muted); font:8px Arial,sans-serif; text-anchor:middle; }
  .trend-value { fill:var(--ink); font-weight:700; }
  .report-page[data-report-section^="executive-summary-"] .report-title { font-size:25pt; }
  .report-page[data-report-section^="executive-summary-"] { padding:8mm 10mm 7mm; }
  .report-page[data-report-section^="executive-summary-"] .report-page-head { padding-bottom:2.5mm; }
  .report-page[data-report-section^="executive-summary-"] .report-body { padding-top:3mm; }
  .report-page[data-report-section^="executive-summary-"] .report-footer { left:10mm; right:10mm; bottom:7mm; }
  .executive-brief-copy { font-size:10.5pt; line-height:1.45; }
  [data-pdf-flow-items] { display:grid; gap:3mm; }
  [data-pdf-flow-item] { min-width:0; }
  [data-pdf-flow-item] > :last-child { margin-bottom:0; }
  [data-pdf-splittable],[data-pdf-field] { min-width:0; overflow-wrap:anywhere; word-break:break-word; }
  .executive-brief-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:2.5mm; margin-bottom:2mm; }
  .executive-brief-metrics .metric-card { padding:2mm 3mm; }
  .executive-brief-metrics .metric-card-value { margin-top:.7mm; font-size:15pt; }
  .executive-brief-metrics .metric-card-detail { display:none; }
  .executive-portfolio-lead { margin-bottom:2mm; padding:2mm 3mm; border-left:1.5mm solid var(--green); border-radius:0 3mm 3mm 0; background:linear-gradient(90deg,var(--green-soft),var(--white) 72%); }
  .executive-portfolio-lead p,.executive-brief-field p { margin:0; }
  .executive-brief-section-title { margin:0 0 1.5mm; font-size:14.5pt; }
  .executive-brief-columns { display:grid; grid-template-columns:1.08fr .92fr; gap:4mm; align-items:start; }
  .executive-priority-grid { display:grid; grid-template-columns:1fr; gap:2mm; }
  .executive-priority-card { padding:2mm 3mm; border-top:1.2mm solid var(--green); }
  .executive-project-title { margin-bottom:1.5mm; font-size:13pt; }
  .executive-brief-field { display:grid; grid-template-columns:28mm minmax(0,1fr); gap:2mm; margin-top:.8mm; }
  .executive-brief-field strong { color:var(--muted); font-size:8.5pt; letter-spacing:.02em; text-transform:uppercase; }
  .executive-ask-grid { display:grid; grid-template-columns:1fr; gap:1.5mm; }
  .executive-ask-card { min-width:0; padding:1.6mm 2.5mm; border:1px solid #ead29d; border-radius:3mm; background:var(--yellow-soft); break-inside:avoid; }
  .executive-ask-card .executive-project-title { margin-bottom:.6mm; font-size:12pt; }
  .executive-ask-card .executive-brief-field { grid-template-columns:38mm minmax(0,1fr); margin-top:.4mm; }
  .executive-decision-continuation .executive-ask-grid { max-width:132mm; margin:0 auto; }
  .executive-context-intro { margin:0 0 3mm; color:var(--muted); }
  .executive-context-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3mm; }
  .executive-context-card { min-height:39mm; padding:3mm 4mm; border-top:1.2mm solid var(--green); }
  .executive-additional-note { margin:3mm 0 0; padding:2mm 3mm; border-radius:2mm; color:var(--muted); background:var(--surface); }
  .management-flow [data-pdf-flow-items] { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3mm; align-items:start; }
  .management-flow [data-flow-kind="attention-heading"],.management-flow [data-flow-kind="risk-actions"],.management-flow [data-pdf-fragment] { grid-column:1 / -1; }
  .attention-matrix { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3mm; }
  .attention-quadrant { border:1px solid var(--line); border-radius:3mm; background:var(--surface); padding:3mm; }
  .attention-quadrant.action { border-color:#e5b5b5; background:var(--red-soft); }
  .attention-quadrant.monitor { border-color:#ead29d; background:var(--yellow-soft); }
  .attention-quadrant-head { display:flex; justify-content:space-between; gap:3mm; margin-bottom:2mm; }
  .attention-quadrant-head h3 { margin-bottom:.5mm; }
  .attention-quadrant-head span { color:var(--muted); font-size:7pt; }
  .attention-quadrant-head b { display:grid; place-items:center; width:7mm; height:7mm; border-radius:50%; background:var(--white); }
  .attention-project { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2mm; margin-top:2mm; padding:2.5mm; border:1px solid rgba(113,129,150,.25); border-radius:2mm; background:var(--white); }
  .attention-project small { display:block; margin-top:.6mm; color:var(--muted); }
  .attention-project p { grid-column:1 / -1; margin:0; color:var(--muted); font-size:8pt; }
  .attention-empty { padding:3mm; color:var(--muted); font-size:8pt; text-align:center; }
  .risk-action-table { font-size:8pt; }
  .risk-action-table th,.risk-action-table td { padding:1.8mm; }
  .executive-milestone-head { margin-bottom:3mm; }
  .executive-milestone-head h2 { margin:0; font-size:16pt; }
  .executive-milestone-category { padding:3.5mm; border-top:1.4mm solid var(--green); }
  .executive-milestone-category h3 { margin-bottom:2.5mm; font-size:12pt; }
  .executive-milestone-quarter-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:2.5mm; align-items:stretch; }
  .executive-milestone-quarter { min-width:0; border:1px solid var(--line); border-radius:2.5mm; background:var(--surface); overflow:hidden; }
  .executive-milestone-quarter header { min-height:13mm; padding:2.2mm 2.5mm; border-bottom:1px solid var(--line); background:var(--white); }
  .executive-milestone-quarter header strong,.executive-milestone-quarter header span { display:block; }
  .executive-milestone-quarter header strong { font-size:10pt; }
  .executive-milestone-quarter header span { margin-top:.8mm; color:var(--muted); font-size:7.5pt; overflow-wrap:anywhere; }
  .executive-milestone-quarter ul { margin:0; padding:2.5mm 2.5mm 2.5mm 7mm; }
  .executive-milestone-quarter li { margin-bottom:1.8mm; font-size:9.5pt; line-height:1.35; overflow-wrap:anywhere; }
  .executive-milestone-quarter li:last-child { margin-bottom:0; }
  .executive-milestone-quarter .executive-milestone-empty { color:var(--muted); list-style:none; margin-left:-4mm; font-size:8.5pt; }
  .report-page[data-report-section="executive-milestones"] [data-pdf-flow-items] { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:2mm; align-items:start; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-head { margin-bottom:1.5mm; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-head h2 { font-size:14pt; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-category { padding:2.5mm; border-top-width:1mm; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-category h3 { margin-bottom:1.5mm; font-size:10pt; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-quarter-grid { gap:1.5mm; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-quarter header { min-height:9mm; padding:1.5mm 2mm; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-quarter header strong { font-size:8.5pt; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-quarter header span { margin-top:.4mm; font-size:7pt; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-quarter ul { padding:1.5mm 1.5mm 1.5mm 5mm; }
  .report-page[data-report-section="executive-milestones"] .executive-milestone-quarter li { margin-bottom:1mm; font-size:8pt; line-height:1.25; }
  .quarter-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:3mm; align-items:start; }
  .quarter-column { min-height:116mm; border:1px solid var(--line); border-radius:3mm; background:var(--surface); }
  .quarter-column > header { display:flex; justify-content:space-between; padding:3mm; border-bottom:1px solid var(--line); }
  .quarter-column > header span { color:var(--muted); font-size:7.5pt; }
  .quarter-items { display:grid; gap:2mm; padding:2mm; }
  .quarter-item { padding:3mm; border:1px solid var(--line); border-radius:2mm; background:var(--white); }
  .quarter-item strong,.quarter-item small,.quarter-item span { display:block; }
  .quarter-item small { margin:1mm 0 2mm; color:var(--muted); }
  .quarter-item span { margin-top:1mm; color:var(--muted); font-size:7pt; }
  .report-page[data-report-section="quarterly-roadmap"] [data-pdf-flow-items] { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:2mm; align-items:start; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-column { min-height:0; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-column > header { padding:2mm; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-items { gap:1.5mm; padding:1.5mm; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-item { padding:2mm; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-item strong { font-size:8pt; line-height:1.2; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-item small { margin:.7mm 0 1.2mm; font-size:7.5pt; }
  .report-page[data-report-section="quarterly-roadmap"] .quarter-item span { margin-top:.7mm; font-size:7pt; }
  .project-portfolio-flow [data-pdf-flow-items] { gap:2.5mm; }
  .portfolio-project-card { display:flex; flex-direction:column; padding:4mm; border:1px solid var(--line); border-top:2.2mm solid var(--green); border-radius:4mm; background:var(--white); }
  .portfolio-project-head { display:flex; justify-content:space-between; gap:8mm; }
  .portfolio-project-head h2 { margin-bottom:1mm; font-size:18pt; }
  .portfolio-owner { color:var(--muted); }
  .portfolio-project-status { display:flex; align-items:center; gap:4mm; }
  .portfolio-project-status > strong { font-size:24pt; }
  .portfolio-progress { margin:4mm 0; }
  .portfolio-highlights { padding:3mm; background:var(--surface); }
  .portfolio-highlights .report-list { margin-top:2mm; }
  .portfolio-section-title { margin:0 0 2mm; font-size:13pt; }
  .portfolio-risk-row { display:grid; grid-template-columns:1fr 1fr; gap:4mm; padding:3mm 4mm; border-left:1.2mm solid var(--red); }
  .portfolio-risk-row span { color:var(--muted); font-size:7.5pt; font-weight:700; text-transform:uppercase; }
  .portfolio-risk-row p { margin:1mm 0 0; font-size:9pt; line-height:1.35; overflow-wrap:anywhere; }
  .portfolio-signal-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:3mm; }
  .portfolio-signal-grid .risk { background:var(--red-soft); }
  .portfolio-signal-grid p { margin:2mm 0 0; line-height:1.35; }
  .portfolio-snapshot-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:3mm; }
  .portfolio-snapshot-grid span,.portfolio-snapshot-grid strong,.portfolio-snapshot-grid small { display:block; }
  .portfolio-snapshot-grid span { color:var(--muted); font-size:7.5pt; text-transform:uppercase; }
  .portfolio-snapshot-grid strong { margin:2mm 0 1mm; }
  .portfolio-snapshot-grid small { color:var(--muted); }
  .portfolio-gantt-heading { padding-top:1mm; }
  .project-portfolio-flow .gantt-row { padding:2mm 3mm; border:1px solid var(--line); border-radius:2mm; background:var(--white); }
  .resource-analytics-layout { display:grid; grid-template-columns:.75fr 1.55fr; gap:4mm; margin-top:4mm; align-items:start; }
  .resource-level-donut { width:36mm; height:36mm; margin:3mm auto; border:9mm solid transparent; border-radius:50%; background:conic-gradient(var(--green) 0 var(--system),var(--yellow) var(--system) var(--module),var(--blue) var(--module) 100%) border-box; mask:linear-gradient(#000 0 0) padding-box exclude,linear-gradient(#000 0 0); }
  .resource-level-row { display:grid; grid-template-columns:4mm minmax(0,1fr) auto; gap:2mm; margin-top:2mm; }
  .resource-level-row i { width:3mm; height:3mm; border-radius:1mm; background:var(--green); }
  .resource-level-row i.level-1 { background:var(--yellow); } .resource-level-row i.level-2 { background:var(--blue); }
  .resource-function-list { display:grid; gap:3mm; }
  .resource-function-row { display:grid; grid-template-columns:38mm minmax(0,1fr) 32mm; align-items:center; gap:3mm; }
  .resource-function-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .resource-function-bar { height:5mm; overflow:hidden; border-radius:99px; background:#e6ecf2; }
  .resource-function-bar i { display:block; height:100%; background:linear-gradient(90deg,var(--green),var(--blue)); }
  .resource-function-row > strong { text-align:right; font-size:8pt; }
  .resource-function-row > strong small { display:block; color:var(--muted); }
  .budget-overview > .metric-grid { margin-bottom:4mm; }
  .budget-overview-layout { display:grid; grid-template-columns:1.55fr .75fr; gap:4mm; align-items:start; }
  .budget-project-table { font-size:8pt; }
  .negative-value { color:var(--red); font-weight:700; } .positive-value { color:var(--green); font-weight:700; }
  .budget-category-row { display:grid; grid-template-columns:30mm minmax(0,1fr) 31mm; align-items:center; gap:2mm; margin-top:3mm; }
  .budget-category-row strong { text-align:right; font-size:8pt; }
`;
