const PROGRESS_LEVELS = new Set([0, 25, 50, 75, 100]);
const HEALTH_LEVELS = new Set(['on-track', 'at-risk', 'delayed']);
const RAG_LEVELS = new Set(['green', 'yellow', 'red']);
const RAG_TO_HEALTH = Object.freeze({ green: 'on-track', yellow: 'at-risk', red: 'delayed' });
const HEALTH_TO_RAG = Object.freeze({ 'on-track': 'green', 'at-risk': 'yellow', delayed: 'red' });
const SOURCE_TYPES = new Set(['milestone', 'quarterly']);

function sourceValues(sources) {
  if (Array.isArray(sources)) return sources;
  if (sources && typeof sources === 'object') {
    return Object.keys(sources).sort().map(key => sources[key]);
  }
  return [];
}

function normalizeSource(source = {}) {
  const type = SOURCE_TYPES.has(source.type) ? source.type : 'milestone';
  return {
    projectCode: String(source.projectCode || ''),
    type,
    milestoneId: String(source.milestoneId || ''),
  };
}

export function executiveSourceKey(source = {}) {
  const normalized = normalizeSource(source);
  return `${normalized.type}|${normalized.projectCode}|${normalized.milestoneId}`;
}

export function normalizeExecutiveOutcome(source = '') {
  if (typeof source === 'string') {
    return {
      id: '',
      text: source,
      version: 0,
      rag: 'green',
      latestStatusText: '',
      latestStatusAt: '',
      latestStatusBy: '',
      progressMode: 'manual',
      manualProgress: 0,
      manualHealth: 'on-track',
      statusReason: '',
      statusUpdatedAt: '',
      statusUpdatedBy: '',
      sources: [],
    };
  }
  const progress = Number(source.manualProgress);
  const legacyHealth = source.status || source.manualHealth;
  const rag = RAG_LEVELS.has(source.rag)
    ? source.rag
    : HEALTH_TO_RAG[legacyHealth] || 'green';
  return {
    id: String(source.id || ''),
    text: String(source.text || source.label || ''),
    version: Math.max(0, Number.parseInt(source.version, 10) || 0),
    rag,
    latestStatusText: String(source.latestStatusText || '').trim(),
    latestStatusAt: String(source.latestStatusAt || ''),
    latestStatusBy: String(source.latestStatusBy || ''),
    progressMode: source.progressMode === 'auto' ? 'auto' : 'manual',
    manualProgress: PROGRESS_LEVELS.has(progress) ? progress : 0,
    manualHealth: RAG_TO_HEALTH[rag],
    statusReason: String(source.statusReason || source.reason || '').trim(),
    statusUpdatedAt: String(source.statusUpdatedAt || ''),
    statusUpdatedBy: String(source.statusUpdatedBy || ''),
    sources: sourceValues(source.sources)
      .map(normalizeSource)
      .filter(item => item.projectCode && item.milestoneId)
      .slice(0, 3),
  };
}

function displayHealth(value, overdue = false) {
  if (overdue || value === 'red' || value === 'delayed') return 'red';
  if (value === 'yellow' || value === 'at-risk') return 'yellow';
  return 'green';
}

export function executiveOutcomeStatusLabel(progress, health) {
  if (Number(progress) === 100) return 'Achieved / Done';
  const normalizedHealth = displayHealth(health);
  if (normalizedHealth === 'red') return 'Delayed';
  if (normalizedHealth === 'yellow') return 'At Risk';
  return 'On Track';
}

export function normalizeExecutiveCategoryOverride(source = {}) {
  const progress = Number(source.progress);
  const reason = String(source.reason || '').trim();
  return {
    enabled: source.enabled === true && reason.length > 0,
    progress: PROGRESS_LEVELS.has(progress) ? progress : 0,
    health: HEALTH_LEVELS.has(source.health) ? source.health : 'on-track',
    reason,
  };
}

export function calculateExecutiveCategory(outcomes = [], override = {}) {
  const valid = outcomes.filter(item => Number.isFinite(item?.progress));
  const automaticProgress = valid.length
    ? Math.round(valid.reduce((sum, item) => sum + Math.max(0, Math.min(100, item.progress)), 0) / valid.length)
    : null;
  const automaticHealth = valid.some(item => displayHealth(item.health, item.overdue) === 'red')
    ? 'red'
    : valid.some(item => displayHealth(item.health, item.overdue) === 'yellow') ? 'yellow' : 'green';
  const manual = normalizeExecutiveCategoryOverride(override);
  const progress = manual.enabled ? manual.progress : automaticProgress;
  const health = manual.enabled ? displayHealth(manual.health) : automaticHealth;
  return {
    progress,
    health,
    status: progress === 100
      ? 'done'
      : health === 'red' ? 'delayed' : health === 'yellow' ? 'at-risk' : 'on-track',
    overridden: manual.enabled,
    reason: manual.enabled ? manual.reason : '',
  };
}

export function calculateExecutiveOutcome(source, sourceLookup = {}) {
  const outcome = normalizeExecutiveOutcome(source);
  if (outcome.progressMode === 'manual') {
    return {
      progress: outcome.manualProgress,
      health: displayHealth(outcome.manualHealth),
      mode: 'manual',
      validSources: [],
      missingSources: [],
    };
  }

  const validSources = [];
  const missingSources = [];
  for (const reference of outcome.sources) {
    const evidence = sourceLookup[executiveSourceKey(reference)];
    if (evidence) validSources.push({ reference, ...evidence });
    else missingSources.push(reference);
  }
  if (!validSources.length) {
    return {
      progress: null,
      health: 'unknown',
      mode: 'auto',
      validSources,
      missingSources,
    };
  }

  const progress = Math.round(
    validSources.reduce((sum, item) => {
      const value = Number(item.progress);
      return sum + Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    }, 0) / validSources.length,
  );
  const health = validSources.reduce((worst, item) => {
    const current = displayHealth(item.health, item.overdue);
    if (current === 'red' || worst === 'red') return 'red';
    if (current === 'yellow' || worst === 'yellow') return 'yellow';
    return 'green';
  }, 'green');
  return {
    progress,
    health,
    mode: 'auto',
    validSources,
    missingSources,
  };
}

export function serializeExecutiveOutcome(source) {
  const outcome = normalizeExecutiveOutcome(source);
  return {
    ...outcome,
    status: RAG_TO_HEALTH[outcome.rag],
    sources: Object.fromEntries(
      outcome.sources.map((item, index) => [`source${index + 1}`, item]),
    ),
  };
}
