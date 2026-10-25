import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findProject } from './project.js';

// ─────────────────────────────────────────────────────────────────────────────
// METADATA REGISTRY: Dynamic mapping from Salesforce metadata types to project files
// ─────────────────────────────────────────────────────────────────────────────
export const METADATA_REGISTRY = {
  LightningComponentBundle: {
    canRecurse: true,
    resolve: (name, pkgDir) => {
      const dir = path.join(pkgDir, 'lwc', name);
      return fs.existsSync(dir) ? getAllFilesRecursively(dir, pkgDir) : [];
    }
  },
  AuraDefinitionBundle: {
    canRecurse: true,
    resolve: (name, pkgDir) => {
      const dir = path.join(pkgDir, 'aura', name);
      return fs.existsSync(dir) ? getAllFilesRecursively(dir, pkgDir) : [];
    }
  },
  ApexClass: {
    canRecurse: true,
    resolve: (name, pkgDir) => {
      const files = [];
      const cls = path.join(pkgDir, 'classes', `${name}.cls`);
      const meta = path.join(pkgDir, 'classes', `${name}.cls-meta.xml`);
      if (fs.existsSync(cls)) files.push(`classes/${name}.cls`);
      if (fs.existsSync(meta)) files.push(`classes/${name}.cls-meta.xml`);

      const testCls = path.join(pkgDir, 'classes', `${name}Test.cls`);
      const testMeta = path.join(pkgDir, 'classes', `${name}Test.cls-meta.xml`);
      if (fs.existsSync(testCls)) files.push(`classes/${name}Test.cls`);
      if (fs.existsSync(testMeta)) files.push(`classes/${name}Test.cls-meta.xml`);
      return files;
    }
  },
  ApexPage: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const files = [];
      const page = path.join(pkgDir, 'pages', `${name}.page`);
      const meta = path.join(pkgDir, 'pages', `${name}.page-meta.xml`);
      if (fs.existsSync(page)) files.push(`pages/${name}.page`);
      if (fs.existsSync(meta)) files.push(`pages/${name}.page-meta.xml`);
      return files;
    }
  },
  ApexComponent: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const files = [];
      const cmp = path.join(pkgDir, 'components', `${name}.component`);
      const meta = path.join(pkgDir, 'components', `${name}.component-meta.xml`);
      if (fs.existsSync(cmp)) files.push(`components/${name}.component`);
      if (fs.existsSync(meta)) files.push(`components/${name}.component-meta.xml`);
      return files;
    }
  },
  StaticResource: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const files = [];
      const meta = path.join(pkgDir, 'staticresources', `${name}.resource-meta.xml`);
      if (fs.existsSync(meta)) files.push(`staticresources/${name}.resource-meta.xml`);

      const resFile = path.join(pkgDir, 'staticresources', `${name}.resource`);
      const resDir = path.join(pkgDir, 'staticresources', name);
      if (fs.existsSync(resFile)) {
        files.push(`staticresources/${name}.resource`);
      } else if (fs.existsSync(resDir)) {
        files.push(...getAllFilesRecursively(resDir, pkgDir));
      }
      return files;
    }
  },
  LightningMessageChannel: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const f = path.join(pkgDir, 'messageChannels', `${name}.messageChannel-meta.xml`);
      return fs.existsSync(f) ? [`messageChannels/${name}.messageChannel-meta.xml`] : [];
    }
  },
  CustomTab: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const f = path.join(pkgDir, 'tabs', `${name}.tab-meta.xml`);
      return fs.existsSync(f) ? [`tabs/${name}.tab-meta.xml`] : [];
    }
  },
  CustomObject: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const files = [];
      const candidates = [name, `${name}__c`, name.replace(/__c$/, '')];
      for (const cand of candidates) {
        const objDir = path.join(pkgDir, 'objects', cand);
        if (fs.existsSync(objDir) && fs.statSync(objDir).isDirectory()) {
          files.push(...getAllFilesRecursively(objDir, pkgDir));
        }
        const objFile = path.join(pkgDir, 'objects', `${cand}.object-meta.xml`);
        if (fs.existsSync(objFile)) {
          files.push(`objects/${cand}.object-meta.xml`);
        }
        if (files.length) return [...new Set(files)];
      }
      return [];
    }
  },
  CustomField: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      if (name.includes('.')) {
        const [objName, fldName] = name.split('.');
        const fieldMeta = path.join(pkgDir, 'objects', objName, 'fields', `${fldName}.field-meta.xml`);
        if (fs.existsSync(fieldMeta)) return [`objects/${objName}/fields/${fldName}.field-meta.xml`];
      } else {
        const objectsDir = path.join(pkgDir, 'objects');
        if (fs.existsSync(objectsDir)) {
          for (const obj of fs.readdirSync(objectsDir)) {
            const fieldMeta = path.join(objectsDir, obj, 'fields', `${name}.field-meta.xml`);
            if (fs.existsSync(fieldMeta)) return [`objects/${obj}/fields/${name}.field-meta.xml`];
          }
        }
      }
      return [];
    }
  },
  PermissionSet: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const f = path.join(pkgDir, 'permissionsets', `${name}.permissionset-meta.xml`);
      return fs.existsSync(f) ? [`permissionsets/${name}.permissionset-meta.xml`] : [];
    }
  },
  CustomMetadata: {
    canRecurse: false,
    resolve: (name, pkgDir) => {
      const f = path.join(pkgDir, 'customMetadata', `${name}.md-meta.xml`);
      return fs.existsSync(f) ? [`customMetadata/${name}.md-meta.xml`] : [];
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function defaultRunToolingQuery(query, targetOrg) {
  const orgArg = targetOrg ? ` --target-org "${targetOrg}"` : '';
  const escapedQuery = query.replace(/"/g, '\\"');
  const cmd = `sf data query --use-tooling-api${orgArg} --query "${escapedQuery}" --json`;
  const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  const parsed = JSON.parse(output);
  if (parsed.status !== 0) {
    throw new Error(parsed.message || 'Tooling query failed');
  }
  return parsed.result?.records ?? [];
}

export function toKebabCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseLabelBlock(xmlContent, labelName) {
  const blockRegex = new RegExp(`<labels>[\\s\\S]*?<fullName>\\s*${escRe(labelName)}\\s*<\\/fullName>[\\s\\S]*?<\\/labels>`, 'm');
  const match = xmlContent.match(blockRegex);
  if (!match) return null;

  const block = match[0];
  const getTag = (tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : null;
  };

  const label = {
    fullName: labelName,
    value: getTag('value') ?? ''
  };
  const shortDesc = getTag('shortDescription');
  if (shortDesc !== null) label.shortDescription = shortDesc;
  const lang = getTag('language');
  if (lang !== null) label.language = lang;
  const isProt = getTag('protected');
  if (isProt !== null) label.protected = isProt === 'true';

  return label;
}

export function getAllFilesRecursively(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const item of fs.readdirSync(dir)) {
    if (item === '__tests__' || item === '.git' || item === 'node_modules' || item.startsWith('.')) continue;
    const fullPath = path.join(dir, item);
    const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(getAllFilesRecursively(fullPath, baseDir));
    } else {
      results.push(rel);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT & RESOLUTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
export async function pack(componentName, options = {}) {
  const targetOrg = options.targetOrg || undefined;
  const projectRoot = options.projectRoot || path.resolve(options.cwd || '.');

  let packageDefault = options.packageDefault;
  if (!packageDefault) {
    try {
      const proj = await findProject(projectRoot);
      packageDefault = proj.targetRoot;
    } catch {
      packageDefault = path.join(projectRoot, 'force-app', 'main', 'default');
    }
  }

  const registryName = options.registryName || toKebabCase(componentName);
  const destDir = options.destDir || options.output
    ? path.resolve(projectRoot, options.destDir || options.output)
    : path.join(projectRoot, 'components', registryName);

  if (fs.existsSync(destDir) && !options.overwrite && !options.dryRun) {
    throw new Error(`Destination directory "${destDir}" already exists. Use -w / --overwrite to replace.`);
  }

  const queryTooling = options.queryToolingApi || defaultRunToolingQuery;
  const log = options.log || (options.json ? () => {} : console.log);

  log(`\n🔍 [1/5] Resolving root bundle for '${componentName}'${targetOrg ? ` in org '${targetOrg}'` : ''}...`);
  const lwcRecords = queryTooling(
    `SELECT Id, DeveloperName, ApiVersion FROM LightningComponentBundle WHERE DeveloperName = '${componentName}'`,
    targetOrg
  );

  if (!lwcRecords || lwcRecords.length === 0) {
    throw new Error(`LWC '${componentName}' not found in org${targetOrg ? ` '${targetOrg}'` : ''}`);
  }

  const bundleId = lwcRecords[0].Id;
  let apiVersion = '62.0';
  if (lwcRecords[0].ApiVersion) {
    const v = String(lwcRecords[0].ApiVersion);
    apiVersion = v.includes('.') ? v : `${v}.0`;
  }
  log(`   Found bundle Id: ${bundleId} (API ${apiVersion})`);

  log(`\n🕸️ [2/5] Traversing dependency graph dynamically from Tooling API...`);
  const visitedIds = new Set();
  const queue = [{ id: bundleId, name: componentName, type: 'LightningComponentBundle' }];

  const discoveredByType = new Map();
  const discoveredLabels = new Set();
  const dependencyTree = {};

  while (queue.length > 0) {
    const current = queue.shift();
    if (visitedIds.has(current.id)) continue;
    visitedIds.add(current.id);

    const depRecords = queryTooling(
      `SELECT MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentId = '${current.id}'`,
      targetOrg
    );

    for (const dep of depRecords) {
      const refName = dep.RefMetadataComponentName;
      const refType = dep.RefMetadataComponentType;
      const refId = dep.RefMetadataComponentId;

      log(`   -> ${current.name} (${current.type}) depends on ${refName} (${refType})`);
      if (!dependencyTree[current.name]) dependencyTree[current.name] = [];
      dependencyTree[current.name].push({ name: refName, type: refType });

      if (refType === 'CustomLabel') {
        discoveredLabels.add(refName);
      } else if (refType === 'StandardEntity') {
        // Built-in standard entities (Account, Contact, User, etc.) exist across all orgs natively
        continue;
      } else {
        if (!discoveredByType.has(refType)) {
          discoveredByType.set(refType, new Set());
        }
        discoveredByType.get(refType).add(refName);

        // Recursively traverse dependencies if the handler allows it
        const handler = METADATA_REGISTRY[refType];
        if (handler && handler.canRecurse && refId && !visitedIds.has(refId)) {
          queue.push({ id: refId, name: refName, type: refType });
        }
      }
    }
  }

  log(`\n📂 [3/5] Dynamically resolving local files across discovered types...`);
  const filesToCopy = new Set();

  // 1. Resolve root LWC bundle files
  const rootFiles = METADATA_REGISTRY.LightningComponentBundle.resolve(componentName, packageDefault);
  if (rootFiles.length === 0) {
    throw new Error(`Local source files for '${componentName}' not found in ${path.join(packageDefault, 'lwc', componentName)}`);
  }
  rootFiles.forEach((f) => filesToCopy.add(f));

  // 2. Resolve all other discovered metadata types generically
  for (const [type, names] of discoveredByType.entries()) {
    const handler = METADATA_REGISTRY[type];
    if (!handler) {
      log(`   ℹ️ Note: No file handler configured for '${type}', skipping file bundling.`);
      continue;
    }

    for (const name of names) {
      // Avoid re-resolving root component as child
      if (type === 'LightningComponentBundle' && name === componentName) continue;

      const resolved = handler.resolve(name, packageDefault);
      if (resolved.length > 0) {
        log(`   ✔ Resolved ${type} '${name}': ${resolved.length} file(s)`);
        resolved.forEach((f) => filesToCopy.add(f));
      } else {
        log(`   ⚠️ Note: ${type} '${name}' not found locally in ${packageDefault}`);
      }
    }
  }

  // 3. Resolve Custom Labels
  const labelEntries = [];
  const labelsMetaPath = path.join(packageDefault, 'labels', 'CustomLabels.labels-meta.xml');
  if (discoveredLabels.size > 0 && fs.existsSync(labelsMetaPath)) {
    const xml = fs.readFileSync(labelsMetaPath, 'utf-8');
    for (const labelName of discoveredLabels) {
      const parsed = parseLabelBlock(xml, labelName);
      if (parsed) labelEntries.push(parsed);
    }
  }

  const filesArray = Array.from(filesToCopy).sort();
  const manifest = {
    name: registryName,
    version: options.version || '1.0.0',
    description: options.description || `Exported ${componentName} component with auto-resolved dependencies.`,
    apiVersion,
    dependencies: options.dependencies || [],
    files: filesArray,
    labels: labelEntries
  };
  if (options.notes?.length) {
    manifest.notes = options.notes;
  }

  log(`\n📦 [4/5] ${options.dryRun ? '[dry-run] Would package' : 'Packaging'} component into '${destDir}'...`);
  const filesDest = path.join(destDir, 'files');

  if (!options.dryRun) {
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.mkdirSync(filesDest, { recursive: true });

    for (const rel of filesArray) {
      const srcPath = path.join(packageDefault, rel);
      const targetPath = path.join(filesDest, rel);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(srcPath, targetPath);
    }
    log(`   Packaged ${filesArray.length} total files.`);

    const manifestPath = path.join(destDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    log(`   wrote manifest.json`);
  } else {
    log(`   [dry-run] Would package ${filesArray.length} total files.`);
    log(`   [dry-run] Would write manifest.json`);
  }

  log(`\n🎉 [5/5] Successfully ${options.dryRun ? 'inspected (dry-run)' : 'exported'} '${registryName}'!`);

  const result = {
    manifest,
    destDir,
    files: filesArray,
    discoveredByType: Object.fromEntries(
      Array.from(discoveredByType.entries()).map(([k, v]) => [k, Array.from(v)])
    ),
    discoveredLabels: Array.from(discoveredLabels),
    dependencyTree,
    dryRun: Boolean(options.dryRun)
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

export const packComponent = pack;
export const exportComponent = pack;
