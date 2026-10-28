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

/**
 * Helper to recursively harvest files in a directory relative to a base directory.
 */
export function getAllFilesRecursively(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '__tests__' || item.name === '.git' || item.name === 'node_modules' || item.name.startsWith('.')) continue;
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(getAllFilesRecursively(fullPath, baseDir));
    } else if (item.isFile()) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * Auto-pack a local component by inspecting its files and recursively discovering dependencies
 * (Apex classes, child LWCs, Custom Objects, Custom Labels, Static Resources, Message Channels).
 * Emits and writes a package manifest to .sf-lwc/<name>.json in the source project.
 */
export async function packLocalComponent(sourceRoot, name, prefix, entries) {
  const compDir = path.join(sourceRoot, prefix, name);
  const pkgPrefix = prefix.replace(/\/lwc$/, '');
  const pkgDir = path.join(sourceRoot, pkgPrefix);

  const files = entries
    .filter((e) => e.isFile())
    .map((e) => `lwc/${name}/${e.name}`);

  let apiVersion = '62.0';
  let description = `Component from ${sourceRoot}`;
  const dependencies = new Set();
  const labelNames = new Set();
  const apexClasses = new Set();
  const customObjects = new Set();
  const staticResources = new Set();
  const messageChannels = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(compDir, entry.name);
    if (entry.name === `${name}.js-meta.xml`) {
      try {
        const metaXml = await readFile(fullPath, 'utf8');
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
        const code = await readFile(fullPath, 'utf8');
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
        const resMatches = [...code.matchAll(/from\s+['"]@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)['"]/g)];
        for (const rm of resMatches) {
          staticResources.add(rm[1]);
        }
        const mcMatches = [...code.matchAll(/from\s+['"]@salesforce\/messageChannel\/([a-zA-Z0-9_]+)['"]/g)];
        for (const mm of mcMatches) {
          messageChannels.add(mm[1]);
        }
      } catch {}
    }
  }

  // Recursive Apex class and Custom Object dependency analysis
  const visitedClasses = new Set();
  const queue = Array.from(apexClasses);
  const classesDir = path.join(pkgDir, 'classes');
  const objectsDir = path.join(pkgDir, 'objects');

  let allClasses = [];
  if (fs.existsSync(classesDir)) {
    allClasses = fs.readdirSync(classesDir)
      .filter((f) => f.endsWith('.cls'))
      .map((f) => f.replace(/\.cls$/, ''));
  }

  let allObjects = [];
  if (fs.existsSync(objectsDir)) {
    allObjects = fs.readdirSync(objectsDir).filter((f) => {
      try { return fs.statSync(path.join(objectsDir, f)).isDirectory(); } catch { return false; }
    });
  }

  while (queue.length > 0) {
    const cls = queue.shift();
    if (visitedClasses.has(cls)) continue;
    visitedClasses.add(cls);

    const clsFile = path.join(classesDir, `${cls}.cls`);
    if (fs.existsSync(clsFile)) {
      files.push(`classes/${cls}.cls`);
      const metaFile = path.join(classesDir, `${cls}.cls-meta.xml`);
      if (fs.existsSync(metaFile)) files.push(`classes/${cls}.cls-meta.xml`);

      const testCls = path.join(classesDir, `${cls}Test.cls`);
      const testMeta = path.join(classesDir, `${cls}Test.cls-meta.xml`);
      if (fs.existsSync(testCls)) files.push(`classes/${cls}Test.cls`);
      if (fs.existsSync(testMeta)) files.push(`classes/${cls}Test.cls-meta.xml`);

      try {
        const clsContent = fs.readFileSync(clsFile, 'utf8');
        for (const other of allClasses) {
          if (other !== cls && !visitedClasses.has(other)) {
            const re = new RegExp(`\\b${other}\\b`);
            if (re.test(clsContent)) {
              queue.push(other);
              apexClasses.add(other);
            }
          }
        }
        for (const obj of allObjects) {
          const re = new RegExp(`\\b${obj}\\b`);
          if (re.test(clsContent)) {
            customObjects.add(obj);
          }
        }
        const clsLblMatches = [...clsContent.matchAll(/(?:System\.Label\.|Label\.)([a-zA-Z0-9_]+)/g)];
        for (const clm of clsLblMatches) {
          labelNames.add(clm[1]);
        }
      } catch {}
    }
  }

  // Resolve custom objects
  for (const obj of customObjects) {
    const objDir = path.join(objectsDir, obj);
    if (fs.existsSync(objDir)) {
      const objFiles = getAllFilesRecursively(objDir, pkgDir);
      files.push(...objFiles);
    }
    const singleObjFile = path.join(objectsDir, `${obj}.object-meta.xml`);
    if (fs.existsSync(singleObjFile)) {
      files.push(`objects/${obj}.object-meta.xml`);
    }
  }

  // Resolve static resources
  for (const res of staticResources) {
    const resMeta = path.join(pkgDir, 'staticresources', `${res}.resource-meta.xml`);
    if (fs.existsSync(resMeta)) files.push(`staticresources/${res}.resource-meta.xml`);
    const resFile = path.join(pkgDir, 'staticresources', `${res}.resource`);
    if (fs.existsSync(resFile)) files.push(`staticresources/${res}.resource`);
    const resDir = path.join(pkgDir, 'staticresources', res);
    if (fs.existsSync(resDir)) files.push(...getAllFilesRecursively(resDir, pkgDir));
  }

  // Resolve message channels
  for (const mc of messageChannels) {
    const mcFile = path.join(pkgDir, 'messageChannels', `${mc}.messageChannel-meta.xml`);
    if (fs.existsSync(mcFile)) files.push(`messageChannels/${mc}.messageChannel-meta.xml`);
  }

  // Parse CustomLabels if present
  const labels = [];
  const labelFile = path.join(pkgDir, 'labels', 'CustomLabels.labels-meta.xml');
  if (fs.existsSync(labelFile)) {
    try {
      const xml = fs.readFileSync(labelFile, 'utf8');
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
    } catch {}
  }

  const manifest = {
    name,
    version: '1.0.0',
    description,
    apiVersion,
    files: [...new Set(files)],
    dependencies: Array.from(dependencies),
    labels,
    _rawPrefix: `${prefix}/${name}`,
    _packageDefault: pkgPrefix
  };

  validate(manifest, name);

  // Write packed manifest to .sf-lwc/<name>.json in sourceRoot
  try {
    const dotSfLwcDir = path.join(sourceRoot, '.sf-lwc');
    if (!fs.existsSync(dotSfLwcDir)) fs.mkdirSync(dotSfLwcDir, { recursive: true });
    fs.writeFileSync(path.join(dotSfLwcDir, `${name}.json`), JSON.stringify(manifest, null, 2) + '\n');
  } catch {}

  return manifest;
}

export async function loadManifest(source, name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid component name "${name}"`);

  // 1. Source verification: Verify whether the source is a valid SFDX project
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

        // 3. Check whether component is packed / published
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
          // Check whether all declared dependencies and files exist in the project
          const missingFiles = packedManifest.files.filter((f) => {
            if (f.startsWith(`lwc/${name}/`)) {
              return !fs.existsSync(path.join(compDir, f.slice(`lwc/${name}/`.length)));
            }
            return !fs.existsSync(path.join(source.root, pkgPrefix, f));
          });

          if (missingFiles.length === 0) {
            packedManifest._rawPrefix = `${prefix}/${name}`;
            packedManifest._packageDefault = pkgPrefix;
            validate(packedManifest, name);
            return packedManifest;
          }
          // If dependencies are missing, for local project we re-run export/pack to refresh dependencies
        }

        // Run local auto-pack to discover and pack all dependencies
        return await packLocalComponent(source.root, name, prefix, entries);
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

          // Check if remote has packed manifest
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

          if (packedManifest && Array.isArray(packedManifest.files) && packedManifest.files.length > 0) {
            // Check if remote files exist
            let tree = [];
            try { tree = await source.getTree(); } catch {}
            const existingPaths = new Set(tree.map((t) => t.path));
            const pkgPrefix = prefix.replace(/\/lwc$/, '');

            const missingFiles = [];
            for (const f of packedManifest.files) {
              const fullRem = f.startsWith(`lwc/${name}/`) ? `${prefix}/${name}/${path.basename(f)}` : `${pkgPrefix}/${f}`;
              if (existingPaths.size > 0 && !existingPaths.has(fullRem)) {
                missingFiles.push(f);
              }
            }

            if (missingFiles.length > 0) {
              console.warn(`Warning: Component "${name}" has missing dependencies in remote repository "${source.label}": ${missingFiles.join(', ')}. Installing available component files.`);
              packedManifest.files = packedManifest.files.filter((f) => !missingFiles.includes(f));
            }

            packedManifest._rawPrefix = `${prefix}/${name}`;
            packedManifest._packageDefault = pkgPrefix;
            validate(packedManifest, name);
            return packedManifest;
          }

          // Component is not packed/published in remote repository
          console.warn(`Warning: Component "${name}" is not published yet in remote repository "${source.label}". Cannot automatically identify all dependencies; installing available component files.`);

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
            _rawPrefix: `${prefix}/${name}`,
            _packageDefault: prefix.replace(/\/lwc$/, '')
          };

          validate(synthesized, name);
          return synthesized;
        }
      } catch {}
    }
  }

  // 4. Casing-agnostic fallback: Check if a bundle matches under camelCase, kebab-case, or case-insensitive name
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
