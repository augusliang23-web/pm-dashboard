const BULLET = '•';
const INDENT = '  ';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function parseLine(source, legacyAsBullets = true) {
  const line = String(source ?? '').replace(/\s+$/, '');
  if (!line.trim()) return { blank: true, level: 0, type: '', text: '' };
  const leadingSpaces = line.match(/^ */)?.[0].length || 0;
  const level = Math.floor(leadingSpaces / INDENT.length);
  if (/^\d+(?:\.\d+)+(?:[ \t]+.*)?$/.test(line.trim())) {
    return {
      blank: false,
      level,
      type: 'plain',
      text: line.trim(),
    };
  }
  const match = line.match(/^( *)(?:([•*-])|(\d+)\.)[ \t]*(.*)$/);
  if (!match) {
    return {
      blank: false,
      level,
      type: legacyAsBullets ? 'bullet' : 'plain',
      text: line.trim(),
    };
  }
  return {
    blank: false,
    level: Math.floor(match[1].length / INDENT.length),
    type: match[3] ? 'number' : 'bullet',
    text: match[4].trim(),
  };
}

function normalizeItems(value, { legacyAsBullets = true, trimTrailingBlank = true } = {}) {
  const parsed = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => parseLine(line, legacyAsBullets));
  if (trimTrailingBlank) {
    while (parsed.at(-1)?.blank || (parsed.at(-1) && !parsed.at(-1).text)) parsed.pop();
  }
  let previousLevel = 0;
  let hasPreviousItem = false;
  return parsed.map(item => {
    if (item.blank) return item;
    const level = hasPreviousItem
      ? Math.max(0, Math.min(item.level, previousLevel + 1))
      : 0;
    previousLevel = level;
    hasPreviousItem = true;
    return { ...item, level };
  });
}

function serializeItems(items) {
  const counters = [];
  const types = [];
  return items.map(item => {
    if (item.blank) return '';
    types.length = item.level + 1;
    counters.length = item.level + 1;
    if (item.type === 'number') {
      counters[item.level] = types[item.level] === 'number'
        ? (counters[item.level] || 0) + 1
        : 1;
    } else {
      counters[item.level] = 0;
    }
    types[item.level] = item.type;
    const marker = item.type === 'number'
      ? `${counters[item.level]}. `
      : item.type === 'bullet' ? `${BULLET} ` : '';
    return `${INDENT.repeat(item.level)}${marker}${item.text}`;
  }).join('\n');
}

export function normalizeListText(value, options) {
  return serializeItems(normalizeItems(value, options));
}

function lineIndexAtOffset(value, offset, selectionEnd = false) {
  const bounded = Math.max(0, Math.min(String(value).length, Number(offset) || 0));
  const target = selectionEnd && bounded > 0 ? bounded - 1 : bounded;
  return String(value).slice(0, target).split('\n').length - 1;
}

function selectionOffsets(lines, startLine, endLine) {
  const selectionStart = lines.slice(0, startLine).reduce((total, line) => total + line.length + 1, 0);
  const selectionEnd = lines.slice(0, endLine + 1).reduce((total, line) => total + line.length + 1, 0) - 1;
  return { selectionStart, selectionEnd: Math.max(selectionStart, selectionEnd) };
}

export function applyListCommand(value, selectionStart, selectionEnd, command) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n');
  const rawLines = source.split('\n');
  const items = normalizeItems(source, { legacyAsBullets: true, trimTrailingBlank: false });
  const startLine = lineIndexAtOffset(source, selectionStart);
  const endLine = lineIndexAtOffset(source, selectionEnd, selectionEnd > selectionStart);
  const selectedItems = items.slice(startLine, endLine + 1).filter(item => !item.blank);
  const selectedType = selectedItems.length && selectedItems.every(item => item.type === selectedItems[0].type)
    ? selectedItems[0].type
    : '';
  const previous = items.slice(0, startLine).reverse().find(item => !item.blank);
  const maximumIndent = previous ? previous.level + 1 : 0;

  for (let index = startLine; index <= endLine; index += 1) {
    const item = items[index];
    if (!item || item.blank) continue;
    if (command === 'bullet' || command === 'number') {
      item.type = selectedType === command ? 'plain' : command;
    } else if (command === 'outdent') {
      item.level = Math.max(0, item.level - 1);
    } else if (command === 'indent') {
      item.level = Math.min(item.level + 1, maximumIndent);
    }
  }

  const normalized = serializeItems(items);
  const normalizedLines = normalized.split('\n');
  const offsets = selectionOffsets(normalizedLines, startLine, endLine);
  return { value: normalized, ...offsets };
}

export function getSelectionListType(value, selectionStart, selectionEnd) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n');
  const items = normalizeItems(source, { legacyAsBullets: false, trimTrailingBlank: false });
  const startLine = lineIndexAtOffset(source, selectionStart);
  const endLine = lineIndexAtOffset(source, selectionEnd, selectionEnd > selectionStart);
  const selected = items.slice(startLine, endLine + 1).filter(item => !item.blank);
  return selected.length && selected.every(item => item.type === selected[0].type)
    ? selected[0].type
    : '';
}

function markerFor(item, number = 1) {
  const marker = item.type === 'number' ? `${number}. ` : item.type === 'bullet' ? `${BULLET} ` : '';
  return `${INDENT.repeat(item.level)}${marker}`;
}

function orderedNumberForLine(lines, lineIndex, level) {
  let count = 1;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const item = parseLine(lines[index], false);
    if (item.blank) continue;
    if (item.level < level || (item.level === level && item.type !== 'number')) break;
    if (item.level === level && item.type === 'number') count += 1;
  }
  return count;
}

export function handleListEnter(value, selectionStart, selectionEnd) {
  let source = String(value ?? '').replace(/\r\n?/g, '\n');
  const boundedStart = Math.max(0, Math.min(source.length, selectionStart));
  const boundedEnd = Math.max(boundedStart, Math.min(source.length, selectionEnd));
  if (boundedEnd > boundedStart) {
    source = `${source.slice(0, boundedStart)}${source.slice(boundedEnd)}`;
  }
  const lineStart = source.lastIndexOf('\n', Math.max(0, boundedStart - 1)) + 1;
  const nextBreak = source.indexOf('\n', boundedStart);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const rawLine = source.slice(lineStart, lineEnd);
  const item = parseLine(rawLine, false);
  const markerMatch = rawLine.match(/^( *)(?:([•*-])|(\d+)\.)[ \t]*/);

  if (!item.text && markerMatch) {
    if (item.level > 0) {
      const promoted = { ...item, level: item.level - 1 };
      const number = promoted.type === 'number'
        ? orderedNumberForLine(source.split('\n'), lineIndexAtOffset(source, lineStart), promoted.level)
        : 1;
      const replacement = markerFor(promoted, number);
      const resultValue = `${source.slice(0, lineStart)}${replacement}${source.slice(lineEnd)}`;
      const cursor = lineStart + replacement.length;
      return { value: resultValue, selectionStart: cursor, selectionEnd: cursor };
    }
    const resultValue = `${source.slice(0, lineStart)}${source.slice(lineEnd)}`;
    return { value: resultValue, selectionStart: lineStart, selectionEnd: lineStart };
  }

  const prefixLength = markerMatch?.[0].length || 0;
  const contentCursor = Math.max(0, boundedStart - lineStart - prefixLength);
  const beforeText = item.text.slice(0, contentCursor);
  const afterText = item.text.slice(contentCursor);
  const lines = source.split('\n');
  const currentLine = lineIndexAtOffset(source, lineStart);
  const nextNumber = item.type === 'number'
    ? orderedNumberForLine(lines, currentLine, item.level) + 1
    : 1;
  const currentNumber = item.type === 'number'
    ? orderedNumberForLine(lines, currentLine, item.level)
    : 1;
  const firstLine = `${markerFor(item, currentNumber)}${beforeText}`;
  const nextPrefix = markerFor(item, nextNumber);
  const replacement = `${firstLine}\n${nextPrefix}${afterText}`;
  const rawValue = `${source.slice(0, lineStart)}${replacement}${source.slice(lineEnd)}`;
  const normalized = normalizeListText(rawValue, { legacyAsBullets: false, trimTrailingBlank: false });
  const normalizedLines = normalized.split('\n');
  const cursor = normalizedLines.slice(0, currentLine + 1).reduce((total, line) => total + line.length + 1, 0)
    + (normalizedLines[currentLine + 1]?.match(/^(?:  )*(?:• |\d+\. )/)?.[0].length || 0);
  return { value: normalized, selectionStart: cursor, selectionEnd: cursor };
}

export function handleListPaste(value, selectionStart, selectionEnd, pastedText) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n');
  const boundedStart = Math.max(0, Math.min(source.length, selectionStart));
  const boundedEnd = Math.max(boundedStart, Math.min(source.length, selectionEnd));
  const lineStart = source.lastIndexOf('\n', Math.max(0, boundedStart - 1)) + 1;
  const nextBreak = source.indexOf('\n', boundedStart);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const current = parseLine(source.slice(lineStart, lineEnd), false);
  const pastedLines = String(pastedText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const marker = markerFor(current, 1);
  const replacement = pastedLines
    .map((line, index) => index && line.trim() ? `${marker}${line.trim()}` : line)
    .join('\n');
  const rawValue = `${source.slice(0, boundedStart)}${replacement}${source.slice(boundedEnd)}`;
  const normalized = normalizeListText(rawValue, { legacyAsBullets: false, trimTrailingBlank: false });
  const insertedLineCount = pastedLines.length - 1;
  const targetLine = lineIndexAtOffset(source, boundedStart) + insertedLineCount;
  const targetLines = normalized.split('\n');
  const cursor = targetLines.slice(0, targetLine + 1).reduce((total, line) => total + line.length + 1, 0) - 1;
  return { value: normalized, selectionStart: cursor, selectionEnd: cursor };
}

function buildTree(value) {
  const root = { children: [] };
  const parents = [root];
  normalizeItems(normalizeListText(value), { legacyAsBullets: true })
    .filter(item => !item.blank && item.text)
    .forEach(item => {
      const level = Math.min(item.level, parents.length - 1);
      const node = { ...item, level, children: [] };
      parents[level].children.push(node);
      parents[level + 1] = node;
      parents.length = level + 2;
    });
  return root;
}

function renderChildren(children, rootClass = '') {
  let html = '';
  for (let index = 0; index < children.length;) {
    const type = children[index].type;
    if (type === 'plain') {
      const group = [];
      while (index < children.length && children[index].type === 'plain') {
        group.push(children[index]);
        index += 1;
      }
      html += group.map(node => `<div class="structured-list-plain">${escapeHtml(node.text)}${renderChildren(node.children)}</div>`).join('');
      continue;
    }
    const listType = type === 'number' ? 'number' : 'bullet';
    const tag = type === 'number' ? 'ol' : 'ul';
    const group = [];
    while (index < children.length && (children[index].type === 'number' ? 'number' : 'bullet') === listType) {
      group.push(children[index]);
      index += 1;
    }
    const className = rootClass && !html ? ` class="${rootClass}"` : '';
    html += `<${tag}${className}>${group.map(node => `<li>${escapeHtml(node.text)}${renderChildren(node.children)}</li>`).join('')}</${tag}>`;
  }
  return html;
}

export function renderListHtml(value, emptyHtml = '-') {
  const source = String(value ?? '');
  return source ? `<div class="structured-text">${escapeHtml(source)}</div>` : emptyHtml;
}
