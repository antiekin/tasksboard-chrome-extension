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
