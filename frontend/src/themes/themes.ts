/**
 * Themes are flat maps of design tokens (CSS custom properties), like VS Code
 * color themes. Every theme must define every token in `TokenName`. Components
 * only ever reference `var(--token)`.
 *
 * `kind` decides how decks see the theme: dark themes get Anki's night-mode
 * body classes inside the card iframe, which existing decks already style.
 */

export type TokenName =
  // surfaces
  | 'bg'
  | 'bg-subtle'
  | 'surface'
  | 'surface-raised'
  | 'surface-hover'
  | 'surface-active'
  | 'overlay'
  // lines
  | 'border'
  | 'border-strong'
  // text
  | 'text'
  | 'text-muted'
  | 'text-subtle'
  | 'text-on-accent'
  // brand
  | 'accent'
  | 'accent-hover'
  | 'accent-soft'
  | 'focus'
  // queue counts (Anki's new / learning / review)
  | 'count-new'
  | 'count-learn'
  | 'count-review'
  // answer buttons
  | 'again'
  | 'hard'
  | 'good'
  | 'easy'
  // card iframe: Anki's --canvas / --fg, used by body.nightMode
  | 'card-canvas'
  | 'card-fg'
  // depth
  | 'shadow-sm'
  | 'shadow-md'
  | 'shadow-lg'

export interface Theme {
  id: string
  name: string
  description: string
  kind: 'light' | 'dark'
  tokens: Record<TokenName, string>
}

const light: Theme = {
  id: 'light',
  name: 'Light',
  description: 'Clean and bright',
  kind: 'light',
  tokens: {
    bg: '#f6f6f3',
    'bg-subtle': '#efefeb',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    'surface-hover': '#f2f2ee',
    'surface-active': '#e9e9e4',
    overlay: 'rgba(24, 24, 20, 0.28)',
    border: '#e4e3dd',
    'border-strong': '#cfcec6',
    text: '#1b1c1e',
    'text-muted': '#5d6066',
    'text-subtle': '#8b8e94',
    'text-on-accent': '#ffffff',
    accent: '#3a5bd9',
    'accent-hover': '#2f4cc0',
    'accent-soft': 'rgba(58, 91, 217, 0.10)',
    focus: 'rgba(58, 91, 217, 0.45)',
    'count-new': '#2f6fdf',
    'count-learn': '#c8491f',
    'count-review': '#1f8a4c',
    again: '#d4452b',
    hard: '#b7791f',
    good: '#1f8a4c',
    easy: '#2f6fdf',
    'card-canvas': '#ffffff',
    'card-fg': '#1b1c1e',
    'shadow-sm': '0 1px 2px rgba(20, 20, 16, 0.06)',
    'shadow-md': '0 1px 2px rgba(20, 20, 16, 0.05), 0 4px 16px rgba(20, 20, 16, 0.06)',
    'shadow-lg': '0 2px 6px rgba(20, 20, 16, 0.06), 0 24px 60px rgba(20, 20, 16, 0.18)',
  },
}

const dark: Theme = {
  id: 'dark',
  name: 'Dark',
  description: 'Easy on the eyes at night',
  kind: 'dark',
  tokens: {
    bg: '#121316',
    'bg-subtle': '#16171b',
    surface: '#1b1c20',
    'surface-raised': '#212227',
    'surface-hover': '#25262c',
    'surface-active': '#2c2d34',
    overlay: 'rgba(0, 0, 0, 0.55)',
    border: '#2a2b31',
    'border-strong': '#3a3b43',
    text: '#ececef',
    'text-muted': '#a2a4ad',
    'text-subtle': '#71737c',
    'text-on-accent': '#0d1020',
    accent: '#8aa4ff',
    'accent-hover': '#a3b7ff',
    'accent-soft': 'rgba(138, 164, 255, 0.14)',
    focus: 'rgba(138, 164, 255, 0.5)',
    'count-new': '#7fa6ff',
    'count-learn': '#ff8a65',
    'count-review': '#5fd08f',
    again: '#ff7a66',
    hard: '#f0b25a',
    good: '#5fd08f',
    easy: '#7fa6ff',
    'card-canvas': '#1b1c20',
    'card-fg': '#ececef',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-md': '0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 20px rgba(0, 0, 0, 0.3)',
    'shadow-lg': '0 2px 8px rgba(0, 0, 0, 0.4), 0 28px 70px rgba(0, 0, 0, 0.55)',
  },
}

const sepia: Theme = {
  id: 'sepia',
  name: 'Parchment',
  description: 'Warm, low-glare paper tones for long sessions',
  kind: 'light',
  tokens: {
    bg: '#efe6d4',
    'bg-subtle': '#e8dec9',
    surface: '#f8f1e3',
    'surface-raised': '#fbf6ec',
    'surface-hover': '#efe5d2',
    'surface-active': '#e6dac4',
    overlay: 'rgba(60, 44, 20, 0.28)',
    border: '#dccfb6',
    'border-strong': '#c9b999',
    text: '#3b2f22',
    'text-muted': '#6d5d49',
    'text-subtle': '#978670',
    'text-on-accent': '#fbf6ec',
    accent: '#9a5a2c',
    'accent-hover': '#834b22',
    'accent-soft': 'rgba(154, 90, 44, 0.12)',
    focus: 'rgba(154, 90, 44, 0.45)',
    'count-new': '#3e6a9e',
    'count-learn': '#b04a25',
    'count-review': '#4f7a32',
    again: '#b8432a',
    hard: '#a0701c',
    good: '#4f7a32',
    easy: '#3e6a9e',
    'card-canvas': '#f8f1e3',
    'card-fg': '#3b2f22',
    'shadow-sm': '0 1px 2px rgba(80, 56, 20, 0.08)',
    'shadow-md': '0 1px 2px rgba(80, 56, 20, 0.07), 0 4px 16px rgba(80, 56, 20, 0.08)',
    'shadow-lg': '0 2px 6px rgba(80, 56, 20, 0.08), 0 24px 60px rgba(80, 56, 20, 0.22)',
  },
}

const dusk: Theme = {
  id: 'dusk',
  name: 'Dusk',
  description: 'Warm dark theme with amber accents',
  kind: 'dark',
  tokens: {
    bg: '#1a1714',
    'bg-subtle': '#1e1a17',
    surface: '#231f1b',
    'surface-raised': '#29241f',
    'surface-hover': '#2e2823',
    'surface-active': '#36302a',
    overlay: 'rgba(0, 0, 0, 0.55)',
    border: '#342e28',
    'border-strong': '#463e36',
    text: '#efe6da',
    'text-muted': '#b3a697',
    'text-subtle': '#80746a',
    'text-on-accent': '#1a1410',
    accent: '#e8a664',
    'accent-hover': '#f0b87d',
    'accent-soft': 'rgba(232, 166, 100, 0.14)',
    focus: 'rgba(232, 166, 100, 0.5)',
    'count-new': '#8fb3e8',
    'count-learn': '#f08a64',
    'count-review': '#9fcf7a',
    again: '#f07c62',
    hard: '#e8b35c',
    good: '#9fcf7a',
    easy: '#8fb3e8',
    'card-canvas': '#231f1b',
    'card-fg': '#efe6da',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-md': '0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 20px rgba(0, 0, 0, 0.3)',
    'shadow-lg': '0 2px 8px rgba(0, 0, 0, 0.4), 0 28px 70px rgba(0, 0, 0, 0.55)',
  },
}

const highContrast: Theme = {
  id: 'high-contrast',
  name: 'High Contrast',
  description: 'Maximum legibility: pure black, bold edges',
  kind: 'dark',
  tokens: {
    bg: '#000000',
    'bg-subtle': '#000000',
    surface: '#000000',
    'surface-raised': '#0a0a0a',
    'surface-hover': '#1a1a1a',
    'surface-active': '#262626',
    overlay: 'rgba(0, 0, 0, 0.8)',
    border: '#8a8a8a',
    'border-strong': '#ffffff',
    text: '#ffffff',
    'text-muted': '#e6e6e6',
    'text-subtle': '#c4c4c4',
    'text-on-accent': '#000000',
    accent: '#ffd60a',
    'accent-hover': '#ffe45c',
    'accent-soft': 'rgba(255, 214, 10, 0.18)',
    focus: '#ffd60a',
    'count-new': '#6cb6ff',
    'count-learn': '#ff9f6c',
    'count-review': '#6cff9f',
    again: '#ff6c6c',
    hard: '#ffd60a',
    good: '#6cff9f',
    easy: '#6cb6ff',
    'card-canvas': '#000000',
    'card-fg': '#ffffff',
    'shadow-sm': '0 0 0 1px #8a8a8a',
    'shadow-md': '0 0 0 1px #c4c4c4',
    'shadow-lg': '0 0 0 2px #ffffff',
  },
}

export const THEMES: Theme[] = [light, dark, sepia, dusk, highContrast]

export const SYSTEM = 'system'
export type ThemeChoice = typeof SYSTEM | string

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id)
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice === SYSTEM) return prefersDark ? dark : light
  return themeById(choice) ?? (prefersDark ? dark : light)
}

export function themeCss(theme: Theme): string {
  const vars = Object.entries(theme.tokens)
    .map(([k, v]) => `--${k}:${v};`)
    .join('')
  return `:root{${vars}color-scheme:${theme.kind};}`
}
