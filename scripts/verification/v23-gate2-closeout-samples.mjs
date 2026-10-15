// Reproducible Gate 2 closeout PDF samples (SYNTHETIC data). Usage: node scripts/verification/v23-gate2-closeout-samples.mjs $PWD docs/delivery-trends-presentation/gate2-closeout
// Needs pdf-service dependencies installed. Runs the real report-data -> report-model -> renderer pipeline and audits page overflow.
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const root = process.argv[2], out = process.argv[3];
const { loadAuthorizedReport, createBoundedDeliveryHistoryReader } = await import(`${root}/pdf-service/src/report-data.js`);
const { renderOverviewReportHtml } = await import(`${root}/pdf-service/src/overview-report.js`);
const { parseReportRequest } = await import(`${root}/pdf-service/src/report-request.js`);
const { renderPdfBuffer } = await import(`${root}/pdf-service/src/pdf-renderer.js`);
const puppeteer = createRequire(`${root}/pdf-service/package.json`)('puppeteer');
const { paginateMeasuredFlows } = await import(`${root}/pdf-service/src/measured-paginator.js`);
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
const DAY = 86400000;
const isoMonday = (y, w) => { const j = Date.UTC(y, 0, 4); return j - ((new Date(j).getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY; };
const md = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function build({ count, longNames = false, longPm = false, dropWeek = null }) {
  const docs = new Map();
  [[2025, 50], [2025, 51], [2025, 52], [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5]].forEach(([y, w], i) => {
    if (dropWeek && dropWeek[0] === y && dropWeek[1] === w) return;
    const projects = Array.from({ length: count }, (_, k) => ({ projectId: `p${k + 1}`, code: `SYN-${k + 1}`,
      name: longNames && k < 2 ? `Synthetic Extremely Long Project Name For Next Generation Integrated Platform Validation Programme Phase Two Extended ${k + 1}` : `Synthetic Project ${k + 1}`,
      owner: longPm && k < 2 ? `Synthetic Project Manager With An Unusually Long Display Name And Department Suffix ${k + 1}` : `Synthetic PM ${k + 1}`,
      projectManager: longPm && k < 2 ? `Synthetic Project Manager With An Unusually Long Display Name And Department Suffix ${k + 1}` : `Synthetic PM ${k + 1}`,
      progress: Math.min(100, 8 * (k + 1) % 70 + i * (1 + (k % 3) * 0.5)), status: ['green', 'yellow', 'red'][k % 3], projectLevel: 'system', visibility: 'active', lifecycle: 'active', baselineId: 'b1', milestones: [], riskActions: [] }));
    docs.set(`W${w}-${y}`, { weekLabel: `W${w} ${y}`, weekDate: `${md(isoMonday(y, w))} - ${md(isoMonday(y, w) + 4 * DAY)}`, isReleased: true, version: 1, summary: '', projects });
  });
  return docs;
}
const fakeDb = map => ({ collection: () => ({ f: null, lim: 50, after: null, where(f, o, v) { this.f = [f, v]; return this; }, orderBy() { return this; }, limit(n) { this.lim = n; return this; }, startAfter(c) { this.after = c; return this; },
  async get() { let ids = [...map.keys()].sort(); if (this.f) ids = ids.filter(id => map.get(id)[this.f[0]] === this.f[1]); if (this.after) ids = ids.filter(id => id > this.after); ids = ids.slice(0, this.lim); return { docs: ids.map(id => ({ id, data: () => JSON.parse(JSON.stringify(map.get(id))) })) }; } }) });
const cases = { 'six-projects': { count: 6 }, 'seven-projects': { count: 7 }, 'fourteen-projects': { count: 14 }, 'missing-observation': { count: 6, dropWeek: [2026, 2] }, 'long-project-names': { count: 6, longNames: true }, 'long-pm-names': { count: 6, longPm: true }, 'partial-selection': { count: 8, partial: 5 } };
for (const [name, c] of Object.entries(cases)) {
  const map = build(c);
  const codes = c.partial ? Array.from({ length: c.partial }, (_, k) => `SYN-${k + 1}`) : Array.from({ length: c.count }, (_, k) => `SYN-${k + 1}`);
  const request = parseReportRequest({ mode: 'overview', weekId: 'W5-2026', sections: ['portfolio-delivery-performance'], overviewScope: 'all', projectCodes: codes }, { deliveryPerformanceSection: true });
  const report = await loadAuthorizedReport({ request, idToken: 't', adapters: { verifyIdToken: async () => ({ email: 'qa@example.test' }), getUserByEmail: async () => ({ role: 'pm' }), getWeekById: async id => JSON.parse(JSON.stringify(map.get(id))),
    getDeliveryHistory: createBoundedDeliveryHistoryReader({ db: fakeDb(map) }), getDeliveryTrendsProvenance: () => ({ source: 'synthetic', asOf: '2026-02-10T00:00:00.000Z' }) } });
  const html = renderOverviewReportHtml({ ...report, projectPortfolioLayout: 'one-page' });
  const pdf = await renderPdfBuffer(html);
  await writeFile(`${out}/${name}.pdf`, pdf);
  const pages = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  const page = await browser.newPage(); await page.setViewport({ width: 1123, height: 794 }); await page.setContent(html); await page.evaluate(paginateMeasuredFlows);
  const audit = await page.evaluate(() => [...document.querySelectorAll('.report-page')].map(pg => { const pr = pg.getBoundingClientRect(); const body = pg.querySelector('[data-pdf-flow-items]'); const foot = pg.querySelector('.report-footer');
    const outside = [...pg.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1); }).length;
    return { gapToFooter: Math.round(foot.getBoundingClientRect().top - body.getBoundingClientRect().bottom), outsidePage: outside }; }));
  const els = await page.$$('.report-page'); for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `${out}/${name}-p${i + 1}.png` }); await page.close();
  console.log(name, JSON.stringify(audit), 'pdfPages=', (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length); console.log(name, 'pages=', pages, 'status=', report.deliveryTrends.status, 'gain=', report.deliveryTrends.summary.weeklyProgressGainPp, 'rows=', report.deliveryTrends.projects.filter(p => p.isInAnchorScope).length);
}
await renderPdfBuffer.close(); await browser.close();
