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
