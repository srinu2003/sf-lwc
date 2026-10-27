import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createSource } from './source.js';
import { loadManifest } from './resolve.js';
import { findProject } from './project.js';
import { readConfig } from './init.js';

/**
 * Split text into lines, handling CRLF and LF.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (text === null || text === undefined) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Simple Longest Common Subsequence (LCS) unified diff generator.
 * @param {string} oldText
 * @param {string} newText
 * @param {string} filepath
 * @param {number} [context=3]
 * @returns {string|null} unified diff string or null if identical
 */
export function generateUnifiedDiff(oldText, newText, filepath, context = 3) {
  const normOld = (typeof oldText === "string" ? oldText : (oldText?.toString?.("utf8") ?? "")).replace(/\r\n/g, "\n");
  const normNew = (typeof newText === "string" ? newText : (newText?.toString?.("utf8") ?? "")).replace(/\r\n/g, "\n");

  if (normOld === normNew) {
    return null;
  }

  const linesA = splitLines(normOld);
  const linesB = splitLines(normNew);
  const m = linesA.length;
  const n = linesB.length;

  // Compute LCS table
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (linesA[i] === linesB[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to find edit operations
  let i = m;
  let j = n;
  const rawOps = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      rawOps.push({ type: ' ', text: linesA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawOps.push({ type: '+', text: linesB[j - 1] });
      j--;
    } else if (i > 0) {
      rawOps.push({ type: '-', text: linesA[i - 1] });
      i--;
    }
  }
  const ops = rawOps.reverse();

  // Find hunks with context
  const hunks = [];
  let currentHunk = null;

  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== ' ') {
      const start = Math.max(0, k - context);
      const end = Math.min(ops.length - 1, k + context);
      if (!currentHunk) {
        currentHunk = { start, end };
      } else if (start <= currentHunk.end + 1) {
        currentHunk.end = end;
      } else {
        hunks.push(currentHunk);
        currentHunk = { start, end };
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) return null;

  const fileHeader = filepath ? filepath.replace(/\\/g, '/') : 'file';
  const out = [
    `--- a/${fileHeader}`,
    `+++ b/${fileHeader}`
  ];

  for (const hunk of hunks) {
    const aBefore = ops.slice(0, hunk.start).filter(op => op.type === ' ' || op.type === '-').length;
    const bBefore = ops.slice(0, hunk.start).filter(op => op.type === ' ' || op.type === '+').length;
    const hunkOps = ops.slice(hunk.start, hunk.end + 1);
    const oldCount = hunkOps.filter(op => op.type === ' ' || op.type === '-').length;
    const newCount = hunkOps.filter(op => op.type === ' ' || op.type === '+').length;
    const oldStart = oldCount === 0 ? aBefore : aBefore + 1;
    const newStart = newCount === 0 ? bBefore : bBefore + 1;

    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of hunkOps) {
      out.push(op.type + op.text);
    }
  }

  return out.join('\n');
}

/**
 * Compare local component files against registry files.
 * @param {string} name - Component name
 * @param {object} [options]
 * @param {string} [options.from] - Custom registry
 * @param {string} [options.cwd] - Target project directory
 * @param {boolean} [options.json] - Output pure JSON
 * @returns {Promise<{ name: string, identical: boolean, files: Array<{ file: string, status: string, diff?: string }> }>}
 */
export async function diff(name, options = {}) {
  const projectRoot = path.resolve(options.cwd || '.');
  const project = await findProject(projectRoot);
  const config = await readConfig(project.root);
  const registry = options.from || config?.registry || process.env.SF_LWC_REGISTRY || '.';

  const source = options.source || createSource(registry);
  const manifest = await loadManifest(source, name);

  const results = [];
  let allIdentical = true;

  for (const file of manifest.files) {
    let registryContent;
    try {
      if (typeof source.readComponentFile === 'function') {
        registryContent = await source.readComponentFile(manifest, file);
      } else if (typeof source.readFile === 'function') {
        registryContent = await source.readFile(`components/${name}/files/${file}`);
      } else {
        registryContent = await source.read(`components/${name}/files/${file}`);
      }
    } catch {
      // Fallback for mocks
      if (typeof source.readFile === 'function') {
        registryContent = await source.readFile(file);
      } else if (typeof source.read === 'function') {
        registryContent = await source.read(file);
      }
    }
    if (Buffer.isBuffer(registryContent)) {
      registryContent = registryContent.toString('utf8');
    }

    const localPath = path.join(project.targetRoot, file);
    let localContent;
    let localExists = true;

    try {
      localContent = await readFile(localPath, 'utf8');
    } catch {
      localExists = false;
    }

    if (!localExists) {
      allIdentical = false;
      const fileDiff = generateUnifiedDiff(registryContent, '', file);
      results.push({
        file,
        status: 'missing',
        diff: fileDiff
      });
    } else {
      const fileDiff = generateUnifiedDiff(registryContent, localContent, file);
      if (fileDiff) {
        allIdentical = false;
        results.push({
          file,
          status: 'modified',
          diff: fileDiff
        });
      } else {
        results.push({
          file,
          status: 'identical'
        });
      }
    }
  }

  return {
    name,
    identical: allIdentical,
    files: results
  };
}
