import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('docs interactive site assets exist and are properly structured', () => {
  assert.ok(fs.existsSync(path.resolve('docs/index.html')), 'docs/index.html exists');
  assert.ok(fs.existsSync(path.resolve('docs/style.css')), 'docs/style.css exists');
  assert.ok(fs.existsSync(path.resolve('docs/app.js')), 'docs/app.js exists');
  assert.ok(fs.existsSync(path.resolve('docs/registry.json')), 'docs/registry.json exists');

  const registry = JSON.parse(fs.readFileSync('docs/registry.json', 'utf8'));
  assert.ok(Array.isArray(registry));
  assert.ok(registry.length >= 3, 'All registry components bundled in docs');

  const modal = registry.find(c => c.name === 'modal');
  assert.ok(modal);
  assert.ok(modal.contents['lwc/modal/modal.html']);
  assert.ok(modal.contents['lwc/modal/modal.js']);
});
