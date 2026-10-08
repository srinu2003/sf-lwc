import { readFile } from 'node:fs/promises';
import path from 'node:path';

// A "source" is a registry: a local folder or a GitHub repo (owner/repo[@ref]).
// Layout: components/<name>/manifest.json and components/<name>/files/<path>
export function createSource(spec) {
  if (/^(\.|\/|~)/.test(spec) || /^[a-zA-Z]:[\\/]/.test(spec)) {
    const root = path.resolve(spec);
    return { label: root, read: (rel) => readFile(path.join(root, rel)) };
  }
  const m = spec.match(/^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/);
  if (!m) throw new Error(`Invalid registry "${spec}". Use owner/repo[@ref] or a local path.`);
  const [, owner, repo, ref = 'main'] = m;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`;
  return {
    label: `${owner}/${repo}@${ref}`,
    async read(rel) {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const res = await fetch(base + rel, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
      if (!res.ok) throw new Error(`${res.status} fetching ${rel} from ${owner}/${repo}@${ref}` + (res.status === 404 && !token ? ' (private repo? set GITHUB_TOKEN)' : ''));
      return Buffer.from(await res.arrayBuffer());
    }
  };
}
