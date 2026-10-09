import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { validate } from './resolve.js';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const IS_LOCAL_PATH_RE = /^(\.|\/|~)|^[a-zA-Z]:[\\/]/;

function isLocalSpec(spec) {
  return IS_LOCAL_PATH_RE.test(spec);
}

async function discoverLocalComponentNames(spec) {
  const componentsDir = path.join(path.resolve(spec), 'components');
  const entries = await readdir(componentsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && NAME_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function discoverRemoteComponentNames(spec) {
  const m = spec.match(/^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/);
  if (!m) throw new Error(`Invalid registry "${spec}". Use owner/repo[@ref] or a local path.`);
  const [, owner, repo, ref = 'main'] = m;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: 'token ' + token } : {})
  };
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/components?ref=${encodeURIComponent(ref)}`, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} listing components from ${owner}/${repo}@${ref}` + (res.status === 404 && !token ? ' (private repo? set GITHUB_TOKEN)' : ''));
  }
  const entries = await res.json();
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry?.type === 'dir' && NAME_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
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
    } catch {
      continue;
    }
    validate(manifest, name);
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
