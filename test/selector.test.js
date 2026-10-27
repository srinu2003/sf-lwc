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
  { name: 'accordion-group', description: 'Collapsible accordion container', version: '1.0.0' }
];

function createMockStreams() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = 80;
  stdout.rows = 24;

  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });

  return {
    stdin,
    stdout,
    getOutput: () => output
  };
}

async function sendKeys(stdin, keys) {
  for (const k of keys) {
    stdin.write(k);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('fuzzyMatch accurately computes matching scores and bonuses', () => {
  // Empty pattern matches anything
  assert.equal(fuzzyMatch('', 'anything').match, true);
  assert.equal(fuzzyMatch('', 'anything').score, 0);

  // Exact substring matches have high score
  const exact = fuzzyMatch('modal', 'modal');
  assert.equal(exact.match, true);
  assert.ok(exact.score > 900);

  // Prefix substring matches score higher than suffix
  const prefix = fuzzyMatch('data', 'data-table');
  const nonPrefix = fuzzyMatch('table', 'data-table');
  assert.ok(prefix.score > nonPrefix.score);

  // Subsequence match with word boundaries
  const subseq = fuzzyMatch('dt', 'data-table');
  assert.equal(subseq.match, true);
  assert.ok(subseq.score > 0);

  // Non-matching pattern
  const nomatch = fuzzyMatch('xyz', 'data-table');
  assert.equal(nomatch.match, false);
  assert.equal(nomatch.score, -1);
});

test('filterComponents filters and ranks by name and description', () => {
  // Empty query returns all components
  const all = filterComponents(sampleComponents, '');
  assert.equal(all.length, sampleComponents.length);

  // Filter on component name
  const modalOnly = filterComponents(sampleComponents, 'mod');
  assert.equal(modalOnly.length, 1);
  assert.equal(modalOnly[0].name, 'modal');

  // Filter on description
  const toastByDesc = filterComponents(sampleComponents, 'notification');
  assert.equal(toastByDesc.length, 1);
  assert.equal(toastByDesc[0].name, 'toast-utils');

  // Name match ranks above description-only match
  const comps = [
    { name: 'helper', description: 'Handles modal events' },
    { name: 'modal', description: 'Base dialog' }
  ];
  const ranked = filterComponents(comps, 'modal');
  assert.equal(ranked[0].name, 'modal');

  // No matches
  const empty = filterComponents(sampleComponents, 'nonexistent-component-12345');
  assert.equal(empty.length, 0);
});

test('isInteractiveSession correctly evaluates TTY and flags', () => {
  const ttyIn = { isTTY: true };
  const ttyOut = { isTTY: true };
  const nonTty = { isTTY: false };

  assert.equal(isInteractiveSession(ttyIn, ttyOut, {}), true);
  assert.equal(isInteractiveSession(ttyIn, ttyOut, { json: true }), false);
  assert.equal(isInteractiveSession(nonTty, ttyOut, {}), false);
  assert.equal(isInteractiveSession(ttyIn, nonTty, {}), false);
});

test('selectComponents rejects immediately when stdin is non-TTY', async () => {
  const stdin = new PassThrough();
  stdin.isTTY = false;
  const stdout = new PassThrough();
  stdout.isTTY = true;

  await assert.rejects(
    async () => {
      await selectComponents(sampleComponents, { stdin, stdout });
    },
    {
      name: 'Error',
      message: /Terminal is non-interactive \(stdin is not a TTY\)/
    }
  );
});

test('selectComponents returns empty array for empty component list', async () => {
  const res = await selectComponents([], { forceInteractive: true });
  assert.deepEqual(res, []);
});

test('selectComponents single-select: pressing Enter selects highlighted component', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  await sendKeys(stdin, ['\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['data-table']);
});

test('selectComponents arrow navigation: Down arrow moves highlight and Enter selects it', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Move down once to 'modal'
  await sendKeys(stdin, ['\x1b[B', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['modal']);
});

test('selectComponents arrow wrap-around: Up arrow wraps from first to last item', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Up arrow wraps to accordion-group
  await sendKeys(stdin, ['\x1b[A', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['accordion-group']);
});

test('selectComponents multi-select: Spacebar toggles checkboxes and Enter returns all checked', async () => {
  const { stdin, stdout, getOutput } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Select item 0 ('data-table'), move down, select item 1 ('modal'), confirm with Enter
  await sendKeys(stdin, [
    ' ',      // toggle data-table
    '\x1b[B', // down
    ' ',      // toggle modal
    '\r'      // confirm
  ]);
  const result = await selectPromise;

  assert.deepEqual(result, ['data-table', 'modal']);
  assert.match(getOutput(), /Selected 2 component\(s\): data-table, modal/);
});

test('selectComponents multi-select toggle: Spacebar toggles item off if pressed twice', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Toggle item 0 on, then off, then move down and select item 1
  await sendKeys(stdin, [
    ' ',      // toggle on data-table
    ' ',      // toggle off data-table
    '\x1b[B', // down to modal
    ' ',      // toggle modal on
    '\r'      // confirm
  ]);
  const result = await selectPromise;

  assert.deepEqual(result, ['modal']);
});

test('selectComponents live typing filters results', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Type 'toast' then hit Enter
  await sendKeys(stdin, ['t', 'o', 'a', 's', 't', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['toast-utils']);
});

test('selectComponents backspace edits query', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  // Type 'z', backspace, type 'mod', hit Enter
  await sendKeys(stdin, ['z', '\x7f', 'm', 'o', 'd', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['modal']);
});

test('selectComponents escape cancels and returns empty array', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  await sendKeys(stdin, ['\x1b']);
  const result = await selectPromise;

  assert.deepEqual(result, []);
});

test('selectComponents ctrl+c cancels and returns empty array', async () => {
  const { stdin, stdout } = createMockStreams();
  const selectPromise = selectComponents(sampleComponents, { stdin, stdout });

  await sendKeys(stdin, ['\x03']);
  const result = await selectPromise;

  assert.deepEqual(result, []);
});

test('selectComponents pagination displays scroll indicators when items exceed pageSize', async () => {
  const manyComponents = Array.from({ length: 12 }, (_, i) => ({
    name: `comp-${String(i + 1).padStart(2, '0')}`,
    description: `Description for component ${i + 1}`,
    version: '1.0.0'
  }));

  const { stdin, stdout, getOutput } = createMockStreams();
  const selectPromise = selectComponents(manyComponents, {
    stdin,
    stdout,
    pageSize: 4
  });

  // Navigate down several times to trigger scroll indicators
  await sendKeys(stdin, ['\x1b[B', '\x1b[B', '\x1b[B', '\x1b[B', '\x1b[B', '\r']);
  const result = await selectPromise;

  assert.deepEqual(result, ['comp-06']);
  const out = getOutput();
  assert.ok(out.includes('more above') || out.includes('more below'));
});
