// Deterministic SYNTHETIC fixtures for presentation tests. Not Production data; every contract says source: "synthetic".
const WEEKS = ['W36', 'W37', 'W38', 'W39', 'W40', 'W41'];

function trendOf(values) {
  return values.map((progressPct, index) => ({ weekId: `2026-${WEEKS[index]}`, label: WEEKS[index], progressPct }));
}

export function syntheticProject(index, overrides = {}) {
  const base = 20 + index * 9;
  return {
    projectId: `syn-${index}`, code: `SYN-${String(index).padStart(3, '0')}`, name: `Synthetic Project ${index}`,
    projectManager: `Synthetic PM ${index}`, currentCompletionPct: base + 5, weeklyChangePp: 2.5, status: ['green', 'yellow', 'red'][index % 3],
    comparable: true, isInAnchorScope: true, trend: trendOf([base - 8, base - 6, base - 3, base, base + 2.5, base + 5]), ...overrides
  };
}

export function syntheticContract(overrides = {}) {
  return {
    contractVersion: 'delivery-trends/v1',
    provenance: { source: 'synthetic', anchorWeekId: '2026-W41', asOf: '2026-10-12T00:00:00.000Z', windowWeeks: 6 },
    status: 'ok',
    summary: { weeklyProgressGainPp: 2.5, comparableCount: 6, projectsProgressedCount: 5, currentCompletionPct: 48.3, health: { green: 3, yellow: 2, red: 1, unknown: 0 } },
    weeklySeries: WEEKS.map((label, index) => ({ weekId: `2026-${label}`, label, gainPp: [1.2, 1.8, 2.1, 1.5, 2.0, 2.5][index], comparableCount: 6 })),
    projects: [1, 2, 3, 4, 5, 6].map(index => syntheticProject(index)),
    changes: { firstObserved: [{ projectId: 'syn-7', code: 'SYN-007', name: 'Synthetic New Project' }], confirmedCompleted: [], missingObservation: [], ambiguousIdentity: [], enteredScope: [], exitedScope: [] },
    warnings: [],
    ...overrides
  };
}

export function zeroGainContract() {
  return syntheticContract({
    summary: { weeklyProgressGainPp: 0, comparableCount: 6, projectsProgressedCount: 0, currentCompletionPct: 48.3, health: { green: 6, yellow: 0, red: 0, unknown: 0 } },
    weeklySeries: syntheticContract().weeklySeries.map(entry => ({ ...entry, gainPp: 0 })),
    projects: [1, 2].map(index => syntheticProject(index, { weeklyChangePp: 0 }))
  });
}

export function missingMetricsContract() {
  return syntheticContract({
    summary: { weeklyProgressGainPp: null, comparableCount: 0, projectsProgressedCount: null, currentCompletionPct: null, health: { green: null, yellow: null, red: null, unknown: null } },
    weeklySeries: syntheticContract().weeklySeries.map(entry => ({ ...entry, gainPp: null, comparableCount: 0 })),
    projects: [syntheticProject(1, { currentCompletionPct: null, weeklyChangePp: null, status: null, comparable: false, trend: trendOf([null, null, null, null, null, null]) })]
  });
}

export function gapContract() {
  const base = syntheticContract();
  return syntheticContract({
    weeklySeries: base.weeklySeries.map((entry, index) => (index === 2 || index === 3 ? { ...entry, gainPp: null, comparableCount: 0 } : entry)),
    projects: [syntheticProject(1, { trend: trendOf([10, 14, null, null, 22, 25]) })]
  });
}

export function negativeContract() {
  return syntheticContract({
    summary: { ...syntheticContract().summary, weeklyProgressGainPp: -3.4 },
    weeklySeries: syntheticContract().weeklySeries.map((entry, index) => (index === 5 ? { ...entry, gainPp: -3.4 } : entry)),
    projects: [syntheticProject(1, { weeklyChangePp: -3.4, status: 'red' })]
  });
}

export function emptyContract() {
  return syntheticContract({
    summary: { weeklyProgressGainPp: null, comparableCount: 0, projectsProgressedCount: null, currentCompletionPct: null, health: { green: 0, yellow: 0, red: 0, unknown: 0 } },
    weeklySeries: [], projects: [], changes: { firstObserved: [], confirmedCompleted: [], missingObservation: [], ambiguousIdentity: [], enteredScope: [], exitedScope: [] }
  });
}

export function largeContract(count = 14) {
  return syntheticContract({ projects: Array.from({ length: count }, (_, index) => syntheticProject(index + 1)) });
}

export function longNameContract() {
  return syntheticContract({
    projects: [
      syntheticProject(1, { name: 'Synthetic Extremely Long Project Name For Next Generation Integrated Platform Validation Programme Phase Two Extended Scope '.repeat(2).trim(), projectManager: 'Synthetic Project Manager With An Unusually Long Display Name And Department Suffix' }),
      syntheticProject(2, { name: 'Supercalifragilisticexpialidocious_unbroken_identifier_'.repeat(4), projectManager: 'A'.repeat(70) }),
      syntheticProject(3)
    ]
  });
}

export function hostileContract() {
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
  return syntheticContract({
    projects: [syntheticProject(1, { name: payload, projectManager: payload, projectId: payload, code: payload })],
    changes: { firstObserved: [{ name: payload }], confirmedCompleted: [payload], missingObservation: [], ambiguousIdentity: [], enteredScope: [], exitedScope: [] },
    weeklySeries: [{ weekId: 'x', label: payload, gainPp: 1, comparableCount: 1 }, { weekId: 'y', label: 'W2', gainPp: 2, comparableCount: 1 }],
    warnings: [payload]
  });
}

export function historicalOnlyContract() {
  const base = syntheticContract();
  return syntheticContract({
    projects: [...base.projects.slice(0, 2), syntheticProject(9, { name: 'Synthetic Historical Only', isInAnchorScope: false, currentCompletionPct: null, weeklyChangePp: null, comparable: false })]
  });
}

export function noScopeFlagContract() {
  const base = syntheticContract();
  return syntheticContract({ projects: base.projects.map(({ isInAnchorScope, ...rest }) => rest) });
}

export function unavailableContract() {
  return syntheticContract({
    status: 'unavailable',
    summary: { weeklyProgressGainPp: null, comparableCount: 0, projectsProgressedCount: null, currentCompletionPct: null, health: { green: 0, yellow: 0, red: 0, unknown: 0 } },
    weeklySeries: [], projects: [], warnings: [{ code: 'invalid-reporting-week', message: 'invalid reporting week', weekId: null, count: 1 }]
  });
}
