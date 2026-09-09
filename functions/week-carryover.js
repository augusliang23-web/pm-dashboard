function cloneFirestoreData(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyPreviousWeekCarryover(previousWeek = {}) {
  const projects = cloneFirestoreData(previousWeek.projects || [])
    .filter(project => !project.visibility || project.visibility === 'active');
  const carryover = { projects };

  if (previousWeek.strategyLayer) {
    carryover.strategyLayer = cloneFirestoreData(previousWeek.strategyLayer);
  }

  return carryover;
}

module.exports = { copyPreviousWeekCarryover };
