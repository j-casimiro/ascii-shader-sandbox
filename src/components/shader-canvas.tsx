import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import type { ColorTheme, ShaderConfig } from '@/types/shader'

interface ShaderCanvasProps {
  config: ShaderConfig
  theme: ColorTheme
  /** Forwarded so exports can read back the framebuffer. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

/**
 * Host surface for the shared WebGL1 effects (modes 0–4).
 *
 * For now this only owns the canvas lifecycle — DPR-aware sizing against its
 * container and the CRT scanline overlay. The WebGL context + fragment shader
 * pipeline (font atlas, per-cell intensity, glyph compositing) is authored
 * later and drops into the marked render scaffold below; the canvas is created
 * with `preserveDrawingBuffer: true` so text/PNG exports can read it back.
 */
export function ShaderCanvas({ config, theme, canvasRef }: ShaderCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // DPR-aware sizing: keep the drawing buffer matched to the displayed size.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { clientWidth, clientHeight } = container
      canvas.width = Math.max(1, Math.floor(clientWidth * dpr))
      canvas.height = Math.max(1, Math.floor(clientHeight * dpr))
      paintPlaceholder(canvas, theme)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [canvasRef, theme])

  // Repaint the placeholder when the theme changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) paintPlaceholder(canvas, theme)
  }, [canvasRef, theme, config])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ backgroundColor: theme.bg }}
      />
      {config.crt && <CrtOverlay />}
    </div>
  )
}

/** Pure-CSS CRT scanline overlay. */
function CrtOverlay({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent 3px)',
        mixBlendMode: 'multiply',
      }}
    />
  )
}

/**
 * Temporary 2D placeholder until the WebGL pipeline lands. Fills the theme
 * background and labels the surface so the layout/theming reads correctly.
 */
function paintPlaceholder(canvas: HTMLCanvasElement, theme: ColorTheme) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  ctx.fillStyle = theme.accent
  ctx.globalAlpha = 0.5
  ctx.font = `${12 * dpr}px SFMono-Regular, Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    'shader pipeline not yet wired',
    canvas.width / 2,
    canvas.height / 2,
  )
  ctx.globalAlpha = 1
}
