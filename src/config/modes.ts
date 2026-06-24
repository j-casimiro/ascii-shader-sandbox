import type { ShaderMode } from '@/types/shader';

export interface ShaderModeDef {
  mode: ShaderMode;
  name: string;
  /** Short hint shown under the selector. */
  description: string;
  /** Whether the Noise Zoom / Scale control applies. */
  usesScale: boolean;
  /** Whether this effect renders in its own dedicated component/context. */
  separateComponent: boolean;
}

/**
 * The selectable shader *algorithms*. Modes 0/2/4 share one WebGL1 context +
 * fragment shader (switched on `u_mode`); modes 5/6/7 own their rendering
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
  },
  {
    mode: 2,
    name: 'Plasma',
    description: 'Layered sine interference.',
    usesScale: false,
    separateComponent: false,
  },
  {
    mode: 4,
    name: 'Field',
    description: 'Additional procedural field.',
    usesScale: true,
    separateComponent: false,
  },
  {
    mode: 5,
    name: 'Blackhole',
    description: 'Gravitational lensing (WebGL1).',
    usesScale: false,
    separateComponent: true,
  },
  {
    mode: 6,
    name: 'Turing',
    description: 'Reaction-diffusion (WebGL2).',
    usesScale: false,
    separateComponent: true,
  },
  {
    mode: 7,
    name: 'Matrix Rain',
    description: 'Falling per-column glyph streams.',
    usesScale: false,
    separateComponent: true,
  },
];

export function getModeDef(mode: ShaderMode): ShaderModeDef {
  return SHADER_MODES.find((m) => m.mode === mode) ?? SHADER_MODES[0];
}

/** Default live configuration. */
export const DEFAULT_CONFIG = {
  mode: 0 as ShaderMode,
  charWidth: 7,
  charHeight: 12,
  scale: 4.0,
  speed: 0.6,
  brightness: 1.0,
  crt: false,
};
