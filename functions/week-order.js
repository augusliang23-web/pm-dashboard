// Chronological ordering of stored reporting weeks.
// Matches js/week-order.mjs exactly in CommonJS format for Cloud Functions.

const LABEL = /^W(\d{1,2}) (\d{4})$/;

function weeksInIsoYear(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}

function parseWeekLabel(label) {
  const match = LABEL.exec(typeof label === 'string' ? label.trim() : '');
  if (!match) return null;
  const week = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || week < 1 || week > weeksInIsoYear(year)) return null;
  return { year, week };
}

const legacyCompare = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true });

function sortWeeksChronologically(weeks) {
  const items = (Array.isArray(weeks) ? weeks : []).map((week, index) => ({ week, index, period: parseWeekLabel(week?.weekLabel) }));
  items.sort((a, b) => {
    if (a.period && b.period) return a.period.year - b.period.year || a.period.week - b.period.week || legacyCompare(a.week.weekLabel, b.week.weekLabel) || a.index - b.index;
    if (a.period) return -1;
    if (b.period) return 1;
    return legacyCompare(a.week?.weekLabel, b.week?.weekLabel) || a.index - b.index;
  });
  return items.map(item => item.week);
}

function latestValidWeekIndex(weeks) {
  const list = Array.isArray(weeks) ? weeks : [];
  for (let index = list.length - 1; index >= 0; index -= 1) if (parseWeekLabel(list[index]?.weekLabel)) return index;
  return -1;
}

module.exports = {
  parseWeekLabel,
  sortWeeksChronologically,
  latestValidWeekIndex,
};
