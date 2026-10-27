import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

function safePath(p) {
  return typeof p === 'string' && p && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..');
}

export function validate(m, expectedName) {
  const err = (msg) => { throw new Error(`Invalid manifest for "${expectedName}": ${msg}`); };
  if (m.name !== expectedName) err(`name "${m.name}" does not match folder`);
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) err('version must be x.y.z');
  if (!/^\d+\.0$/.test(m.apiVersion ?? '')) err('apiVersion must look like "62.0"');
  if (!Array.isArray(m.files) || !m.files.length) err('files must be a non-empty array');
  for (const f of m.files) if (!safePath(f)) err(`unsafe file path "${f}"`);
  for (const d of m.dependencies ?? []) if (!NAME_RE.test(d)) err(`bad dependency "${d}"`);
  for (const l of m.labels ?? []) if (!l.fullName || l.value === undefined) err('labels need fullName and value');
}

export async function loadManifest(source, name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid component name "${name}"`);

  // 1. Try standard registry manifest: components/<name>/manifest.json
  try {
    const buf = await source.read(`components/${name}/manifest.json`);
    const m = JSON.parse(buf.toString('utf8'));
    validate(m, name);
    return m;
  } catch (e) {
    // Fall back to direct DX repository auto-discovery below
  }

  // 2. Direct DX Fallback: Inspect local SFDX repository
  if (source.type === 'local' && source.root) {
    const candidatePrefixes = [
      'force-app/main/default/lwc',
      'main/default/lwc'
    ];

    for (const prefix of candidatePrefixes) {
      try {
        const compDir = path.join(source.root, prefix, name);
        const entries = await readdir(compDir, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile())
          .map((e) => `lwc/${name}/${e.name}`);
        if (!files.length) continue;

        let apiVersion = '62.0';
        let description = `Component from ${source.label}`;

        try {
          const metaXml = await readFile(path.join(compDir, `${name}.js-meta.xml`), 'utf8');
          const descMatch = metaXml.match(/<description>([\s\S]*?)<\/description>/i);
          if (descMatch) description = descMatch[1].trim();
          const apiMatch = metaXml.match(/<apiVersion>([\s\S]*?)<\/apiVersion>/i);
          if (apiMatch) {
            const parsedApi = apiMatch[1].trim();
            apiVersion = parsedApi.includes('.') ? parsedApi : `${parsedApi}.0`;
          }
        } catch {}

        const synthesized = {
          name,
          version: '1.0.0',
          description,
          apiVersion,
          files,
          dependencies: [],
          _rawPrefix: `${prefix}/${name}`
        };

        validate(synthesized, name);
        return synthesized;
      } catch {}
    }
  }

  // 3. Direct DX Fallback: Inspect remote SFDX repository tree
  if (source.fetchApi) {
    const candidatePrefixes = [
      'force-app/main/default/lwc',
      'main/default/lwc'
    ];

    for (const prefix of candidatePrefixes) {
      try {
        const entries = await source.fetchApi(`contents/${prefix}/${name}`);
        if (Array.isArray(entries) && entries.length > 0) {
          const files = [];
          for (const item of entries) {
            if (item.type === 'file') {
              files.push(`lwc/${name}/${item.name}`);
            }
          }

          if (files.length === 0) continue;

          let apiVersion = '62.0';
          let description = `Component from ${source.label}`;

          try {
            const metaBuf = await source.read(`${prefix}/${name}/${name}.js-meta.xml`);
            const metaXml = metaBuf.toString('utf8');
            const descMatch = metaXml.match(/<description>([\s\S]*?)<\/description>/i);
            if (descMatch) description = descMatch[1].trim();
            const apiMatch = metaXml.match(/<apiVersion>([\s\S]*?)<\/apiVersion>/i);
            if (apiMatch) {
              const parsedApi = apiMatch[1].trim();
              apiVersion = parsedApi.includes('.') ? parsedApi : `${parsedApi}.0`;
            }
          } catch {
            // Use defaults
          }

          const synthesized = {
            name,
            version: '1.0.0',
            description,
            apiVersion,
            files,
            dependencies: [],
            _rawPrefix: `${prefix}/${name}`
          };

          validate(synthesized, name);
          return synthesized;
        }
      } catch (err) {
        // If 404, try next prefix
      }
    }
  }

  throw new Error(`Component "${name}" not found in registry (${source.label}).`);
}

// Depth-first; dependencies come before dependents. Detects cycles.
export async function resolve(source, names) {
  const ordered = [];
  const state = new Map();
  async function visit(name, stack) {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') throw new Error(`Circular dependency: ${[...stack, name].join(' -> ')}`);
    state.set(name, 'visiting');
    const m = await loadManifest(source, name);
    for (const d of m.dependencies ?? []) await visit(d, [...stack, name]);
    state.set(name, 'done');
    ordered.push(m);
  }
  for (const n of names) await visit(n, []);
  return ordered;
}
