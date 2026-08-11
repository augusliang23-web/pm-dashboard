import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyListCommand,
  getSelectionListType,
  handleListEnter,
  handleListPaste,
  normalizeListText,
  renderListHtml,
} from '../js/list-editor.mjs';

test('normalizes legacy lines without inventing empty content', () => {
  assert.equal(normalizeListText(''), '');
  assert.equal(normalizeListText('  \n'), '');
  assert.equal(normalizeListText('First\nSecond'), '• First\n• Second');
  assert.equal(normalizeListText('      • Too deep'), '• Too deep');
  assert.equal(normalizeListText('• Kept\n• '), '• Kept');
});

test('renumbers adjacent ordered blocks at each level', () => {
  assert.equal(normalizeListText('4. First\n9. Second'), '1. First\n2. Second');
  assert.equal(
    normalizeListText('8. Parent\n  4. Child\n  9. Next child\n3. Next parent'),
    '1. Parent\n  1. Child\n  2. Next child\n2. Next parent',
  );
  assert.equal(normalizeListText('1. One\n• Break\n8. Restart'), '1. One\n• Break\n1. Restart');
});

test('renders PM text exactly with line breaks, indentation, and literal markers', () => {
  assert.equal(
    renderListHtml('3. Parent\n  3.1 Child\n  3.2 Next\n- Root\n  - Nested'),
    '<div class="structured-text">3. Parent\n  3.1 Child\n  3.2 Next\n- Root\n  - Nested</div>',
  );
});

test('escapes PM text without changing its visible content', () => {
  assert.equal(
    renderListHtml('  - Child <unsafe>\n  - Next & "quoted"'),
    '<div class="structured-text">  - Child &lt;unsafe&gt;\n  - Next &amp; &quot;quoted&quot;</div>',
  );
  assert.equal(renderListHtml('', '<span>Empty</span>'), '<span>Empty</span>');
});

test('Enter continues the current item and splits its text at the cursor', () => {
  assert.deepEqual(handleListEnter('• Alpha', 7, 7), {
    value: '• Alpha\n• ', selectionStart: 10, selectionEnd: 10,
  });
  assert.deepEqual(handleListEnter('• AlphaBeta', 7, 7), {
    value: '• Alpha\n• Beta', selectionStart: 10, selectionEnd: 10,
  });
  assert.deepEqual(handleListEnter('3. Alpha', 8, 8), {
    value: '1. Alpha\n2. ', selectionStart: 12, selectionEnd: 12,
  });
});

test('Enter on an empty item outdents once and then exits the list', () => {
  assert.deepEqual(handleListEnter('• Alpha\n  • ', 12, 12), {
    value: '• Alpha\n• ', selectionStart: 10, selectionEnd: 10,
  });
  assert.deepEqual(handleListEnter('• Alpha\n• ', 10, 10), {
    value: '• Alpha\n', selectionStart: 8, selectionEnd: 8,
  });
});

test('Enter and paste preserve plain text after a list is toggled off', () => {
  const plain = applyListCommand('• Alpha', 0, 7, 'bullet');
  assert.equal(plain.value, 'Alpha');
  assert.deepEqual(handleListEnter(plain.value, 5, 5), {
    value: 'Alpha\n', selectionStart: 6, selectionEnd: 6,
  });
  assert.deepEqual(handleListPaste('Existing', 8, 8, ' first\nsecond'), {
    value: 'Existing first\nsecond', selectionStart: 21, selectionEnd: 21,
  });
});

test('commands transform selected lines and expose the active list type', () => {
  const numbered = applyListCommand('• One\n• Two', 0, 11, 'number');
  assert.equal(numbered.value, '1. One\n2. Two');
  assert.equal(getSelectionListType(numbered.value, 0, numbered.value.length), 'number');
  assert.equal(applyListCommand(numbered.value, 0, numbered.value.length, 'number').value, 'One\nTwo');
  assert.equal(applyListCommand('1. One\n2. Two', 0, 5, 'bullet').value, '• One\n1. Two');
});

test('indent and outdent transform every selected line within safe bounds', () => {
  assert.equal(applyListCommand('• One\n• Two', 8, 13, 'indent').value, '• One\n  • Two');
  assert.equal(applyListCommand('• One\n• Two\n• Three', 8, 19, 'indent').value, '• One\n  • Two\n  • Three');
  assert.equal(applyListCommand('• One\n  • Two', 8, 13, 'outdent').value, '• One\n• Two');
  assert.equal(applyListCommand('• One', 0, 5, 'indent').value, '• One');
});

test('multiline paste inherits the current list type and level', () => {
  const result = handleListPaste('• Existing', 10, 10, ' first\nsecond ');
  assert.equal(result.value, '• Existing first\n• second');
  assert.equal(result.selectionStart, result.selectionEnd);

  const nested = handleListPaste('1. Parent\n  1. Existing', 24, 24, ' First\nSecond');
  assert.equal(nested.value, '1. Parent\n  1. Existing First\n  2. Second');
});

test('multiline paste preserves internal blank lines without empty list markers', () => {
  const result = handleListPaste('\u2022 Existing', 10, 10, ' A\n\nB');
  assert.equal(result.value, '\u2022 Existing A\n\n\u2022 B');
  assert.equal(result.selectionStart, result.selectionEnd);
});
