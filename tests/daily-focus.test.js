const { test } = require('node:test');
const assert = require('node:assert');
const df = require('../daily-focus.js');

function fixture() {
  return { preamble: '', sections: [
    { name: '短期任务', comment: null, items: [
      { id:'a', text:'写方案', completed:false, today:true, order:0 },
      { id:'b', text:'打电话', completed:false, today:true, order:1 },
      { id:'c', text:'读书', completed:false, today:false, order:2 },
    ]},
    { name: '中长期', comment: null, items: [
      { id:'d', text:'写宪章', completed:false, today:false, order:0 },
    ]},
  ]};
}

test('getMustDoItems 只返回 today 项', () => {
  const ids = df.getMustDoItems(fixture()).map(i => i.id);
  assert.deepStrictEqual(ids, ['a', 'b']);
});

test('countMustDo 计数正确', () => {
  assert.strictEqual(df.countMustDo(fixture()), 2);
});

test('canAddMustDo 在 <3 时为 true', () => {
  assert.strictEqual(df.canAddMustDo(fixture()), true);
});

test('canAddMustDo 在 =3 时为 false', () => {
  const d = fixture();
  d.sections[0].items[2].today = true; // 第三个
  assert.strictEqual(df.canAddMustDo(d), false);
});

test('allMustDoComplete:有未完成时 false', () => {
  assert.strictEqual(df.allMustDoComplete(fixture()), false);
});

test('allMustDoComplete:全部完成时 true', () => {
  const d = fixture();
  d.sections[0].items[0].completed = true;
  d.sections[0].items[1].completed = true;
  assert.strictEqual(df.allMustDoComplete(d), true);
});

test('allMustDoComplete:无必做时 false', () => {
  const d = fixture();
  d.sections[0].items.forEach(i => i.today = false);
  assert.strictEqual(df.allMustDoComplete(d), false);
});

test('buildDayRecord 汇总必做与超额', () => {
  const d = fixture();
  d.sections[0].items[0].completed = true;       // 必做完成 1
  const rec = df.buildDayRecord(d, ['回复邮件', '健身']);
  assert.strictEqual(rec.mustDoTotal, 2);
  assert.strictEqual(rec.mustDoCompleted, 1);
  assert.deepStrictEqual(rec.overAchieved, ['回复邮件', '健身']);
});

test('buildDayRecord 对超额去重', () => {
  const rec = df.buildDayRecord(fixture(), ['读书', '读书']);
  assert.deepStrictEqual(rec.overAchieved, ['读书']);
});

test('addDays 跨月正确', () => {
  assert.strictEqual(df.addDays('2026-06-30', 1), '2026-07-01');
  assert.strictEqual(df.addDays('2026-03-01', -1), '2026-02-28');
});

test('computeStreak 连续达成', () => {
  const h = {
    '2026-06-21': { mustDoTotal:1, mustDoCompleted:1, overAchieved:[] },
    '2026-06-22': { mustDoTotal:2, mustDoCompleted:2, overAchieved:[] },
    '2026-06-23': { mustDoTotal:2, mustDoCompleted:2, overAchieved:[] },
  };
  assert.strictEqual(df.computeStreak(h, '2026-06-23'), 3);
});

test('computeStreak 今天未达成则从昨天算', () => {
  const h = {
    '2026-06-22': { mustDoTotal:2, mustDoCompleted:2, overAchieved:[] },
    '2026-06-23': { mustDoTotal:2, mustDoCompleted:1, overAchieved:[] },
  };
  assert.strictEqual(df.computeStreak(h, '2026-06-23'), 1);
});

test('computeStreak 断裂', () => {
  const h = {
    '2026-06-20': { mustDoTotal:1, mustDoCompleted:1, overAchieved:[] },
    '2026-06-22': { mustDoTotal:1, mustDoCompleted:1, overAchieved:[] },
    '2026-06-23': { mustDoTotal:1, mustDoCompleted:1, overAchieved:[] },
  };
  assert.strictEqual(df.computeStreak(h, '2026-06-23'), 2);
});

test('tallyOverAchieved 区间求和', () => {
  const h = {
    '2026-06-21': { mustDoTotal:1, mustDoCompleted:1, overAchieved:['x'] },
    '2026-06-23': { mustDoTotal:1, mustDoCompleted:1, overAchieved:['y','z'] },
  };
  assert.strictEqual(df.tallyOverAchieved(h, '2026-06-21', '2026-06-23'), 3);
});
