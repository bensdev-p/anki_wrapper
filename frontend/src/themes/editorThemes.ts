/**
 * Themes after popular code-editor color schemes (One Dark Pro, Dracula,
 * Night Owl, Monokai Pro, Material, GitHub, Tokyo Night, Nord, Cobalt2,
 * SynthWave '84, Ayu, Catppuccin, Gruvbox, Solarized).
 *
 * Each is described by its own signature colors (`EditorPalette`); `build()`
 * derives every design token from them, so all themes stay complete and
 * consistent. Chart tokens reuse the app's validated blue family (light or
 * dark steps), checked against each theme's surface by
 * `scripts/check_themes.mjs`. Colors are the schemes' published palettes;
 * the names refer to the schemes they're modeled on.
 */

import type { Theme } from './themes'

export interface EditorPalette {
  /** Window background (behind cards). */
  bg: string
  /** Panels and cards. */
  surface: string
  /** Menus and popovers (defaults to surface). */
  raised?: string
  border: string
  text: string
  /** Secondary text; must stay readable on `surface`. */
  muted: string
  /** Hints and comments. */
  subtle: string
  accent: string
  red: string
  /** "Hard": the scheme's orange or yellow. */
  orange: string
  green: string
  blue: string
}

type Kind = Theme['kind']

// -- tiny color helpers (hex only) ---------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function hex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
}

/** `a` moved toward `b` by `t` (0–1). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return hex(x.map((v, i) => v + (y[i] - v) * t))
}

function rgba(color: string, alpha: number): string {
  const [r, g, b] = rgb(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// -- chart steps (the app's validated blue family) ------------------------------

/** The reference sequential blue, steps 100 → 700 (light → dark). */
const BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']

/**
 * Card maturity is ordinal: four steps of one hue, and the step nearest the
 * surface must still clear 2:1 against it. Start as close to the surface as
 * that allows, then spread the steps evenly to the far end of the scale.
 */
function maturityRamp(surface: string, kind: Kind): [string, string, string, string] {
  const order = kind === 'light' ? BLUE : [...BLUE].reverse()
  const far = kind === 'light' ? order.length - 1 : order.indexOf('#b7d3f6')
  let start = order.findIndex((c) => contrast(c, surface) >= 2.05)
  if (start < 0 || far - start < 6) start = far - 6
  const at = (i: number) => order[Math.round(start + ((far - start) * i) / 3)]
  return [at(0), at(1), at(2), at(3)]
}

// Heatmap: sequential magnitude, where the faintest step may recede toward the
// surface (the reference palette's rule), so the full scale is used as is.
const HEAT: Record<Kind, string[]> = {
  light: ['#b7d3f6', '#6da7ec', '#2a78d6', '#184f95'],
  dark: ['#184f95', '#2a78d6', '#6da7ec', '#b7d3f6'],
}
const CHART_1: Record<Kind, string> = { light: '#2a78d6', dark: '#3987e5' }

export function build(
  id: string,
  name: string,
  description: string,
  kind: Kind,
  p: EditorPalette,
  flags: Record<`flag-${1 | 2 | 3 | 4 | 5 | 6 | 7}`, string>,
): Theme {
  const dark = kind === 'dark'
  const ink = dark ? '#ffffff' : '#000000'
  const raised = p.raised ?? p.surface
  // Text on the accent: white or the theme's own darkest ink, whichever reads better.
  const darkInk = dark ? p.bg : mix(p.text, '#000000', 0.6)
  const onAccent = contrast(p.accent, '#ffffff') >= contrast(p.accent, darkInk) ? '#ffffff' : darkInk
  const mat = maturityRamp(p.surface, kind)
  const shadow = dark ? 'rgba(0, 0, 0,' : 'rgba(20, 20, 16,'
  return {
    id,
    name,
    description,
    kind,
    tokens: {
      bg: p.bg,
      'bg-subtle': mix(p.bg, p.surface, 0.5),
      surface: p.surface,
      'surface-raised': raised,
      'surface-hover': mix(p.surface, ink, dark ? 0.06 : 0.04),
      'surface-active': mix(p.surface, ink, dark ? 0.1 : 0.07),
      overlay: dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(24, 24, 20, 0.28)',
      border: p.border,
      'border-strong': mix(p.border, p.text, 0.18),
      text: p.text,
      'text-muted': p.muted,
      'text-subtle': p.subtle,
      'text-on-accent': onAccent,
      accent: p.accent,
      'accent-hover': mix(p.accent, ink, dark ? 0.15 : 0.12),
      'accent-soft': rgba(p.accent, dark ? 0.16 : 0.12),
      focus: rgba(p.accent, 0.5),
      'count-new': p.blue,
      'count-learn': p.red,
      'count-review': p.green,
      again: p.red,
      hard: p.orange,
      good: p.green,
      easy: p.blue,
      'card-canvas': p.surface,
      'card-fg': p.text,
      'shadow-sm': `0 1px 2px ${shadow} ${dark ? 0.4 : 0.06})`,
      'shadow-md': dark
        ? '0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 20px rgba(0, 0, 0, 0.3)'
        : '0 1px 2px rgba(20, 20, 16, 0.05), 0 4px 16px rgba(20, 20, 16, 0.06)',
      'shadow-lg': dark
        ? '0 2px 8px rgba(0, 0, 0, 0.4), 0 28px 70px rgba(0, 0, 0, 0.55)'
        : '0 2px 6px rgba(20, 20, 16, 0.06), 0 24px 60px rgba(20, 20, 16, 0.18)',
      'chart-1': CHART_1[kind],
      'mat-1': mat[0],
      'mat-2': mat[1],
      'mat-3': mat[2],
      'mat-4': mat[3],
      'heat-1': HEAT[kind][0],
      'heat-2': HEAT[kind][1],
      'heat-3': HEAT[kind][2],
      'heat-4': HEAT[kind][3],
      'chart-other': mix(p.border, p.subtle, 0.45),
      'heat-0': mix(p.surface, ink, dark ? 0.07 : 0.05),
      'chart-grid': p.border,
      'chart-axis': mix(p.border, p.text, 0.18),
      ...flags,
    },
  }
}

// -- the schemes -----------------------------------------------------------------
// Colors from each scheme's published palette. Where a scheme's own "muted"
// grey (or its text on a light background) is too faint to read comfortably,
// a slightly stronger step is used; scripts/check_themes.mjs enforces this.
// Variants that differ only in fonts or borders (No Italics, Italic,
// Bordered) have the same colors, so they aren't repeated here.

export interface EditorTheme {
  id: string
  name: string
  description: string
  kind: Kind
  /** Shown as a group in Settings → Appearance. */
  family: string
  palette: EditorPalette
}

// Compact form: bg, surface, raised, border | text, muted, subtle | accent, red, orange, green, blue
function t(
  family: string,
  id: string,
  name: string,
  kind: Kind,
  description: string,
  [bg, surface, raised, border]: string[],
  [text, muted, subtle]: string[],
  [accent, red, orange, green, blue]: string[],
): EditorTheme {
  return { id, name, kind, description, family, palette: { bg, surface, raised, border, text, muted, subtle, accent, red, orange, green, blue } }
}

const GH = 'GitHub'
const ODP = 'One Dark Pro'
const DRA = 'Dracula'
const TN = 'Tokyo Night'
const AYU = 'Ayu'
const SOP = 'Shades of Purple'
const NO = 'Night Owl'
const CAT = 'Catppuccin'
const NOC = 'Noctis'
const MOON = 'Moonlight'
const MP = 'Monokai Pro'
const MORE = 'More classics'

// Noctis shares its syntax colors across its dark variants.
const NOCTIS_DARK_SYNTAX = ['#e66533', '#e4b781', '#49e9a6', '#49ace9']
const NOCTIS_LIGHT_SYNTAX = ['#d6301f', '#9c5c00', '#00806b', '#0070b8']

export const EDITOR_THEMES: EditorTheme[] = [
  // GitHub
  t(GH, 'github-dark', 'GitHub Dark Default', 'dark', 'GitHub’s current dark mode: crisp and neutral',
    ['#010409', '#0d1117', '#161b22', '#30363d'], ['#e6edf3', '#9198a1', '#7d8590'], ['#4493f8', '#f85149', '#d29922', '#3fb950', '#58a6ff']),
  t(GH, 'github-dark-classic', 'GitHub Dark', 'dark', 'The original GitHub dark: softer charcoal',
    ['#1f2428', '#24292e', '#2f363d', '#444d56'], ['#e1e4e8', '#b1bac4', '#959da5'], ['#79b8ff', '#f97583', '#ffab70', '#85e89d', '#79b8ff']),
  t(GH, 'github-dark-dimmed', 'GitHub Dark Dimmed', 'dark', 'Lower contrast, easier in dim rooms',
    ['#1c2128', '#22272e', '#2d333b', '#444c56'], ['#cdd9e5', '#adbac7', '#909dab'], ['#539bf5', '#e5534b', '#c69026', '#57ab5a', '#6cb6ff']),
  t(GH, 'github-dark-hc', 'GitHub Dark High Contrast', 'dark', 'Maximum legibility on near-black',
    ['#010409', '#0a0c10', '#151b23', '#7a828e'], ['#ffffff', '#f0f3f6', '#bdc4cc'], ['#71b7ff', '#ff9492', '#f0b72f', '#26cd4d', '#71b7ff']),
  t(GH, 'github-dark-colorblind', 'GitHub Dark Colorblind', 'dark', 'Blue and orange in place of green and red',
    ['#010409', '#0d1117', '#161b22', '#30363d'], ['#e6edf3', '#9198a1', '#7d8590'], ['#4493f8', '#ec8e2c', '#e3b341', '#58a6ff', '#bc8cff']),
  t(GH, 'github-light', 'GitHub Light Default', 'light', 'GitHub’s current light mode: bright and familiar',
    ['#f6f8fa', '#ffffff', '#ffffff', '#d1d9e0'], ['#1f2328', '#59636e', '#6e7781'], ['#0969da', '#cf222e', '#9a6700', '#1a7f37', '#0969da']),
  t(GH, 'github-light-classic', 'GitHub Light', 'light', 'The original GitHub light',
    ['#f6f8fa', '#ffffff', '#ffffff', '#e1e4e8'], ['#24292e', '#586069', '#6a737d'], ['#0366d6', '#d73a49', '#b05800', '#22863a', '#005cc5']),
  t(GH, 'github-light-hc', 'GitHub Light High Contrast', 'light', 'Maximum legibility on white',
    ['#e7ecf0', '#ffffff', '#ffffff', '#20252c'], ['#0e1116', '#1f2328', '#4b535d'], ['#0349b4', '#a0111f', '#744500', '#055d20', '#0349b4']),
  t(GH, 'github-light-colorblind', 'GitHub Light Colorblind', 'light', 'Blue and orange in place of green and red',
    ['#f6f8fa', '#ffffff', '#ffffff', '#d1d9e0'], ['#1f2328', '#59636e', '#6e7781'], ['#0969da', '#bc4c00', '#9a6700', '#0969da', '#8250df']),

  // One Dark Pro
  t(ODP, 'one-dark', 'One Dark Pro', 'dark', 'Atom’s classic: slate and soft pastels',
    ['#21252b', '#282c34', '#2c313a', '#3a3f4b'], ['#d7dae0', '#abb2bf', '#7f848e'], ['#61afef', '#e06c75', '#d19a66', '#98c379', '#61afef']),
  t(ODP, 'one-dark-darker', 'One Dark Pro Darker', 'dark', 'One Dark with deeper backgrounds',
    ['#1b1e23', '#23272e', '#2a2f37', '#353b45'], ['#d7dae0', '#abb2bf', '#7f848e'], ['#61afef', '#e06c75', '#d19a66', '#98c379', '#61afef']),
  t(ODP, 'one-dark-flat', 'One Dark Pro Flat', 'dark', 'One Dark with one flat background',
    ['#282c34', '#282c34', '#2f343e', '#3b4048'], ['#d7dae0', '#abb2bf', '#7f848e'], ['#61afef', '#e06c75', '#d19a66', '#98c379', '#61afef']),
  t(ODP, 'one-dark-mix', 'One Dark Pro Mix', 'dark', 'Darker chrome around One Dark panels',
    ['#1b1d23', '#282c34', '#2c313a', '#3a3f4b'], ['#d7dae0', '#abb2bf', '#7f848e'], ['#c678dd', '#e06c75', '#d19a66', '#98c379', '#61afef']),

  // Dracula
  t(DRA, 'dracula', 'Dracula', 'dark', 'Deep violet-grey with vivid pinks and purples',
    ['#21222c', '#282a36', '#343746', '#44475a'], ['#f8f8f2', '#c3c6d4', '#8b93bf'], ['#bd93f9', '#ff5555', '#ffb86c', '#50fa7b', '#8be9fd']),
  t(DRA, 'dracula-soft', 'Dracula Soft', 'dark', 'Dracula with gentler, less saturated colors',
    ['#22212c', '#2a2c37', '#353746', '#44475a'], ['#f6f6f4', '#c6c8d2', '#8f96bd'], ['#bf9eee', '#ee6666', '#ffb86c', '#62e884', '#97e1f1']),

  // Tokyo Night
  t(TN, 'tokyo-night', 'Tokyo Night', 'dark', 'Neon city lights on deep indigo',
    ['#16161e', '#1a1b26', '#24283b', '#292e42'], ['#c0caf5', '#a9b1d6', '#737aa2'], ['#7aa2f7', '#f7768e', '#ff9e64', '#9ece6a', '#7aa2f7']),
  t(TN, 'tokyo-night-storm', 'Tokyo Night Storm', 'dark', 'Tokyo Night with a stormier slate blue',
    ['#1f2335', '#24283b', '#292e42', '#3b4261'], ['#c0caf5', '#a9b1d6', '#7d84ad'], ['#7aa2f7', '#f7768e', '#ff9e64', '#9ece6a', '#7aa2f7']),
  t(TN, 'tokyo-night-moon', 'Tokyo Night Moon', 'dark', 'Moonlit Tokyo: softer blues and greens',
    ['#1e2030', '#222436', '#2f334d', '#3b4261'], ['#c8d3f5', '#b4c2f0', '#828bb8'], ['#82aaff', '#ff757f', '#ff966c', '#c3e88d', '#82aaff']),
  t(TN, 'tokyo-night-day', 'Tokyo Night Day', 'light', 'Tokyo Night by daylight',
    ['#d0d5e3', '#e1e2e7', '#e9e9ed', '#c4c8da'], ['#273b73', '#3c4c80', '#5a6694'], ['#2a72d6', '#d20b45', '#965000', '#4a6531', '#2463c4']),

  // Ayu
  t(AYU, 'ayu-dark', 'Ayu Dark', 'dark', 'Near-black with a warm golden accent',
    ['#0b0e14', '#0d1017', '#131721', '#1e232e'], ['#bfbdb6', '#acb6bf', '#7a8290'], ['#e6b450', '#f07178', '#ff8f40', '#aad94c', '#59c2ff']),
  t(AYU, 'ayu-mirage', 'Ayu Mirage', 'dark', 'Muted slate with a warm golden accent',
    ['#1c212b', '#1f2430', '#242936', '#33394a'], ['#cccac2', '#b0aea5', '#8a919e'], ['#ffcc66', '#f28779', '#ffad66', '#87d96c', '#73d0ff']),
  t(AYU, 'ayu-light', 'Ayu Light', 'light', 'Airy white with a warm orange accent',
    ['#f3f4f5', '#fcfcfc', '#fcfcfc', '#e1e3e6'], ['#44494f', '#5c6166', '#737b85'], ['#d9711a', '#d95050', '#a86a00', '#4d7a00', '#1f7ac2']),

  // Shades of Purple
  t(SOP, 'shades-of-purple', 'Shades of Purple', 'dark', 'Bold purples with a bright yellow accent',
    ['#1e1e3f', '#2d2b55', '#322f5f', '#4d21fc'], ['#ffffff', '#c7c1f5', '#a599e9'], ['#fad000', '#ff628c', '#ff9d00', '#a5ff90', '#9effff']),
  t(SOP, 'shades-of-purple-super-dark', 'Shades of Purple Super Dark', 'dark', 'The same purples, much darker',
    ['#0c0b1a', '#15142b', '#1e1e3f', '#2d2b55'], ['#ffffff', '#c7c1f5', '#a599e9'], ['#fad000', '#ff628c', '#ff9d00', '#a5ff90', '#9effff']),

  // Night Owl
  t(NO, 'night-owl', 'Night Owl', 'dark', 'Midnight blue, made for late-night sessions',
    ['#010e1a', '#011627', '#0b2942', '#1d3b53'], ['#d6deeb', '#a8b8cc', '#7e8fa3'], ['#82aaff', '#ef5350', '#ffcb8b', '#addb67', '#82aaff']),
  t(NO, 'night-owl-light', 'Night Owl Light', 'light', 'Night Owl’s daytime counterpart',
    ['#f0f0f0', '#fbfbfb', '#fbfbfb', '#d9d9d9'], ['#2f2e3f', '#403f53', '#5f6b75'], ['#406ec8', '#c4312f', '#a0540f', '#087d5c', '#3a63b8']),

  // Catppuccin
  t(CAT, 'catppuccin-latte', 'Catppuccin Latte', 'light', 'Catppuccin’s gentle light pastels',
    ['#e6e9ef', '#eff1f5', '#f5f6f9', '#ccd0da'], ['#4c4f69', '#5c5f77', '#6c6f85'], ['#8839ef', '#d20f39', '#b35b00', '#347d22', '#1e66f5']),
  t(CAT, 'catppuccin-frappe', 'Catppuccin Frappé', 'dark', 'Catppuccin’s medium-dark: soft blue-grey',
    ['#292c3c', '#303446', '#414559', '#51576d'], ['#c6d0f5', '#b5bfe2', '#949cbb'], ['#ca9ee6', '#e78284', '#ef9f76', '#a6d189', '#8caaee']),
  t(CAT, 'catppuccin-macchiato', 'Catppuccin Macchiato', 'dark', 'Catppuccin’s dark: deeper and richer',
    ['#1e2030', '#24273a', '#363a4f', '#494d64'], ['#cad3f5', '#b8c0e0', '#939ab7'], ['#c6a0f6', '#ed8796', '#f5a97f', '#a6da95', '#8aadf4']),
  t(CAT, 'catppuccin-mocha', 'Catppuccin Mocha', 'dark', 'Catppuccin’s darkest: cozy and calm',
    ['#181825', '#1e1e2e', '#313244', '#313244'], ['#cdd6f4', '#bac2de', '#9399b2'], ['#cba6f7', '#f38ba8', '#fab387', '#a6e3a1', '#89b4fa']),

  // Noctis
  t(NOC, 'noctis', 'Noctis', 'dark', 'Deep teal-green with aqua accents',
    ['#03191b', '#052529', '#073940', '#0d4a52'], ['#d3e3e5', '#b2cacd', '#87a7ab'], ['#40d4e7', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-azureus', 'Noctis Azureus', 'dark', 'Noctis in deep azure blue',
    ['#051b29', '#07273b', '#0a3350', '#0e4163'], ['#d6e4ee', '#becfda', '#8fa9ba'], ['#49ace9', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-bordo', 'Noctis Bordo', 'dark', 'Noctis in warm burgundy-grey',
    ['#272022', '#322a2d', '#413639', '#524448'], ['#e0d5d8', '#cbbec2', '#a6969b'], ['#e4b781', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-minimus', 'Noctis Minimus', 'dark', 'Noctis, pared back to cool slate',
    ['#141e24', '#1b2932', '#233541', '#2f4553'], ['#dbe2e6', '#c5cdd3', '#95a4ae'], ['#5998c0', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-obscuro', 'Noctis Obscuro', 'dark', 'Noctis at its darkest',
    ['#020e10', '#031417', '#05252a', '#0b3a41'], ['#d3e3e5', '#b3c9cc', '#86a6aa'], ['#40d4e7', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-sereno', 'Noctis Sereno', 'dark', 'A serene, lighter Noctis teal',
    ['#04262a', '#062e32', '#0a3d42', '#0f4e54'], ['#d3e3e5', '#b2cacd', '#89aaae'], ['#40d4e7', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-uva', 'Noctis Uva', 'dark', 'Noctis in grape violet',
    ['#211e35', '#292640', '#342f52', '#433d66'], ['#dcdaeb', '#c5c2d6', '#9c98bc'], ['#998ef1', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-viola', 'Noctis Viola', 'dark', 'Noctis in plum purple',
    ['#281d33', '#30243d', '#3d2e4e', '#4d3a62'], ['#e2d8ec', '#ccbfd9', '#a595b8'], ['#bf8ef1', ...NOCTIS_DARK_SYNTAX]),
  t(NOC, 'noctis-hibernus', 'Noctis Hibernus', 'light', 'Noctis light: wintry white and teal',
    ['#e1e7e8', '#f4f6f6', '#ffffff', '#c9d6d8'], ['#003b42', '#205a61', '#4c7479'], ['#007c8e', ...NOCTIS_LIGHT_SYNTAX]),
  t(NOC, 'noctis-lilac', 'Noctis Lilac', 'light', 'Noctis light: soft lilac',
    ['#e5e3f1', '#f2f1f8', '#ffffff', '#d0cde6'], ['#0c006b', '#3a2f86', '#5d55a0'], ['#5c49e9', ...NOCTIS_LIGHT_SYNTAX]),
  t(NOC, 'noctis-lux', 'Noctis Lux', 'light', 'Noctis light: warm cream',
    ['#f6edda', '#fef8ec', '#fffdf7', '#e8dcc2'], ['#003b42', '#205a61', '#4c7479'], ['#b35900', ...NOCTIS_LIGHT_SYNTAX]),

  // Moonlight
  t(MOON, 'moonlight', 'Moonlight', 'dark', 'Pale moonlit blues on deep navy',
    ['#191a2a', '#212337', '#2a2d45', '#363a5a'], ['#e4f3fa', '#c7d3f0', '#8a93c4'], ['#82aaff', '#ff5370', '#f78c6c', '#c3e88d', '#82aaff']),
  t(MOON, 'moonlight-ii', 'Moonlight II', 'dark', 'Moonlight’s refined, softer sequel',
    ['#1e2030', '#222436', '#2f334d', '#3b4261'], ['#c8d3f5', '#b4c2f0', '#828bb8'], ['#86e1fc', '#ff757f', '#ff966c', '#c3e88d', '#82aaff']),

  // Monokai Pro
  t(MP, 'monokai', 'Monokai Pro', 'dark', 'Warm charcoal with bright, punchy accents',
    ['#221f22', '#2d2a2e', '#363337', '#403e41'], ['#fcfcfa', '#c1c0c0', '#939293'], ['#ffd866', '#ff6188', '#fc9867', '#a9dc76', '#78dce8']),
  t(MP, 'monokai-classic', 'Monokai Pro Filter Classic', 'dark', 'The original Monokai olive-charcoal',
    ['#1d1e19', '#272822', '#31322b', '#3e3d32'], ['#fdfff1', '#c0c1b5', '#919288'], ['#e6db74', '#f92672', '#fd971f', '#a6e22e', '#66d9ef']),
  t(MP, 'monokai-machine', 'Monokai Pro Filter Machine', 'dark', 'Cool blue-grey steel',
    ['#1d2528', '#273136', '#313b40', '#3a4449'], ['#f2fffc', '#c3cfcd', '#8b9798'], ['#ffed72', '#ff6d7e', '#ffb270', '#a2e57b', '#7cd5f1']),
  t(MP, 'monokai-octagon', 'Monokai Pro Filter Octagon', 'dark', 'Dusky indigo-grey',
    ['#1e1f2b', '#282a3a', '#32344a', '#3a3d4b'], ['#eaf2f1', '#c1c7c8', '#888d94'], ['#ffd76d', '#ff657a', '#ff9b5e', '#bad761', '#9cd1bb']),
  t(MP, 'monokai-ristretto', 'Monokai Pro Filter Ristretto', 'dark', 'Espresso-brown warmth',
    ['#211c1c', '#2c2525', '#352e2e', '#403838'], ['#fff1f3', '#c3b7b8', '#948a8b'], ['#f9cc6c', '#fd6883', '#f38d70', '#adda78', '#85dacc']),
  t(MP, 'monokai-spectrum', 'Monokai Pro Filter Spectrum', 'dark', 'Neutral black with a full spectrum',
    ['#191919', '#222222', '#2d2c2d', '#363537'], ['#f7f1ff', '#bab6c0', '#8b888f'], ['#fce566', '#fc618d', '#fd9353', '#7bd88f', '#5ad4e6']),

  // More classics
  t(MORE, 'one-monokai', 'One Monokai', 'dark', 'One Dark’s calm UI with Monokai’s colors',
    ['#21252b', '#282c34', '#2c313a', '#3a3f4b'], ['#d7dae0', '#abb2bf', '#7f848e'], ['#e5c07b', '#f92672', '#fd971f', '#a6e22e', '#66d9ef']),
  t(MORE, 'panda', 'Panda', 'dark', 'Soft charcoal with teal and pink',
    ['#242526', '#292a2b', '#31353a', '#3e4145'], ['#e6e6e6', '#c6c6c6', '#8f959c'], ['#19f9d8', '#ff4b82', '#ffb86c', '#19f9d8', '#45a9f9']),
  t(MORE, 'cyberpunk-2077', '2077', 'dark', 'Cyberpunk neon: cyan and hot pink on navy',
    ['#010714', '#030d22', '#0a1a3a', '#1b2a4a'], ['#e8fdff', '#9fdfea', '#6fa4b5'], ['#0ef3ff', '#ff3d81', '#ffd400', '#00ff9c', '#0ef3ff']),
  t(MORE, 'city-lights', 'City Lights', 'dark', 'Night city: dusky blue-grey and cool blues',
    ['#181e24', '#1d252c', '#252f38', '#333f4a'], ['#d4dee8', '#b7c5d3', '#8499ab'], ['#5ec4ff', '#e27e8d', '#ebbf83', '#8bd49c', '#5ec4ff']),
  t(MORE, 'palenight', 'Material Palenight', 'dark', 'Material’s soft purple-blue night',
    ['#1b1e2b', '#292d3e', '#32374d', '#3a3f58'], ['#eeffff', '#a6accd', '#7982b4'], ['#c792ea', '#f07178', '#f78c6c', '#c3e88d', '#82aaff']),
  t(MORE, 'nord', 'Nord', 'dark', 'Arctic, north-bluish calm',
    ['#2b303b', '#2e3440', '#3b4252', '#434c5e'], ['#eceff4', '#d8dee9', '#9aa5b8'], ['#88c0d0', '#bf616a', '#d08770', '#a3be8c', '#81a1c1']),
  t(MORE, 'cobalt2', 'Cobalt2', 'dark', 'Bold cobalt blue with golden highlights',
    ['#15232d', '#193549', '#1f4662', '#234e6d'], ['#ffffff', '#c7d6e2', '#8fa9bd'], ['#ffc600', '#ff628c', '#ff9d00', '#3ad900', '#9effff']),
  t(MORE, 'synthwave', 'SynthWave ’84', 'dark', 'Retro neon pink and cyan on dusky purple',
    ['#1e1a2e', '#262335', '#2a2139', '#3b3052'], ['#ffffff', '#c9c5e0', '#8f8bb8'], ['#ff7edb', '#fe4450', '#fede5d', '#72f1b8', '#36f9f6']),
  t(MORE, 'gruvbox', 'Gruvbox Dark', 'dark', 'Retro, earthy and warm',
    ['#1d2021', '#282828', '#32302f', '#3c3836'], ['#ebdbb2', '#d5c4a1', '#a89984'], ['#fabd2f', '#fb4934', '#fe8019', '#b8bb26', '#83a598']),
  t(MORE, 'solarized-dark', 'Solarized Dark', 'dark', 'The precision palette, deep teal',
    ['#00212b', '#002b36', '#073642', '#0b4351'], ['#eee8d5', '#93a1a1', '#7f9090'], ['#268bd2', '#dc322f', '#cb4b16', '#859900', '#268bd2']),
  t(MORE, 'solarized-light', 'Solarized Light', 'light', 'The precision palette, warm cream',
    ['#eee8d5', '#fdf6e3', '#fdf6e3', '#e0d9c4'], ['#073642', '#4f6069', '#657b83'], ['#268bd2', '#c42c2a', '#a8420f', '#5f6e00', '#1f73ad']),
]

/** Families in display order. */
export const EDITOR_FAMILIES = [...new Set(EDITOR_THEMES.map((e) => e.family))]
