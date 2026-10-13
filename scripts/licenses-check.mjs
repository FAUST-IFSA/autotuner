// Fails on any GPL / AGPL / LGPL license in the full dependency tree (incl. transitive),
// except the allowlisted lamejs MP3 encoder (LGPL, shipped as a separate unmodified chunk).
// Also fails on unknown licenses so they get reviewed and recorded in the register.
import { execFileSync } from 'node:child_process';

const ALLOW_COPYLEFT = new Set(['lamejs', '@breezystack/lamejs']);
const COPYLEFT = /\b(A?GPL|LGPL)\b/i;

const raw = execFileSync(
  'npx',
  ['license-checker-rseidelsohn', '--json', '--excludePrivatePackages', '--start', '.'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const pkgs = JSON.parse(raw);

const failures = [];
const counts = {};
for (const [id, info] of Object.entries(pkgs)) {
  const license = Array.isArray(info.licenses)
    ? info.licenses.join(' OR ')
    : String(info.licenses ?? 'UNKNOWN');
  counts[license] = (counts[license] ?? 0) + 1;
  const name = id.slice(0, id.lastIndexOf('@'));
  if (COPYLEFT.test(license) && !ALLOW_COPYLEFT.has(name))
    failures.push(`${id}: ${license} (copyleft)`);
  if (/UNKNOWN|UNLICENSED|Custom/i.test(license)) failures.push(`${id}: ${license} (needs review)`);
}

console.log(`Scanned ${Object.keys(pkgs).length} packages.`);
for (const [l, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(4)}  ${l}`);
if (failures.length) {
  console.error(`\nLicense check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nLicense check passed.');
