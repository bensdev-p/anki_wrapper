// Checks every theme: text contrast (WCAG) and chart colors (dataviz validator).
//
//   node frontend/scripts/check_themes.mjs [path/to/validate_palette.js]
//
// Bundles src/themes/themes.ts with rolldown (Vite's bundler) so the check runs
// on the real token values. Exits 1 if anything fails.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'themes-'))
const bundle = join(out, 'themes.mjs')
execFileSync(join(root, 'node_modules/.bin/rolldown'), [join(root, 'src/themes/themes.ts'), '--format', 'esm', '--file', bundle], { stdio: 'ignore' })
const { THEMES } = await import(pathToFileURL(bundle).href)
rmSync(out, { recursive: true, force: true })

const validatorPath = process.argv[2]
const validator = validatorPath ? await import(pathToFileURL(resolve(validatorPath)).href) : null

function lum(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [foreground, background, minimum]
const TEXT_CHECKS = [
  ['text', 'surface', 7],
  ['text', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-subtle', 'surface', 3],
  ['text-on-accent', 'accent', 4.5],
  ['card-fg', 'card-canvas', 7],
  ['accent', 'surface', 3],
  // counts and answer labels are bold, large text: 3:1
  ['count-new', 'surface', 3],
  ['count-learn', 'surface', 3],
  ['count-review', 'surface', 3],
  ['again', 'surface', 3],
  ['hard', 'surface', 3],
  ['good', 'surface', 3],
  ['easy', 'surface', 3],
]

let failed = 0
for (const theme of THEMES) {
  const t = theme.tokens
  const problems = []
  for (const [fg, bg, min] of TEXT_CHECKS) {
    const r = ratio(t[fg], t[bg])
    if (r < min) problems.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`)
  }
  if (validator) {
    const surface = t.surface
    const ramp = ['mat-1', 'mat-2', 'mat-3', 'mat-4'].map((k) => t[k])
    // Maturity is ordinal (--ordinal). The heatmap is sequential magnitude,
    // whose faintest step may recede toward the surface, so only its order is checked.
    const res = validator.validateOrdinal(ramp, { mode: theme.kind, surface })
    if (!res.ok) problems.push(`maturity ramp: ${res.report.filter((r) => !r[1]).map((r) => r[2]).join('; ')}`)
    const heat = ['heat-1', 'heat-2', 'heat-3', 'heat-4'].map((k) => lum(t[k]))
    const monotone = heat.every((l, i) => i === 0 || (theme.kind === 'light' ? l < heat[i - 1] : l > heat[i - 1]))
    if (!monotone) problems.push('heatmap ramp: not monotone from faint to strong')
    const c1 = validator.contrast(t['chart-1'], surface)
    if (c1 < 3) problems.push(`chart-1 on surface: ${c1.toFixed(2)} < 3`)
  }
  if (problems.length) {
    failed++
    console.log(`✗ ${theme.name}\n  ${problems.join('\n  ')}`)
  } else {
    console.log(`✓ ${theme.name}`)
  }
}
console.log(failed ? `\n${failed} theme(s) need fixes.` : `\nAll ${THEMES.length} themes pass.`)
process.exit(failed ? 1 : 0)
