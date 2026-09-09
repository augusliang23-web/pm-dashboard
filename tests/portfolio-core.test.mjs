import test from 'node:test';
import assert from 'node:assert/strict';
import * as portfolioCore from '../js/portfolio-core.mjs';

import {
  BUILT_IN_WORKSTREAM_TEMPLATES,
  PROJECT_LEVEL,
  PROJECT_LIFECYCLE,
  buildGanttCalendarAxis,
  calculateDropIndex,
  createTimelineTicks,
  createDefaultWorkstreams,
  filterOverviewSummaryLines,
  filterProjects,
  filterRoleVisibleProjects,
  formatStatusDate,
  getOverviewProjectBadgeLabel,
  getOverviewProjects,
  getOverviewScopeStorageKey,
  getFocusTrapIndex,
  mergeResourceEntry,
  normalizeOverviewMilestoneStatus,
  normalizeOverviewPercent,
  normalizeOverviewRagStatus,
  orderProjectsByAttention,
  normalizeRiskActionRows,
  normalizeOverviewSummaryHeading,
  normalizeOverviewScope,
  normalizeProject,
  normalizeResourceEntry,
  normalizeWorkstream,
  parseIsoDate,
  projectOwnershipMatchesIdentity,
  resolveProjectStatusDate,
  validateResourceInput,
  validateWorkstreamTemplateConfig,
  validateWorkstreams,
} from '../js/portfolio-core.mjs';

test('team effort summary reports average allocation and FTE instead of a summed percent', () => {
  assert.equal(typeof portfolioCore.summarizeTeamEffort, 'function');
  const members = [
    ...Array.from({ length: 14 }, (_, index) => ({
      name: `Member ${index + 1}`,
      effortPct: 100,
    })),
    { name: 'Member 15', effortPct: 70 },
  ];

  assert.deepEqual(portfolioCore.summarizeTeamEffort(members), {
    memberCount: 15,
    averagePct: 98,
    fte: 14.7,
  });
  assert.deepEqual(portfolioCore.summarizeTeamEffort([]), {
    memberCount: 0,
    averagePct: 0,
    fte: 0,
  });
});

test('weekly Gantt axis aligns to Mondays and groups labelled ISO weeks by month', () => {
  const axis = buildGanttCalendarAxis(
    new Date(Date.UTC(2026, 5, 30)),
    new Date(Date.UTC(2026, 6, 15)),
    'week',
  );

  assert.equal(axis.axisStart.toISOString(), '2026-06-29T00:00:00.000Z');
  assert.equal(axis.axisEnd.toISOString(), '2026-07-20T00:00:00.000Z');
  assert.deepEqual(axis.ticks.map(tick => tick.label), [
    'W27 · Jun 29',
    'W28 · Jul 6',
    'W29 · Jul 13',
  ]);
  assert.deepEqual(axis.groups.map(group => ({
    label: group.label,
    span: group.span,
  })), [
    { label: 'Jun 2026', span: 1 },
    { label: 'Jul 2026', span: 2 },
  ]);
  assert.equal(axis.guidance, 'Each grid column represents one calendar week.');
  assert.equal(axis.rangeLabel, 'Jun 30, 2026 – Jul 15, 2026');
});

test('weekly Gantt axis uses the correct ISO week across a year boundary', () => {
  const axis = buildGanttCalendarAxis(
    new Date(Date.UTC(2025, 11, 29)),
    new Date(Date.UTC(2026, 0, 4)),
    'week',
  );

  assert.equal(axis.ticks[0].label, 'W01 · Dec 29');
});

test('monthly Gantt axis aligns to month boundaries and groups months by year', () => {
  const axis = buildGanttCalendarAxis(
    new Date(Date.UTC(2026, 10, 18)),
    new Date(Date.UTC(2027, 1, 3)),
    'month',
  );

  assert.equal(axis.axisStart.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(axis.axisEnd.toISOString(), '2027-03-01T00:00:00.000Z');
  assert.deepEqual(axis.ticks.map(tick => tick.label), ['Nov', 'Dec', 'Jan', 'Feb']);
  assert.deepEqual(axis.groups.map(group => ({
    label: group.label,
    span: group.span,
  })), [
    { label: '2026', span: 2 },
    { label: '2027', span: 2 },
  ]);
  assert.equal(axis.guidance, 'Each grid column represents one calendar month.');
});

test('Gantt calendar axis rejects invalid or reversed ranges', () => {
  assert.equal(buildGanttCalendarAxis(new Date('invalid'), new Date(), 'week'), null);
  assert.equal(buildGanttCalendarAxis(
    new Date(Date.UTC(2026, 1, 1)),
    new Date(Date.UTC(2026, 0, 1)),
    'month',
  ), null);
});

test('portfolio order follows attention priority and is stable within each group', () => {
  const projects = [
    { code: 'W-1', attention: 'watch' },
    { code: 'A-1', attention: 'action' },
    { code: 'S-1', attention: 'strategy' },
    { code: 'A-2', attention: 'action' },
    { code: 'M-1', attention: 'monitor' },
    { code: 'X-1', attention: 'other' },
    { code: 'X-2' },
  ];

  assert.deepEqual(
    orderProjectsByAttention(projects, project => project.attention).map(project => project.code),
    ['A-1', 'A-2', 'S-1', 'M-1', 'W-1', 'X-1', 'X-2'],
  );
  assert.deepEqual(projects.map(project => project.code), [
    'W-1', 'A-1', 'S-1', 'A-2', 'M-1', 'X-1', 'X-2',
  ]);
});

test('project ownership uses exact canonical identity tokens', () => {
  const ann = { displayName: 'Ann', email: 'ann.smith@example.com' };

  assert.equal(projectOwnershipMatchesIdentity({ owner: 'Joann' }, ann), false);
  assert.equal(projectOwnershipMatchesIdentity({ owner: 'Ann' }, ann), true);
  assert.equal(projectOwnershipMatchesIdentity({ owner: 'ann.smith@example.com' }, ann), true);
  assert.equal(projectOwnershipMatchesIdentity({ deputy: 'ann.smith' }, ann), true);
  assert.equal(
    projectOwnershipMatchesIdentity(
      { owner: 'Bob, Carol; Dan / Ann | Erin\nFrank' },
      ann,
    ),
    true,
  );
  assert.equal(projectOwnershipMatchesIdentity({ owner: '', deputy: '   ' }, ann), false);
  assert.equal(projectOwnershipMatchesIdentity({ owner: 'Ann Smith' }, ann), false);
});

test('normalizeRiskActionRows preserves asymmetric risk and action pairing', () => {
  assert.deepEqual(normalizeRiskActionRows({
    riskActions: [
      { risk: '', action: 'Action without a risk' },
      { risk: 'Risk without an action', action: '' },
      { description: 'Legacy risk', mitigation: 'Legacy mitigation' },
    ],
  }), [
    { risk: '', action: 'Action without a risk', primary: true },
    { risk: 'Risk without an action', action: '', primary: false },
    { risk: 'Legacy risk', action: 'Legacy mitigation', primary: false },
  ]);
  assert.deepEqual(normalizeRiskActionRows({
    risk: 'Risk A\nRisk B',
    next: 'Action A',
  }), [
    { risk: 'Risk A', action: 'Action A', primary: true },
    { risk: 'Risk B', action: '', primary: false },
  ]);
});

test('resolveProjectStatusDate prefers project dates then selected reporting period without using today', () => {
  assert.equal(resolveProjectStatusDate(
    { statusDate: '2026-06-25', updatedAt: '2026-06-24' },
    { weekDate: '2026-06-28' },
  ), 'Jun 25, 2026');
  assert.equal(resolveProjectStatusDate(
    { statusDate: 'invalid' },
    { reportingDate: '2026-06-28' },
  ), 'Jun 28, 2026');
  assert.equal(resolveProjectStatusDate(
    {},
    { weekDate: 'Jun 22 - Jun 28', weekLabel: 'W26 2026 Prototype' },
  ), 'Jun 28, 2026');
  assert.equal(resolveProjectStatusDate({}, {}), 'Not available');
});

test('getFocusTrapIndex wraps Tab navigation in both directions', () => {
  assert.equal(getFocusTrapIndex(0, 3, true), 2);
  assert.equal(getFocusTrapIndex(2, 3, false), 0);
  assert.equal(getFocusTrapIndex(1, 3, false), 1);
  assert.equal(getFocusTrapIndex(-1, 0, false), -1);
});

test('formatStatusDate accepts Firestore, ISO, and Date values without inventing a date', () => {
  const expected = 'Jun 28, 2026';
  const instant = new Date('2026-06-28T12:34:56.000Z');

  assert.equal(formatStatusDate(instant), expected);
  assert.equal(formatStatusDate('2026-06-28T12:34:56.000Z'), expected);
  assert.equal(formatStatusDate({ toDate: () => instant }), expected);
  assert.equal(formatStatusDate({ seconds: 1782650096, nanoseconds: 0 }), expected);
  assert.equal(formatStatusDate(), 'Not available');
  assert.equal(formatStatusDate('not-a-date'), 'Not available');
});

test('normalizeResourceEntry keeps a blank actual unknown and does not calculate remaining', () => {
  assert.deepEqual(normalizeResourceEntry({ estimated: 12, actual: '  ', updatedAt: ' 2026-06-28T12:00:00Z ' }), {
    estimated: 12,
    actual: null,
    remaining: null,
    updatedAt: '2026-06-28T12:00:00.000Z',
  });
});

test('normalizeResourceEntry accepts numeric strings and floors overrun remaining at zero', () => {
  assert.deepEqual(normalizeResourceEntry({ estimated: '10.5', actual: '12' }), {
    estimated: 10.5,
    actual: 12,
    remaining: 0,
    updatedAt: '',
  });
});

test('normalizeResourceEntry safely normalizes invalid and negative legacy data', () => {
  assert.deepEqual(normalizeResourceEntry({ estimated: 'invalid', actual: -4 }), {
    estimated: 0,
    actual: 0,
    remaining: 0,
    updatedAt: '',
  });
  assert.equal(normalizeResourceEntry({ actual: 'invalid' }).actual, null);
});

test('normalizeResourceEntry converts supported timestamps to ISO and rejects invalid timestamps', () => {
  const iso = '2026-06-28T12:34:56.000Z';
  assert.equal(normalizeResourceEntry({ updatedAt: iso }).updatedAt, iso);
  assert.equal(normalizeResourceEntry({ updatedAt: new Date(iso) }).updatedAt, iso);
  assert.equal(normalizeResourceEntry({ updatedAt: { toDate: () => new Date(iso) } }).updatedAt, iso);
  assert.equal(normalizeResourceEntry({ updatedAt: { seconds: 1782650096, nanoseconds: 0 } }).updatedAt, iso);
  assert.equal(normalizeResourceEntry({ updatedAt: 'not-a-date' }).updatedAt, '');
  assert.equal(normalizeResourceEntry({ updatedAt: { seconds: Infinity } }).updatedAt, '');
});

test('validateResourceInput rejects negative and non-finite values while allowing blank actual', () => {
  assert.deepEqual(validateResourceInput(3.5, false), { valid: true, value: 3.5 });
  assert.deepEqual(validateResourceInput(NaN, false), { valid: false, value: null });
  assert.deepEqual(validateResourceInput(Infinity, false), { valid: false, value: null });
  assert.deepEqual(validateResourceInput(-1, false), { valid: false, value: null });
  assert.deepEqual(validateResourceInput(NaN, true), { valid: true, value: null });
});

test('mergeResourceEntry preserves metadata and timestamps semantically unchanged values', () => {
  const previous = {
    estimated: '4',
    actual: '2',
    updatedAt: { seconds: 1782650096, nanoseconds: 0 },
    source: 'import',
  };
  assert.deepEqual(mergeResourceEntry(previous, 4, 2, '2027-01-01T00:00:00Z'), {
    estimated: 4,
    actual: 2,
    remaining: 2,
    updatedAt: '2026-06-28T12:34:56.000Z',
    source: 'import',
  });
  assert.equal(
    mergeResourceEntry(previous, 5, 2, '2027-01-01T00:00:00Z').updatedAt,
    '2027-01-01T00:00:00.000Z',
  );
});

test('normalizeProject preserves legacy fields and supplies portfolio defaults', () => {
  const source = {
    code: 'LEG-1',
    type: 'Platform',
    legacyFlag: true,
    projectLevel: 'invalid',
    lifecycle: null,
    ganttWorkstreams: 'legacy-value',
    resources: ['legacy-value'],
  };

  assert.deepEqual(normalizeProject(source), {
    ...source,
    projectLevel: PROJECT_LEVEL.SYSTEM,
    lifecycle: PROJECT_LIFECYCLE.ACTIVE,
    projectType: 'Platform',
    classification: '',
    productFamily: '',
    ganttWorkstreams: [],
    resources: {},
  });
});

test('normalizeProject trims and coerces portfolio text fields', () => {
  const project = normalizeProject({
    type: ' Platform ',
    classification: 42,
    productFamily: '  Power  ',
  });

  assert.equal(project.projectType, 'Platform');
  assert.equal(project.classification, '42');
  assert.equal(project.productFamily, 'Power');
});

test('normalizeProject preserves unknown resource disciplines and known-entry metadata', () => {
  const project = normalizeProject({
    resources: {
      hardware: { estimated: '3', actual: '', source: 'import' },
      quality: { headcount: 2, note: 'legacy discipline' },
    },
  });
  assert.deepEqual(project.resources.hardware, {
    estimated: 3,
    actual: null,
    remaining: null,
    updatedAt: '',
    source: 'import',
  });
  assert.deepEqual(project.resources.quality, { headcount: 2, note: 'legacy discipline' });
});

test('software is a supported project level with its own default workstreams', () => {
  const project = normalizeProject({ projectLevel: PROJECT_LEVEL.SOFTWARE });
  assert.equal(project.projectLevel, 'software');
  assert.deepEqual(
    createDefaultWorkstreams(PROJECT_LEVEL.SOFTWARE).map(item => item.name),
    [...BUILT_IN_WORKSTREAM_TEMPLATES[PROJECT_LEVEL.SOFTWARE]],
  );
});

test('role resource rows are case-insensitive and preserve matching legacy hours', () => {
  const rows = portfolioCore.deriveRoleResourceRows(
    [
      { role: 'Firmware' },
      { roleName: 'firmware' },
      { role: 'Software QA' },
      { role: '' },
    ],
    {
      firmware: { estimated: 120, actual: 40 },
      role_software_qa: { role: 'Software QA', estimated: 80, actual: null },
    },
  );

  assert.deepEqual(rows.map(row => row.label), ['Firmware', 'Software QA']);
  assert.equal(rows[0].key, 'firmware');
  assert.equal(rows[0].entry.estimated, 120);
  assert.equal(rows[1].key, 'role_software_qa');
  assert.equal(rows[1].entry.estimated, 80);
});

test('role resource rows are hidden when allocation is absent or not required', () => {
  assert.deepEqual(portfolioCore.deriveRoleResourceRows([], { hardware: { estimated: 10 } }), []);
  assert.deepEqual(
    portfolioCore.deriveRoleResourceRows([{ role: 'Hardware' }], { hardware: { estimated: 10 } }, true),
    [],
  );
});

test('filterProjects combines portfolio filters and case-insensitive search', () => {
  const projects = [
    {
      code: 'SYS-ALPHA',
      name: 'Orion Controller',
      projectLevel: PROJECT_LEVEL.SYSTEM,
      owner: 'Morgan',
      status: 'yellow',
      lifecycle: PROJECT_LIFECYCLE.ACTIVE,
      productFamily: 'Power',
      projectType: 'Platform',
      classification: 'Internal',
    },
    {
      code: 'HW-BETA',
      name: 'Orion Board',
      projectLevel: PROJECT_LEVEL.HARDWARE_MODULE,
      owner: 'Morgan',
      status: 'yellow',
      lifecycle: PROJECT_LIFECYCLE.ACTIVE,
      productFamily: 'Power',
      projectType: 'Module',
      classification: 'Internal',
    },
    {
      code: 'SYS-GAMMA',
      name: 'Other',
      projectLevel: PROJECT_LEVEL.SYSTEM,
      owner: 'Casey',
      status: 'green',
      lifecycle: PROJECT_LIFECYCLE.COMPLETED,
      productFamily: 'Compute',
      projectType: 'Platform',
      classification: 'Customer',
    },
  ];

  assert.deepEqual(
    filterProjects(projects, {
      scope: PROJECT_LEVEL.SYSTEM,
      pm: 'morgan',
      rag: 'YELLOW',
      lifecycle: PROJECT_LIFECYCLE.ACTIVE,
      productFamily: 'power',
      projectType: 'PLATFORM',
      classification: 'internal',
      search: 'ORION',
    }).map(project => project.code),
    ['SYS-ALPHA'],
  );
});

test('filterProjects combines project type and classification with every portfolio filter', () => {
  const projects = [
    {
      code: 'MATCH',
      projectType: ' Platform ',
      classification: ' Internal ',
      productFamily: 'Power',
    },
    {
      code: 'WRONG-TYPE',
      projectType: 'Module',
      classification: 'Internal',
      productFamily: 'Power',
    },
    {
      code: 'WRONG-CLASS',
      projectType: 'Platform',
      classification: 'Customer',
      productFamily: 'Power',
    },
  ];

  assert.deepEqual(
    filterProjects(projects, {
      scope: 'all',
      projectType: 'platform',
      classification: 'INTERNAL',
      productFamily: 'power',
    }).map(project => project.code),
    ['MATCH'],
  );
});

test('filterProjects all scope does not restrict project level', () => {
  const projects = [
    { code: 'SYS' },
    { code: 'HW', projectLevel: PROJECT_LEVEL.HARDWARE_MODULE },
  ];

  const result = filterProjects(projects, { scope: 'all' });

  assert.deepEqual(result.map(project => project.code), ['SYS', 'HW']);
  assert.equal(result[0].projectLevel, PROJECT_LEVEL.SYSTEM);
  assert.equal(result[0].lifecycle, PROJECT_LIFECYCLE.ACTIVE);
  assert.deepEqual(result[0].ganttWorkstreams, []);
  assert.deepEqual(result[0].resources, {});
});

test('normalizeOverviewScope defaults missing and invalid values to System projects', () => {
  assert.equal(normalizeOverviewScope(), PROJECT_LEVEL.SYSTEM);
  assert.equal(normalizeOverviewScope(''), PROJECT_LEVEL.SYSTEM);
  assert.equal(normalizeOverviewScope('portfolio'), PROJECT_LEVEL.SYSTEM);
  assert.equal(normalizeOverviewScope('all'), 'all');
  assert.equal(normalizeOverviewScope(PROJECT_LEVEL.HARDWARE_MODULE), PROJECT_LEVEL.HARDWARE_MODULE);
});

test('getOverviewProjects returns only the selected Overview population without mutating input', () => {
  const projects = [
    { code: 'SYS', projectLevel: PROJECT_LEVEL.SYSTEM },
    { code: 'MODULE', projectLevel: PROJECT_LEVEL.HARDWARE_MODULE },
    { code: 'LEGACY' },
  ];

  assert.deepEqual(
    getOverviewProjects(projects, PROJECT_LEVEL.SYSTEM).map(project => project.code),
    ['SYS', 'LEGACY'],
  );
  assert.deepEqual(
    getOverviewProjects(projects, PROJECT_LEVEL.HARDWARE_MODULE).map(project => project.code),
    ['MODULE'],
  );
  assert.deepEqual(
    getOverviewProjects(projects, 'all').map(project => project.code),
    ['SYS', 'MODULE', 'LEGACY'],
  );
  assert.equal(projects[2].projectLevel, undefined);
});

test('Overview project badges are emitted only for the mixed All Projects scope', () => {
  assert.equal(
    getOverviewProjectBadgeLabel({ projectLevel: PROJECT_LEVEL.SYSTEM }, 'all'),
    'System',
  );
  assert.equal(
    getOverviewProjectBadgeLabel({ projectLevel: PROJECT_LEVEL.HARDWARE_MODULE }, 'all'),
    'Module',
  );
  assert.equal(
    getOverviewProjectBadgeLabel({ projectLevel: PROJECT_LEVEL.SYSTEM }, PROJECT_LEVEL.SYSTEM),
    '',
  );
  assert.equal(
    getOverviewProjectBadgeLabel({ projectLevel: PROJECT_LEVEL.HARDWARE_MODULE }, PROJECT_LEVEL.HARDWARE_MODULE),
    '',
  );
});

test('Overview display enums and progress are normalized before HTML rendering', () => {
  assert.equal(normalizeOverviewRagStatus('red'), 'red');
  assert.equal(normalizeOverviewRagStatus('red" onmouseover="alert(1)'), 'green');
  assert.equal(normalizeOverviewMilestoneStatus('at-risk'), 'at-risk');
  assert.equal(normalizeOverviewMilestoneStatus('done onclick=alert(1)'), 'to-do');
  assert.equal(normalizeOverviewPercent('42.5'), 42.5);
  assert.equal(normalizeOverviewPercent(-5), 0);
  assert.equal(normalizeOverviewPercent(500), 100);
  assert.equal(normalizeOverviewPercent('not-a-number'), 0);
});

test('role-visible project filtering consistently enforces active-only access', () => {
  const projects = [
    { code: 'ACTIVE', visibility: 'active' },
    { code: 'LEGACY' },
    { code: 'HIDDEN', visibility: 'hidden' },
    { code: 'ARCHIVED', visibility: 'archived' },
  ];

  assert.deepEqual(
    filterRoleVisibleProjects(projects, { role: 'pm' }).map(project => project.code),
    ['ACTIVE', 'LEGACY'],
  );
  assert.deepEqual(
    filterRoleVisibleProjects(projects, { role: 'vip' }).map(project => project.code),
    ['ACTIVE', 'LEGACY'],
  );
  assert.deepEqual(
    filterRoleVisibleProjects(projects, { role: 'admin', visibilityFilter: 'all' }).map(project => project.code),
    ['ACTIVE', 'LEGACY', 'HIDDEN', 'ARCHIVED'],
  );
  assert.deepEqual(
    filterRoleVisibleProjects(projects, { role: 'admin', visibilityFilter: 'all', vipPerspective: true }).map(project => project.code),
    ['ACTIVE', 'LEGACY'],
  );
});

test('Overview scope storage keys are isolated per authenticated identity', () => {
  assert.equal(getOverviewScopeStorageKey('User.One@example.com'), 'team2.overviewScope.User.One%40example.com');
  assert.equal(getOverviewScopeStorageKey('uid/123'), 'team2.overviewScope.uid%2F123');
  assert.notEqual(getOverviewScopeStorageKey('user-a'), getOverviewScopeStorageKey('user-b'));
  assert.notEqual(getOverviewScopeStorageKey('UserA'), getOverviewScopeStorageKey('usera'));
  assert.equal(getOverviewScopeStorageKey(''), '');
});

const summaryProjects = [
  { code: 'SYS-A', name: 'Alpha', projectLevel: PROJECT_LEVEL.SYSTEM },
  { code: 'MOD-A', name: 'Alpha Module', projectLevel: PROJECT_LEVEL.HARDWARE_MODULE },
];

test('Overview summary filtering excludes Module lines from System scope', () => {
  const summary = [
    'WEEKLY MOVEMENT',
    '- Alpha: System work advanced.',
    '- Alpha Module: Module work advanced.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    ['WEEKLY MOVEMENT', '- Alpha: System work advanced.'].join('\n'),
  );
});

test('Overview summary filtering excludes System lines from Module scope', () => {
  const summary = [
    '- SYS-A: System action.',
    '- MOD-A: Module action.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.HARDWARE_MODULE)),
    '- MOD-A: Module action.',
  );
});

test('Overview summary filtering omits every known project line for an empty scope', () => {
  const summary = [
    '- Alpha: System action.',
    '- Alpha Module: Module action.',
  ].join('\n');

  assert.equal(filterOverviewSummaryLines(summary, summaryProjects, []), '');
});

test('Overview summary filtering preserves generic non-project narrative', () => {
  const summary = [
    'Portfolio delivery remains stable.',
    '- Alpha Module: Module action.',
    '',
    'No management decision required.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    ['Portfolio delivery remains stable.', '', 'No management decision required.'].join('\n'),
  );
});

test('Overview summary filtering supports labeled lines and chooses the longest known project identity', () => {
  const summary = [
    '- Alpha weekly status: System-specific update.',
    '- Alpha Module weekly status: Module-specific update.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    '- Alpha weekly status: System-specific update.',
  );
  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.HARDWARE_MODULE)),
    '- Alpha Module weekly status: Module-specific update.',
  );
  const codeSummary = '- MOD-A management ask: Approve the module decision.';
  assert.equal(
    filterOverviewSummaryLines(codeSummary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    '',
  );
  assert.equal(
    filterOverviewSummaryLines(codeSummary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.HARDWARE_MODULE)),
    codeSummary,
  );
});

test('Overview summary filtering removes section headings orphaned by project exclusions', () => {
  const summary = [
    '## WEEKLY MOVEMENT',
    '- Alpha weekly status: System-specific update.',
    '## MANAGEMENT ASK',
    '- Alpha Module weekly status: Module-specific update.',
  ].join('\n');

  assert.equal(filterOverviewSummaryLines(summary, summaryProjects, []), '');
  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    ['## WEEKLY MOVEMENT', '- Alpha weekly status: System-specific update.'].join('\n'),
  );
});

test('Overview summary matching requires a strict identity delimiter boundary', () => {
  const projects = [
    { code: 'MOD', name: 'Alpha', projectLevel: PROJECT_LEVEL.SYSTEM },
  ];
  const summary = [
    '- MODERN weekly status: Generic MODERN narrative.',
    '- Alphabet weekly status: Generic Alphabet narrative.',
    '- MOD weekly status: Known project narrative.',
    '- Alpha weekly status: Known project narrative.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, projects, []),
    [
      '- MODERN weekly status: Generic MODERN narrative.',
      '- Alphabet weekly status: Generic Alphabet narrative.',
    ].join('\n'),
  );
});

test('Overview summary filtering removes nested content owned by an excluded project block', () => {
  const summary = [
    '## Weekly Progress',
    '- Alpha Module weekly status: Module parent.',
    '  - Nested module detail.',
    '    Continuation owned by module.',
    '- Portfolio: Generic sibling remains.',
    '## Support Needed',
    '- Alpha: System parent.',
    '  System continuation.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    [
      '## Weekly Progress',
      '- Portfolio: Generic sibling remains.',
      '## Support Needed',
      '- Alpha: System parent.',
      '  System continuation.',
    ].join('\n'),
  );
  assert.equal(filterOverviewSummaryLines(summary, summaryProjects, []), [
    '## Weekly Progress',
    '- Portfolio: Generic sibling remains.',
  ].join('\n'));
});

test('Overview summary filtering keeps unindented continuation text in an excluded project block', () => {
  const summary = [
    '## Weekly Progress',
    '- Alpha Module weekly status: Module parent.',
    'This unindented sentence still belongs to the excluded module update.',
    '',
    'Portfolio delivery remains stable.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    [
      '## Weekly Progress',
      '',
      'Portfolio delivery remains stable.',
    ].join('\n'),
  );
});

test('Overview summary filtering reprocesses an unbulleted known project after an excluded project', () => {
  const summary = [
    '## Weekly Progress',
    '- Alpha Module: Hidden module update.',
    'Alpha: Visible system update.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    [
      '## Weekly Progress',
      'Alpha: Visible system update.',
    ].join('\n'),
  );
});

test('Overview summary filtering recognizes Markdown-wrapped project identities before sanitizing', () => {
  const summary = [
    '## Weekly Progress',
    '- **Alpha Module:** Hidden module update.',
    '  - Hidden nested detail.',
    '- Portfolio: Generic sibling.',
  ].join('\n');

  assert.equal(
    filterOverviewSummaryLines(summary, summaryProjects, getOverviewProjects(summaryProjects, PROJECT_LEVEL.SYSTEM)),
    ['## Weekly Progress', '- Portfolio: Generic sibling.'].join('\n'),
  );
});

test('Overview summary heading recognition matches every sanitizer heading variant', () => {
  for (const heading of [
    'Weekly Movement',
    'Weekly Progress',
    'Portfolio Movement',
    'Project Movement',
    'Executive Summary',
    'Key Updates',
    'Management Ask',
    'Management Asks',
    'Management Request',
    'Decision Needed',
    'Executive Ask',
    'Support Needed',
  ]) {
    assert.equal(normalizeOverviewSummaryHeading(`## ${heading}:`), heading);
  }
  assert.equal(normalizeOverviewSummaryHeading('This is a sentence.'), '');
});

test('createDefaultWorkstreams returns independent templates for each project level', () => {
  const systems = createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM);
  const modules = createDefaultWorkstreams(PROJECT_LEVEL.HARDWARE_MODULE);
  const secondSystems = createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM);

  assert.deepEqual(systems.map(row => row.name), ['Design', 'Integration', 'Validation', 'Certification', 'Launch']);
  assert.deepEqual(modules.map(row => row.name), ['Documentation', 'BOM Verification', 'Procurement', 'Assembly/Test', 'Certification']);
  systems[0].name = 'Changed';
  assert.equal(secondSystems[0].name, 'Design');
  assert.notStrictEqual(systems, secondSystems);
});

test('workstream template validation trims names and rejects blank, duplicate, and out-of-range lists', () => {
  const valid = validateWorkstreamTemplateConfig({
    system: [' Discovery ', 'Build'],
    'hardware-module': ['Schematic', 'Prototype'],
  });
  assert.deepEqual(valid, {
    valid: true,
    errors: {},
    config: {
      system: ['Discovery', 'Build'],
      'hardware-module': ['Schematic', 'Prototype'],
    },
  });

  const invalid = validateWorkstreamTemplateConfig({
    system: ['Design', ' design ', ''],
    'hardware-module': Array.from({ length: 21 }, (_, index) => `Phase ${index + 1}`),
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.system.join(' '), /blank/i);
  assert.match(invalid.errors.system.join(' '), /unique/i);
  assert.match(invalid.errors['hardware-module'].join(' '), /20/);

  const empty = validateWorkstreamTemplateConfig({
    system: [],
    'hardware-module': ['Assembly'],
  });
  assert.match(empty.errors.system.join(' '), /at least 1/i);
});

test('createDefaultWorkstreams accepts validated config or names and falls back safely', () => {
  const config = {
    system: ['Discover', 'Deliver'],
    'hardware-module': ['Schematic', 'Prototype'],
  };
  const configured = createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM, config);
  const configuredAgain = createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM, config);
  const directNames = createDefaultWorkstreams(PROJECT_LEVEL.HARDWARE_MODULE, ['Layout', 'EVT']);
  assert.deepEqual(configured.map(row => row.name), ['Discover', 'Deliver']);
  assert.deepEqual(directNames.map(row => row.name), ['Layout', 'EVT']);
  assert.deepEqual(configured.map(row => row.id), ['workstream-1', 'workstream-2']);
  assert.notStrictEqual(configured, configuredAgain);

  configured[0].name = 'Changed';
  assert.equal(configuredAgain[0].name, 'Discover');
  config.system[0] = 'Mutated';
  assert.equal(configuredAgain[0].name, 'Discover');
  assert.deepEqual(
    createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM, {
      system: ['Discover', 'Deliver'],
      'hardware-module': ['Schematic', 'Prototype'],
    }).map(row => row.name),
    ['Discover', 'Deliver'],
  );
  assert.deepEqual(
    createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM, {
      system: ['Same', ' same '],
      'hardware-module': ['Valid'],
    }).map(row => row.name),
    BUILT_IN_WORKSTREAM_TEMPLATES.system,
  );
  assert.notStrictEqual(
    createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM),
    createDefaultWorkstreams(PROJECT_LEVEL.SYSTEM),
  );
});

test('normalizeWorkstream supplies safe defaults and preserves a stable identity', () => {
  const source = {
    id: 'ws-custom',
    name: '  Design  ',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    status: 'at-risk',
    progress: '42',
    milestoneId: ' ms-1 ',
    sortOrder: 8,
  };

  assert.deepEqual(normalizeWorkstream(source, 2), {
    id: 'ws-custom',
    name: 'Design',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    status: 'at-risk',
    progress: 42,
    milestoneId: 'ms-1',
    sortOrder: 8,
  });
  assert.equal(normalizeWorkstream({}, 2).id, 'workstream-3');
  assert.equal(normalizeWorkstream({}, 2).id, normalizeWorkstream({}, 2).id);
  assert.equal(normalizeWorkstream({ status: 'unknown', progress: 'bad' }, 0).status, 'not-started');
  assert.equal(normalizeWorkstream({ status: 'unknown', progress: 'bad' }, 0).progress, 0);
});

test('validateWorkstreams reports invalid fields per row', () => {
  const errors = validateWorkstreams([
    { name: ' ', startDate: '2026-08-10', endDate: '2026-08-01', progress: -1 },
    { name: 'Valid', startDate: '', endDate: '', progress: 101 },
  ]);

  assert.deepEqual(errors, [
    {
      index: 0,
      fields: {
        name: 'Name is required.',
        endDate: 'End date cannot be before start date.',
        progress: 'Progress must be between 0 and 100.',
      },
    },
    {
      index: 1,
      fields: {
        progress: 'Progress must be between 0 and 100.',
      },
    },
  ]);
  assert.deepEqual(validateWorkstreams([{ name: 'Design', progress: 0 }]), []);
});

test('parseIsoDate rejects malformed and impossible calendar dates', () => {
  assert.equal(parseIsoDate('2026-02-31'), null);
  assert.equal(parseIsoDate('2026-2-01'), null);
  assert.equal(parseIsoDate('not-a-date'), null);
  assert.equal(parseIsoDate('2026-02-28').toISOString(), '2026-02-28T00:00:00.000Z');
});

test('validateWorkstreams rejects invalid dates and missing milestone links', () => {
  assert.deepEqual(validateWorkstreams([{
    name: 'Design',
    startDate: '2026-02-31',
    endDate: 'bad',
    milestoneId: 'deleted',
  }], ['kept']), [{
    index: 0,
    fields: {
      startDate: 'Enter a valid date.',
      endDate: 'Enter a valid date.',
      milestoneId: 'Select an existing milestone.',
    },
  }]);
});

test('createTimelineTicks coarsens long ranges while preserving both endpoints', () => {
  const start = parseIsoDate('2020-01-01');
  const end = parseIsoDate('2035-12-31');
  const ticks = createTimelineTicks(start, end, 'week', 60);

  assert.ok(ticks.length <= 60);
  assert.equal(ticks[0].getTime(), start.getTime());
  assert.equal(ticks.at(-1).getTime(), end.getTime());
  assert.ok(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1]));
});

test('calculateDropIndex supports before, between, and after all rows', () => {
  const bounds = [{ top: 0, bottom: 40 }, { top: 50, bottom: 90 }, { top: 100, bottom: 140 }];

  assert.equal(calculateDropIndex(-1, bounds), 0);
  assert.equal(calculateDropIndex(75, bounds), 2);
  assert.equal(calculateDropIndex(200, bounds), 3);
});
