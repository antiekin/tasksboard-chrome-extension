const { test } = require('node:test');
const assert = require('node:assert');
const TodoSync = require('../todo-sync.js');
const ts = new TodoSync({});

test('解析 #今日 → today=true 且从文本剥离', () => {
  const md = '# T\n## 短期任务\n- [ ] [S] 写方案 #工作 #今日\n';
  const data = ts.parseTodoMarkdown(md);
  const item = data.sections[0].items[0];
  assert.strictEqual(item.today, true);
  assert.strictEqual(item.text, '写方案');
  assert.strictEqual(item.category, '工作');
  assert.strictEqual(item.priority, 'S');
});

test('无 #今日 → today=false', () => {
  const md = '# T\n## 短期任务\n- [ ] 读书 #学习\n';
  const item = ts.parseTodoMarkdown(md).sections[0].items[0];
  assert.strictEqual(item.today, false);
  assert.strictEqual(item.text, '读书');
});

test('round-trip 保留 #今日', () => {
  const md = '# T\n## 短期任务\n- [ ] [A] 写方案 #工作 #今日\n';
  const data = ts.parseTodoMarkdown(md);
  const out = ts.toMarkdown(data);
  assert.match(out, /- \[ \] \[A\] 写方案 #工作 #今日/);
});

test('today=false 不输出 #今日', () => {
  const md = '# T\n## 短期任务\n- [ ] 读书 #学习\n';
  const out = ts.toMarkdown(ts.parseTodoMarkdown(md));
  assert.doesNotMatch(out, /#今日/);
});
