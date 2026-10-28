import path from 'node:path';
import { validate } from './resolve.js';
import { normalizeSpec, createSource } from './source.js';

const IS_LOCAL_PATH_RE = /^(\.|\/|~)|^[a-zA-Z]:[\\/]/;

function isLocalSpec(spec) {
  return IS_LOCAL_PATH_RE.test(normalizeSpec(spec));
}

function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export function parseMetaXml(xml) {
  if (!xml || typeof xml !== 'string') {
    return { description: '', masterLabel: '', apiVersion: '62.0' };
  }
  const descMatch = xml.match(/<description>([\s\S]*?)<\/description>/i);
  const labelMatch = xml.match(/<masterLabel>([\s\S]*?)<\/masterLabel>/i);
  const apiMatch = xml.match(/<apiVersion>([\s\S]*?)<\/apiVersion>/i);

  const masterLabel = labelMatch ? decodeXml(labelMatch[1].trim()) : '';
  let description = '';
  if (descMatch) {
    description = decodeXml(descMatch[1].trim());
  } else if (masterLabel) {
    description = masterLabel;
  }

  let apiVersion = '62.0';
  if (apiMatch) {
    const rawApi = apiMatch[1].trim();
    apiVersion = rawApi.includes('.') ? rawApi : `${rawApi}.0`;
  }

  return {
    description,
    masterLabel,
    apiVersion
  };
}

export async function discoverComponentNames(spec) {
  const source = createSource(spec);
  const { bundles } = await source.listLwcBundles(spec);
  return bundles.map((b) => b.name).sort();
}

export async function listComponents(source, spec) {
  const targetSpec = spec || source?.spec || source?.rawSpec || source?.label || source?.root || '';

  let bundleResult;
  if (source && typeof source.listLwcBundles === 'function') {
    bundleResult = await source.listLwcBundles(targetSpec);
  } else {
    const fallbackSource = createSource(targetSpec);
    bundleResult = await fallbackSource.listLwcBundles(targetSpec);
  }

  const { layout, bundles } = bundleResult;

  if (layout === 'sfdx' || Array.isArray(bundles)) {
    const components = await Promise.all(
      bundles.map(async (bundle) => {
        let description = '';
        let apiVersion = '62.0';
        try {
          const relPath = path.isAbsolute(bundle.metaXmlPath) && source?.root
            ? path.relative(source.root, bundle.metaXmlPath).replace(/\\/g, '/')
            : bundle.metaXmlPath;
          const buf = await source.read(relPath);
          const meta = parseMetaXml(buf.toString('utf8'));
          description = meta.description || meta.masterLabel || '';
          apiVersion = meta.apiVersion || '62.0';
        } catch {
          // Gracefully default if metaXml is missing or unparseable
        }
        return {
          name: bundle.name,
          description,
          version: '1.0.0',
          apiVersion,
          dependencies: []
        };
      })
    );
    return components.sort((a, b) => a.name.localeCompare(b.name));
  }

  return [];
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
