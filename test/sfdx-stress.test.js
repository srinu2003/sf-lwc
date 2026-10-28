import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSource } from '../src/source.js';
import { listComponents, parseMetaXml, discoverComponentNames } from '../src/list.js';
import { diff } from '../src/diff.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 1. Remote SFDX Repository Enumeration (Deterministic Mock)
// ---------------------------------------------------------------------------
test('stress: remote SFDX repo lists in single Git Tree pass without 404 probing (deterministic mock)', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;

  // Mock Git Trees containing 2 SFDX components and raw files
  const mockTree = [
    { path: 'force-app/main/default/lwc/modal/modal.js', type: 'blob' },
    { path: 'force-app/main/default/lwc/modal/modal.html', type: 'blob' },
    { path: 'force-app/main/default/lwc/modal/modal.js-meta.xml', type: 'blob' },
    { path: 'force-app/main/default/lwc/toastUtils/toastUtils.js', type: 'blob' },
    { path: 'force-app/main/default/lwc/toastUtils/toastUtils.js-meta.xml', type: 'blob' },
    { path: 'force-app/main/default/lwc/toastUtils/toastUtils.html', type: 'blob' }
  ];

  globalThis.fetch = async (url) => {
    const urlStr = url.toString();
    requests.push(urlStr);
    if (urlStr.includes('git/trees')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ tree: mockTree })
      };
    }
    if (urlStr.includes('modal.js-meta.xml')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('<LightningComponentBundle><description>A versatile modal component</description><apiVersion>62.0</apiVersion></LightningComponentBundle>')
      };
    }
    if (urlStr.includes('toastUtils.js-meta.xml')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('<LightningComponentBundle><masterLabel>Toast Utilities</masterLabel><apiVersion>61.0</apiVersion></LightningComponentBundle>')
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const start = Date.now();
    const source = createSource('mock-owner/mock-sfdx-repo');
    const components = await listComponents(source, 'mock-owner/mock-sfdx-repo');
    const duration = Date.now() - start;

    assert.ok(duration < 1000, `Expected listing in < 1000ms, took ${duration}ms`);
    assert.equal(components.length, 2);
    assert.equal(components[0].name, 'modal');
    assert.equal(components[0].description, 'A versatile modal component');
    assert.equal(components[0].apiVersion, '62.0');

    assert.equal(components[1].name, 'toastUtils');
    assert.equal(components[1].description, 'Toast Utilities');
    assert.equal(components[1].apiVersion, '61.0');

    // Verify exactly 1 Git Trees API request
    const treeReqs = requests.filter((u) => u.includes('git/trees'));
    assert.equal(treeReqs.length, 1);

    // Verify ZERO requests to components/
    const manifestReqs = requests.filter((u) => u.includes('components/'));
    assert.equal(manifestReqs.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 2. Remote SFDX Repository Enumeration & Latency (< 3s) (Live Network)
// ---------------------------------------------------------------------------
test('stress: remote SFDX repo (svierk/awesome-lwc-collection) lists in < 3s without 404 probing (live)', async (t) => {
  let output;
  const start = Date.now();
  try {
    const res = await execFileAsync('node', [
      'bin/sf-lwc.js',
      'list',
      '--from',
      'svierk/awesome-lwc-collection'
    ], { cwd: root, timeout: 10000 });
    output = res.stdout;
  } catch (err) {
    if (err.message.includes('rate limit exceeded') || err.code === 'ENOTFOUND') {
      t.skip('Skipped live network due to GitHub rate limit or offline: ' + err.message);
      return;
    }
    throw err;
  }
  const duration = Date.now() - start;

  assert.ok(duration < 3000, `Expected listing to complete in < 3000ms, took ${duration}ms`);
  assert.match(output, /Registry:\s+svierk\/awesome-lwc-collection@main/);
  assert.match(output, /- base64ToPdf@1\.0\.0/);
  assert.match(output, /A simple utility for Base64 encoded strings to decode and download them as PDF file\./);
  assert.match(output, /- customDatatable@1\.0\.0/);
  assert.match(output, /A custom datatable with different configuration options\./);
  assert.match(output, /- signaturePad@1\.0\.0/);
  assert.match(output, /A canvas-based signature capture component with mouse and touch support\./);
});

// ---------------------------------------------------------------------------
// 3. Remote Non-LWC Repository Error Handling (Deterministic Mock & Live)
// ---------------------------------------------------------------------------
test('stress: remote non-LWC repo throws exact error without auth claim (deterministic mock)', async () => {
  const originalFetch = globalThis.fetch;
  const mockTree = [
    { path: 'package.json', type: 'blob' },
    { path: 'src/index.js', type: 'blob' },
    { path: 'README.md', type: 'blob' }
  ];

  globalThis.fetch = async (url) => {
    if (url.toString().includes('git/trees')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ tree: mockTree })
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const source = createSource('mock-owner/non-lwc-repo');
    await assert.rejects(
      async () => {
        await listComponents(source, 'mock-owner/non-lwc-repo');
      },
      {
        name: 'Error',
        message: "Repository 'mock-owner/non-lwc-repo' does not contain any LWC components (expected standard layout: force-app/main/default/lwc)."
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stress: remote non-LWC repo (facebook/react) fails immediately with exact error without auth claim (live)', async (t) => {
  let errOutput = '';
  let exitCode = 0;
  try {
    await execFileAsync('node', [
      'bin/sf-lwc.js',
      'list',
      '--from',
      'facebook/react'
    ], { cwd: root, timeout: 10000 });
  } catch (err) {
    exitCode = err.code ?? 1;
    errOutput = (err.stderr || '') + (err.stdout || '');
  }

  if (errOutput.includes('rate limit exceeded') || errOutput.includes('ENOTFOUND')) {
    t.skip('Skipped live network due to rate limit / offline');
    return;
  }

  assert.equal(exitCode, 1);
  assert.match(
    errOutput,
    /Error: Repository 'facebook\/react' does not contain any LWC components \(expected standard layout: force-app\/main\/default\/lwc\)\./
  );
  assert.doesNotMatch(errOutput, /GITHUB_TOKEN/);
  assert.doesNotMatch(errOutput, /404/);
  assert.doesNotMatch(errOutput, /inaccessible/);
});

// ---------------------------------------------------------------------------
// 4. Remote Non-Existent Repository Error Handling (Deterministic Mock & Live)
// ---------------------------------------------------------------------------
test('stress: remote non-existent repo throws exact 404 error (deterministic mock)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    headers: new Map()
  });

  try {
    const source = createSource('fake-owner/fake-repo');
    await assert.rejects(
      async () => {
        await listComponents(source, 'fake-owner/fake-repo');
      },
      {
        name: 'Error',
        message: "Repository 'fake-owner/fake-repo' not found or inaccessible (check repository name or set GITHUB_TOKEN for private repos)."
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stress: remote non-existent repo fails immediately with 404 / inaccessible error (live CLI)', async (t) => {
  let errOutput = '';
  let exitCode = 0;
  try {
    await execFileAsync('node', [
      'bin/sf-lwc.js',
      'list',
      '--from',
      'nonexistent-user/nonexistent-repo-998877'
    ], { cwd: root, timeout: 10000 });
  } catch (err) {
    exitCode = err.code ?? 1;
    errOutput = (err.stderr || '') + (err.stdout || '');
  }

  if (errOutput.includes('rate limit exceeded') || errOutput.includes('ENOTFOUND')) {
    t.skip('Skipped live CLI due to rate limit / offline');
    return;
  }

  assert.equal(exitCode, 1);
  assert.match(
    errOutput,
    /Error: Repository 'nonexistent-user\/nonexistent-repo-998877' not found or inaccessible \(check repository name or set GITHUB_TOKEN for private repos\)\./
  );
});

// ---------------------------------------------------------------------------
// 5. Local Non-Existent Directory Error Handling
// ---------------------------------------------------------------------------
test('stress: local non-existent directory fails with exact error', async () => {
  let errOutput = '';
  let exitCode = 0;
  try {
    await execFileAsync('node', [
      'bin/sf-lwc.js',
      'list',
      '--from',
      './nonexistent-local-folder-12345'
    ], { cwd: root });
  } catch (err) {
    exitCode = err.code ?? 1;
    errOutput = (err.stderr || '') + (err.stdout || '');
  }

  assert.equal(exitCode, 1);
  assert.match(errOutput, /Error: Local directory '\.\/nonexistent-local-folder-12345' does not exist\./);
});

// ---------------------------------------------------------------------------
// 6. Local Empty / Non-LWC Directory Error Handling
// ---------------------------------------------------------------------------
test('stress: local empty or non-LWC directory fails with exact expected layout message', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'sf-non-lwc-stress-'));
  try {
    await writeFile(path.join(tmp, 'index.js'), 'console.log("no lwc here")');
    let errOutput = '';
    let exitCode = 0;
    try {
      await execFileAsync('node', [
        'bin/sf-lwc.js',
        'list',
        '--from',
        tmp
      ], { cwd: root });
    } catch (err) {
      exitCode = err.code ?? 1;
      errOutput = (err.stderr || '') + (err.stdout || '');
    }

    assert.equal(exitCode, 1);
    assert.match(errOutput, /does not contain an LWC bundle \(expected standard layout: force-app\/main\/default\/lwc\)/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. XML Entity Decoding and MasterLabel Fallback in parseMetaXml
// ---------------------------------------------------------------------------
test('stress: parseMetaXml decodes XML entities and falls back to masterLabel', () => {
  const xmlWithEntities = `
    <LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
      <apiVersion>60</apiVersion>
      <description>Component with &amp; &lt; &gt; &quot; &#39; &apos; symbols</description>
    </LightningComponentBundle>
  `;
  const parsed1 = parseMetaXml(xmlWithEntities);
  assert.equal(parsed1.description, `Component with & < > " ' ' symbols`);
  assert.equal(parsed1.apiVersion, '60.0');

  const xmlWithOnlyMasterLabel = `
    <LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
      <apiVersion>61.0</apiVersion>
      <masterLabel>Master Label Fallback</masterLabel>
    </LightningComponentBundle>
  `;
  const parsed2 = parseMetaXml(xmlWithOnlyMasterLabel);
  assert.equal(parsed2.description, 'Master Label Fallback');
  assert.equal(parsed2.apiVersion, '61.0');

  const emptyXml = parseMetaXml('');
  assert.equal(emptyXml.description, '');
  assert.equal(emptyXml.apiVersion, '62.0');
});

// ---------------------------------------------------------------------------
// 8. SFDX Diff Support via manifest._rawPrefix
// ---------------------------------------------------------------------------
test('stress: diff resolves files from SFDX layout correctly using manifest._rawPrefix', async () => {
  const tmpRepo = await mkdtemp(path.join(tmpdir(), 'sf-diff-repo-'));
  const tmpProj = await mkdtemp(path.join(tmpdir(), 'sf-diff-proj-'));
  try {
    // SFDX Source Repo
    await writeFile(path.join(tmpRepo, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));
    const repoLwc = path.join(tmpRepo, 'force-app/main/default/lwc/heroBanner');
    await mkdir(repoLwc, { recursive: true });
    await writeFile(path.join(repoLwc, 'heroBanner.js'), 'export default class HeroBanner { title = "Original"; }');
    await writeFile(path.join(repoLwc, 'heroBanner.html'), '<template>Original</template>');
    await writeFile(path.join(repoLwc, 'heroBanner.js-meta.xml'), '<LightningComponentBundle></LightningComponentBundle>');

    // Target Project
    const projLwc = path.join(tmpProj, 'force-app/main/default/lwc/heroBanner');
    await mkdir(projLwc, { recursive: true });
    await writeFile(path.join(projLwc, 'heroBanner.js'), 'export default class HeroBanner { title = "Original"; }');
    await writeFile(path.join(projLwc, 'heroBanner.html'), '<template>Modified Local</template>');
    await writeFile(path.join(tmpProj, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }));

    const result = await diff('heroBanner', { cwd: tmpProj, from: tmpRepo });
    assert.equal(result.name, 'heroBanner');
    assert.equal(result.identical, false);

    const htmlFile = result.files.find((f) => f.file === 'lwc/heroBanner/heroBanner.html');
    assert.ok(htmlFile);
    assert.equal(htmlFile.status, 'modified');

    const jsFile = result.files.find((f) => f.file === 'lwc/heroBanner/heroBanner.js');
    assert.ok(jsFile);
    assert.equal(jsFile.status, 'identical');

    const metaFile = result.files.find((f) => f.file === 'lwc/heroBanner/heroBanner.js-meta.xml');
    assert.ok(metaFile);
    assert.equal(metaFile.status, 'missing');
  } finally {
    await rm(tmpRepo, { recursive: true, force: true });
    await rm(tmpProj, { recursive: true, force: true });
  }
});
