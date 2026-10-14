// Chronological ordering of stored reporting weeks (UAT Delivery Trends support).
//
// The dashboard's legacy sort compares "W<n> <year>" labels with numeric localeCompare, which compares the week
// number before the year: "W1 2026" sorts before "W7 2025". That is only correct inside a single year. This module
// orders by (ISO year, ISO week) taken from the stored label. It never guesses: labels that are not a valid
// "W<n> <year>" ISO week (for example a prototype label, W0, W54, or W53 in a 52-week year) are NOT given a date and
// are kept after every valid week, in the legacy order, so an ambiguous label can never become a chronological date.

const LABEL = /^W(\d{1,2}) (\d{4})$/;

function weeksInIsoYear(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}

export function parseWeekLabel(label) {
  const match = LABEL.exec(typeof label === 'string' ? label.trim() : '');
  if (!match) return null;
  const week = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || week < 1 || week > weeksInIsoYear(year)) return null;
  return { year, week };
}

const legacyCompare = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true });

export function sortWeeksChronologically(weeks) {
  const items = (Array.isArray(weeks) ? weeks : []).map((week, index) => ({ week, index, period: parseWeekLabel(week?.weekLabel) }));
  items.sort((a, b) => {
    if (a.period && b.period) return a.period.year - b.period.year || a.period.week - b.period.week || legacyCompare(a.week.weekLabel, b.week.weekLabel) || a.index - b.index;
    if (a.period) return -1;
    if (b.period) return 1;
    return legacyCompare(a.week?.weekLabel, b.week?.weekLabel) || a.index - b.index;
  });
  return items.map(item => item.week);
}
