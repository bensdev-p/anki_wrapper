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
      'card-canvas': dark ? p.surface : '#ffffff',
      'card-fg': dark ? p.text : mix(p.text, '#000000', 0.2),
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
// grey is too faint to read as text, a slightly lighter/darker step is used.

export const EDITOR_PALETTES: { id: string; name: string; description: string; kind: Kind; palette: EditorPalette }[] = [
  {
    id: 'one-dark',
    name: 'One Dark',
    description: 'Atom’s classic: slate and soft pastels',
    kind: 'dark',
    palette: {
      bg: '#21252b', surface: '#282c34', raised: '#2c313a', border: '#3a3f4b',
      text: '#d7dae0', muted: '#abb2bf', subtle: '#7f848e',
      accent: '#61afef', red: '#e06c75', orange: '#d19a66', green: '#98c379', blue: '#61afef',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Deep violet-grey with vivid pinks and purples',
    kind: 'dark',
    palette: {
      bg: '#21222c', surface: '#282a36', raised: '#343746', border: '#44475a',
      text: '#f8f8f2', muted: '#c3c6d4', subtle: '#8b93bf',
      accent: '#bd93f9', red: '#ff5555', orange: '#ffb86c', green: '#50fa7b', blue: '#8be9fd',
    },
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Midnight blue, made for late-night sessions',
    kind: 'dark',
    palette: {
      bg: '#010e1a', surface: '#011627', raised: '#0b2942', border: '#1d3b53',
      text: '#d6deeb', muted: '#a8b8cc', subtle: '#7e8fa3',
      accent: '#82aaff', red: '#ef5350', orange: '#ffcb8b', green: '#addb67', blue: '#82aaff',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai Pro',
    description: 'Warm charcoal with bright, punchy accents',
    kind: 'dark',
    palette: {
      bg: '#221f22', surface: '#2d2a2e', raised: '#363337', border: '#403e41',
      text: '#fcfcfa', muted: '#c1c0c0', subtle: '#939293',
      accent: '#ffd866', red: '#ff6188', orange: '#fc9867', green: '#a9dc76', blue: '#78dce8',
    },
  },
  {
    id: 'palenight',
    name: 'Material Palenight',
    description: 'Material’s soft purple-blue night',
    kind: 'dark',
    palette: {
      bg: '#1b1e2b', surface: '#292d3e', raised: '#32374d', border: '#3a3f58',
      text: '#eeffff', muted: '#a6accd', subtle: '#7982b4',
      accent: '#c792ea', red: '#f07178', orange: '#f78c6c', green: '#c3e88d', blue: '#82aaff',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    description: 'GitHub’s dark mode: crisp and neutral',
    kind: 'dark',
    palette: {
      bg: '#010409', surface: '#0d1117', raised: '#161b22', border: '#30363d',
      text: '#e6edf3', muted: '#9198a1', subtle: '#7d8590',
      accent: '#4493f8', red: '#f85149', orange: '#d29922', green: '#3fb950', blue: '#58a6ff',
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    description: 'GitHub’s light mode: bright and familiar',
    kind: 'light',
    palette: {
      bg: '#f6f8fa', surface: '#ffffff', border: '#d1d9e0',
      text: '#1f2328', muted: '#59636e', subtle: '#6e7781',
      accent: '#0969da', red: '#cf222e', orange: '#9a6700', green: '#1a7f37', blue: '#0969da',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    description: 'Neon city lights on deep indigo',
    kind: 'dark',
    palette: {
      bg: '#16161e', surface: '#1a1b26', raised: '#24283b', border: '#292e42',
      text: '#c0caf5', muted: '#a9b1d6', subtle: '#737aa2',
      accent: '#7aa2f7', red: '#f7768e', orange: '#ff9e64', green: '#9ece6a', blue: '#7aa2f7',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic, north-bluish calm',
    kind: 'dark',
    palette: {
      bg: '#2b303b', surface: '#2e3440', raised: '#3b4252', border: '#434c5e',
      text: '#eceff4', muted: '#d8dee9', subtle: '#9aa5b8',
      accent: '#88c0d0', red: '#bf616a', orange: '#d08770', green: '#a3be8c', blue: '#81a1c1',
    },
  },
  {
    id: 'cobalt2',
    name: 'Cobalt2',
    description: 'Bold cobalt blue with golden highlights',
    kind: 'dark',
    palette: {
      bg: '#15232d', surface: '#193549', raised: '#1f4662', border: '#234e6d',
      text: '#ffffff', muted: '#c7d6e2', subtle: '#8fa9bd',
      accent: '#ffc600', red: '#ff628c', orange: '#ff9d00', green: '#3ad900', blue: '#9effff',
    },
  },
  {
    id: 'synthwave',
    name: 'SynthWave ’84',
    description: 'Retro neon pink and cyan on dusky purple',
    kind: 'dark',
    palette: {
      bg: '#1e1a2e', surface: '#262335', raised: '#2a2139', border: '#3b3052',
      text: '#ffffff', muted: '#c9c5e0', subtle: '#8f8bb8',
      accent: '#ff7edb', red: '#fe4450', orange: '#fede5d', green: '#72f1b8', blue: '#36f9f6',
    },
  },
  {
    id: 'ayu-mirage',
    name: 'Ayu Mirage',
    description: 'Muted slate with a warm golden accent',
    kind: 'dark',
    palette: {
      bg: '#1c212b', surface: '#1f2430', raised: '#242936', border: '#33394a',
      text: '#cccac2', muted: '#b0aea5', subtle: '#8a919e',
      accent: '#ffcc66', red: '#f28779', orange: '#ffad66', green: '#87d96c', blue: '#73d0ff',
    },
  },
  {
    id: 'ayu-light',
    name: 'Ayu Light',
    description: 'Airy white with a warm orange accent',
    kind: 'light',
    palette: {
      bg: '#f3f4f5', surface: '#fcfcfc', border: '#e1e3e6',
      text: '#44494f', muted: '#5c6166', subtle: '#737b85',
      accent: '#d9711a', red: '#d95050', orange: '#a86a00', green: '#4d7a00', blue: '#1f7ac2',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    description: 'Soothing pastels on a cozy dark base',
    kind: 'dark',
    palette: {
      bg: '#181825', surface: '#1e1e2e', raised: '#313244', border: '#313244',
      text: '#cdd6f4', muted: '#bac2de', subtle: '#9399b2',
      accent: '#cba6f7', red: '#f38ba8', orange: '#fab387', green: '#a6e3a1', blue: '#89b4fa',
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    description: 'Catppuccin’s gentle light pastels',
    kind: 'light',
    palette: {
      bg: '#e6e9ef', surface: '#eff1f5', raised: '#f5f6f9', border: '#ccd0da',
      text: '#4c4f69', muted: '#5c5f77', subtle: '#6c6f85',
      accent: '#8839ef', red: '#d20f39', orange: '#b35b00', green: '#347d22', blue: '#1e66f5',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox Dark',
    description: 'Retro, earthy and warm',
    kind: 'dark',
    palette: {
      bg: '#1d2021', surface: '#282828', raised: '#32302f', border: '#3c3836',
      text: '#ebdbb2', muted: '#d5c4a1', subtle: '#a89984',
      accent: '#fabd2f', red: '#fb4934', orange: '#fe8019', green: '#b8bb26', blue: '#83a598',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    description: 'The precision palette, deep teal',
    kind: 'dark',
    palette: {
      bg: '#00212b', surface: '#002b36', raised: '#073642', border: '#0b4351',
      text: '#eee8d5', muted: '#93a1a1', subtle: '#7f9090',
      accent: '#268bd2', red: '#dc322f', orange: '#cb4b16', green: '#859900', blue: '#268bd2',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    description: 'The precision palette, warm cream',
    kind: 'light',
    palette: {
      bg: '#eee8d5', surface: '#fdf6e3', border: '#e0d9c4',
      text: '#073642', muted: '#4f6069', subtle: '#657b83',
      accent: '#268bd2', red: '#c42c2a', orange: '#a8420f', green: '#5f6e00', blue: '#1f73ad',
    },
  },
]
