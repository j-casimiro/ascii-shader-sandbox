import type { GlyphRamp } from '@/types/shader'

export const ASCII_RAMP = ' .,:;+*?%S#@'
export const STANDARD_RAMP = ' .:-=+*#%@'
export const DETAILED_RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
export const BLOCKS_RAMP = ' ░▒▓█'
export const BINARY_RAMP = ' 01'
export const SOLID_RAMP = '█'
export const MINIMAL_RAMP = ' .xX*#@'
export const LIFE_RAMP = ' .,:;ox%#@'

/** Default glyph ramp, ordered dark → light. */
export const DEFAULT_RAMP = ASCII_RAMP

/** Quick-pick glyph ramps surfaced as buttons in the control panel. */
export const GLYPH_RAMPS: GlyphRamp[] = [
  { id: 'ascii', label: 'ASCII', chars: ASCII_RAMP },
  { id: 'standard', label: 'Standard', chars: STANDARD_RAMP },
  { id: 'detailed', label: 'Detailed', chars: DETAILED_RAMP },
  { id: 'blocks', label: 'Blocks', chars: BLOCKS_RAMP },
  { id: 'binary', label: 'Binary', chars: BINARY_RAMP },
  { id: 'solid', label: 'Solid', chars: SOLID_RAMP },
  { id: 'minimal', label: 'Minimal', chars: MINIMAL_RAMP },
  { id: 'life', label: 'Life', chars: LIFE_RAMP },
]
