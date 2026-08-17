const SAFETY_SUBTYPES = [
  'missing-field',
  'duplicate-field',
  'reversed-fields',
  'empty-field',
  'mixed-field-family',
  'unknown-project',
  'historical-management',
  'markdown-heading',
  'table-input',
  'excessive-asks'
];

function cloneContext(context) {
  return {
    currentProjects: context.currentProjects.map(project => ({ ...project })),
    historicalProjects: context.historicalProjects.map(project => ({ ...project })),
    askCount: context.askCount,
    id: context.id
  };
}

function movementText(number, projectIndex) {
  return {
    movement: `Movement ${number}.${projectIndex} completed.`,
    blocker: 'None',
    nextStep: `Next step ${number}.${projectIndex} confirmed.`
  };
}

function canonicalMovementEntry(projectName, number, projectIndex) {
  const text = movementText(number, projectIndex);
  return [
    `- Project: ${projectName}`,
    `  Movement: ${text.movement}`,
    `  Blocker: ${text.blocker}`,
    `  Next step: ${text.nextStep}`
  ];
}

function canonicalAskEntry(projectName, number, projectIndex) {
  return [
    `- Project: ${projectName}`,
    `  Decision / Support needed: Approve action ${number}.${projectIndex}.`,
    `  Business impact: Protects milestone ${number}.${projectIndex}.`
  ];
}

function allMovementProjects(context) {
  return [
    ...context.currentProjects.map((project, index) => ({ project, index: index + 1 })),
    ...context.historicalProjects.map((project, index) => ({
      project,
      index: context.currentProjects.length + index + 1
    }))
  ];
}

function buildCanonicalSummary(context) {
  const number = context.id.slice(-2);
  const lines = [
    'WEEKLY MOVEMENT',
    `Portfolio Summary: Week ${number} delivery remained controlled.`,
    ''
  ];
  allMovementProjects(context).forEach(({ project, index }) => {
    lines.push(...canonicalMovementEntry(project.name, number, index), '');
  });
  lines.push('MANAGEMENT ASK');
  if (!context.askCount) {
    lines.push('No immediate management decision required this week.');
  } else {
    context.currentProjects.slice(0, context.askCount).forEach((project, index) => {
      lines.push(...canonicalAskEntry(project.name, number, index + 1), '');
    });
    while (lines.at(-1) === '') lines.pop();
  }
  return lines.join('\n');
}

function buildPresentationVariant(context) {
  return buildCanonicalSummary(context)
    .replace(/^\- Project:/gm, 'Project:')
    .replace(/Movement:/g, 'Movement：')
    .replace(/Decision \/ Support needed:/g, 'Decision / Support needed：');
}

function packedMovementEntry(projectName, number, projectIndex, marker = '- Project:') {
  const text = movementText(number, projectIndex);
  return `${marker} ${projectName} Movement: ${text.movement} Blocker: ${text.blocker} Next step: ${text.nextStep}`;
}

function buildPackedMovementSummary(context, variant = 0) {
  const number = context.id.slice(-2);
  const marker = variant % 3 === 1 ? 'Project:' : variant % 3 === 2 ? '• Project:' : '- Project:';
  const first = context.currentProjects[0];
  return [
    `WEEKLY MOVEMENT Portfolio Summary: Week ${number} delivery remained controlled.`,
    packedMovementEntry(first.name, number, 1, marker),
    'MANAGEMENT ASK',
    'No immediate management decision required this week.'
  ].join('\n');
}

function buildPackedHeadingAndAskSummary(context) {
  const number = context.id.slice(-2);
  const first = context.currentProjects[0];
  const text = movementText(number, 1);
  return [
    `WEEKLY MOVEMENT Portfolio Summary: Week ${number} needs one supported decision.`,
    `Project: ${first.name} Movement: ${text.movement} Blocker: None Next step: ${text.nextStep}`,
    `MANAGEMENT ASK - Project: ${first.name} Decision / Support needed: Approve action ${number}.1. Business impact: Protects milestone ${number}.1.`
  ].join('\n');
}

function buildSingleProjectNoAskCanonical(context) {
  const number = context.id.slice(-2);
  return [
    'WEEKLY MOVEMENT',
    `Portfolio Summary: Week ${number} delivery remained controlled.`,
    ...canonicalMovementEntry(context.currentProjects[0].name, number, 1),
    'MANAGEMENT ASK',
    'No immediate management decision required this week.'
  ].join('\n');
}

function buildSingleProjectAskCanonical(context) {
  const number = context.id.slice(-2);
  return [
    'WEEKLY MOVEMENT',
    `Portfolio Summary: Week ${number} needs one supported decision.`,
    ...canonicalMovementEntry(context.currentProjects[0].name, number, 1),
    'MANAGEMENT ASK',
    ...canonicalAskEntry(context.currentProjects[0].name, number, 1)
  ].join('\n');
}

function buildSafetyNegative(context, subtype) {
  const number = context.id.slice(-2);
  const first = context.currentProjects[0];
  const packed = packedMovementEntry(first.name, number, 1);
  const base = [
    `WEEKLY MOVEMENT Portfolio Summary: Week ${number} delivery remained controlled.`,
    packed,
    'MANAGEMENT ASK',
    'No immediate management decision required this week.'
  ];
  switch (subtype) {
    case 'missing-field':
      base[1] = `- Project: ${first.name} Movement: Movement ${number}.1 completed. Blocker: None.`;
      return base.join('\n');
    case 'duplicate-field':
      base[1] = `${packed} Blocker: None`;
      return base.join('\n');
    case 'reversed-fields':
      base[1] = `- Project: ${first.name} Movement: Movement ${number}.1 completed. Next step: Next step ${number}.1 confirmed. Blocker: None.`;
      return base.join('\n');
    case 'empty-field':
      base[1] = `- Project: ${first.name} Movement: Movement ${number}.1 completed. Blocker: None Next step:`;
      return base.join('\n');
    case 'mixed-field-family':
      return [
        base[0],
        base[1],
        `MANAGEMENT ASK - Project: ${first.name} Decision / Support needed: Approve action ${number}.1. Next step: Wrong family. Business impact: Protects milestone ${number}.1.`
      ].join('\n');
    case 'unknown-project':
      base[1] = packedMovementEntry(`Week ${number} / Unknown Project`, number, 1);
      return base.join('\n');
    case 'historical-management': {
      const historical = context.historicalProjects[0]?.name || `Week ${number} / Historical Only`;
      return [
        base[0],
        base[1],
        'MANAGEMENT ASK',
        ...canonicalAskEntry(historical, number, 1)
      ].join('\n');
    }
    case 'markdown-heading':
      base[0] = `## ${base[0]}`;
      return base.join('\n');
    case 'table-input':
      base[1] = `| Project | ${first.name} | Movement | Blocker | Next step |`;
      return base.join('\n');
    case 'excessive-asks': {
      const asks = Array.from({ length: 5 }, (_, index) => canonicalAskEntry(first.name, number, index + 1)).flat();
      return [base[0], base[1], 'MANAGEMENT ASK', ...asks].join('\n');
    }
    default:
      throw new Error(`Unknown safety subtype: ${subtype}`);
  }
}

export function buildSyntheticWeekContexts() {
  return Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    const currentProjects = Array.from({ length: (index % 6) + 1 }, (_, projectIndex) => ({
      name: `Week ${number} / Project ${projectIndex + 1}${projectIndex === 0 && index % 4 === 0 ? ' · R&D' : ''}`
    }));
    const historicalProjects = index % 2 === 0
      ? [{ name: `Week ${number} / Released Project` }]
      : [];
    return { id: `week-${number}`, currentProjects, historicalProjects, askCount: index % 5 };
  });
}

function acceptedCase(id, source, context, family, expectedCanonical, minimumCorrections = 0) {
  return {
    id,
    source,
    sourceType: 'synthetic',
    observed: false,
    context: cloneContext(context),
    expected: 'accept',
    expectedCanonical,
    family,
    minimumCorrections
  };
}

function rejectedCase(id, source, context, subtype, expectedError) {
  return {
    id,
    source,
    sourceType: 'synthetic',
    observed: false,
    context: cloneContext(context),
    expected: 'reject',
    family: 'safety-negative',
    expectedError,
    safetySubtype: subtype
  };
}

export const weeklySummaryCorpus = buildSyntheticWeekContexts().flatMap(context => {
  const number = context.id.slice(-2);
  const canonical = buildCanonicalSummary(context);
  const presentation = buildPresentationVariant(context);
  const packedMovement = buildPackedMovementSummary(context);
  const packedHeadingAndAsk = buildPackedHeadingAndAskSummary(context);
  const safety = SAFETY_SUBTYPES[(Number(number) - 1) % SAFETY_SUBTYPES.length];
  const safetyOccurrence = Math.floor((Number(number) - 1) / SAFETY_SUBTYPES.length);
  const errorBySubtype = {
    'missing-field': 'expected "Movement:"',
    'duplicate-field': 'expected "Movement:"',
    'reversed-fields': 'expected "Movement:"',
    'empty-field': 'expected "Movement:"',
    'mixed-field-family': 'missing "Decision / Support needed:"',
    'unknown-project': 'not an active project name',
    'historical-management': 'must be a current active project',
    'markdown-heading': 'Markdown heading',
    'table-input': 'Markdown heading',
    'excessive-asks': 'at most four'
  };
  return [
    acceptedCase(`week-${number}-canonical`, canonical, context, 'canonical', canonical),
    acceptedCase(`week-${number}-presentation-variant`, presentation, context, 'presentation-variant', canonical, 1),
    acceptedCase(`week-${number}-packed-movement`, packedMovement, context, 'packed-movement', buildSingleProjectNoAskCanonical(context), 2),
    acceptedCase(`week-${number}-packed-heading-and-ask`, packedHeadingAndAsk, context, 'packed-heading-and-ask', buildSingleProjectAskCanonical(context), 3),
    rejectedCase(
      `week-${number}-safety-${safety}-${safetyOccurrence + 1}`,
      buildSafetyNegative(context, safety),
      context,
      safety,
      safety === 'historical-management' && !context.historicalProjects.length
        ? 'not an active project name'
        : errorBySubtype[safety]
    )
  ];
});

export function buildDeterministicPackedMutations() {
  const mutations = [];
  for (const context of buildSyntheticWeekContexts()) {
    const number = context.id.slice(-2);
    for (let variant = 0; variant < 50; variant += 1) {
      const source = buildPackedMovementSummary(context, variant);
      mutations.push({
        id: `${context.id}-packed-mutation-${String(variant + 1).padStart(2, '0')}`,
        source,
        sourceType: 'synthetic',
        observed: false,
        context: cloneContext(context),
        expected: 'accept',
        family: 'packed-movement',
        expectedCanonical: buildSingleProjectNoAskCanonical(context)
      });
    }
  }
  return mutations;
}
