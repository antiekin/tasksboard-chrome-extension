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

test('checkRemoteChanges：保护窗口内的本地改动 → 跳过远端拉取', async () => {
  const t = new TodoSync({});
  t.readRemoteFile = async () => '# T\n## S\n- [x] 任务\n';
  t.pendingLocalChanges = true;
  t.lastLocalEditAt = Date.now();          // 刚刚编辑
  let pulled = false;
  t.onRemoteChange = () => { pulled = true; };
  await t.checkRemoteChanges();
  assert.strictEqual(pulled, false, '窗口内应保护本地、跳过远端');
  assert.strictEqual(t.pendingLocalChanges, true);
});

test('checkRemoteChanges：保护窗口过期 → 放行远端并清标志（离线死锁修复）', async () => {
  const t = new TodoSync({ localEditGuardMs: 50 });
  t.readRemoteFile = async () => '# T\n## S\n- [x] 任务\n';
  t.pendingLocalChanges = true;
  t.lastLocalEditAt = Date.now() - 5000;   // 5 秒前编辑，远超 50ms 窗口
  let pulled = false;
  t.onRemoteChange = () => { pulled = true; };
  await t.checkRemoteChanges();
  assert.strictEqual(pulled, true, '窗口过期应放行远端拉取');
  assert.strictEqual(t.pendingLocalChanges, false, '过期应清除标志，解除死锁');
});
