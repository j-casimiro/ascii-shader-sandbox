import type { GlyphRamp } from '@/types/shader'

/** Default glyph ramp, ordered dark → light. */
export const DEFAULT_RAMP = ' .,:;+*?%S#@'

/** Quick-pick glyph ramps surfaced as buttons in the control panel. */
export const GLYPH_RAMPS: GlyphRamp[] = [
  { id: 'standard', label: 'Standard', chars: ' .:-=+*#%@' },
  { id: 'detailed', label: 'Detailed', chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { id: 'blocks', label: 'Blocks', chars: ' ░▒▓█' },
  { id: 'binary', label: 'Binary', chars: ' 01' },
  { id: 'solid', label: 'Solid', chars: '█' },
  { id: 'minimal', label: 'Minimal', chars: ' .xX*#@' },
]
