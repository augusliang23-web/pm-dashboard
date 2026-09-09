import { serializeExecutiveOutcome } from './js/executive-outcomes.mjs';

export function getExecutiveTimelineCell(cells, index) {
  if (Array.isArray(cells)) {
    return cells[index] ?? [];
  }
  return cells?.[`q${index + 1}`] ?? [];
}

export function getExecutiveTimelineItemText(item) {
  if (item && typeof item === 'object') {
    return String(item.text || item.label || '');
  }
  return String(item || '');
}

function mergeTimelineItem(item, existingItems, index, usedIndexes) {
  if (item && typeof item === 'object') {
    const serialized = serializeExecutiveOutcome(item);
    return { ...item, ...serialized, sources: serialized.sources };
  }
  const text = getExecutiveTimelineItemText(item).trim();
  if (!text) return null;

  let existingIndex = existingItems.findIndex((candidate, candidateIndex) => (
    !usedIndexes.has(candidateIndex)
    && candidate
    && typeof candidate === 'object'
    && getExecutiveTimelineItemText(candidate) === text
  ));
  if (
    existingIndex < 0
    && existingItems[index]
    && typeof existingItems[index] === 'object'
    && !usedIndexes.has(index)
  ) {
    existingIndex = index;
  }
  if (existingIndex < 0) return text;

  usedIndexes.add(existingIndex);
  const serialized = serializeExecutiveOutcome({ ...existingItems[existingIndex], text });
  return { ...existingItems[existingIndex], ...serialized, sources: serialized.sources };
}

export function serializeExecutiveMilestoneTimeline(timeline = {}, existingTimeline = {}) {
  const existingRows = existingTimeline.rows || [];
  return {
    ...timeline,
    rows: (timeline.rows || []).map((row, rowIndex) => {
      const existingRow = existingRows.find(item => item?.label === row.label) || existingRows[rowIndex] || {};
      return {
        ...row,
        cells: Object.fromEntries(
          Array.from({ length: 4 }, (_, index) => {
          const value = getExecutiveTimelineCell(row.cells, index);
          const existingItems = getExecutiveTimelineCell(existingRow.cells, index);
          const safeExistingItems = Array.isArray(existingItems) ? existingItems : [];
          const usedIndexes = new Set();
          const items = Array.isArray(value)
            ? value
              .map((item, itemIndex) => mergeTimelineItem(item, safeExistingItems, itemIndex, usedIndexes))
              .filter(Boolean)
            : String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
          return [`q${index + 1}`, items];
          })
        )
      };
    })
  };
}
