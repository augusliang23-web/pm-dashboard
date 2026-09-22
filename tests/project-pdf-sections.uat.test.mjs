// RESTORED (Control Plane remediation after Codex's independent review flagged the missing UAT project-brief/project-update
// checkbox options as a remaining integration regression, on top of the pdf-service backend restored earlier -- see
// pdf-service/test/project-brief-update-boundary.test.mjs and the six tests in pdf-service/test/{report-request,project-report,
// app,pdf-layout}.uat.test.mjs). index.html's renderProjectUpdateReport/renderProjectPrintReport/PROJECT_PDF_SECTIONS and the two
// were already common code, byte-identical between the Production and UAT baselines, and had already carried through the
// consolidation merge unmodified; the two checkbox <label> options for #projectPdfSectionPicker were the only thing missing. They
// are added gated with data-profile-only="uat" (the same mechanism as every other Production/UAT-only markup in this file), and
// openProjectPdfSectionPicker/confirmProjectPdfExport were made profile-aware (see 'the picker never presents or submits...'
// below) so a Production user can never see or silently submit them, matching the UAT baseline's request/render pipeline exactly
// -- the same 'project-brief'/'project-update' section names pdf-service now accepts only for the UAT-resolved target.
import { dashboardSource, dashboardSourceAsync, rawDashboardSource } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const dashboard = await dashboardSourceAsync('uat');
const productionDashboard = await dashboardSourceAsync('production');

test('project PDF picker exposes selectable project background and delivery sections', () => {
  assert.match(dashboard, /id="projectPdfSectionPicker"/);
  assert.match(dashboard, /data-pdf-section="project-brief"/);
  assert.match(dashboard, /data-pdf-section="project-update"/);
  assert.match(dashboard, /data-pdf-section="milestone"/);
  assert.match(dashboard, /data-pdf-section="gantt"/);
  assert.match(dashboard, /data-pdf-section="team-allocation"/);
  assert.match(dashboard, /data-pdf-section="budget"/);
  assert.match(dashboard, /data-pdf-section="resources"/);
  assert.match(dashboard, /Project brief/);
  assert.match(dashboard, /Milestone/);
  assert.match(dashboard, /Gantt Chart/);
  assert.match(dashboard, /Team allocation/);
  assert.match(dashboard, /Budget/);
  assert.match(dashboard, /Discipline hours/);
});

test('project PDF includes a selectable executive project update section', () => {
  assert.match(dashboard, /data-pdf-section="project-update"/);
  assert.match(dashboard, /function renderProjectUpdateReport\(/);
  assert.match(dashboard, /project-print-update-card/);
  assert.match(dashboard, /Highlight/);
  assert.match(dashboard, /Risk \/ Blocker/);
  assert.match(dashboard, /Weekly actions/);
});

test('project export opens a section picker before direct professional download', () => {
  const start = dashboard.indexOf('window.exportProjectOnePagePdf =');
  const end = dashboard.indexOf('// ── RENDER ──', start);
  const source = dashboard.slice(start, end);
  assert.match(source, /openProjectPdfSectionPicker/);
  assert.doesNotMatch(source, /window\.print\(\)/);
  assert.match(dashboard, /function confirmProjectPdfExport\(/);
  assert.match(dashboard, /window\.confirmProjectPdfExport\s*=\s*confirmProjectPdfExport/);
  assert.match(dashboard, /function confirmProjectPdfExport\(\)[\s\S]*downloadProfessionalReport/);
});

test('project presentation report keeps complete sections and table rows together', () => {
  assert.match(dashboard, /body\.print-presentation-report \.print-report-unit \{ break-inside:avoid-page/);
  assert.match(dashboard, /body\.print-presentation-report \.project-report-table tr \{ break-inside:avoid-page/);
  assert.match(dashboard, /data-pdf-section="milestone"/);
  assert.match(dashboard, /data-pdf-section="gantt"/);
  assert.match(dashboard, /data-pdf-section="budget"/);
  assert.match(dashboard, /data-pdf-section="resources"/);
});

test('project Gantt uses a presentation report grid that fits a landscape page', () => {
  const printStart = dashboard.indexOf('@media print {');
  const printCss = dashboard.slice(printStart, dashboard.indexOf('</style>', printStart));
  assert.match(printCss, /\.project-report-gantt \.gantt-grid\s*\{[^}]*min-width:\s*0/);
  assert.match(printCss, /\.project-report-gantt \.gantt-name\s*\{[^}]*width:\s*46mm/);
  assert.match(dashboard, /renderProjectGantt\(project, 'printReportGantt'\)/);
});

test('project print separates report pages while keeping the executive summary compact', () => {
  assert.match(dashboard, /project-print-update-grid \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(dashboard, /if \(selected\.has\('milestone'\)\) page\('milestone'/);
  assert.match(dashboard, /if \(selected\.has\('gantt'\)\) page\('gantt'/);
  assert.match(dashboard, /if \(selected\.has\('team-allocation'\)\) page\('team-allocation'/);
});

test('project PDF uses a presentation report with a horizontal milestone timeline and named team allocation', () => {
  assert.match(dashboard, /function renderProjectPrintReport\(/);
  assert.match(dashboard, /function renderProjectMilestoneTimeline\(/);
  assert.match(dashboard, /project-milestone-timeline/);
  assert.match(dashboard, /<th>Name<\/th><th>Role<\/th><th>Allocation<\/th>/);
  assert.match(dashboard, /renderProjectTeamAllocationReport/);
  assert.match(dashboard, /finalizePresentationReport\(pages, 'project'\)/);
});

// dashboardSource() strips the resolved data-profile-only attribute text from BOTH per-profile views (the same
// way it removes every other resolved profile marker), so the attribute itself can only be asserted against the
// single, literal, as-shipped index.html source -- rawDashboardSource() -- not a reconstructed profile view.
test('the two picker options are gated data-profile-only="uat" in the shipped source, the same mechanism as every other UAT-only element', () => {
  const raw = rawDashboardSource();
  const pickerStart = raw.indexOf('id="projectPdfSectionPicker"');
  const pickerEnd = raw.indexOf('</div>\n</div>', pickerStart);
  const picker = raw.slice(pickerStart, pickerEnd);
  assert.match(picker, /data-profile-only="uat"><input type="checkbox" data-pdf-section="project-brief">/);
  assert.match(picker, /data-profile-only="uat"><input type="checkbox" data-pdf-section="project-update">/);
  // Neither is checked by default in markup; visibility/checked state is assigned at runtime by
  // openProjectPdfSectionPicker so a hidden Production checkbox is never silently checked (see below).
  assert.doesNotMatch(picker, /data-pdf-section="project-brief" checked/);
  assert.doesNotMatch(picker, /data-pdf-section="project-update" checked/);
  // The other five options are unconditionally visible in both profiles, unchanged from before this fix.
  for (const section of ['milestone', 'gantt', 'team-allocation', 'resources', 'budget']) {
    assert.doesNotMatch(picker, new RegExp(`data-profile-only="[a-z]+"><input type="checkbox" data-pdf-section="${section}"`));
  }
});

test('both profile views still describe the same two options textually (only visibility differs, per the shipped source check above)', () => {
  for (const view of [dashboard, productionDashboard]) {
    assert.match(view, /id="projectPdfSectionPicker"/);
    assert.match(view, /data-pdf-section="project-brief"/);
    assert.match(view, /data-pdf-section="project-update"/);
  }
});

// Finds `function name(` (optionally preceded by `async `) and slices up to the given end marker string. This is
// deliberately not "up to the next `function`", because confirmProjectPdfExport is followed by
// `window.openProjectPdfSectionPicker = ...`, not another `function` declaration.
function functionSource(source, name, endMarker) {
  const bare = source.indexOf(`function ${name}(`);
  assert.ok(bare >= 0, `${name} function must exist`);
  const start = source.slice(Math.max(0, bare - 6), bare) === 'async ' ? bare - 6 : bare;
  let end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${name} function must end before "${endMarker}"`);
  // If endMarker is itself preceded by "async " (e.g. the boundary is "function confirmProjectPdfExport(" but the
  // real declaration is "async function confirmProjectPdfExport("), stop before that too, so the slice never ends
  // on a dangling "async" keyword with no following function statement.
  if (source.slice(Math.max(0, end - 6), end) === 'async ') end -= 6;
  return source.slice(start, end);
}

function stubInput(section, { profileOnly } = {}) {
  const label = profileOnly ? { dataset: { profileOnly } } : null;
  const input = {
    dataset: { pdfSection: section },
    checked: false,
    closest(selector) {
      return selector === '[data-profile-only]' ? label : null;
    }
  };
  return input;
}

function runPickerLogic(source, isUatProfile, inputs) {
  const picker = {
    dataset: {},
    querySelectorAll: selector => selector === 'input[data-pdf-section]'
      ? inputs
      : inputs.filter(input => input.checked)
  };
  const context = vm.createContext({
    IS_UAT_PROFILE: isUatProfile,
    document: { getElementById: id => (id === 'projectPdfSectionPicker' ? picker : { textContent: '' }) },
    openAccessibleModal: () => {}
  });
  vm.runInContext(functionSource(source, 'isProfileVisible', 'function openProjectPdfSectionPicker('), context);
  vm.runInContext(functionSource(source, 'openProjectPdfSectionPicker', 'function confirmProjectPdfExport('), context);
  context.openProjectPdfSectionPicker('PMS-001');
  return inputs;
}

test('opening the picker checks project-brief/project-update for UAT and leaves them unchecked for Production, by the same runtime gate', () => {
  for (const [source, isUatProfile] of [[dashboard, true], [productionDashboard, false]]) {
    const inputs = [
      stubInput('project-brief', { profileOnly: 'uat' }),
      stubInput('project-update', { profileOnly: 'uat' }),
      stubInput('milestone')
    ];
    runPickerLogic(source, isUatProfile, inputs);
    assert.equal(inputs[0].checked, isUatProfile, `project-brief checked state for isUatProfile=${isUatProfile}`);
    assert.equal(inputs[1].checked, isUatProfile, `project-update checked state for isUatProfile=${isUatProfile}`);
    assert.equal(inputs[2].checked, true, 'milestone (ungated) is always checked when the picker opens');
  }
});

test('confirming the export never submits project-brief/project-update for Production even if a hidden checkbox is somehow checked', async () => {
  for (const [source, isUatProfile, expectSections] of [
    [dashboard, true, ['project-brief', 'project-update', 'milestone']],
    [productionDashboard, false, ['milestone']]
  ]) {
    const inputs = [
      stubInput('project-brief', { profileOnly: 'uat' }),
      stubInput('project-update', { profileOnly: 'uat' }),
      stubInput('milestone')
    ];
    for (const input of inputs) input.checked = true; // simulate a hidden checkbox left checked / a manipulated DOM
    const picker = {
      dataset: { projectCode: 'PMS-001' },
      querySelectorAll: () => inputs.filter(input => input.checked)
    };
    let sentSections = null;
    const errorEl = { textContent: '' };
    const context = vm.createContext({
      IS_UAT_PROFILE: isUatProfile,
      document: {
        getElementById: id => {
          if (id === 'projectPdfSectionPicker') return picker;
          if (id === 'projectPdfSectionPickerError') return errorEl;
          if (id === 'projectPdfExportButton') return { disabled: false, setAttribute() {}, removeAttribute() {} };
          return {};
        }
      },
      allWeeks: [{ weekLabel: 'W28', projects: [{ code: 'PMS-001' }] }],
      currentIdx: 0,
      downloadProfessionalReport: async (request) => { sentSections = request.sections; return true; },
      closeModal: () => {}
    });
    vm.runInContext(functionSource(source, 'isProfileVisible', 'function openProjectPdfSectionPicker('), context);
    vm.runInContext(functionSource(source, 'confirmProjectPdfExport', 'window.openProjectPdfSectionPicker = openProjectPdfSectionPicker'), context);
    await vm.runInContext('confirmProjectPdfExport()', context);
    // sentSections is an Array from the vm context's own realm (a different Array.prototype); spread it into a
    // plain array in this realm before a strict deepEqual, or the comparison fails on prototype identity alone
    // despite printing identically.
    assert.deepEqual([...sentSections], expectSections);
  }
});

test('confirming the export with no sections selected shows an error and never calls the PDF service', async () => {
  const inputs = [];
  const picker = { dataset: { projectCode: 'PMS-001' }, querySelectorAll: () => inputs };
  const errorEl = { textContent: '' };
  let called = false;
  const context = vm.createContext({
    IS_UAT_PROFILE: true,
    document: {
      getElementById: id => (id === 'projectPdfSectionPicker' ? picker : id === 'projectPdfSectionPickerError' ? errorEl : {})
    },
    allWeeks: [{ weekLabel: 'W28', projects: [{ code: 'PMS-001' }] }],
    currentIdx: 0,
    downloadProfessionalReport: async () => { called = true; return true; },
    closeModal: () => {}
  });
  vm.runInContext(functionSource(dashboard, 'isProfileVisible', 'function openProjectPdfSectionPicker('), context);
  vm.runInContext(functionSource(dashboard, 'confirmProjectPdfExport', 'window.openProjectPdfSectionPicker = openProjectPdfSectionPicker'), context);
  await vm.runInContext('confirmProjectPdfExport()', context);
  assert.equal(called, false, 'the PDF service must never be called with zero selected sections');
  assert.match(errorEl.textContent, /Select at least one section/);
});
