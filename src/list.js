import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { validate, NAME_RE } from './resolve.js';
import { normalizeSpec } from './source.js';

const IS_LOCAL_PATH_RE = /^(\.|\/|~)|^[a-zA-Z]:[\\/]/;

function isLocalSpec(spec) {
  return IS_LOCAL_PATH_RE.test(normalizeSpec(spec));
}

async function discoverLocalComponentNames(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const root = path.resolve(spec);

  // 1. Try registry format: components/
  try {
    const componentsDir = path.join(root, 'components');
    const entries = await readdir(componentsDir, { withFileTypes: true });
    const found = entries
      .filter((entry) => entry.isDirectory() && NAME_RE.test(entry.name))
      .map((entry) => entry.name);
    if (found.length) return found.sort();
  } catch {}

  // 2. Direct DX fallback: force-app/main/default/lwc, main/default/lwc
  for (const sub of ['force-app/main/default/lwc', 'main/default/lwc']) {
    try {
      const lwcDir = path.join(root, sub);
      const entries = await readdir(lwcDir, { withFileTypes: true });
      const found = entries
        .filter((entry) => entry.isDirectory() && NAME_RE.test(entry.name))
        .map((entry) => entry.name);
      if (found.length) return found.sort();
    } catch {}
  }

  return [];
}

async function discoverRemoteComponentNames(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const m = spec.match(/^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/);
  if (!m) throw new Error(`Invalid registry "${rawSpec}". Use owner/repo[@ref], a GitHub URL, or a local path.`);
  const [, owner, repo, ref] = m;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sf-lwc',
    ...(token ? { Authorization: 'token ' + token } : {})
  };

  const candidatePaths = [
    'components',
    'force-app/main/default/lwc',
    'main/default/lwc'
  ];

  let lastStatus = 404;
  for (const candidate of candidatePaths) {
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${candidate}${refParam}`, { headers });
    if (res.ok) {
      const entries = await res.json();
      if (Array.isArray(entries)) {
        const names = entries
          .filter((entry) => entry?.type === 'dir' && NAME_RE.test(entry.name))
          .map((entry) => entry.name)
          .sort();
        if (names.length) return names;
      }
    } else {
      lastStatus = res.status;
      if (res.status === 403) {
        throw new Error('GitHub API rate limit exceeded. Set GITHUB_TOKEN to increase limit.');
      }
      if (res.status === 401) {
        throw new Error('GitHub authentication failed. Check GITHUB_TOKEN.');
      }
    }
  }

  throw new Error(`${lastStatus} listing components from ${owner}/${repo}${ref ? '@' + ref : ''}` + (lastStatus === 404 && !token ? ' (private repo? set GITHUB_TOKEN)' : ''));
}

async function discoverComponentNames(spec) {
  return isLocalSpec(spec) ? discoverLocalComponentNames(spec) : discoverRemoteComponentNames(spec);
}

export async function listComponents(source, spec) {
  const names = await discoverComponentNames(spec);
  const components = [];
  for (const name of names) {
    let manifest;
    try {
      const buf = await source.read(`components/${name}/manifest.json`);
      manifest = JSON.parse(buf.toString('utf8'));
      validate(manifest, name);
    } catch {
      // Direct DX Fallback synthesized entry
      manifest = {
        name,
        description: '',
        version: '1.0.0',
        dependencies: []
      };
    }
    components.push({
      name: manifest.name,
      description: manifest.description ?? '',
      version: manifest.version,
      dependencies: manifest.dependencies ?? []
    });
  }
  return components.sort((a, b) => a.name.localeCompare(b.name));
}

export function formatComponentList(components) {
  if (!components.length) return 'No components found.';
  return components
    .map((component) => {
      const lines = [`- ${component.name}@${component.version}`];
      if (component.description) lines.push(`  ${component.description}`);
      lines.push(`  dependencies: ${component.dependencies.length ? component.dependencies.join(', ') : 'none'}`);
      return lines.join('\n');
    })
    .join('\n');
}
