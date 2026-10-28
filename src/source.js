import { readFile, stat, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { NAME_RE } from './resolve.js';

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

/**
 * Determines whether a string token represents a repository source (GitHub URL, owner/repo, or local path)
 * vs a standalone component name (e.g. "modal", "qrCodeGenerator").
 */
export function isSourceSpec(spec) {
  if (!spec || typeof spec !== 'string') return false;
  const trimmed = spec.trim();
  if (/^(\.|\/|~|[a-zA-Z]:[\\/])/.test(trimmed)) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^git@/i.test(trimmed)) return true;
  if (/^github:/i.test(trimmed)) return true;
  if (/^[\w.-]+\/[\w.-]+(@.+)?$/.test(trimmed)) return true;
  return false;
}

// A "source" is a registry: a local folder or a GitHub repo (owner/repo[@ref]).
// Salesforce DX repo source (e.g. force-app/main/default/lwc/<name>).
export function createSource(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  if (/^(\.|\/|~)/.test(spec) || /^[a-zA-Z]:[\\/]/.test(spec)) {
    const root = path.resolve(spec);
    const read = (rel) => readFile(path.join(root, rel));
    return {
      type: 'local',
      label: root,
      root,
      spec: rawSpec,
      rawSpec,
      read,
      readFile: read,
      async readComponentFile(manifest, rel) {
        if (rel.startsWith('lwc/')) {
          const rawPrefix = manifest._rawPrefix || `force-app/main/default/lwc/${manifest.name}`;
          const subPath = rel.startsWith(`lwc/${manifest.name}/`)
            ? rel.slice(`lwc/${manifest.name}/`.length)
            : path.basename(rel);
          return readFile(path.join(root, rawPrefix, subPath));
        }
        const pkgDefault = manifest._packageDefault || 'force-app/main/default';
        const candidatePaths = [
          path.join(root, pkgDefault, rel),
          path.join(root, 'force-app/main/default', rel),
          path.join(root, 'main/default', rel)
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            return readFile(p);
          }
        }
        return readFile(candidatePaths[0]);
      },
      async listLwcBundles(specOverride) {
        const displayPath = specOverride || rawSpec || root;
        let rootStat;
        try {
          rootStat = await stat(root);
        } catch {
          throw new Error(`Local directory '${displayPath}' does not exist.`);
        }
        if (!rootStat.isDirectory()) {
          throw new Error(`Local directory '${displayPath}' does not exist.`);
        }

        // Standard SFDX layout: force-app/main/default/lwc
        const sfdxDir = path.join(root, 'force-app', 'main', 'default', 'lwc');
        try {
          const entries = await readdir(sfdxDir, { withFileTypes: true });
          const bundles = [];
          for (const entry of entries) {
            if (entry.isDirectory() && NAME_RE.test(entry.name)) {
              bundles.push({
                name: entry.name,
                layout: 'sfdx',
                prefix: `force-app/main/default/lwc/${entry.name}`,
                metaXmlPath: path.join(sfdxDir, entry.name, `${entry.name}.js-meta.xml`)
              });
            }
          }
          if (bundles.length > 0) {
            return {
              layout: 'sfdx',
              bundles: bundles.sort((a, b) => a.name.localeCompare(b.name))
            };
          }
        } catch {}

        throw new Error(`Directory '${displayPath}' does not contain an LWC bundle (expected standard layout: force-app/main/default/lwc).`);
      }
    };
  }

  const m = spec.match(/^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/);
  if (!m) throw new Error(`Invalid registry "${rawSpec}". Use owner/repo[@ref], a GitHub URL, or a local path.`);
  const [, owner, repo, explicitRef] = m;
  const ref = explicitRef || 'main';
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${explicitRef ? explicitRef : 'HEAD'}/`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  return {
    type: 'remote',
    owner,
    repo,
    ref,
    hasExplicitRef: Boolean(explicitRef),
    spec: rawSpec,
    rawSpec,
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
      if (rel.startsWith('lwc/')) {
        const rawPrefix = manifest._rawPrefix || `force-app/main/default/lwc/${manifest.name}`;
        const subPath = rel.startsWith(`lwc/${manifest.name}/`)
          ? rel.slice(`lwc/${manifest.name}/`.length)
          : path.basename(rel);
        return this.read(`${rawPrefix}/${subPath}`);
      }
      const pkgDefault = manifest._packageDefault || 'force-app/main/default';
      try {
        return await this.read(`${pkgDefault}/${rel}`);
      } catch {
        return await this.read(`main/default/${rel}`);
      }
    },
    async getTree(specOverride) {
      if (this._treePromise) return this._treePromise;
      this._treePromise = (async () => {
        const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        const targetRef = explicitRef ? encodeURIComponent(explicitRef) : 'HEAD';
        const url = `${apiBase}/git/trees/${targetRef}?recursive=1`;
        const res = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'sf-lwc',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        });
        if (!res.ok) {
          const displaySpec = specOverride || rawSpec;
          if (res.status === 403) {
            const remaining = res.headers.get('x-ratelimit-remaining');
            if (remaining === '0') {
              throw new Error('GitHub API rate limit exceeded. Set GITHUB_TOKEN to increase limit.');
            }
          }
          if (res.status === 404 || res.status === 401 || res.status === 403) {
            throw new Error(`Repository '${displaySpec}' not found or inaccessible (check repository name or set GITHUB_TOKEN for private repos).`);
          }
          throw new Error(`Failed to fetch tree from ${owner}/${repo}: HTTP ${res.status}`);
        }
        const data = await res.json();
        return Array.isArray(data.tree) ? data.tree : [];
      })();
      return this._treePromise;
    },
    async listLwcBundles(specOverride) {
      const displaySpec = specOverride || rawSpec;
      const tree = await this.getTree(displaySpec);

      // 1. Primary standard layout: force-app/main/default/lwc
      const sfdxMap = new Map();
      for (const item of tree) {
        const match = item.path.match(/^force-app\/main\/default\/lwc\/([^/]+)(?:\/(.*))?$/);
        if (!match) continue;
        const compName = match[1];
        if (!NAME_RE.test(compName)) continue;
        if (!sfdxMap.has(compName)) {
          sfdxMap.set(compName, {
            name: compName,
            layout: 'sfdx',
            prefix: `force-app/main/default/lwc/${compName}`,
            metaXmlPath: `force-app/main/default/lwc/${compName}/${compName}.js-meta.xml`,
            files: []
          });
        }
        const relPath = match[2];
        if (relPath && item.type === 'blob') {
          sfdxMap.get(compName).files.push(`lwc/${compName}/${path.basename(relPath)}`);
        }
      }

      if (sfdxMap.size > 0) {
        return {
          layout: 'sfdx',
          bundles: Array.from(sfdxMap.values()).sort((a, b) => a.name.localeCompare(b.name))
        };
      }

      throw new Error(`Repository '${displaySpec}' does not contain any LWC components (expected standard layout: force-app/main/default/lwc).`);
    }
  };
}
