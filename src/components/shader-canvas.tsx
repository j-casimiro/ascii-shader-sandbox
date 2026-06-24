import { useCallback, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import type { ColorTheme, ShaderConfig } from '@/types/shader'

interface ShaderCanvasProps {
  config: ShaderConfig
  theme: ColorTheme
  /** Forwarded so exports can read back the framebuffer. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

// ─── Vertex Shader (GLSL ES 1.00) ─────────────────────────────────────
const VERTEX_SHADER = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

// ─── Fragment Shader — shared back end for modes 0–4 ──────────────────
// One scalar intensity `val` is computed per character cell (at the cell
// center), quantized to a glyph index, sampled from the font atlas, and tinted
// by the active theme. The effect-specific intensity is branched on u_mode.
const FRAGMENT_SHADER = `
  precision highp float;
  precision highp int;

  uniform sampler2D u_font_atlas;
  uniform vec2  u_resolution;
  uniform vec2  u_grid_size;
  uniform float u_char_count;
  uniform float u_brightness;
  uniform float u_time;
  uniform float u_scale;
  uniform int   u_mode;

  // Color theme uniforms
  uniform int   u_color_mode;
  uniform vec3  u_color_solid;
  uniform vec3  u_color_grad_start;
  uniform vec3  u_color_grad_end;
  uniform vec3  u_color_bg;

  // ── Hand-written value-noise fBm ──────────────────────────────────
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);          // smoothstep interpolation
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      v += amp * valueNoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return v / 0.96875;                        // normalize ~[0,1]
  }

  // ── Hand-written Worley (cellular) noise ──────────────────────────
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)),
                          dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }

  // F1 distance to the nearest animated feature point. Returns ~[0,1].
  float worley(vec2 p) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float minDist = 1.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(ip + g);
        o = 0.5 + 0.5 * sin(u_time * 0.6 + 6.2831 * o);  // drift the points
        vec2 r = g + o - fp;
        minDist = min(minDist, dot(r, r));
      }
    }
    return sqrt(minDist);
  }

  // ── Effect intensity, branched on u_mode ──────────────────────────
  float computeIntensity(vec2 uv) {
    if (u_mode == 0) {
      // Mode 0 — animated procedural noise field.
      vec2 p = uv;
      p.x *= u_resolution.x / u_resolution.y;  // aspect-correct so features stay round
      p *= u_scale;
      p += vec2(u_time * 0.15, u_time * -0.10);
      return fbm(p);
    } else if (u_mode == 2) {
      // Mode 2 — Plasma: layered sine interference. Smooth bands that read
      // clearly even at the coarse one-sample-per-cell grid. No u_scale.
      vec2 p = uv;
      p.x *= u_resolution.x / u_resolution.y;  // aspect-correct radial term
      float t = u_time;

      // Domain warp: displace coords by smooth low-freq value noise so the
      // sine grid never tiles into an obvious repeat. Single-octave (not fBm)
      // keeps the warp soft — no high-frequency grain. The warp itself drifts.
      vec2 warp = vec2(
        valueNoise(p * 1.2 + vec2(0.0, t * 0.12)),
        valueNoise(p * 1.2 + vec2(5.2, t * 0.10 + 1.7))
      );
      p += (warp - 0.5) * 1.5;

      float v = sin(p.x * 9.0 + t);
      v += sin(p.y * 9.0 + t * 1.1);
      v += sin((p.x + p.y) * 8.0 + t * 0.8);
      vec2 c = p + 0.5 * vec2(sin(t * 0.33), cos(t * 0.41));
      v += sin(length(c) * 12.0 - t * 1.3);
      // Smooth low-freq term adds gentle non-periodic large-scale variation.
      v += 2.0 * (valueNoise(p * 0.8 + vec2(t * 0.07, -t * 0.05)) - 0.5);
      return v * 0.1 + 0.5;                    // [-5,5] -> [0,1]
    } else if (u_mode == 4) {
      // Mode 4 — Field: animated Worley (cellular) noise. Organic pulsing
      // cells, distinct from fBm grain (mode 0) and sine bands (mode 2).
      vec2 p = uv;
      p.x *= u_resolution.x / u_resolution.y;  // aspect-correct cells
      p *= u_scale;
      float d = worley(p);
      return 1.0 - clamp(d, 0.0, 1.0);         // bright cell centers, dark borders
    }
    // TODO: mode 3 (Source Image). Authored in its own task.
    return 0.0;
  }

  // ── Theme colorization ────────────────────────────────────────────
  vec3 getColor(float v, vec2 uv) {
    if (u_color_mode == 0) {
      return u_color_solid;                                  // solid
    } else if (u_color_mode == 1) {
      return mix(u_color_grad_start, u_color_grad_end,
                 clamp(uv.y, 0.0, 1.0));                     // vertical gradient
    } else if (u_color_mode == 3) {
      return u_color_solid * (0.25 + 0.75 * clamp(v, 0.0, 1.0)); // matrix green
    }
    // mode 2 — multivalue heat ramp (start → solid → end)
    float t = clamp(v, 0.0, 1.0);
    if (t < 0.5) {
      return mix(u_color_grad_start, u_color_solid, t / 0.5);
    }
    return mix(u_color_solid, u_color_grad_end, (t - 0.5) / 0.5);
  }

  void main() {
    vec2 gridCoords  = floor(gl_FragCoord.xy / u_grid_size);   // which cell
    vec2 localCoords = fract(gl_FragCoord.xy / u_grid_size);   // where in the cell
    vec2 uv = (gridCoords + 0.5) * u_grid_size / u_resolution; // cell CENTER

    float val = computeIntensity(uv);
    val *= u_brightness;
    val = clamp(val, 0.0, 1.0);

    float charIdx = clamp(floor(val * u_char_count), 0.0, u_char_count - 1.0);
    vec2  fontUv  = vec2((charIdx + localCoords.x) / u_char_count, localCoords.y);
    float charIntensity = texture2D(u_font_atlas, fontUv).r;

    vec3 color = getColor(val, uv);
    gl_FragColor = vec4(mix(u_color_bg, color, charIntensity), 1.0);
  }
`

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
  ]
}

type UniformMap = Record<string, WebGLUniformLocation | null>

/**
 * Host surface for the shared WebGL1 effects (modes 0–4).
 *
 * Owns one WebGL1 context + fragment shader (switched on `u_mode`) and the
 * pre-baked font atlas. A fragment computes a single scalar intensity per
 * character cell at the cell center, quantizes it to a glyph index, samples the
 * atlas at the sub-cell position, and composites the theme-tinted glyph over
 * the background. The context is created with `preserveDrawingBuffer: true` so
 * text/PNG exports can read back the framebuffer.
 *
 * Currently only mode 0 (Noise Field) is implemented; the other branches are
 * scaffolded and authored in their own tasks.
 */
export function ShaderCanvas({ config, theme, canvasRef }: ShaderCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const fontAtlasTextureRef = useRef<WebGLTexture | null>(null)

  // Live values read through refs so the render loop is set up only once.
  const charsRef = useRef(config.chars)
  const charWidthRef = useRef(config.charWidth)
  const charHeightRef = useRef(config.charHeight)
  const scaleRef = useRef(config.scale)
  const speedRef = useRef(config.speed)
  const brightnessRef = useRef(config.brightness)
  const modeRef = useRef(config.mode)
  const colorModeRef = useRef(theme.mode)
  const colorSolidRef = useRef(hexToRgb(theme.accent))
  const colorGradStartRef = useRef(hexToRgb(theme.gradStart))
  const colorGradEndRef = useRef(hexToRgb(theme.gradEnd))
  const colorBgRef = useRef(hexToRgb(theme.bg))

  useEffect(() => {
    charsRef.current = config.chars
    charWidthRef.current = config.charWidth
    charHeightRef.current = config.charHeight
    scaleRef.current = config.scale
    speedRef.current = config.speed
    brightnessRef.current = config.brightness
    modeRef.current = config.mode
    colorModeRef.current = theme.mode
    colorSolidRef.current = hexToRgb(theme.accent)
    colorGradStartRef.current = hexToRgb(theme.gradStart)
    colorGradEndRef.current = hexToRgb(theme.gradEnd)
    colorBgRef.current = hexToRgb(theme.bg)
  }, [config, theme])

  // Pre-bake the font atlas: a horizontal strip of every ramp glyph, drawn in
  // bold white monospace on black. LUMINANCE / NEAREST / CLAMP_TO_EDGE keeps
  // glyph edges crisp. Rebuilt only when the ramp or character size changes.
  const buildFontAtlas = useCallback(
    (gl: WebGLRenderingContext, charsList: string, w: number, h: number) => {
      if (fontAtlasTextureRef.current) {
        gl.deleteTexture(fontAtlasTextureRef.current)
      }

      const atlasCanvas = document.createElement('canvas')
      const ctx = atlasCanvas.getContext('2d')
      if (!ctx) return

      atlasCanvas.width = Math.max(1, w * charsList.length)
      atlasCanvas.height = h

      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height)
      ctx.fillStyle = 'white'
      ctx.font = `bold ${h - 2}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (let i = 0; i < charsList.length; i++) {
        ctx.fillText(charsList[i], i * w + w / 2, h / 2)
      }

      const texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        atlasCanvas,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

      fontAtlasTextureRef.current = texture
    },
    [],
  )

  // Rebuild the font atlas when the ramp or character size changes.
  useEffect(() => {
    const gl = glRef.current
    if (gl) buildFontAtlas(gl, config.chars, config.charWidth, config.charHeight)
  }, [config.chars, config.charWidth, config.charHeight, buildFontAtlas])

  // WebGL1 initialization + render loop (set up once).
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true })
    if (!gl) {
      console.error('WebGL not supported')
      return
    }
    glRef.current = gl

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vs = createShader(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vs || !fs) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    // Full-screen quad.
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // Cache uniform locations.
    const u: UniformMap = {}
    for (const name of [
      'u_font_atlas',
      'u_resolution',
      'u_grid_size',
      'u_char_count',
      'u_brightness',
      'u_time',
      'u_scale',
      'u_mode',
      'u_color_mode',
      'u_color_solid',
      'u_color_grad_start',
      'u_color_grad_end',
      'u_color_bg',
    ]) {
      u[name] = gl.getUniformLocation(program, name)
    }

    buildFontAtlas(
      gl,
      charsRef.current,
      charWidthRef.current,
      charHeightRef.current,
    )

    const resize = () => {
      const w = Math.max(1, container.clientWidth)
      const h = Math.max(1, container.clientHeight)
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    let rafId = 0
    let prevTime = 0
    let elapsed = 0

    const render = (ts: number) => {
      if (prevTime === 0) prevTime = ts
      const dt = (ts - prevTime) / 1000
      prevTime = ts
      elapsed += dt * speedRef.current

      gl.uniform2f(u.u_resolution, canvas.width, canvas.height)
      gl.uniform2f(u.u_grid_size, charWidthRef.current, charHeightRef.current)
      gl.uniform1f(u.u_char_count, Math.max(1, charsRef.current.length))
      gl.uniform1f(u.u_brightness, brightnessRef.current)
      gl.uniform1f(u.u_time, elapsed)
      gl.uniform1f(u.u_scale, scaleRef.current)
      gl.uniform1i(u.u_mode, modeRef.current)
      gl.uniform1i(u.u_color_mode, colorModeRef.current)
      gl.uniform3fv(u.u_color_solid, colorSolidRef.current)
      gl.uniform3fv(u.u_color_grad_start, colorGradStartRef.current)
      gl.uniform3fv(u.u_color_grad_end, colorGradEndRef.current)
      gl.uniform3fv(u.u_color_bg, colorBgRef.current)

      if (fontAtlasTextureRef.current) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, fontAtlasTextureRef.current)
        gl.uniform1i(u.u_font_atlas, 0)
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6)
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)

    return () => {
      resizeObserver.disconnect()
      cancelAnimationFrame(rafId)
      if (fontAtlasTextureRef.current) {
        gl.deleteTexture(fontAtlasTextureRef.current)
        fontAtlasTextureRef.current = null
      }
      gl.deleteProgram(program)
      gl.deleteBuffer(buffer)
      glRef.current = null
    }
  }, [canvasRef, buildFontAtlas])

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
