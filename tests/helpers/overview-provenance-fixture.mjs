// SYNTHETIC Firestore-shaped history. No Production records, names or progress values.
export function overviewHistory() {
  return Array.from({ length: 14 }, (_, index) => {
    const week = 30 + index;
    const monday = Date.UTC(2026, 0, 4) - 6 * 86400000 + (week - 1) * 7 * 86400000;
    const md = time => new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return { weekId: `W${week}-2026`, weekLabel: `W${week} 2026`,
      weekDate: `${md(monday)} - ${md(monday + 4 * 86400000)}`,
      isReleased: week !== 43, version: 1, summary: 'Synthetic acceptance fixture',
      projects: ['A', 'B', 'C'].map((code, i) => ({ code: `SYN-${code}`, name: `測試專案 ${code}`,
        owner: i === 1 ? 'Synthetic PM B' : 'Synthetic PM A', progress: index * 2 + i * 10,
        projectLevel: 'system', visibility: 'active', lifecycle: 'active', status: 'green',
        milestones: [], quarterlyMilestones: [] })) };
  });
}
