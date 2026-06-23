# 今日任务重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把今日任务精简到 1-3 个必做、加上强完成反馈与超额激励,并把 To-do List 重定位为低压力任务池。

**Architecture:** 高亮式数据模型——任务池(`todo.md`)是唯一任务库,今日必做 = 池子里带 `#今日` 标记的项。完成事件实时记入 `chrome.storage` 的 `completionHistory`,午夜归档并清除 `#今日` 标记。纯逻辑集中在新模块 `daily-focus.js`(可 Node 单测),I/O 留在 `storage.js`/`todo-sync.js`/`obsidian-sync.js`,UI 在 `sidepanel.*`。

**Tech Stack:** 原生 JS + HTML + CSS(零依赖)、Manifest V3、chrome.storage.local、Obsidian Local REST API、Node 内置 `node:test`(仅测试用,不进扩展运行时)。

## Global Constraints

- 零运行时依赖:扩展代码不得引入任何第三方库(反馈动画/彩纸/音效都用原生 CSS/Canvas/Web Audio 实现)。
- 防 XSS:渲染任务文本一律用 `textContent`,禁止 `innerHTML` 拼接用户内容。
- 本地日期:日期一律用 `getFullYear()/getMonth()/getDate()` 计算,禁止 `toISOString().split('T')[0]`(UTC 偏差)。
- `todo.md` 保持 clean markdown:不得写入内联 HTML 注释元数据;`#今日` 用普通 tag 表示。
- 今日必做上限 3 个,常量 `MAX_MUST_DO = 3`。
- API Key 等密钥不得出现在代码、commit、文档中。
- 每个逻辑模块底部加 `if (typeof module !== 'undefined' && module.exports) { module.exports = ... }`,使其同时能在浏览器(全局)和 Node(require)下工作。

---

## 文件结构

| 文件 | 职责 | 本计划改动 |
|------|------|-----------|
| `daily-focus.js` | **新增**。纯逻辑:必做规则(上限/查询)、当天完成记录构建、streak 与累计计算。无 DOM/chrome 依赖。 | 新建 |
| `todo-sync.js` | 任务池 `todo.md` 的解析/序列化。 | 解析+写回 `#今日` 标记 |
| `storage.js` | chrome.storage 封装。 | 新增 `completionHistory` 与"今日已记录的额外完成"读写 |
| `obsidian-sync.js` | Obsidian REST I/O。 | 新增 `writeDailyLog()`,把当天记录写成 `YYYYMMDD_Daily_Tasks.md` 快照 |
| `background.js` | service worker、午夜定时。 | rollover 改为"归档 + 清 `#今日` + 重置" |
| `sidepanel.html` | 结构。 | 今日页重构、看板容器、任务池升级 |
| `sidepanel.css` | 样式/动画。 | 必做卡片、完成动画、彩纸、庆祝、看板样式 |
| `sidepanel.js` | UI 控制器。 | 今日页渲染/交互、反馈触发、超额、看板、任务池"设为今日必做" |
| `tests/*.test.js` | **新增**。Node 单测。 | 覆盖 `daily-focus.js` 与 `todo-sync.js` 解析 |
| `task-manager.js` | 旧"今日任务"清单逻辑。 | 今日页改读 todoData 后,其旧职责退役(本计划末尾清理,不在中途删以免破坏现有同步) |

### 数据结构(贯穿全计划)

任务池项(`todo-sync` 解析产出,新增 `today` 字段):
```js
{ id, text, reference, priority, category, completed, order, today }  // today: boolean
```

完成历史(`chrome.storage.local.completionHistory`),按本地日期键:
```js
{
  "2026-06-23": {
    mustDoTotal: 2,                       // 当天必做数(快照)
    mustDoCompleted: 2,                   // 完成的必做数
    overAchieved: ["回复客户邮件", "健身 30 分钟"]  // 超额完成(非必做)文本
  }
}
```

当天进行中的额外完成(尚未归档),`chrome.storage.local.todayExtra`:
```js
{ date: "2026-06-23", items: ["回复客户邮件"] }  // 当天完成的「非必做」任务文本
```

---

## Phase 0 — 可测性脚手架

### Task 1: 让逻辑模块可被 Node 加载 + 建测试运行方式

**Files:**
- Modify: `todo-sync.js`(末尾追加导出)
- Create: `daily-focus.js`(占位骨架 + 导出)
- Create: `tests/smoke.test.js`

**Interfaces:**
- Produces: `module.exports`(浏览器下不执行)。`tests` 用 `node --test` 运行。

- [ ] **Step 1: 写冒烟测试**

创建 `tests/smoke.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const TodoSync = require('../todo-sync.js');
const dailyFocus = require('../daily-focus.js');

test('todo-sync 可被 require 且是构造函数', () => {
  assert.strictEqual(typeof TodoSync, 'function');
});

test('daily-focus 导出 MAX_MUST_DO 常量', () => {
  assert.strictEqual(dailyFocus.MAX_MUST_DO, 3);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/`
Expected: FAIL —— `Cannot find module '../daily-focus.js'`

- [ ] **Step 3: 建 daily-focus.js 骨架 + 给 todo-sync.js 加导出**

创建 `daily-focus.js`:
```js
// daily-focus.js — pure logic for the "today must-do" model. No DOM, no chrome.
const MAX_MUST_DO = 3;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_MUST_DO };
}
```

在 `todo-sync.js` 末尾(`class TodoSync { ... }` 之后)追加:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TodoSync;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/`
Expected: PASS(2 tests)

- [ ] **Step 5: 提交**

```bash
git add daily-focus.js todo-sync.js tests/smoke.test.js
git commit -m "test: add node:test scaffolding + daily-focus module skeleton"
```

---

## Phase 1 — 数据层(纯逻辑,TDD)

### Task 2: 必做查询与上限规则(daily-focus)

**Files:**
- Modify: `daily-focus.js`
- Test: `tests/daily-focus.test.js`

**Interfaces:**
- Consumes: todoData 形如 `{ preamble, sections:[{ name, comment, items:[item] }] }`,item 含 `today`/`completed`。
- Produces:
  - `getMustDoItems(todoData) → item[]`(所有 `today===true` 的项,跨分段,按 section+order)
  - `countMustDo(todoData) → number`
  - `canAddMustDo(todoData) → boolean`(`countMustDo < MAX_MUST_DO`)
  - `allMustDoComplete(todoData) → boolean`(必做非空且全部 completed)

- [ ] **Step 1: 写失败测试**

创建 `tests/daily-focus.test.js`:
```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/daily-focus.test.js`
Expected: FAIL —— `df.getMustDoItems is not a function`

- [ ] **Step 3: 实现**

在 `daily-focus.js` 的 `module.exports` 之前加入:
```js
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
```

把导出改为:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_MUST_DO, getMustDoItems, countMustDo, canAddMustDo, allMustDoComplete };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/daily-focus.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: 提交**

```bash
git add daily-focus.js tests/daily-focus.test.js
git commit -m "feat: must-do query + cap rules in daily-focus"
```

### Task 3: 当天完成记录构建(daily-focus)

**Files:**
- Modify: `daily-focus.js`
- Test: `tests/daily-focus.test.js`(追加)

**Interfaces:**
- Produces: `buildDayRecord(todoData, extraCompletions) → { mustDoTotal, mustDoCompleted, overAchieved }`
  - `mustDoTotal` = 必做数;`mustDoCompleted` = 已完成必做数;`overAchieved` = `extraCompletions`(去重后的非必做完成文本数组)。

- [ ] **Step 1: 写失败测试**

向 `tests/daily-focus.test.js` 追加:
```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/daily-focus.test.js`
Expected: FAIL —— `df.buildDayRecord is not a function`

- [ ] **Step 3: 实现**

在 `daily-focus.js` 加入:
```js
function buildDayRecord(todoData, extraCompletions) {
  const mustDo = getMustDoItems(todoData);
  const overAchieved = [...new Set(extraCompletions || [])];
  return {
    mustDoTotal: mustDo.length,
    mustDoCompleted: mustDo.filter(i => i.completed).length,
    overAchieved,
  };
}
```
并加入 `module.exports`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/daily-focus.test.js`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add daily-focus.js tests/daily-focus.test.js
git commit -m "feat: build per-day completion record"
```

### Task 4: streak 与累计计算(daily-focus)

**Files:**
- Modify: `daily-focus.js`
- Test: `tests/daily-focus.test.js`(追加)

**Interfaces:**
- Produces:
  - `addDays(dateStr, delta) → 'YYYY-MM-DD'`(本地日期加减,内部辅助,也导出供测试)
  - `computeStreak(history, todayStr) → number`:从今天往回数连续"达成"天数。某天达成 = `mustDoTotal>0 && mustDoCompleted===mustDoTotal`。今天若尚未达成不清零(从昨天起算)。
  - `tallyOverAchieved(history, fromStr, toStr) → number`:`[fromStr, toStr]` 闭区间内 `overAchieved` 总数。

- [ ] **Step 1: 写失败测试**

追加:
```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/daily-focus.test.js`
Expected: FAIL —— `df.addDays is not a function`

- [ ] **Step 3: 实现**

```js
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
```
加入 `module.exports`(含 `addDays, computeStreak, tallyOverAchieved, isAchieved`)。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/daily-focus.test.js`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add daily-focus.js tests/daily-focus.test.js
git commit -m "feat: streak + overachieve tally computation"
```

### Task 5: todo-sync 解析/写回 `#今日` 标记

**Files:**
- Modify: `todo-sync.js`(`parseTodoMarkdown` 与 `toMarkdown`)
- Test: `tests/todo-sync.test.js`

**Interfaces:**
- Consumes: `todo.md` 文本,任务行形如 `- [ ] [S] 写方案 #工作 #今日 ← [[ref]]`。
- Produces: 解析出的 item 增加 `today:boolean`;`toMarkdown` 在 `today===true` 时输出 ` #今日`(置于分类标签之后、引用之前)。`#今日` 不得被当作分类。

- [ ] **Step 1: 写失败测试**

创建 `tests/todo-sync.test.js`:
```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/todo-sync.test.js`
Expected: FAIL（`today` 为 undefined / round-trip 丢失 `#今日`）

- [ ] **Step 3: 实现**

在 `todo-sync.js` 的 `parseTodoMarkdown` 里,解析任务行处,先剥离 `#今日`:把现有从 `rawContent` 提取 reference/category 的逻辑之前,加入:
```js
let today = false;
let work = rawContent;
if (/(^|\s)#今日(\s|$)/.test(work)) {
  today = true;
  work = work.replace(/\s*#今日\b/g, '').trim();
}
```
随后把原先对 `rawContent` 的 reference/category 提取改为对 `work` 进行(即把局部变量 `rawContent` 的后续使用替换为 `work`)。在 `currentSection.items.push({...})` 中加入 `today`。

在 `toMarkdown` 的任务行拼接处(现为 `` `- [${check}] ${pri}${item.text}${cat}${ref}\n` ``)改为在 `cat` 之后、`ref` 之前插入 `#今日`:
```js
const todayTag = item.today ? ' #今日' : '';
result += `- [${check}] ${pri}${item.text}${cat}${todayTag}${ref}\n`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/todo-sync.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: 提交**

```bash
git add todo-sync.js tests/todo-sync.test.js
git commit -m "feat: parse and serialize #今日 must-do tag in todo-sync"
```

---

## Phase 2 — I/O 集成

### Task 6: 完成日志 markdown 构建(daily-focus,纯逻辑)

**Files:**
- Modify: `daily-focus.js`
- Test: `tests/daily-focus.test.js`(追加)

**Interfaces:**
- Produces: `buildDailyLogMarkdown(dateStr, mustDoItems, overAchieved) → string`
  - `mustDoItems`：`[{ text, completed }]`;`overAchieved`：`string[]`。输出 `type: daily-log` 的快照 markdown。

- [ ] **Step 1: 写失败测试**

追加到 `tests/daily-focus.test.js`:
```js
test('buildDailyLogMarkdown 输出快照', () => {
  const md = df.buildDailyLogMarkdown(
    '2026-06-23',
    [{ text:'写方案', completed:true }, { text:'打电话', completed:false }],
    ['回复邮件']
  );
  assert.match(md, /type: daily-log/);
  assert.match(md, /## 今日必做 \(1\/2\)/);
  assert.match(md, /- \[x\] 写方案/);
  assert.match(md, /- \[ \] 打电话/);
  assert.match(md, /## 超额完成 \(1\)/);
  assert.match(md, /- \[x\] 回复邮件/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/daily-focus.test.js`
Expected: FAIL —— `df.buildDailyLogMarkdown is not a function`

- [ ] **Step 3: 实现**

在 `daily-focus.js` 加入(并加进 `module.exports`):
```js
function buildDailyLogMarkdown(dateStr, mustDoItems, overAchieved) {
  const doneCount = mustDoItems.filter(i => i.completed).length;
  const lines = ['---', `date: ${dateStr}`, 'type: daily-log', '---', `# ${dateStr} 完成日志`, ''];
  lines.push(`## 今日必做 (${doneCount}/${mustDoItems.length})`);
  for (const it of mustDoItems) lines.push(`- [${it.completed ? 'x' : ' '}] ${it.text}`);
  lines.push('');
  lines.push(`## 超额完成 (${(overAchieved || []).length})`);
  for (const t of (overAchieved || [])) lines.push(`- [x] ${t}`);
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/daily-focus.test.js`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add daily-focus.js tests/daily-focus.test.js
git commit -m "feat: build daily-log markdown snapshot"
```

### Task 7: storage.js — completionHistory 与 todayExtra 读写

**Files:**
- Modify: `storage.js`(在 `storage` 对象内追加方法)

**Interfaces:**
- Produces(均返回 Promise):
  - `getCompletionHistory() → object`
  - `saveCompletionDay(dateStr, record) → void`
  - `getTodayExtra(dateStr) → string[]`(仅当存储的 `date===dateStr` 才返回,跨日自动失效)
  - `addTodayExtra(dateStr, text) → void`(去重追加)
  - `clearTodayExtra() → void`

- [ ] **Step 1: 追加实现**

在 `storage.js` 的 `storage` 对象里(`saveTodoData` 之后)加入:
```js
  ,
  async getCompletionHistory() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['completionHistory'], (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r.completionHistory || {});
      });
    });
  },

  async saveCompletionDay(dateStr, record) {
    const history = await this.getCompletionHistory();
    history[dateStr] = record;
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ completionHistory: history }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  },

  async getTodayExtra(dateStr) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['todayExtra'], (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else {
          const te = r.todayExtra;
          resolve(te && te.date === dateStr ? te.items : []);
        }
      });
    });
  },

  async addTodayExtra(dateStr, text) {
    const items = await this.getTodayExtra(dateStr);
    if (!items.includes(text)) items.push(text);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ todayExtra: { date: dateStr, items } }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  },

  async clearTodayExtra() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ todayExtra: { date: null, items: [] } }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }
```
（注意:`saveTodoData` 原本是对象最后一个方法,其后无逗号;追加时先补一个逗号,如上 `,` 起头。）

- [ ] **Step 2: 语法检查**

Run: `node --check storage.js`
Expected: 无输出(通过)

- [ ] **Step 3: 在扩展中手动验证**

`chrome://extensions` 重新加载 → 右键侧边栏检查 → Console 执行:
```js
await storage.saveCompletionDay('2026-06-23', {mustDoTotal:1,mustDoCompleted:1,overAchieved:['x']});
console.log(await storage.getCompletionHistory());
```
Expected: 打印含 `2026-06-23` 的对象。

- [ ] **Step 4: 提交**

```bash
git add storage.js
git commit -m "feat: completionHistory + todayExtra storage accessors"
```

### Task 8: obsidian-sync.js — 写当天完成日志快照

**Files:**
- Modify: `obsidian-sync.js`

**Interfaces:**
- Consumes: `daily-focus.buildDailyLogMarkdown`(浏览器下为全局 `buildDailyLogMarkdown`;`obsidian-sync.js` 在 `sidepanel.html` 中于 `daily-focus.js` 之后加载)。
- Produces: `async writeDailyLog(dateStr, mustDoItems, overAchieved) → boolean`,PUT 到 `${vaultPath}/${YYYYMMDD}_Daily_Tasks.md`。

- [ ] **Step 1: 实现**

在 `obsidian-sync.js` 的 `ObsidianSync` 类中(`syncToRemote` 附近)加入:
```js
  async writeDailyLog(dateStr, mustDoItems, overAchieved) {
    const md = buildDailyLogMarkdown(dateStr, mustDoItems, overAchieved);
    const [y, m, d] = dateStr.split('-');
    const filePath = `${this.vaultPath}/${y}${m}${d}_Daily_Tasks.md`;
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await this.apiRequest('PUT', `/vault/${encodedPath}`, md);
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      this.setConnected(true);
      return true;
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        this.setConnected(false);
        return false;
      }
      throw error;
    }
  }
```

- [ ] **Step 2: 在 sidepanel.html 中确保加载顺序**

确认 `<script src="daily-focus.js">` 在 `<script src="obsidian-sync.js">` 之前(见 Task 9 的 HTML 改动;此处仅核对)。

- [ ] **Step 3: 语法检查**

Run: `node --check obsidian-sync.js`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add obsidian-sync.js
git commit -m "feat: write daily-log snapshot to Daily_Tasks.md"
```

### Task 9: background.js — 跨日归档 + 清 `#今日` + 重置

**Files:**
- Modify: `background.js`

**Interfaces:**
- 替换原 `performRollover`(全量复制未完成)为 `performDailyArchive`:午夜对"昨天"归档完成记录并清除 `#今日` 标记。由 `sidepanel.js` 在收到 `daily-archive` 消息时执行需要 DOM/同步的部分;background 仅负责定时与触发。

**实现要点(因 service worker 无法直接操作 todoData/REST,采用消息驱动):**
- background 午夜 alarm → 给 sidepanel 发 `{type:'daily-archive', date: 昨天}`;sidepanel 执行归档(写 completionHistory + 写 Daily_Tasks.md 快照 + 清 todoData 里所有 `today` 标记并同步 todo.md + clearTodayExtra)。
- 若 sidepanel 未打开:下次 sidepanel 启动时 `initSync` 检测"上次归档日期 < 昨天"则补归档。

- [ ] **Step 1: 改 background.js 的 alarm 处理**

把 `chrome.alarms.onAlarm` 中调用 `performRollover()` 的逻辑改为发消息:
```js
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    const yesterday = (() => {
      const dt = new Date();
      dt.setDate(dt.getDate() - 1);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();
    chrome.runtime.sendMessage({ type: 'daily-archive', date: yesterday }).catch(() => {});
    scheduleMidnightAlarm();
  }
});
```
删除/保留 `performRollover` 不再被调用(本计划末尾 Task 16 清理)。`scheduleMidnightAlarm` 复用现有实现。

- [ ] **Step 2: 语法检查**

Run: `node --check background.js`
Expected: 通过

- [ ] **Step 3: 手动验证(模拟触发)**

`chrome://extensions` 重新加载 → service worker 检查 → Console:
```js
chrome.alarms.create('daily-rollover', { when: Date.now() + 2000 });
```
打开侧边栏,2 秒后侧边栏 Console 应收到 `daily-archive` 消息(在 Task 10 接好监听后验证完整归档)。

- [ ] **Step 4: 提交**

```bash
git add background.js
git commit -m "feat: midnight daily-archive trigger (message-driven)"
```

---

## Phase 3 — UI(手动验证为主)

> 图标约定:真实扩展零依赖,**不用 Tabler**(那是 mockup 沙盒里的)。庆祝/火苗用 emoji(🏆🔥✨),复选框用 CSS 圆形,引用 mockup 仅作视觉目标参照。

### Task 10: 今日页结构 + 渲染必做 + 完成交互 + 归档监听

**Files:**
- Modify: `sidepanel.html`(`#daily-tab` 内容 + 脚本加载顺序)
- Modify: `sidepanel.css`(今日页/必做卡片样式)
- Modify: `sidepanel.js`(渲染与交互)

**Interfaces:**
- Consumes: 全局 `todoData`(由 todo-sync 维护)、`daily-focus` 全局函数、`storage`。
- Produces: `renderToday()`、`completeMustDoItem(itemId)`、`handleDailyArchive(dateStr)`。

- [ ] **Step 1: 改 `sidepanel.html`**

把脚本区改为(新增 `daily-focus.js`,置于 sync 之前):
```html
  <script src="storage.js"></script>
  <script src="task-manager.js"></script>
  <script src="daily-focus.js"></script>
  <script src="obsidian-sync.js"></script>
  <script src="todo-sync.js"></script>
  <script src="sidepanel.js"></script>
```
把 `#daily-tab` 整块替换为:
```html
    <div id="daily-tab" class="tab-content active">
      <div class="today-header">
        <div class="today-progress"><span id="md-done">0</span> / <span id="md-total">0</span> 今日必做</div>
        <div class="streak-mini" id="streak-mini" title="连续达成天数">🔥 <span id="streak-num">0</span></div>
      </div>
      <div id="must-do-list" class="must-do-list"></div>
      <div id="today-empty" class="today-empty" style="display:none;">
        <p>今天还没定必做</p>
        <p class="empty-hint">去「任务池」挑 1-3 件,或在下面直接新建</p>
      </div>
      <button id="add-mustdo-btn" class="add-task-btn">+ 临时新建一个必做</button>
      <div id="celebrate" class="celebrate" style="display:none;"></div>
      <div id="board" class="board" style="display:none;"></div>
      <canvas id="fx-canvas" class="fx-canvas"></canvas>
    </div>
```

- [ ] **Step 2: 加 `sidepanel.css`(今日页核心样式)**

追加:
```css
.today-header { display:flex; justify-content:space-between; align-items:center; margin: 4px 0 12px; }
.today-progress { font-size: 13px; color: var(--text-secondary, #5f6368); }
.streak-mini { font-size: 13px; font-weight: 600; }
.must-do-list { display:flex; flex-direction:column; gap: 10px; }
.mustdo-card { display:flex; align-items:center; gap:12px; padding:16px; border:1px solid #e0e0e0; border-radius:12px; background:#fff; transition: background .25s, border-color .25s; }
.mustdo-card .check { width:22px; height:22px; border-radius:50%; border:2px solid #bdbdbd; flex-shrink:0; cursor:pointer; transition: transform .2s, background .2s, border-color .2s; }
.mustdo-card.done { background:#e6f4ea; border-color:#34a853; }
.mustdo-card.done .check { background:#34a853; border-color:#34a853; }
.mustdo-card.done .check::after { content:'✓'; color:#fff; display:flex; align-items:center; justify-content:center; height:100%; font-size:13px; }
.mustdo-card .text { font-size:15px; line-height:1.4; flex:1; }
.mustdo-card.done .text { text-decoration: line-through; color:#34a853; }
.mustdo-card .cat-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.today-empty { text-align:center; color: var(--text-secondary,#5f6368); padding: 24px 0; }
.fx-canvas { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:50; display:none; }
.container { position: relative; }
```
（颜色沿用现有 `sidepanel.css` 的变量/色板;若已有 `--text-secondary` 等变量则复用,无则用上面字面值。)

- [ ] **Step 3: 写 `renderToday()` 与交互(sidepanel.js)**

新增(并在切到 daily tab、todoData 变更后调用):
```js
function renderToday() {
  const listEl = document.getElementById('must-do-list');
  const emptyEl = document.getElementById('today-empty');
  const mustDo = getMustDoItems(todoData);          // daily-focus 全局
  listEl.innerHTML = '';
  emptyEl.style.display = mustDo.length === 0 ? 'block' : 'none';

  for (const item of mustDo) {
    const card = document.createElement('div');
    card.className = 'mustdo-card' + (item.completed ? ' done' : '');
    const check = document.createElement('span');
    check.className = 'check';
    check.addEventListener('click', () => completeMustDoItem(item.id));
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;                    // 防 XSS
    card.appendChild(check);
    card.appendChild(text);
    if (item.category) {
      const tag = createCategoryTag(item.category, () => {}); // 复用现有分类标签函数
      tag.style.cursor = 'default';
      card.appendChild(tag);
    }
    listEl.appendChild(card);
  }

  const done = mustDo.filter(i => i.completed).length;
  document.getElementById('md-done').textContent = done;
  document.getElementById('md-total').textContent = mustDo.length;
  refreshStreakMini();
}

function findTodoItem(id) {
  for (const s of todoData.sections) {
    const it = s.items.find(i => i.id === id);
    if (it) return it;
  }
  return null;
}

async function completeMustDoItem(id) {
  const item = findTodoItem(id);
  if (!item || item.completed) return;
  item.completed = true;
  await saveTodoDebounced();                 // 写回 todo.md(复用现有 todo 保存路径)
  renderToday();
  triggerCompletionFx(false);          // Task 11
  if (allMustDoComplete(todoData)) showAllDoneCelebration();  // Task 12
}
```
`saveTodoDebounced()`:现有持久化函数(写 storage + REST 同步),完成/标记后调用它即可。分类标签复用 `createCategoryTag()`。

- [ ] **Step 4: 接归档消息 + 启动补归档**

在 `chrome.runtime.onMessage` 监听里加入分支:
```js
if (message.type === 'daily-archive') {
  handleDailyArchive(message.date);
}
```
实现:
```js
async function handleDailyArchive(dateStr) {
  const extra = await storage.getTodayExtra(dateStr);
  const mustDo = getMustDoItems(todoData).map(i => ({ text: i.text, completed: i.completed }));
  const record = buildDayRecord(todoData, extra);
  await storage.saveCompletionDay(dateStr, record);
  if (obsidianSync && obsidianSync.connected) {
    await obsidianSync.writeDailyLog(dateStr, mustDo, record.overAchieved);
  }
  // 清 #今日 标记 + 重置当天额外完成
  for (const s of todoData.sections) for (const it of s.items) it.today = false;
  await saveTodoDebounced();
  await storage.clearTodayExtra();
  renderToday();
}
```

- [ ] **Step 5: 手动验证**

`chrome://extensions` 重新加载 → 打开侧边栏 → 在「任务池」给 1-2 项打 `#今日`(Task 15 之前可临时在 Obsidian 的 todo.md 手动加 `#今日` 再等同步)→ 今日页应显示这些必做卡片;点圆圈 → 卡片变绿、进度 +1;`todo.md` 对应行变 `[x]`。

- [ ] **Step 6: 提交**

```bash
git add sidepanel.html sidepanel.css sidepanel.js
git commit -m "feat: today page renders must-do from #今日 items + completion"
```

### Task 11: 完成反馈(打勾动画 + 彩纸 + 轻音效 + 鼓励语)

**Files:**
- Modify: `sidepanel.js`(fx 函数)
- Modify: `sidepanel.css`(动画 keyframes、鼓励语样式)

**Interfaces:**
- Produces: `triggerCompletionFx(isOverAchieve)`、`fireConfetti(opts)`、`playChime(kind)`、`flashEncouragement(text)`。

- [ ] **Step 1: 打勾动画 CSS**

追加到 `sidepanel.css`:
```css
@keyframes pop { 0%{transform:scale(1);} 40%{transform:scale(1.35);} 100%{transform:scale(1);} }
.mustdo-card.done .check { animation: pop .28s ease; }
.encourage { text-align:center; font-size:13px; font-weight:600; color:#34a853; padding:6px 0; animation: fadeUp 1.6s ease forwards; }
@keyframes fadeUp { 0%{opacity:0; transform:translateY(6px);} 20%{opacity:1; transform:none;} 80%{opacity:1;} 100%{opacity:0;} }
```

- [ ] **Step 2: 彩纸 + 音效 + 鼓励语(纯原生)**

在 `sidepanel.js` 加入:
```js
const ENCOURAGE = ['漂亮!', '搞定一个 👍', '稳!', '又近一步', '就是这个节奏'];
const ENCOURAGE_OVER = ['超神! 🔥', '额外拿下一件!', '今天血赚', '余力惊人 ✨'];

let _audioCtx = null;
function playChime(kind) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const base = kind === 'over' ? 660 : 523;
    [0, 0.12].forEach((t, i) => {
      const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = base * (i ? 1.5 : 1);
      g.gain.setValueAtTime(0.0001, _audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, _audioCtx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + t + 0.25);
      o.connect(g).connect(_audioCtx.destination);
      o.start(_audioCtx.currentTime + t); o.stop(_audioCtx.currentTime + t + 0.26);
    });
  } catch (e) { /* 音效失败不影响 */ }
}

function fireConfetti(opts) {
  const canvas = document.getElementById('fx-canvas');
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  canvas.style.display = 'block';
  const colors = opts && opts.gold ? ['#f9ab00','#fbc02d','#ffd54f'] : ['#34a853','#4285f4','#ea4335','#fbbc04'];
  const n = (opts && opts.count) || 80;
  const parts = Array.from({length:n}, () => ({
    x: canvas.width/2, y: canvas.height*0.3,
    vx: (Math.random()-0.5)*8, vy: Math.random()*-8-3,
    s: Math.random()*6+4, c: colors[(Math.random()*colors.length)|0], life: 1
  }));
  let raf;
  (function frame(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.3; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      if (p.life > 0 && p.y < canvas.height) {
        alive = true;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
    if (alive) raf = requestAnimationFrame(frame);
    else { cancelAnimationFrame(raf); canvas.style.display='none'; }
  })();
}

function flashEncouragement(text) {
  const el = document.createElement('div');
  el.className = 'encourage';
  el.textContent = text;
  const list = document.getElementById('must-do-list');
  list.parentNode.insertBefore(el, list.nextSibling);
  setTimeout(() => el.remove(), 1700);
}

function triggerCompletionFx(isOverAchieve) {
  const pool = isOverAchieve ? ENCOURAGE_OVER : ENCOURAGE;
  flashEncouragement(pool[(Math.random()*pool.length)|0]);
  fireConfetti({ gold: isOverAchieve, count: isOverAchieve ? 120 : 70 });
  playChime(isOverAchieve ? 'over' : 'base');
}
```

- [ ] **Step 3: 手动验证**

重新加载扩展 → 点完成一个必做 → 应看到:圆圈弹一下变绿、上方一行鼓励语淡出、彩纸从中上方洒落、听到轻"叮"。(首次需点击解锁音频,完成点击本身即手势。)

- [ ] **Step 4: 提交**

```bash
git add sidepanel.js sidepanel.css
git commit -m "feat: completion feedback — check pop, confetti, chime, encouragement"
```

### Task 12: 全部达成庆祝 + 任务池入口

**Files:**
- Modify: `sidepanel.js`、`sidepanel.css`

**Interfaces:**
- Produces: `showAllDoneCelebration()`、`getLocalToday() → 'YYYY-MM-DD'`。

- [ ] **Step 1: 样式**

追加 `sidepanel.css`:
```css
.celebrate { text-align:center; background:#e6f4ea; border-radius:12px; padding:20px 16px; margin-top:12px; }
.celebrate .trophy { font-size:34px; }
.celebrate .title { font-size:16px; font-weight:600; color:#1e8e3e; margin-top:6px; }
.celebrate .sub { font-size:13px; color:#1e8e3e; margin-top:2px; }
.celebrate .pool-entry { margin-top:12px; width:100%; }
```

- [ ] **Step 2: 实现**

```js
function getLocalToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function showAllDoneCelebration() {
  const el = document.getElementById('celebrate');
  el.style.display = 'block';
  el.innerHTML = '';
  const trophy = document.createElement('div'); trophy.className='trophy'; trophy.textContent='🏆';
  const title = document.createElement('div'); title.className='title'; title.textContent='今日必做全部达成';
  const sub = document.createElement('div'); sub.className='sub'; sub.textContent='今天你赢了';
  const btn = document.createElement('button'); btn.className='add-task-btn pool-entry';
  btn.textContent='还有余力?从任务池捞一个 →';
  btn.addEventListener('click', () => document.querySelector('.tab[data-tab="todo"]').click());
  el.append(trophy, title, sub, btn);
  fireConfetti({ count: 140 });
  refreshBoard();                       // Task 14:达成后展开看板
  document.getElementById('board').style.display = 'block';
}
```
在 `renderToday()` 末尾:当 `!allMustDoComplete(todoData)` 时隐藏 celebrate/board:
```js
  if (!allMustDoComplete(todoData)) {
    document.getElementById('celebrate').style.display = 'none';
    document.getElementById('board').style.display = 'none';
  }
```
tab 切换:现无独立函数,用 `document.querySelector('.tab[data-tab="todo"]').click()` 触发(见上)。

- [ ] **Step 3: 手动验证**

完成最后一个必做 → 出现奖杯庆祝块 + 大彩纸 + "从任务池捞一个"按钮;点按钮跳到任务池。

- [ ] **Step 4: 提交**

```bash
git add sidepanel.js sidepanel.css
git commit -m "feat: all-done celebration + pool entry"
```

### Task 13: 超额即时金色庆祝

**Files:**
- Modify: `sidepanel.js`、`sidepanel.css`

**Interfaces:**
- Produces: `completePoolItem(id)`、`showOverAchieveCelebration(text)`。超额定义:`!item.today && allMustDoComplete(todoData)` 时完成的池子项。

- [ ] **Step 1: 样式(金色)**

追加 `sidepanel.css`:
```css
.overachieve { text-align:center; background:#fef7e0; border-radius:12px; padding:16px; margin-top:12px; }
.overachieve .icon { font-size:28px; }
.overachieve .title { font-size:15px; font-weight:600; color:#b06000; margin-top:6px; }
```

- [ ] **Step 2: 实现**

```js
async function completePoolItem(id) {
  const item = findTodoItem(id);
  if (!item || item.completed) return;
  item.completed = true;
  await saveTodoDebounced();
  const over = !item.today && allMustDoComplete(todoData);
  if (over) {
    await storage.addTodayExtra(getLocalToday(), item.text);
    triggerCompletionFx(true);
    showOverAchieveCelebration(item.text);
  } else {
    triggerCompletionFx(false);
  }
  renderTodoSections();           // 任务池重渲染(现有/Task 15)
  renderToday();
  refreshBoard();
}

function showOverAchieveCelebration(text) {
  const el = document.getElementById('celebrate');
  el.style.display = 'block';
  const box = document.createElement('div'); box.className='overachieve';
  const icon = document.createElement('div'); icon.className='icon'; icon.textContent='🥇';
  const title = document.createElement('div'); title.className='title'; title.textContent='超额 +1 · 超神';
  box.append(icon, title);
  el.appendChild(box);
  setTimeout(() => box.remove(), 4000);
}
```

- [ ] **Step 3: 手动验证**(需 Task 15 的任务池完成入口接好后)

必做全完成后,在任务池完成一个非必做任务 → 金色庆祝 + 金色彩纸 + 更高音;`todayExtra` 增加该任务。

- [ ] **Step 4: 提交**

```bash
git add sidepanel.js sidepanel.css
git commit -m "feat: over-achievement gold celebration on extra completions"
```

### Task 14: 长期激励看板

**Files:**
- Modify: `sidepanel.js`、`sidepanel.css`

**Interfaces:**
- Produces: `refreshBoard()`、`refreshStreakMini()`、`badgeFor(monthlyCount) → string|null`。

- [ ] **Step 1: 样式**

追加 `sidepanel.css`:
```css
.board { margin-top:14px; }
.board .streak-card { text-align:center; border:1px solid #e0e0e0; border-radius:12px; padding:14px; }
.board .streak-card .big { font-size:15px; font-weight:600; margin-top:4px; }
.board .metrics { display:flex; gap:8px; margin-top:10px; }
.board .metric { flex:1; background:#f1f3f4; border-radius:8px; padding:10px; text-align:center; }
.board .metric .num { font-size:22px; font-weight:600; }
.board .metric .lbl { font-size:11px; color:#5f6368; }
.board .badge { display:flex; align-items:center; gap:8px; justify-content:center; background:#fef7e0; color:#b06000; border-radius:8px; padding:10px; margin-top:10px; font-size:12px; }
```

- [ ] **Step 2: 实现**

```js
function badgeFor(monthly) {
  if (monthly >= 20) return '高效达人';
  if (monthly >= 10) return '稳步前进';
  return null;
}

async function computeBoardData() {
  const history = await storage.getCompletionHistory();
  const today = getLocalToday();
  const live = buildDayRecord(todoData, await storage.getTodayExtra(today));
  const merged = { ...history, [today]: live };
  const streak = computeStreak(merged, today);
  const weekly = tallyOverAchieved(merged, addDays(today, -6), today);
  const monthStart = today.slice(0, 8) + '01';
  const monthly = tallyOverAchieved(merged, monthStart, today);
  return { streak, weekly, monthly };
}

async function refreshStreakMini() {
  const { streak } = await computeBoardData();
  document.getElementById('streak-num').textContent = streak;
}

async function refreshBoard() {
  const board = document.getElementById('board');
  const { streak, weekly, monthly } = await computeBoardData();
  document.getElementById('streak-num').textContent = streak;
  board.innerHTML = '';
  const sc = document.createElement('div'); sc.className='streak-card';
  sc.innerHTML = '<div style="font-size:26px;">🔥</div>';
  const big = document.createElement('div'); big.className='big'; big.textContent = `连续 ${streak} 天达成`;
  sc.appendChild(big);
  const metrics = document.createElement('div'); metrics.className='metrics';
  for (const [num, lbl] of [[weekly,'本周超额'],[monthly,'本月超额']]) {
    const m = document.createElement('div'); m.className='metric';
    const nEl = document.createElement('div'); nEl.className='num'; nEl.textContent = num;
    const lEl = document.createElement('div'); lEl.className='lbl'; lEl.textContent = lbl;
    m.append(nEl, lEl); metrics.appendChild(m);
  }
  board.append(sc, metrics);
  const badge = badgeFor(monthly);
  if (badge) {
    const b = document.createElement('div'); b.className='badge';
    b.textContent = `🏅 本月徽章 · ${badge}`;
    board.appendChild(b);
  }
}
```
在 `initSync`/启动渲染今日页后调用一次 `refreshStreakMini()`。

- [ ] **Step 3: 手动验证**

Console 预置历史:
```js
await storage.saveCompletionDay('2026-06-22',{mustDoTotal:1,mustDoCompleted:1,overAchieved:['a']});
```
完成今日必做 → 看板展开,连续天数 ≥1,本周超额计数正确。

- [ ] **Step 4: 提交**

```bash
git add sidepanel.js sidepanel.css
git commit -m "feat: long-term board — streak, weekly/monthly tally, badge"
```

### Task 15: 任务池页面升级("设为今日必做" + 新建必做 + 定位弱化)

**Files:**
- Modify: `sidepanel.js`(任务池渲染处增加操作 + 新建必做)、`sidepanel.css`、`sidepanel.html`(文案)

**Interfaces:**
- Consumes: `canAddMustDo`、`completePoolItem`、`saveTodoDebounced()`、`renderTodoSections()`(现有任务池渲染)。
- Produces: `setMustDo(id)`、`addTempMustDo(text)`。

- [ ] **Step 1: 每个任务池项加"设为今日必做 🎯"操作**

在现有任务池项渲染(`renderTodo`/`createTodoItemElement` 等)中,为未完成且 `!item.today` 的项添加一个按钮:
```js
const star = document.createElement('button');
star.className = 'set-mustdo-btn';
star.textContent = '🎯';
star.title = '设为今日必做';
star.addEventListener('click', (e) => { e.stopPropagation(); setMustDo(item.id); });
// append 到该项操作区
```
并把任务池项的完成动作接到 `completePoolItem(item.id)`(替换原直接 toggle)。

- [ ] **Step 2: 实现 setMustDo / 新建必做**

```js
async function setMustDo(id) {
  if (!canAddMustDo(todoData)) {
    showError('今日必做最多 3 个,先完成或退回一个');
    return;
  }
  const item = findTodoItem(id);
  if (!item) return;
  item.today = true;
  await saveTodoDebounced();
  renderTodoSections(); renderToday();
}

async function addTempMustDo(text) {
  if (!canAddMustDo(todoData)) { showError('今日必做最多 3 个'); return; }
  const section = todoData.sections.find(s => s.name.includes('短期')) || todoData.sections[0];
  section.items.push({
    id: 'm' + Date.now().toString(36),
    text: text.trim(), reference: null, priority: null, category: null,
    completed: false, order: section.items.length, today: true
  });
  await saveTodoDebounced();
  renderTodoSections(); renderToday();
}
```
绑定今日页的 `#add-mustdo-btn`:点击 → 用现有内联输入方式(或 `prompt` 兜底)取文本 → `addTempMustDo(text)`。

- [ ] **Step 3: 定位弱化(文案/样式)**

- 把任务池 tab 文案/标题里的"待办/欠债"措辞改为"任务池 · 可做可不做";`sidepanel.html` 相应文本更新。
- 池子项完成反馈保持轻量(`completePoolItem` 里非超额走 `triggerCompletionFx(false)`)。

- [ ] **Step 4: 手动验证**

任务池每项有 🎯;点击 → 该项进今日必做、池子里标记/置灰;第 4 个时提示上限。今日页"+ 临时新建一个必做"可加入并显示。

- [ ] **Step 5: 提交**

```bash
git add sidepanel.html sidepanel.css sidepanel.js
git commit -m "feat: pool — set-as-must-do, temp must-do, low-pressure framing"
```

### Task 16: 收尾(清理旧逻辑 + 全量验证 + 文档)

**Files:**
- Modify: `task-manager.js`、`background.js`、`README.md`、`CLAUDE.md`

- [ ] **Step 1: 移除已废弃的旧"今日清单"代码路径**

- `background.js`:删除不再调用的 `performRollover`(全量复制逻辑)。
- `sidepanel.js`:删除旧 `#daily-tab` 的任务渲染/拖拽/完成折叠等已被今日页取代的死代码;`task-manager.js` 若仅服务旧今日清单则整体移除其引用(保留 `getTodayDate` 等仍被用到的纯工具,或迁到 daily-focus)。
- 逐一确认无悬空引用:`grep -n "performRollover\|getActiveTasks\|getCompletedTasks" *.js`。

- [ ] **Step 2: 全量测试 + 语法检查**

Run:
```bash
node --test tests/
for f in daily-focus.js todo-sync.js obsidian-sync.js storage.js background.js sidepanel.js task-manager.js; do node --check "$f" || echo "FAIL $f"; done
```
Expected: 所有测试 PASS;无语法错误输出。

- [ ] **Step 3: 端到端手动回归(对照验收标准)**

逐条走 spec §12 验收标准:必做上限、跨日退回、完成反馈、超额、看板、任务池保留、归档。

- [ ] **Step 4: 更新文档**

`README.md` + `CLAUDE.md`:更新数据模型(高亮式/#今日/completionHistory)、今日页/任务池/反馈/看板说明、跨日逻辑、`daily-focus.js` 与 `tests/`。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: remove legacy daily-list path; docs; full test pass"
```

---

## Self-Review(计划自查)

- **Spec 覆盖**:§3 数据模型→T2-T7;§3.3 日志→T6-T8;§3.4 streak→T4;§4 今日页→T10-T12;§5 任务池→T15;§6 超额+看板→T13-T14;§7 跨日→T9+T10S4;§9 反馈→T11;§10 受影响文件→全覆盖;§12 验收→T16S3。无遗漏。
- **占位符**:无 TBD/TODO;每个 code step 给出完整代码。
- **类型/命名一致**:`getMustDoItems/countMustDo/canAddMustDo/allMustDoComplete/buildDayRecord/computeStreak/tallyOverAchieved/addDays/buildDailyLogMarkdown`(daily-focus)贯穿一致;`completeMustDoItem/completePoolItem/findTodoItem/renderToday/refreshBoard/getLocalToday`(新增)并复用 `saveTodoDebounced/renderTodoSections` 在 sidepanel 内一致。
- **依赖前置**:`daily-focus.js` 在 `obsidian-sync.js`/`sidepanel.js` 之前加载(T10S1)。
- **已核对的现有函数(计划已用真实名)**:`saveTodoDebounced()`、`renderTodoSections()`、`createCategoryTag()`、`createTodoItemElement()`、`handleTodoToggle()`、`showError()`、`setupTabSwitching()`。
