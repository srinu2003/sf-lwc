const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
</CustomLabels>
`;

// Merge labels into an existing CustomLabels XML string (or null). Existing labels are never touched.
export function mergeLabels(xml, labels) {
  let out = xml ?? EMPTY;
  const added = [], skipped = [];
  for (const l of labels) {
    const exists = new RegExp(`<fullName>\\s*${l.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</fullName>`).test(out);
    if (exists) { skipped.push(l.fullName); continue; }
    const block =
`    <labels>
        <fullName>${esc(l.fullName)}</fullName>
        <language>${esc(l.language ?? 'en_US')}</language>
        <protected>${l.protected ? 'true' : 'false'}</protected>
        <shortDescription>${esc(l.shortDescription ?? l.fullName)}</shortDescription>
        <value>${esc(l.value)}</value>
    </labels>
`;
    out = out.replace('</CustomLabels>', block + '</CustomLabels>');
    added.push(l.fullName);
  }
  return { xml: out, added, skipped };
}
