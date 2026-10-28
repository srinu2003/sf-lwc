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

export async function loadManifest(source, name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid component name "${name}"`);

  // 1. Inspect local SFDX repository
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
        const dependencies = new Set();
        const labelNames = new Set();
        const apexClasses = new Set();

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
          } else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) {
            try {
              const code = await readFile(path.join(compDir, entry.name), 'utf8');
              const impMatches = [...code.matchAll(/from\s+['"]c\/([a-zA-Z0-9_-]+)['"]/g)];
              for (const im of impMatches) {
                if (im[1] !== name) dependencies.add(im[1]);
              }
              const tagMatches = [...code.matchAll(/<c-([a-z0-9-]+)/gi)];
              for (const tm of tagMatches) {
                dependencies.add(tm[1]);
              }
              const lblMatches = [...code.matchAll(/(?:@salesforce\/label\/c\.|\$Label\.c\.)([a-zA-Z0-9_]+)/g)];
              for (const lm of lblMatches) {
                labelNames.add(lm[1]);
              }
              const apexMatches = [...code.matchAll(/from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[a-zA-Z0-9_]+['"]/g)];
              for (const am of apexMatches) {
                apexClasses.add(am[1]);
              }
            } catch {}
          }
        }

        // Add Apex class files if present
        for (const cls of apexClasses) {
          const clsRel = `classes/${cls}.cls`;
          const metaRel = `classes/${cls}.cls-meta.xml`;
          if (fs.existsSync(path.join(source.root, 'force-app/main/default', clsRel))) {
            files.push(clsRel);
            if (fs.existsSync(path.join(source.root, 'force-app/main/default', metaRel))) {
              files.push(metaRel);
            }
          }
          const testClsRel = `classes/${cls}Test.cls`;
          const testMetaRel = `classes/${cls}Test.cls-meta.xml`;
          if (fs.existsSync(path.join(source.root, 'force-app/main/default', testClsRel))) {
            files.push(testClsRel);
            if (fs.existsSync(path.join(source.root, 'force-app/main/default', testMetaRel))) {
              files.push(testMetaRel);
            }
          }
        }

        // Parse CustomLabels if present
        const labels = [];
        const labelPaths = [
          path.join(source.root, 'force-app/main/default/labels/CustomLabels.labels-meta.xml'),
          path.join(source.root, 'main/default/labels/CustomLabels.labels-meta.xml')
        ];
        for (const lp of labelPaths) {
          try {
            const xml = await readFile(lp, 'utf8');
            const labelBlocks = [...xml.matchAll(/<labels>([\s\S]*?)<\/labels>/g)];
            for (const lb of labelBlocks) {
              const nm = lb[1].match(/<fullName>(.*?)<\/fullName>/);
              const val = lb[1].match(/<value>(.*?)<\/value>/);
              if (nm && val) {
                const fullName = nm[1].trim();
                if (labelNames.has(fullName) || fullName.toLowerCase().startsWith(name.toLowerCase() + '_')) {
                  labels.push({ fullName, value: val[1].trim() });
                }
              }
            }
            if (labels.length) break;
          } catch {}
        }

        const synthesized = {
          name,
          version: '1.0.0',
          description,
          apiVersion,
          files: [...new Set(files)],
          dependencies: Array.from(dependencies),
          labels,
          _rawPrefix: `${prefix}/${name}`
        };

        validate(synthesized, name);
        return synthesized;
      } catch {}
    }
  }

  // 2. Inspect remote SFDX repository tree
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
            const labelMatch = metaXml.match(/<masterLabel>([\s\S]*?)<\/masterLabel>/i);
            if (!descMatch && labelMatch) description = labelMatch[1].trim();
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

  // 3. Casing-agnostic fallback: Check if a bundle matches under camelCase, kebab-case, or case-insensitive name
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
  let resolvedNames = names;
  if (typeof source?.listLwcBundles === 'function') {
    try {
      const { bundles } = await source.listLwcBundles();
      const bundleNames = bundles.map((b) => b.name);
      resolvedNames = names.map((n) => matchComponentName(bundleNames, n));
    } catch {
      // If listLwcBundles fails or cannot be read, proceed with original names
    }
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
