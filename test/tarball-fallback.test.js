import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createSource, parseTar } from '../src/source.js';

/**
 * Helper to build an uncompressed ustar tar buffer in memory for testing.
 */
function createMockTar(entries) {
  const blocks = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const name = entry.name;
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content || '', 'utf8');
    const isDir = Boolean(entry.isDir);

    // Name (0-99)
    header.write(name.slice(0, 100), 0, 100, 'utf8');
    // Mode (100-107)
    header.write('0000644\0', 100, 8, 'utf8');
    // UID (108-115)
    header.write('0000000\0', 108, 8, 'utf8');
    // GID (116-123)
    header.write('0000000\0', 116, 8, 'utf8');
    // Size (124-135)
    const sizeOctal = content.length.toString(8).padStart(11, '0') + ' ';
    header.write(sizeOctal, 124, 12, 'utf8');
    // Mtime (136-147)
    header.write('00000000000 ', 136, 12, 'utf8');
    // Typeflag (156)
    header[156] = isDir ? 53 : 48; // '5' for dir, '0' for file
    // Magic (257-262)
    header.write('ustar\0', 257, 6, 'utf8');
    // Version (263-264)
    header.write('00', 263, 2, 'utf8');

    // Compute checksum (148-155)
    header.fill(32, 148, 156); // fill with spaces for computation
    let chksum = 0;
    for (let i = 0; i < 512; i++) chksum += header[i];
    const chksumOctal = chksum.toString(8).padStart(6, '0') + '\0 ';
    header.write(chksumOctal, 148, 8, 'utf8');

    blocks.push(header);

    if (!isDir && content.length > 0) {
      blocks.push(content);
      const pad = (512 - (content.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }

  // Two 512-byte zero blocks at end of archive
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

test('parseTar: correctly parses in-memory tarball into tree and filesMap', () => {
  const mockEntries = [
    { name: 'repo-HEAD/', isDir: true },
    { name: 'repo-HEAD/sfdx-project.json', content: '{"packageDirectories":[{"path":"force-app","default":true}]}' },
    { name: 'repo-HEAD/force-app/main/default/lwc/myComp/myComp.js', content: 'export default class MyComp {}' },
    { name: 'repo-HEAD/force-app/main/default/lwc/myComp/myComp.js-meta.xml', content: '<LightningComponentBundle></LightningComponentBundle>' }
  ];

  const tarBuffer = createMockTar(mockEntries);
  const { tree, filesMap } = parseTar(tarBuffer);

  assert.equal(filesMap.size, 3);
  assert.equal(filesMap.has('sfdx-project.json'), true);
  assert.equal(filesMap.has('force-app/main/default/lwc/myComp/myComp.js'), true);
  assert.equal(
    filesMap.get('force-app/main/default/lwc/myComp/myComp.js').toString('utf8'),
    'export default class MyComp {}'
  );

  const paths = tree.map((t) => t.path);
  assert.ok(paths.includes('sfdx-project.json'));
  assert.ok(paths.includes('force-app/main/default/lwc/myComp/myComp.js'));
  assert.ok(paths.includes('force-app/main/default/lwc/myComp/myComp.js-meta.xml'));
});

test('source.getTree(): automatically falls back to codeload tarball when GitHub REST API returns 403', async () => {
  const originalFetch = globalThis.fetch;
  const mockEntries = [
    { name: 'demo-HEAD/sfdx-project.json', content: '{"packageDirectories":[{"path":"force-app"}]}' },
    { name: 'demo-HEAD/force-app/main/default/lwc/toastMsg/toastMsg.js', content: 'export const show = () => {};' },
    { name: 'demo-HEAD/force-app/main/default/lwc/toastMsg/toastMsg.js-meta.xml', content: '<LightningComponentBundle><isExposed>true</isExposed></LightningComponentBundle>' }
  ];
  const gzippedTar = zlib.gzipSync(createMockTar(mockEntries));

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes('api.github.com/repos/mock-user/mock-lwc-repo/git/trees')) {
      // Simulate rate limit exceeded
      return {
        ok: false,
        status: 403,
        headers: new Map([['x-ratelimit-remaining', '0']])
      };
    }
    if (url.includes('codeload.github.com/mock-user/mock-lwc-repo/tar.gz')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => gzippedTar
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const source = createSource('mock-user/mock-lwc-repo');
    const bundlesResult = await source.listLwcBundles();

    assert.equal(bundlesResult.layout, 'sfdx');
    assert.equal(bundlesResult.bundles.length, 1);
    assert.equal(bundlesResult.bundles[0].name, 'toastMsg');

    // Verify source.read serves directly from in-memory tarball without extra network call
    const jsContent = await source.read('force-app/main/default/lwc/toastMsg/toastMsg.js');
    assert.equal(jsContent.toString('utf8'), 'export const show = () => {};');

    // Verify calls: REST API was tried first, then codeload tarball succeeded
    assert.ok(calls.some((u) => u.includes('api.github.com')));
    assert.ok(calls.some((u) => u.includes('codeload.github.com')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
