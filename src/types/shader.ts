/**
 * Shared type contract for the ASCII Shader Sandbox.
 *
 * Most effects funnel into one back end: a fragment shader computes a single
 * scalar intensity per character cell, which is quantized to a glyph index,
 * sampled from a pre-baked font atlas, and tinted by the active color theme.
 * Dedicated renderers use the same control contract where they need their own
 * state or context.
 */
import type { RefObject } from 'react'

/** How `getColor()` colorizes a scalar intensity into an RGB tint. */
export type ColorMode =
  | 0 // solid       — single accent color
  | 1 // gradient    — vertical interpolation between a start/end pair
  | 2 // multivalue  — heat ramp across intensity bands
  | 3 // matrix      — classic falling-green look

/** The available renderer modes. */
export type ShaderMode =
  | 0 // procedural noise field
  | 1 // flow / domain-warped noise
  | 2 // plasma / interference
  | 3 // source image
  | 4 // additional procedural field
  | 5 // blackhole   (own WebGL1 context — blackhole-shader.tsx)
  | 6 // turing      (own WebGL2 context — turing-shader.tsx)
  | 7 // matrix rain (own 2D canvas renderer — matrix-rain-shader.tsx)
  | 8 // automata    (own 2D canvas renderer — cellular-automata-shader.tsx)
  | 9 // pewdiepie   (domain-warped wavy diagonal stripes)
  | 10 // truchet    (randomly oriented quarter-circle arc tiles)
  | 11 // truchet tiles (2-port multi-tile set; fixed cells that spin 90°, always connected)

/** A selectable color theme. */
export interface ColorTheme {
  id: string
  name: string
  /** Background hex, composited under the lit glyph. */
  bg: string
  /** Primary accent / solid hex. */
  accent: string
  /** Gradient start hex (used by color modes 1 and 2). */
  gradStart: string
  /** Gradient end hex (used by color modes 1 and 2). */
  gradEnd: string
  /** Colorization strategy. */
  mode: ColorMode
}

/** A quick-pick glyph ramp, ordered dark → light. */
export interface GlyphRamp {
  id: string
  label: string
  chars: string
}

/**
 * Live configuration shared across the container's control panel and every
 * renderer. This is the single source of truth for the UI; renderers read it.
 */
export interface ShaderConfig {
  mode: ShaderMode
  /** Glyph ramp string, ordered dark → light. */
  chars: string
  charWidth: number
  charHeight: number
  /** Noise zoom / scale (modes 0, 1, 4 only). */
  scale: number
  /** Animation speed multiplier, 0.0–4.0×. */
  speed: number
  /** Brightness gain applied before quantization, 0.2–2.0. */
  brightness: number
  /** CRT scanline CSS overlay. */
  crt: boolean
  /** Active color theme id (resolves into COLOR_THEMES). */
  themeId: string
  /** Source Image: uploaded image (object URL or data URL). */
  imageSrc: string | null
  /**
   * Source Image: when true (and an image is loaded), the canvas renders the
   * image instead of the selected algorithm. Decoupled from `mode` so the
   * algorithm dropdown stays purely about procedural effects.
   */
  imageEnabled: boolean
  /** Source Image: passthrough the image's own colors instead of theme tint. */
  imageUseColors: boolean
  showRealColors: boolean
}

/**
 * Prop contract for the separate-component effects. The parent
 * container remains the single source of truth for screensaver state and feeds
 * resolved theme colors as hex strings.
 */
export interface ShaderProps {
  chars?: string
  charWidth?: number
  charHeight?: number
  speed?: number
  brightness?: number
  crt?: boolean
  colorMode?: number // 0 solid | 1 gradient | 2 multivalue | 3 matrix
  colorSolid?: string // hex
  colorGradStart?: string // hex
  colorGradEnd?: string // hex
  colorBg?: string // hex
  isParentScreensaver?: boolean
  onExitParentScreensaver?: () => void
  externalCanvasRef?: RefObject<HTMLCanvasElement | null> // for exports
  exportRef?: RefObject<{ getHtml?: () => Promise<string> | string } | null>
  showRealColors?: boolean
}
