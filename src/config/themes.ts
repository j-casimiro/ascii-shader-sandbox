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
    gradStart: '#001409',
    gradEnd: '#ccffdd',
    mode: 2,
  },
  {
    id: 'amber-crt',
    name: 'Amber CRT',
    bg: '#0b0600',
    accent: '#ffb000',
    gradStart: '#1c0a00',
    gradEnd: '#fff3cc',
    mode: 2,
  },
  {
    id: 'cyberpunk-flame',
    name: 'Cyberpunk Flame',
    bg: '#0e0012',
    accent: '#ff0055',
    gradStart: '#1f0033',
    gradEnd: '#ffccee',
    mode: 2,
  },
  {
    id: 'ocean-currents',
    name: 'Ocean Currents',
    bg: '#000914',
    accent: '#0088ff',
    gradStart: '#000b22',
    gradEnd: '#99eeff',
    mode: 2,
  },
  {
    id: 'volcanic-glow',
    name: 'Volcanic Glow',
    bg: '#0a0100',
    accent: '#ff3300',
    gradStart: '#1a0300',
    gradEnd: '#ffdd00',
    mode: 2,
  },
  {
    id: 'classic-bw',
    name: 'Classic B&W',
    bg: '#000000',
    accent: '#777777',
    gradStart: '#1a1a1a',
    gradEnd: '#ffffff',
    mode: 2,
  },
  {
    id: 'terminal-green',
    name: 'Terminal Green',
    bg: '#000801',
    accent: '#33ff33',
    gradStart: '#001200',
    gradEnd: '#aaffaa',
    mode: 2,
  },
  {
    id: 'paper-print',
    name: 'Paper Print (Light)',
    bg: '#f4f4f6',
    accent: '#445566',
    gradStart: '#ccccdd',
    gradEnd: '#0d0d1a',
    mode: 2,
  },
  {
    id: 'pewdiepie',
    name: 'PewDiePie',
    bg: '#000000',
    accent: '#ff0033',
    gradStart: '#660011',
    gradEnd: '#ff4455',
    mode: 0,
  },
]

/** Default theme: Amber CRT. */
export const DEFAULT_THEME_ID = 'amber-crt'

export function getTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((t) => t.id === id) ?? COLOR_THEMES[1]
}
