import type { ColorTheme } from '@/types/shader'

/**
 * The 8 color themes. Each defines a background, an accent/solid color, a
 * gradient pair, and a `mode` that selects how `getColor()` colorizes intensity
 * (0 solid · 1 vertical gradient · 2 multivalue heat ramp · 3 matrix green).
 */
export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'matrix-neon',
    name: 'Matrix Neon',
    bg: '#000000',
    accent: '#00ff33',
    gradStart: '#003311',
    gradEnd: '#00ff33',
    mode: 3,
  },
  {
    id: 'amber-crt',
    name: 'Amber CRT',
    bg: '#0b0600',
    accent: '#ffb000',
    gradStart: '#3a1e00',
    gradEnd: '#ffd060',
    mode: 0,
  },
  {
    id: 'cyberpunk-flame',
    name: 'Cyberpunk Flame',
    bg: '#0e0012',
    accent: '#ff0055',
    gradStart: '#3a0066',
    gradEnd: '#ff0055',
    mode: 1,
  },
  {
    id: 'ocean-currents',
    name: 'Ocean Currents',
    bg: '#000914',
    accent: '#0088ff',
    gradStart: '#001a33',
    gradEnd: '#33ddff',
    mode: 1,
  },
  {
    id: 'volcanic-glow',
    name: 'Volcanic Glow',
    bg: '#0a0100',
    accent: '#ff3300',
    gradStart: '#330000',
    gradEnd: '#ffdd00',
    mode: 2,
  },
  {
    id: 'classic-bw',
    name: 'Classic B&W',
    bg: '#000000',
    accent: '#ffffff',
    gradStart: '#444444',
    gradEnd: '#ffffff',
    mode: 0,
  },
  {
    id: 'terminal-green',
    name: 'Terminal Green',
    bg: '#000801',
    accent: '#33ff33',
    gradStart: '#0a3a0a',
    gradEnd: '#33ff33',
    mode: 0,
  },
  {
    id: 'paper-print',
    name: 'Paper Print (Light)',
    bg: '#f4f4f6',
    accent: '#1b1b22',
    gradStart: '#9a9aa2',
    gradEnd: '#1b1b22',
    mode: 0,
  },
]

/** Default theme: Amber CRT. */
export const DEFAULT_THEME_ID = 'amber-crt'

export function getTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((t) => t.id === id) ?? COLOR_THEMES[1]
}
