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

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);          // 本地时间,避免 UTC 偏移
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isAchieved(rec) {
  return !!rec && rec.mustDoTotal > 0 && rec.mustDoCompleted === rec.mustDoTotal;
}

function computeStreak(history, todayStr) {
  let streak = 0;
  let cursor = todayStr;
  if (!isAchieved(history[cursor])) cursor = addDays(cursor, -1); // 今天没达成则从昨天算
  while (isAchieved(history[cursor])) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function tallyOverAchieved(history, fromStr, toStr) {
  let total = 0;
  let cursor = fromStr;
  while (cursor <= toStr) {
    const rec = history[cursor];
    if (rec && Array.isArray(rec.overAchieved)) total += rec.overAchieved.length;
    cursor = addDays(cursor, 1);
  }
  return total;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_MUST_DO, getMustDoItems, countMustDo, canAddMustDo, allMustDoComplete, buildDayRecord, addDays, computeStreak, tallyOverAchieved, isAchieved };
}
