import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { findProject } from './project.js';
import { readConfig } from './init.js';
import { readLock, LOCK_FILE } from './install.js';
import { createSource } from './source.js';

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Diagnostic health check for Salesforce DX projects using sf-lwc.
 * @param {object} [options]
 * @param {string} [options.cwd] - Target project path
 * @param {boolean} [options.json] - Output pure JSON
 * @returns {Promise<{ ok: boolean, checks: Array<{ name: string, status: 'pass'|'warn'|'fail', message: string }> }>}
 */
export async function doctor(options = {}) {
  const projectRoot = path.resolve(options.cwd || '.');
  const checks = [];
  let allOk = true;

  // 1. Check sfdx-project.json and package directories
  let project;
  try {
    project = await findProject(projectRoot);
    checks.push({
      name: 'sfdx-project.json',
      status: 'pass',
      message: `Found valid Salesforce DX project at ${path.basename(project.root)} (default package dir: ${path.relative(project.root, project.targetRoot)})`
    });
  } catch (err) {
    allOk = false;
    checks.push({
      name: 'sfdx-project.json',
      status: 'fail',
      message: `Not a valid Salesforce DX project: ${err.message}`
    });
    return { ok: false, checks };
  }

  // 2. Check sf-lwc.json configuration
  const config = await readConfig(project.root);
  if (config) {
    checks.push({
      name: 'sf-lwc.json',
      status: 'pass',
      message: `Configured registry: ${config.registry}`
    });

    // Test registry connectivity
    try {
      const source = createSource(config.registry);
      checks.push({
        name: 'registry-source',
        status: 'pass',
        message: `Registry source resolved: ${source.label}`
      });
    } catch (err) {
      checks.push({
        name: 'registry-source',
        status: 'warn',
        message: `Failed to resolve registry "${config.registry}": ${err.message}`
      });
    }
  } else {
    checks.push({
      name: 'sf-lwc.json',
      status: 'warn',
      message: 'No sf-lwc.json found. Run "sf-lwc init" to set a default registry.'
    });
  }

  // 3. Check lockfile and installed file integrity
  const lockExists = await exists(path.join(project.root, LOCK_FILE));
  if (!lockExists) {
    checks.push({
      name: 'sf-lwc.lock.json',
      status: 'pass',
      message: 'No lockfile present (0 components installed).'
    });
  } else {
    const lock = await readLock(project.root);
    const components = Object.entries(lock.components || {});
    checks.push({
      name: 'sf-lwc.lock.json',
      status: 'pass',
      message: `Lockfile tracks ${components.length} installed component(s).`
    });

    let missingFilesCount = 0;
    for (const [compName, info] of components) {
      for (const relFile of info.files || []) {
        const fullPath = path.join(project.targetRoot, relFile);
        if (!(await exists(fullPath))) {
          missingFilesCount++;
          checks.push({
            name: `file:${compName}/${relFile}`,
            status: 'fail',
            message: `Missing tracked file on disk: ${relFile}`
          });
        }
      }
    }

    if (missingFilesCount > 0) {
      allOk = false;
    } else if (components.length > 0) {
      checks.push({
        name: 'file-integrity',
        status: 'pass',
        message: 'All tracked component files exist on disk.'
      });
    }
  }

  // 4. Check CustomLabels.labels-meta.xml
  const labelsFile = path.join(project.targetRoot, 'labels', 'CustomLabels.labels-meta.xml');
  if (await exists(labelsFile)) {
    try {
      const xml = await readFile(labelsFile, 'utf8');
      if (xml.includes('<CustomLabels') && xml.includes('</CustomLabels>')) {
        checks.push({
          name: 'CustomLabels',
          status: 'pass',
          message: 'CustomLabels.labels-meta.xml is well-formed.'
        });
      } else {
        checks.push({
          name: 'CustomLabels',
          status: 'warn',
          message: 'CustomLabels.labels-meta.xml may be malformed.'
        });
      }
    } catch (err) {
      checks.push({
        name: 'CustomLabels',
        status: 'warn',
        message: `Could not read CustomLabels: ${err.message}`
      });
    }
  }

  return { ok: allOk, checks };
}
