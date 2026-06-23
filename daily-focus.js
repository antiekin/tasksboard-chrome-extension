// daily-focus.js — pure logic for the "today must-do" model. No DOM, no chrome.
const MAX_MUST_DO = 3;

function getMustDoItems(todoData) {
  const out = [];
  for (const section of (todoData.sections || [])) {
    for (const item of section.items) {
      if (item.today) out.push(item);
    }
  }
  return out;
}

function countMustDo(todoData) {
  return getMustDoItems(todoData).length;
}

function canAddMustDo(todoData) {
  return countMustDo(todoData) < MAX_MUST_DO;
}

function allMustDoComplete(todoData) {
  const mustDo = getMustDoItems(todoData);
  return mustDo.length > 0 && mustDo.every(i => i.completed);
}

function buildDayRecord(todoData, extraCompletions) {
  const mustDo = getMustDoItems(todoData);
  const overAchieved = [...new Set(extraCompletions || [])];
  return {
    mustDoTotal: mustDo.length,
    mustDoCompleted: mustDo.filter(i => i.completed).length,
    overAchieved,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_MUST_DO, getMustDoItems, countMustDo, canAddMustDo, allMustDoComplete, buildDayRecord };
}
