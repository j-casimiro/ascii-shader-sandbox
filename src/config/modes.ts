import type { ShaderMode } from '@/types/shader';
import {
  ASCII_RAMP,
  BINARY_RAMP,
  BLOCKS_RAMP,
  DETAILED_RAMP,
  LIFE_RAMP,
  MINIMAL_RAMP,
  STANDARD_RAMP,
} from '@/config/ramps';

export interface ShaderModeDefaults {
  chars: string;
  themeId: string;
  speed: number;
}

export interface ShaderModeDef {
  mode: ShaderMode;
  name: string;
  /** Short hint shown under the selector. */
  description: string;
  /** Whether the Noise Zoom / Scale control applies. */
  usesScale: boolean;
  /** Whether this effect renders in its own dedicated component/context. */
  separateComponent: boolean;
  /** Applied when this algorithm is selected from the dropdown. */
  defaults: ShaderModeDefaults;
}

/**
 * The selectable shader *algorithms*. Modes 0/2/4 share one WebGL1 context +
 * fragment shader (switched on `u_mode`); modes 5/6/7/8 own their rendering
 * contexts in separate components. Mode 3 (Source Image) is intentionally
 * absent: it is not an algorithm but an input source, toggled via its own panel
 * (`imageEnabled`), and rendered by the shared WebGL1 fragment shader's
 * `u_mode == 3` branch.
 */
export const SHADER_MODES: ShaderModeDef[] = [
  {
    mode: 0,
    name: 'Noise Field',
    description: 'Animated procedural noise.',
    usesScale: true,
    separateComponent: false,
    defaults: {
      chars: STANDARD_RAMP,
      themeId: 'ocean-currents',
      speed: 0.55,
    },
  },
  {
    mode: 2,
    name: 'Plasma',
    description: 'Layered sine interference.',
    usesScale: false,
    separateComponent: false,
    defaults: {
      chars: DETAILED_RAMP,
      themeId: 'cyberpunk-flame',
      speed: 0.7,
    },
  },
  {
    mode: 4,
    name: 'Field',
    description: 'Additional procedural field.',
    usesScale: true,
    separateComponent: false,
    defaults: {
      chars: MINIMAL_RAMP,
      themeId: 'classic-bw',
      speed: 0.45,
    },
  },
  {
    mode: 5,
    name: 'Blackhole',
    description: 'Gravitational lensing (WebGL1).',
    usesScale: false,
    separateComponent: true,
    defaults: {
      chars: ASCII_RAMP,
      themeId: 'volcanic-glow',
      speed: 0.85,
    },
  },
  {
    mode: 6,
    name: 'Turing',
    description: 'Reaction-diffusion (WebGL2).',
    usesScale: false,
    separateComponent: true,
    defaults: {
      chars: BLOCKS_RAMP,
      themeId: 'paper-print',
      speed: 0.75,
    },
  },
  {
    mode: 7,
    name: 'Matrix Rain',
    description: 'Falling per-column glyph streams.',
    usesScale: false,
    separateComponent: true,
    defaults: {
      chars: BINARY_RAMP,
      themeId: 'matrix-neon',
      speed: 1.2,
    },
  },
  {
    mode: 8,
    name: 'Cellular Automata',
    description: 'Life-like cyclic feedback grid.',
    usesScale: false,
    separateComponent: true,
    defaults: {
      chars: LIFE_RAMP,
      themeId: 'terminal-green',
      speed: 0.45,
    },
  },
];

export function getModeDef(mode: ShaderMode): ShaderModeDef {
  return SHADER_MODES.find((m) => m.mode === mode) ?? SHADER_MODES[0];
}

export function getModeDefaults(mode: ShaderMode): ShaderModeDefaults {
  return getModeDef(mode).defaults;
}

/** Default live configuration. */
export const DEFAULT_CONFIG = {
  mode: 0 as ShaderMode,
  charWidth: 7,
  charHeight: 12,
  scale: 4.0,
  speed: 0.55,
  brightness: 1.0,
  crt: false,
};
