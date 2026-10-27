import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Normalizes any git or registry specifier (GitHub URL, git SSH, owner/repo)
 * to a canonical owner/repo[@ref] or local directory path.
 *
 * Examples:
 *   https://github.com/svierk/awesome-lwc-collection.git -> svierk/awesome-lwc-collection
 *   git@github.com:owner/repo.git -> owner/repo
 *   github:owner/repo -> owner/repo
 *   owner/repo@v1.0.0 -> owner/repo@v1.0.0
 */
export function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'string') return spec;
  const trimmed = spec.trim();
  if (/^(\.|\/|~)/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }
  let s = trimmed;
  s = s.replace(/^github:/i, '');
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/^https?:\/\/github\.com\//i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/^\/+/, '');
  const treeMatch = s.match(/^([\w.-]+)\/([\w.-]+)\/tree\/(.+)$/);
  if (treeMatch) {
    return `${treeMatch[1]}/${treeMatch[2]}@${treeMatch[3]}`;
  }
  return s;
}

// A "source" is a registry: a local folder or a GitHub repo (owner/repo[@ref]).
// Layout: components/<name>/manifest.json and components/<name>/files/<path>
// Also supports direct Salesforce DX repos (e.g. force-app/main/default/lwc/<name>).
export function createSource(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  if (/^(\.|\/|~)/.test(spec) || /^[a-zA-Z]:[\\/]/.test(spec)) {
    const root = path.resolve(spec);
    const read = (rel) => readFile(path.join(root, rel));
    return {
      type: 'local',
      label: root,
      root,
      read,
      readFile: read,
      async readComponentFile(manifest, rel) {
        if (manifest._rawPrefix) {
          return readFile(path.join(root, manifest._rawPrefix, path.basename(rel)));
        }
        return read(`components/${manifest.name}/files/${rel}`);
      }
    };
  }

  const m = spec.match(/^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/);
  if (!m) throw new Error(`Invalid registry "${rawSpec}". Use owner/repo[@ref], a GitHub URL, or a local path.`);
  const [, owner, repo, ref = 'main'] = m;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  return {
    type: 'remote',
    owner,
    repo,
    ref,
    label: `${owner}/${repo}@${ref}`,
    async read(rel) {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const res = await fetch(base + rel, {
        headers: {
          'User-Agent': 'sf-lwc',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        throw new Error(`${res.status} fetching ${rel} from ${owner}/${repo}@${ref}` + (res.status === 404 && !token ? ' (private repo? set GITHUB_TOKEN)' : ''));
      }
      return Buffer.from(await res.arrayBuffer());
    },
    async fetchApi(endpoint) {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const cleanEndpoint = endpoint.replace(/^\//, '');
      const separator = cleanEndpoint.includes('?') ? '&' : '?';
      const url = `${apiBase}/${cleanEndpoint}${separator}ref=${encodeURIComponent(ref)}`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'sf-lwc',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        const err = new Error(`${res.status} from GitHub API ${cleanEndpoint}`);
        // @ts-ignore
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    async readComponentFile(manifest, rel) {
      if (manifest._rawPrefix) {
        return this.read(`${manifest._rawPrefix}/${path.basename(rel)}`);
      }
      return this.read(`components/${manifest.name}/files/${rel}`);
    }
  };
}
