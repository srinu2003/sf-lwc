import { readdir, readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function toKebabCase(str) {
  return (str || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function matchComponentName(candidates, input) {
  if (!input || !candidates?.length) return input;
  // 1. Exact match
  const exact = candidates.find((c) => c === input);
  if (exact) return exact;

  // 2. Exact case-insensitive match
  const lowerInput = input.toLowerCase();
  const lowerMatch = candidates.find((c) => c.toLowerCase() === lowerInput);
  if (lowerMatch) return lowerMatch;

  // 3. Kebab-case match
  const kebabInput = toKebabCase(input);
  const kebabMatch = candidates.find((c) => toKebabCase(c) === kebabInput);
  if (kebabMatch) return kebabMatch;

  // 4. Normalized match (strip all hyphens, underscores, and lowercase)
  const normInput = lowerInput.replace(/[-_]/g, '');
  const normMatch = candidates.find((c) => c.toLowerCase().replace(/[-_]/g, '') === normInput);
  if (normMatch) return normMatch;

  return input;
}

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

/**
 * 1. Source verification: Verify whether the source is a valid Salesforce DX project.
 */
export async function verifySourceProject(source) {
  if (source.type === 'local' && source.root) {
    const sfdxProjectJson = path.join(source.root, 'sfdx-project.json');
    if (!fs.existsSync(sfdxProjectJson)) {
      throw new Error(`Source directory '${source.label}' is not a valid Salesforce DX project (missing sfdx-project.json).`);
    }
  } else if (source.type === 'remote' || typeof source.getTree === 'function') {
    try {
      const tree = await source.getTree();
      const hasSfdx = tree.some((item) => item.path === 'sfdx-project.json');
      if (!hasSfdx) {
        const hasForceApp = tree.some((item) => item.path.startsWith('force-app/') || item.path.startsWith('main/default/'));
        if (!hasForceApp) {
          throw new Error(`Source repository '${source.label}' is not a valid Salesforce DX project (missing sfdx-project.json).`);
        }
      }
    } catch (err) {
      if (err.message && err.message.includes('not a valid Salesforce DX project')) throw err;
    }
  }
}

export async function loadManifest(source, name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid component name "${name}"`);

  // 1. Source verification
  await verifySourceProject(source);

  // 2. Inspect local SFDX repository
  if (source.type === 'local' && source.root) {
    const candidatePrefixes = [
      'force-app/main/default/lwc',
      'main/default/lwc'
    ];

    for (const prefix of candidatePrefixes) {
      try {
        const compDir = path.join(source.root, prefix, name);
        if (!fs.existsSync(compDir)) continue;
        const entries = await readdir(compDir, { withFileTypes: true });
        if (!entries.length) continue;

        const pkgPrefix = prefix.replace(/\/lwc$/, '');

        // Check whether component has an explicit frozen manifest
        const candidateManifestPaths = [
          path.join(source.root, '.sf-lwc', `${name}.json`),
          path.join(source.root, 'components', name, 'manifest.json'),
          path.join(compDir, 'manifest.json'),
          path.join(compDir, '.sf-lwc.json')
        ];

        let packedManifest = null;
        for (const mfPath of candidateManifestPaths) {
          if (fs.existsSync(mfPath)) {
            try {
              packedManifest = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
              break;
            } catch {}
          }
        }

        if (packedManifest && Array.isArray(packedManifest.files) && packedManifest.files.length > 0) {
          packedManifest._rawPrefix = `${prefix}/${name}`;
          packedManifest._packageDefault = pkgPrefix;
          validate(packedManifest, name);
          return packedManifest;
        }

        // No explicit manifest: synthesize clean manifest for root LWC bundle only
        const files = entries
          .filter((e) => e.isFile())
          .map((e) => `lwc/${name}/${e.name}`);

        let apiVersion = '62.0';
        let description = `Component from ${source.label}`;

        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (entry.name === `${name}.js-meta.xml`) {
            try {
              const metaXml = await readFile(path.join(compDir, entry.name), 'utf8');
              const descMatch = metaXml.match(/<description>([\s\S]*?)<\/description>/i);
              if (descMatch) description = descMatch[1].trim();
              const labelMatch = metaXml.match(/<masterLabel>([\s\S]*?)<\/masterLabel>/i);
              if (!descMatch && labelMatch) description = labelMatch[1].trim();
              const apiMatch = metaXml.match(/<apiVersion>([\s\S]*?)<\/apiVersion>/i);
              if (apiMatch) {
                const parsedApi = apiMatch[1].trim();
                apiVersion = parsedApi.includes('.') ? parsedApi : `${parsedApi}.0`;
              }
            } catch {}
            break;
          }
        }

        console.warn(`Notice: Component "${name}" has no explicit manifest (.sf-lwc/${name}.json). Installing root LWC files only. To package Apex classes and metadata dependencies, run: sf-lwc pack ${name} --target-org <org>`);

        const synthesized = {
          name,
          version: '1.0.0',
          description,
          apiVersion,
          files: [...new Set(files)],
          dependencies: [],
          labels: [],
          _rawPrefix: `${prefix}/${name}`,
          _packageDefault: pkgPrefix
        };

        validate(synthesized, name);
        return synthesized;
      } catch (err) {
        if (err.message && err.message.startsWith('Invalid manifest')) throw err;
      }
    }
  }

  // 3. Inspect remote SFDX repository tree
  if (source.fetchApi || source.type === 'remote') {
    const candidatePrefixes = [
      'force-app/main/default/lwc',
      'main/default/lwc'
    ];

    for (const prefix of candidatePrefixes) {
      try {
        let entries = [];
        if (typeof source.fetchApi === 'function') {
          entries = await source.fetchApi(`contents/${prefix}/${name}`);
        } else if (typeof source.getTree === 'function') {
          const tree = await source.getTree();
          const prefixMatch = `${prefix}/${name}/`;
          entries = tree
            .filter((i) => i.path.startsWith(prefixMatch) && i.type === 'blob')
            .map((i) => ({ name: path.basename(i.path), type: 'file' }));
        }

        if (Array.isArray(entries) && entries.length > 0) {
          const files = [];
          for (const item of entries) {
            if (item.type === 'file') {
              files.push(`lwc/${name}/${item.name}`);
            }
          }

          if (files.length === 0) continue;

          // Check if remote has explicit frozen manifest
          let packedManifest = null;
          const candidateRemotePaths = [
            `.sf-lwc/${name}.json`,
            `components/${name}/manifest.json`,
            `${prefix}/${name}/manifest.json`
          ];

          for (const remPath of candidateRemotePaths) {
            try {
              const buf = await source.read(remPath);
              packedManifest = JSON.parse(buf.toString('utf8'));
              break;
            } catch {}
          }

          const pkgPrefix = prefix.replace(/\/lwc$/, '');

          if (packedManifest && Array.isArray(packedManifest.files) && packedManifest.files.length > 0) {
            packedManifest._rawPrefix = `${prefix}/${name}`;
            packedManifest._packageDefault = pkgPrefix;
            validate(packedManifest, name);
            return packedManifest;
          }

          console.warn(`Notice: Component "${name}" has no explicit manifest in remote repository "${source.label}". Installing root LWC files only.`);

          let apiVersion = '62.0';
          let description = `Component from ${source.label}`;

          try {
            const metaBuf = await source.read(`${prefix}/${name}/${name}.js-meta.xml`);
            const metaXml = metaBuf.toString('utf8');
            const descMatch = metaXml.match(/<description>([\s\S]*?)<\/description>/i);
            if (descMatch) description = descMatch[1].trim();
            const labelMatch = metaXml.match(/<masterLabel>([\s\S]*?)<\/masterLabel>/i);
            if (!descMatch && labelMatch) description = labelMatch[1].trim();
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
            labels: [],
            _rawPrefix: `${prefix}/${name}`,
            _packageDefault: pkgPrefix
          };

          validate(synthesized, name);
          return synthesized;
        }
      } catch {}
    }
  }

  // 4. Casing-agnostic fallback
  if (typeof source?.listLwcBundles === 'function') {
    try {
      const { bundles } = await source.listLwcBundles();
      const bundleNames = bundles.map((b) => b.name);
      const matched = matchComponentName(bundleNames, name);
      if (matched && matched !== name) {
        return await loadManifest(source, matched);
      }
    } catch {}
  }

  throw new Error(`Component "${name}" not found in repository (${source.label}).`);
}

// Depth-first; dependencies come before dependents. Detects cycles.
export async function resolve(source, names) {
  await verifySourceProject(source);

  let resolvedNames = names;
  if (typeof source?.listLwcBundles === 'function') {
    try {
      const { bundles } = await source.listLwcBundles();
      const bundleNames = bundles.map((b) => b.name);
      resolvedNames = names.map((n) => matchComponentName(bundleNames, n));
    } catch {}
  }

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
  for (const n of resolvedNames) await visit(n, []);
  return ordered;
}
