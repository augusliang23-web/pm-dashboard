import { parseIsoDate } from './date-utils.js';

const MAX_LANES = 8;
const LOW_CONFIDENCE_MIN_WORKSTREAMS = 4;
const RISK_STATUSES = new Set(['at-risk', 'delayed', 'risk']);
const STATUS_SEVERITY = {
  delayed: 4, 'at-risk': 3, risk: 3,
  'in-progress': 2, 'on-track': 2, yellow: 2,
  'not-started': 1, planned: 1, red: 4, green: 1,
  completed: 0, done: 0
};
const DAY_MS = 86400000;

function slug(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Derives a grouping "stem" from a workstream name by stripping a trailing
 * discipline/number suffix, e.g. "Design - Mechanical" / "Design 2" both stem to "Design".
 */
function keywordStem(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const separated = trimmed.split(/\s*(?:[-–—/|:]|\s\(|,)\s*/)[0].trim();
  const withoutTrailingNumber = separated.replace(/\s*\b(?:phase\s*)?\d+\b\s*$/i, '').trim();
  return withoutTrailingNumber || separated || trimmed;
}

function milestoneLabel(milestone) {
  return String(milestone?.name || milestone?.title || '').trim();
}

function milestoneKey(milestone) {
  return String(milestone?.id || milestone?.planId || '').trim();
}

function workstreamSeverity(workstream) {
  const status = String(workstream?.status || '').toLowerCase();
  return STATUS_SEVERITY[status] ?? 1;
}

function isRiskStatus(status) {
  return RISK_STATUSES.has(String(status || '').toLowerCase());
}

function laneRange(workstreams) {
  const dated = workstreams
    .map(item => ({ start: parseIsoDate(item.startDate), end: parseIsoDate(item.endDate) }))
    .filter(item => item.start && item.end);
  if (!dated.length) return { start: null, end: null };
  return {
    start: new Date(Math.min(...dated.map(item => item.start.getTime()))),
    end: new Date(Math.max(...dated.map(item => item.end.getTime())))
  };
}

function laneStatus(workstreams) {
  let worst = workstreams[0]?.status || 'not-started';
  let worstSeverity = -1;
  workstreams.forEach(item => {
    const severity = workstreamSeverity(item);
    if (severity > worstSeverity) {
      worstSeverity = severity;
      worst = item.status || 'not-started';
    }
  });
  return worst;
}

function weightedAverageProgress(workstreams) {
  const weighted = workstreams.map(item => {
    const start = parseIsoDate(item.startDate);
    const end = parseIsoDate(item.endDate);
    const days = start && end && end >= start ? Math.round((end - start) / DAY_MS) + 1 : 1;
    return { progress: Number(item.progress) || 0, weight: Math.max(days, 1) };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const totalProgress = weighted.reduce((sum, item) => sum + item.progress * item.weight, 0);
  return Math.round(totalProgress / totalWeight);
}

/**
 * Groups detailed workstreams into 4-8 management-summary lanes.
 * Priority: PM-assigned summaryGroupId > linked milestone > keyword stem of the name.
 * Groups containing an at-risk/delayed workstream are never merged away, even if
 * that pushes the lane count above 8 - visibility of risk wins over the target count.
 */
export function buildSummaryLanes({ workstreams = [], milestones = [], pdfSummaryLanes = [] } = {}) {
  const rows = Array.isArray(workstreams) ? workstreams : [];
  const milestoneById = new Map(
    (Array.isArray(milestones) ? milestones : [])
      .map(milestone => [milestoneKey(milestone), milestone])
      .filter(([key]) => key)
  );
  const laneOverrideById = new Map(
    (Array.isArray(pdfSummaryLanes) ? pdfSummaryLanes : [])
      .map(lane => [String(lane?.id || ''), lane])
      .filter(([key]) => key)
  );

  if (!rows.length) return { lanes: [], lowConfidence: false, ungroupedCount: 0 };

  let fallbackSignalCount = 0;
  const groups = new Map();
  const groupOrder = [];

  rows.forEach(row => {
    const manualId = String(row?.summaryGroupId || '').trim();
    const linkedMilestone = milestoneById.get(String(row?.milestoneId || '').trim());
    let key;
    let label;
    let source;

    if (manualId) {
      key = `manual:${manualId}`;
      label = laneOverrideById.get(manualId)?.label || keywordStem(row.name) || 'Workstream';
      source = 'manual';
    } else if (linkedMilestone) {
      key = `milestone:${milestoneKey(linkedMilestone)}`;
      label = milestoneLabel(linkedMilestone) || 'Milestone';
      source = 'milestone';
    } else {
      const stem = keywordStem(row.name);
      key = `auto:${slug(stem) || 'general'}`;
      label = titleCase(stem) || 'General work';
      source = 'keyword';
      fallbackSignalCount += 1;
    }

    if (!groups.has(key)) {
      groups.set(key, { id: key, label, source, workstreams: [] });
      groupOrder.push(key);
    }
    groups.get(key).workstreams.push(row);
  });

  let lanes = groupOrder.map(key => groups.get(key));

  const canMerge = lane => !lane.workstreams.some(item => isRiskStatus(item.status));

  while (lanes.length > MAX_LANES) {
    const mergeable = lanes.filter(canMerge);
    if (mergeable.length < 2) break;

    const withRange = mergeable.map(lane => ({ lane, range: laneRange(lane.workstreams) }));
    let bestPair = null;
    let bestGapDays = Infinity;
    for (let i = 0; i < withRange.length; i += 1) {
      for (let j = i + 1; j < withRange.length; j += 1) {
        const a = withRange[i];
        const b = withRange[j];
        const gap = a.range.end && b.range.start
          ? Math.abs((b.range.start - a.range.end) / DAY_MS)
          : Number.MAX_SAFE_INTEGER;
        if (gap < bestGapDays) {
          bestGapDays = gap;
          bestPair = [a.lane, b.lane];
        }
      }
    }
    if (!bestPair) break;

    const [first, second] = bestPair;
    first.workstreams = [...first.workstreams, ...second.workstreams];
    first.merged = true;
    lanes = lanes.filter(lane => lane !== second);
  }

  const result = lanes.map(lane => {
    const range = laneRange(lane.workstreams);
    const override = lane.id.startsWith('manual:') ? laneOverrideById.get(lane.id.slice('manual:'.length)) : null;
    const hasRisk = lane.workstreams.some(item => isRiskStatus(item.status));
    return {
      id: lane.id,
      label: override?.label || lane.label,
      start: range.start ? range.start.toISOString().slice(0, 10) : '',
      end: range.end ? range.end.toISOString().slice(0, 10) : '',
      status: laneStatus(lane.workstreams),
      progress: override?.progress !== null && override?.progress !== undefined && override?.progress !== ''
        && Number.isFinite(Number(override.progress))
        ? Math.min(100, Math.max(0, Number(override.progress)))
        : weightedAverageProgress(lane.workstreams),
      suggestedProgress: weightedAverageProgress(lane.workstreams),
      hasRisk,
      workstreamIds: lane.workstreams.map(item => item.id),
      workstreamCount: lane.workstreams.length
    };
  }).sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));

  return {
    lanes: result,
    lowConfidence: rows.length >= LOW_CONFIDENCE_MIN_WORKSTREAMS && fallbackSignalCount / rows.length > 0.5,
    ungroupedCount: fallbackSignalCount
  };
}
