import type { ShaderMode } from '@/types/shader'

export interface ShaderModeDef {
  mode: ShaderMode
  name: string
  /** Short hint shown under the selector. */
  description: string
  /** Whether the Noise Zoom / Scale control applies (modes 0, 1, 4 only). */
  usesScale: boolean
  /** Whether this effect renders in its own dedicated component/context. */
  separateComponent: boolean
}

/**
 * The 7 shader algorithms. Modes 0–4 share one WebGL1 context + fragment shader
 * (switched on `u_mode`); modes 5 and 6 own their contexts in separate
 * components. Effects/shaders themselves are authored later — this only
 * describes the selectable set and which controls each mode exposes.
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
    mode: 1,
    name: 'Flow',
    description: 'Domain-warped flowing noise.',
    usesScale: true,
    separateComponent: false,
  },
  {
    mode: 2,
    name: 'Plasma',
    description: 'Layered interference patterns.',
    usesScale: false,
    separateComponent: false,
  },
  {
    mode: 3,
    name: 'Source Image',
    description: 'ASCII-ify an uploaded image.',
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
]

export function getModeDef(mode: ShaderMode): ShaderModeDef {
  return SHADER_MODES.find((m) => m.mode === mode) ?? SHADER_MODES[0]
}

/** Default live configuration. */
export const DEFAULT_CONFIG = {
  mode: 0 as ShaderMode,
  charWidth: 10,
  charHeight: 16,
  scale: 4.0,
  speed: 1.0,
  brightness: 1.0,
  crt: false,
}
