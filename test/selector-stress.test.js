import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  fuzzyMatch,
  filterComponents,
  isInteractiveSession,
  selectComponents
} from '../src/selector.js';

const sampleComponents = [
  { name: 'data-table', description: 'Config-driven record table backed by Apex', version: '1.0.0' },
  { name: 'modal', description: 'Accessible, SLDS-compliant modal dialog component', version: '1.0.0' },
  { name: 'toast-utils', description: 'Notification helper for toast events', version: '1.0.0' },
  { name: 'accordion-group', description: 'Collapsible accordion container', version: '1.0.0' },
  { name: 'file-uploader', description: 'Lightning file upload utility with progress', version: '2.1.0' },
  { name: 'rich-text-viewer', description: 'Sanitized HTML and rich text display component', version: '1.2.0' },
  { name: 'tree-grid', description: 'Hierarchical tree grid with lazy loading', version: '0.9.0' },
  { name: 'signature-pad', description: 'Canvas-based signature capture utility', version: '1.0.4' },
  { name: 'badge-pill', description: 'Configurable SLDS badge and pill tags', version: '1.1.0' },
  { name: 'card-header', description: 'Custom SLDS card header with action slots', version: '1.0.0' }
];

function createMockStreams(columns = 80, rows = 24) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  let rawMode = false;
  stdin.setRawMode = (mode) => {
    rawMode = Boolean(mode);
  };
  stdin.getRawMode = () => rawMode;

  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = columns;
  stdout.rows = rows;

  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });

  return {
    stdin,
    stdout,
    getOutput: () => output,
    clearOutput: () => { output = ''; }
  };
}

async function sendKeys(stdin, keys, delayMs = 15) {
  for (const k of keys) {
    stdin.write(k);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function sendBurst(stdin, keys) {
  for (const k of keys) {
    stdin.write(k);
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
}

test('stress: rapid burst typing and instant filter refinement', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Burst type 'acc' instantaneously, followed by Enter
  await sendBurst(stdin, ['a', 'c', 'c', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['accordion-group']);
});

test('stress: rapid backspace does not underflow query buffer or crash', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Type 'z', then send 20 backspaces rapidly, then type 'mod' and Enter
  const keys = ['z', ...Array(20).fill('\x7f'), 'm', 'o', 'd', '\r'];
  await sendBurst(stdin, keys);
  const result = await selectPromise;

  assert.deepEqual(result, ['modal']);
});

test('stress: rapid alternating keystrokes and backspaces', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Rapidly type wrong characters and backspace them
  const keys = [
    'x', '\x7f',
    'y', '\x7f',
    's', 'i', 'g', '\r'
  ];
  await sendBurst(stdin, keys);
  const result = await selectPromise;

  assert.deepEqual(result, ['signature-pad']);
});

test('stress: fuzzy matching word boundary bonus and description matching', () => {
  // Test word boundary bonus with hyphenated prefixes
  const comps = [
    { name: 'sf-data-table', description: 'Table' },
    { name: 'custom-date-picker', description: 'Date picker' },
    { name: 'super-fast-diff-tool', description: 'Diff' }
  ];

  // 'sdt' should match 'sf-data-table' and 'super-fast-diff-tool'
  const match1 = fuzzyMatch('sdt', 'super-fast-diff-tool');
  assert.equal(match1.match, true);
  assert.ok(match1.score > 50);

  // Description-only matching works when name does not match query
  const filtered = filterComponents(sampleComponents, 'hierarchical');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'tree-grid');

  // Exact substring matches heavily outrank scattered subsequence matches
  const exact = fuzzyMatch('card', 'card-header');
  const scattered = fuzzyMatch('card', 'accordion-group');
  assert.ok(exact.score > (scattered.match ? scattered.score : -1));
});

test('stress: cyclic wrap-around with Up arrow from index 0 to last index', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // From 0, press Up -> should wrap to index 9 ('card-header')
  await sendKeys(stdin, ['\x1b[A', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['card-header']);
});

test('stress: cyclic wrap-around with Down arrow from last index to index 0', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Navigate Down 10 times (wrap from 9 back to 0: data-table)
  const downs = Array(10).fill('\x1b[B');
  await sendBurst(stdin, [...downs, '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['data-table']);
});

test('stress: multi-page cyclic wrap-around correctly updates scroll viewport', async () => {
  // 10 items, pageSize 4
  const { stdin, stdout, getOutput } = createMockStreams(80, 24);
  const selectPromise = selectComponents(sampleComponents, {
    stdin,
    stdout,
    pageSize: 4
  });

  // Up wraps to index 9 (card-header). Scroll window must adjust so card-header is visible.
  await sendKeys(stdin, ['\x1b[A']);
  await new Promise((r) => setTimeout(r, 30));
  let out = getOutput();
  assert.match(out, /card-header/);
  assert.match(out, /more above/);

  // Down wraps from 9 back to 0 (data-table). Scroll window must adjust so data-table is visible.
  await sendKeys(stdin, ['\x1b[B']);
  await new Promise((r) => setTimeout(r, 30));
  out = getOutput();
  assert.match(out, /data-table/);

  await sendKeys(stdin, ['\r']);
  const result = await selectPromise;
  assert.deepEqual(result, ['data-table']);
});

test('stress: spacebar multi-select across search queries preserves original order', async () => {
  const { stdin, stdout, getOutput } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // 1. Search 'tree', select tree-grid
  // 2. Backspace 4 times
  // 3. Search 'modal', select modal
  // 4. Confirm with Enter
  await sendKeys(stdin, [
    't', 'r', 'e', 'e',
    ' ',
    '\x7f', '\x7f', '\x7f', '\x7f',
    'm', 'o', 'd', 'a', 'l',
    ' ',
    '\r'
  ]);
  const result = await selectPromise;

  // Components should be returned in original catalog order: 'modal' appears before 'tree-grid'
  assert.deepEqual(result, ['modal', 'tree-grid']);
  assert.match(getOutput(), /Selected 2 component\(s\): modal, tree-grid/);
});

test('stress: spacebar toggle spam on single component handles parity', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Press space 11 times (odd = selected)
  const spaces = Array(11).fill(' ');
  await sendBurst(stdin, [...spaces, '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['data-table']);
});

test('stress: spacebar toggle spam even count deselects and falls back to highlighted', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Press space 12 times (even = unselected), then Enter falls back to highlighted item
  const spaces = Array(12).fill(' ');
  await sendBurst(stdin, [...spaces, '\r']);
  const result = await selectPromise;

  // Since selected.size === 0, it falls back to highlighted item (data-table)
  assert.deepEqual(result, ['data-table']);
});

test('stress: spacebar on zero-match search does not crash or select ghost items', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Type non-existent query, hit space, hit Enter
  await sendBurst(stdin, ['x', 'x', 'x', 'x', '9', '9', ' ', '\r']);
  const result = await selectPromise;

  // Zero matches, nothing selected
  assert.deepEqual(result, []);
});

test('stress: Enter on zero matches when prior selections exist preserves selected items', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Select item 0 ('data-table')
  // Type non-matching query 'nonexistent'
  // Press Enter
  await sendKeys(stdin, [
    ' ',
    'n', 'o', 'n', 'e', 'x', 'i', 's', 't', 'e', 'n', 't',
    '\r'
  ]);
  const result = await selectPromise;

  // Selected item is preserved!
  assert.deepEqual(result, ['data-table']);
});

test('stress: Escape cancellation cleanly restores terminal and clears listeners', async () => {
  const stdinListenerCountBefore = process.stdin.listenerCount('keypress');
  const sigintListenerCountBefore = process.listenerCount('SIGINT');

  const { stdin, stdout, getOutput } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Send Escape key
  await sendKeys(stdin, ['\x1b']);
  const result = await selectPromise;

  assert.deepEqual(result, []);

  // Verify cursor restoration escape code was written
  assert.ok(getOutput().includes('\x1b[?25h'));

  // Verify listeners were cleaned up
  assert.equal(stdin.listenerCount('keypress'), 0);
  assert.equal(process.listenerCount('SIGINT'), sigintListenerCountBefore);
});

test('stress: Ctrl+C cancellation cleanly restores terminal and clears listeners', async () => {
  const sigintListenerCountBefore = process.listenerCount('SIGINT');

  const { stdin, stdout, getOutput } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Send Ctrl+C
  await sendKeys(stdin, ['\x03']);
  const result = await selectPromise;

  assert.deepEqual(result, []);
  assert.ok(getOutput().includes('\x1b[?25h'));
  assert.equal(stdin.listenerCount('keypress'), 0);
  assert.equal(process.listenerCount('SIGINT'), sigintListenerCountBefore);
});

test('stress: SIGINT process event triggers cancellation and listener cleanup', async () => {
  const sigintListenerCountBefore = process.listenerCount('SIGINT');

  const { stdin, stdout, getOutput } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Emit SIGINT on process
  process.emit('SIGINT');
  const result = await selectPromise;

  assert.deepEqual(result, []);
  assert.ok(getOutput().includes('\x1b[?25h'));
  assert.equal(process.listenerCount('SIGINT'), sigintListenerCountBefore);
});

test('stress: raw mode is enabled on start and disabled on exit', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Verify raw mode was set
  assert.equal(stdin.getRawMode(), true);

  // Confirm with Enter
  await sendKeys(stdin, ['\r']);
  await selectPromise;

  // Verify raw mode was restored to false
  assert.equal(stdin.getRawMode(), false);
});

test('stress: small terminal window dimensions (columns=20, rows=4) does not throw', async () => {
  const { stdin, stdout } = createMockStreams(20, 4);
  const selectPromise = selectComponents(sampleComponents, {
    stdin,
    stdout
  });

  // Navigate down and select
  await sendKeys(stdin, ['\x1b[B', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['modal']);
});

test('stress: long component names and descriptions truncate gracefully without throwing', async () => {
  const longComponents = [
    {
      name: 'super-ultra-mega-long-enterprise-custom-salesforce-lightning-web-component-wrapper-for-complex-transactions',
      description: 'This is an exceedingly long description intended to test description truncation in limited columns. '.repeat(5),
      version: '10.200.3000'
    },
    {
      name: 'short-comp',
      description: 'Normal description'
    }
  ];

  const { stdin, stdout, getOutput } = createMockStreams(40, 20);
  const selectPromise = selectComponents(longComponents, { stdin, stdout });

  await sendKeys(stdin, ['\r']);
  const result = await selectPromise;

  assert.deepEqual(result, [longComponents[0].name]);
  const out = getOutput();
  // Ensure description was truncated with ellipsis and did not crash
  assert.match(out, /\.\.\./);
});

test('stress: high-volume catalog (500 components) filters and navigates under 50ms', async () => {
  const largeCatalog = Array.from({ length: 500 }, (_, i) => ({
    name: `component-${String(i).padStart(4, '0')}`,
    description: `Automated test catalog component number ${i} with searchable metadata`,
    version: '1.0.0'
  }));

  const startFilter = performance.now();
  const filtered = filterComponents(largeCatalog, 'component-042');
  const filterDuration = performance.now() - startFilter;

  assert.ok(filterDuration < 50, `Filter took ${filterDuration}ms, expected < 50ms`);
  assert.ok(filtered.length >= 1);
  assert.equal(filtered[0].name, 'component-0420');

  // Interactive selection on 500 components
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(largeCatalog, { stdin, stdout });

  // Rapidly type search for '0499' and press Enter
  await sendBurst(stdin, ['0', '4', '9', '9', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['component-0499']);
});

test('stress: non-array or invalid input gracefully returns empty array', async () => {
  assert.deepEqual(await selectComponents(null), []);
  assert.deepEqual(await selectComponents(undefined), []);
  assert.deepEqual(await selectComponents('invalid-string'), []);
  assert.deepEqual(await selectComponents(12345), []);
  assert.deepEqual(await selectComponents({}), []);
});
