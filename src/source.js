import { readFile, stat, readdir } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { NAME_RE } from './resolve.js';

/**
 * Normalizes any git or registry specifier (GitHub URL, git SSH, owner/repo)
 * to a canonical owner/repo[@ref] or local directory path.
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

export function getLocalPackagePrefixes(sourceRoot) {
  const prefixes = [];
  try {
    const sfdxProjectJson = path.join(sourceRoot, 'sfdx-project.json');
    if (fs.existsSync(sfdxProjectJson)) {
      const content = fs.readFileSync(sfdxProjectJson, 'utf8');
      const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
      for (const dir of parsed.packageDirectories ?? []) {
        if (dir.path) {
          const norm = dir.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          prefixes.push(`${norm}/main/default/lwc`);
          prefixes.push(`${norm}/lwc`);
        }
      }
    }
  } catch {}
  if (!prefixes.includes('force-app/main/default/lwc')) prefixes.push('force-app/main/default/lwc');
  if (!prefixes.includes('main/default/lwc')) prefixes.push('main/default/lwc');
  return [...new Set(prefixes)];
}

// A "source" is a registry: a local folder or a GitHub repo (owner/repo[@ref]).
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

        const candidatePrefixes = getLocalPackagePrefixes(root);
        const bundlesMap = new Map();

        for (const prefix of candidatePrefixes) {
          const lwcDir = path.join(root, prefix);
          try {
            const entries = await readdir(lwcDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && NAME_RE.test(entry.name)) {
                if (!bundlesMap.has(entry.name)) {
                  bundlesMap.set(entry.name, {
                    name: entry.name,
                    layout: 'sfdx',
                    prefix: `${prefix}/${entry.name}`,
                    metaXmlPath: path.join(lwcDir, entry.name, `${entry.name}.js-meta.xml`)
                  });
                }
              }
            }
          } catch {}
        }

        if (bundlesMap.size > 0) {
          return {
            layout: 'sfdx',
            bundles: Array.from(bundlesMap.values()).sort((a, b) => a.name.localeCompare(b.name))
          };
        }

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

      const sfdxMap = new Map();
      for (const item of tree) {
        // Matches force-app/main/default/lwc/<comp>, main/default/lwc/<comp>, or <pkg>/lwc/<comp>
        const match = item.path.match(/^(?:.*\/)?(?:main\/default\/lwc|lwc)\/([^/]+)(?:\/(.*))?$/);
        if (!match) continue;
        const compName = match[1];
        if (!NAME_RE.test(compName)) continue;
        if (!sfdxMap.has(compName)) {
          const prefixMatch = item.path.match(/^(.*\/lwc\/[^/]+)/);
          const prefix = prefixMatch ? prefixMatch[1] : `force-app/main/default/lwc/${compName}`;
          sfdxMap.set(compName, {
            name: compName,
            layout: 'sfdx',
            prefix,
            metaXmlPath: `${prefix}/${compName}.js-meta.xml`,
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
