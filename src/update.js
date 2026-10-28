import path from 'node:path';
import { readLock, install, LOCK_FILE } from './install.js';
import { createSource } from './source.js';
import { loadManifest } from './resolve.js';
import { findProject } from './project.js';
import { readConfig } from './init.js';

/**
 * Compare two semver strings (e.g., '1.0.0' vs '1.1.0').
 * Returns >0 if v1 > v2, <0 if v1 < v2, 0 if equal.
 */
export function compareSemver(v1 = '0.0.0', v2 = '0.0.0') {
  const p1 = v1.split('.').map(n => parseInt(n, 10) || 0);
  const p2 = v2.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] ?? 0) > (p2[i] ?? 0)) return 1;
    if ((p1[i] ?? 0) < (p2[i] ?? 0)) return -1;
  }
  return 0;
}

/**
 * Check and upgrade installed components to upstream registry versions.
 * @param {object} options
 * @param {string[]} [options.names] - Specific component names to update
 * @param {boolean} [options.all] - Update all outdated components
 * @param {string} [options.from] - Custom registry override
 * @param {string} [options.cwd] - Target project path
 * @param {boolean} [options.dryRun] - Show what would happen
 * @param {boolean} [options.force] - Force update even if already at latest version
 * @param {boolean} [options.json] - Output pure JSON
 * @param {function} [options.log] - Logging function
 * @returns {Promise<{ updated: Array<{ name: string, from: string, to: string }>, upToDate: string[], plans: Array }>}
 */
export async function update(options = {}) {
  const projectRoot = path.resolve(options.cwd || '.');
  const project = await findProject(projectRoot);
  const config = await readConfig(project.root);
  const registry = options.from || config?.registry || process.env.SF_LWC_REGISTRY || '.';
  const log = options.log || console.log;

  const lock = await readLock(project.root);
  const installedNames = Object.keys(lock.components || {});

  if (installedNames.length === 0) {
    if (!options.json) log('No components currently installed. Nothing to update.');
    return { updated: [], upToDate: [], plans: [] };
  }

  let targetNames = options.names && options.names.length > 0 ? options.names : [];
  if (options.all || targetNames.length === 0) {
    targetNames = installedNames;
  }

  // Validate requested targets
  for (const name of targetNames) {
    if (!lock.components[name]) {
      throw new Error(`Component '${name}' is not installed in this project. Use 'sf-lwc add ${name}' to install.`);
    }
  }

  const source = options.source || createSource(registry);
  const plans = [];
  const updated = [];
  const upToDate = [];
  const toInstallManifests = [];

  for (const name of targetNames) {
    const installed = lock.components[name];
    const upstream = await loadManifest(source, name);
    const cmp = compareSemver(upstream.version, installed.version);

    if (cmp > 0 || options.force) {
      plans.push({
        name,
        currentVersion: installed.version,
        latestVersion: upstream.version,
        needsUpdate: true
      });
      toInstallManifests.push({ ...upstream, name });
      updated.push({
        name,
        from: installed.version,
        to: upstream.version
      });
    } else {
      plans.push({
        name,
        currentVersion: installed.version,
        latestVersion: upstream.version,
        needsUpdate: false
      });
      upToDate.push(name);
    }
  }

  if (options.json) {
    return { updated, upToDate, plans };
  }

  if (toInstallManifests.length === 0) {
    log('All components are up to date.');
    return { updated, upToDate, plans };
  }

  log(`Updating ${toInstallManifests.length} component(s)...`);
  await install({
    source,
    manifests: toInstallManifests,
    project,
    overwrite: true,
    dryRun: options.dryRun,
    log
  });

  return { updated, upToDate, plans };
}
