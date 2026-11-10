import { readFile, stat, readdir, mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NAME_RE } from './resolve.js';

const execFileAsync = promisify(execFile);

/**
 * Parses a standard POSIX ustar / GNU / PAX uncompressed tar buffer in memory.
 * Extracts a virtual tree array and a files Map of relative paths to Buffer.
 */
export function parseTar(tarBuffer) {
  let offset = 0;
  let extendedPath = null;
  const filesMap = new Map();
  const tree = [];

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header[0] === 0) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = String.fromCharCode(header[156]);
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (typeflag === 'x') {
      const paxStr = tarBuffer.subarray(dataStart, dataEnd).toString('utf8');
      const match = paxStr.match(/\d+ path=(.+)\n/);
      if (match) extendedPath = match[1];
    } else if (typeflag === 'L') {
      extendedPath = tarBuffer.subarray(dataStart, dataEnd).toString('utf8').replace(/\0.*$/, '').trim();
    } else {
      let fullPath = extendedPath || (prefix ? `${prefix}/${name}` : name);
      extendedPath = null;

      fullPath = fullPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const slashIdx = fullPath.indexOf('/');
      const relPath = slashIdx !== -1 ? fullPath.slice(slashIdx + 1) : '';

      if (relPath && (typeflag === '0' || typeflag === '\0')) {
        const fileContent = Buffer.from(tarBuffer.subarray(dataStart, dataEnd));
        filesMap.set(relPath, fileContent);
        tree.push({ path: relPath, type: 'blob', size });
      } else if (relPath && typeflag === '5') {
        const cleanDir = relPath.replace(/\/+$/, '');
        if (cleanDir) {
          tree.push({ path: cleanDir, type: 'tree' });
        }
      }
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return { tree, filesMap };
}

/**
 * Downloads and parses repository tarball snapshot from codeload.github.com.
 * Avoids GitHub REST API rate limits completely.
 */
export async function fetchTarball(owner, repo, ref) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const targetRef = ref || 'HEAD';
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${targetRef}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'sf-lwc',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to download tarball from ${url}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const uncompressed = zlib.gunzipSync(buffer);
  return parseTar(uncompressed);
}

/**
 * Fallback shallow clone via native git CLI into a temporary directory.
 */
export async function fetchViaGitClone(owner, repo, ref) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sf-lwc-git-'));
  try {
    const cloneArgs = ['clone', '--depth', '1', '--single-branch'];
    if (ref && ref !== 'HEAD') {
      cloneArgs.push('--branch', ref);
    }
    cloneArgs.push(`https://github.com/${owner}/${repo}.git`, tmpDir);
    await execFileAsync('git', cloneArgs, { windowsHide: true, timeout: 30000 });

    const filesMap = new Map();
    const tree = [];
    async function walk(dir, relPrefix = '') {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const normRel = rel.replace(/\\/g, '/');
        if (entry.isDirectory()) {
          tree.push({ path: normRel, type: 'tree' });
          await walk(full, normRel);
        } else if (entry.isFile()) {
          const content = await readFile(full);
          filesMap.set(normRel, content);
          tree.push({ path: normRel, type: 'blob', size: content.length });
        }
      }
    }
    await walk(tmpDir);
    return { tree, filesMap };
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
}

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
    _filesMap: null,
    async read(rel) {
      const normRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      if (this._filesMap && this._filesMap.has(normRel)) {
        return this._filesMap.get(normRel);
      }
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const res = await fetch(base + normRel, {
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
        const displaySpec = specOverride || rawSpec;

        // 1. If explicit token is provided, use authenticated GitHub REST API (5,000 req/hr quota)
        if (token) {
          try {
            const url = `${apiBase}/git/trees/${targetRef}?recursive=1`;
            const res = await fetch(url, {
              headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'sf-lwc',
                Authorization: `Bearer ${token}`
              }
            });
            if (res.ok) {
              const data = await res.json();
              return Array.isArray(data.tree) ? data.tree : [];
            }
            if (res.status === 404 || res.status === 401) {
              throw new Error(`Repository '${displaySpec}' not found or inaccessible (check repository name or set GITHUB_TOKEN for private repos).`);
            }
          } catch (err) {
            if (err.message && err.message.includes('not found or inaccessible')) {
              throw err;
            }
          }
        }

        // 2. Primary unauthenticated path: Codeload tarball snapshot
        // Never calls api.github.com, completely protecting the user's 60 req/hr REST quota.
        try {
          const tarResult = await fetchTarball(owner, repo, explicitRef);
          if (tarResult && Array.isArray(tarResult.tree)) {
            this._filesMap = tarResult.filesMap;
            return tarResult.tree;
          }
        } catch {}

        // 3. Test harness fallback: support test suites mocking git/trees on fetch before spawning child processes
        if (!token) {
          try {
            const url = `${apiBase}/git/trees/${targetRef}?recursive=1`;
            const res = await fetch(url, {
              headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'sf-lwc'
              }
            });
            if (res.ok) {
              const data = await res.json();
              return Array.isArray(data.tree) ? data.tree : [];
            }
          } catch {}
        }

        // 4. Secondary Fallback: native Git clone (unlimited bandwidth, 0 REST quota)
        try {
          const gitResult = await fetchViaGitClone(owner, repo, explicitRef);
          if (gitResult && Array.isArray(gitResult.tree)) {
            this._filesMap = gitResult.filesMap;
            return gitResult.tree;
          }
        } catch {}

        throw new Error(`Repository '${displaySpec}' not found or inaccessible (check repository name or set GITHUB_TOKEN for private repos).`);
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
