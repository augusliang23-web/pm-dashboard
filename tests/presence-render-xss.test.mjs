import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function rootEscHtml() {
  const start = dashboard.indexOf('function escHtml(v) {');
  const end = dashboard.indexOf('\n}', start) + 2;
  assert.notEqual(start, -1, 'root dashboard must provide escHtml');
  return new Function(`${dashboard.slice(start, end)}; return escHtml;`)();
}

function presenceRenderer() {
  const start = dashboard.indexOf('function renderOnlineUsers(users) {');
  const end = dashboard.indexOf('\n}\n\nwindow.addEventListener', start) + 2;
  assert.notEqual(start, -1, 'root dashboard must render online presence users');
  return new Function('document', 'escHtml', `${dashboard.slice(start, end)}; return renderOnlineUsers;`);
}

test('presence renderer displays a hostile persisted name as literal badge text', () => {
  const container = { innerHTML: '' };
  const count = { textContent: '' };
  const pulse = { classList: { add() {}, remove() {} } };
  const document = {
    getElementById(id) {
      return { onlineUsersList: container, onlineCount: count, onlinePulse: pulse }[id] || null;
    },
  };

  const renderOnlineUsers = presenceRenderer()(document, rootEscHtml());
  renderOnlineUsers([{ name: '<img src=x onerror=alert(1)>', idle: false }]);

  assert.equal(
    container.innerHTML,
    '<div class="online-badge ">&lt;img src=x onerror=alert(1)&gt;</div>',
  );
  assert.doesNotMatch(container.innerHTML, /<img\b/i);
});
