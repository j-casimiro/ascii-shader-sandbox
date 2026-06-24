import { useCallback, useEffect, useRef } from 'react'

import type { ShaderProps } from '@/types/shader'

// ─── Vertex Shader (GLSL ES 3.00) ─────────────────────────────────────
const VERTEX_SHADER = `#version 300 es
  layout(location = 0) in vec2 position;
  out vec2 vUv;
  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

// ─── Simulation Shader — Gray-Scott reaction-diffusion ────────────────
// Reads the previous chemical state (A in .x, B in .y) and integrates one
// step. Run many times per frame via ping-pong framebuffers.
const SIM_SHADER = `#version 300 es
  precision highp float;

  uniform sampler2D u_state;
  uniform vec2  u_res;   // simulation resolution
  uniform float u_feed;
  uniform float u_kill;

  in vec2 vUv;
  out vec4 outColor;

  void main() {
    vec2 t = 1.0 / u_res;

    vec2 c = texture(u_state, vUv).xy;

    // 9-point Laplacian (orthogonal 0.2, diagonal 0.05, center -1)
    vec2 lap = c * -1.0;
    lap += texture(u_state, vUv + t * vec2(-1.0, -1.0)).xy * 0.05;
    lap += texture(u_state, vUv + t * vec2( 0.0, -1.0)).xy * 0.20;
    lap += texture(u_state, vUv + t * vec2( 1.0, -1.0)).xy * 0.05;
    lap += texture(u_state, vUv + t * vec2(-1.0,  0.0)).xy * 0.20;
    lap += texture(u_state, vUv + t * vec2( 1.0,  0.0)).xy * 0.20;
    lap += texture(u_state, vUv + t * vec2(-1.0,  1.0)).xy * 0.05;
    lap += texture(u_state, vUv + t * vec2( 0.0,  1.0)).xy * 0.20;
    lap += texture(u_state, vUv + t * vec2( 1.0,  1.0)).xy * 0.05;

    float a = c.x;
    float b = c.y;
    float reaction = a * b * b;

    const float dA = 1.0;
    const float dB = 0.5;

    float na = a + (dA * lap.x - reaction + u_feed * (1.0 - a));
    float nb = b + (dB * lap.y + reaction - (u_kill + u_feed) * b);

    outColor = vec4(clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0, 1.0);
  }
`

// ─── Display Shader — map concentration to ASCII glyph + theme ────────
const DISPLAY_SHADER = `#version 300 es
  precision highp float;

  uniform sampler2D u_state;
  uniform sampler2D u_font_atlas;
  uniform vec2  u_resolution;
  uniform vec2  u_grid_size;
  uniform float u_char_count;
  uniform float u_brightness;

  // Color theme uniforms
  uniform int   u_color_mode;
  uniform vec3  u_color_solid;
  uniform vec3  u_color_grad_start;
  uniform vec3  u_color_grad_end;
  uniform vec3  u_color_bg;

  out vec4 fragColor;

  vec3 getThemeColor(float v) {
    if (u_color_mode == 0) {
      return u_color_solid;
    } else if (u_color_mode == 1 || u_color_mode == 3) {
      return mix(u_color_grad_start, u_color_grad_end, clamp(v, 0.0, 1.0));
    }
    // Volcanic / multivalue
    if (v < 0.5) {
      return mix(vec3(1.0, 0.96, 0.92), vec3(1.0, 0.6, 0.15), clamp(v / 0.5, 0.0, 1.0));
    }
    return mix(vec3(1.0, 0.6, 0.15), vec3(0.5, 0.06, 0.02), clamp((v - 0.5) / 0.5, 0.0, 1.0));
  }

  void main() {
    vec2 gridCoords = floor(gl_FragCoord.xy / u_grid_size);
    vec2 localCoords = fract(gl_FragCoord.xy / u_grid_size);
    vec2 uv = (gridCoords + 0.5) * u_grid_size / u_resolution;

    // Sample chemical B, remap into a pleasing display range
    float b = texture(u_state, uv).y;
    float val = clamp((b - 0.08) * 5.5, 0.0, 1.0) * u_brightness;
    val = clamp(val, 0.0, 1.0);

    float charIdx = floor(val * u_char_count);
    charIdx = clamp(charIdx, 0.0, u_char_count - 1.0);

    vec2 fontUv = vec2((charIdx + localCoords.x) / u_char_count, localCoords.y);
    float charIntensity = texture(u_font_atlas, fontUv).r;

    vec3 col = getThemeColor(val);
    fragColor = vec4(mix(u_color_bg, col, charIntensity), 1.0);
  }
`

// Gray-Scott parameters — "coral" regime: grows to fill the field with a
// slowly-evolving labyrinth.
const FEED = 0.0545
const KILL = 0.062

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
  ]
}

interface SimState {
  texs: WebGLTexture[]
  fbos: WebGLFramebuffer[]
  w: number
  h: number
  src: number
}

/**
 * Mode 6 — Turing. A Gray-Scott reaction-diffusion simulation on its own
 * WebGL2 context: two chemicals (A, B) are integrated over ping-pong float
 * framebuffers run at ~1/3 canvas resolution, then a display pass resamples
 * chemical B onto the ASCII glyph grid and tints it with the active theme.
 * Animation speed drives the number of sim iterations per frame. Screensaver
 * state is owned by the parent container, so this component renders only the
 * canvas surface (+ optional CRT overlay).
 */
export function TuringShader({
  chars = ' .,:;+*?%S#@',
  charWidth = 8,
  charHeight = 14,
  speed = 1.0,
  brightness = 1.0,
  crt = false,
  colorMode = 2,
  colorSolid = '#ffb000',
  colorGradStart = '#ff3300',
  colorGradEnd = '#ffbb00',
  colorBg = '#000000',
  externalCanvasRef,
}: ShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const fontAtlasTextureRef = useRef<WebGLTexture | null>(null)
  const simRef = useRef<SimState | null>(null)
  const animationFrameIdRef = useRef<number | null>(null)

  // Live props are read through refs so the render loop (set up once) always
  // sees the latest values without re-initializing the WebGL context.
  const charsRef = useRef(chars)
  const charWidthRef = useRef(charWidth)
  const charHeightRef = useRef(charHeight)
  const speedRef = useRef(speed)
  const brightnessRef = useRef(brightness)
  const colorModeRef = useRef(colorMode)
  const colorSolidRef = useRef(hexToRgb(colorSolid))
  const colorGradStartRef = useRef(hexToRgb(colorGradStart))
  const colorGradEndRef = useRef(hexToRgb(colorGradEnd))
  const colorBgRef = useRef(hexToRgb(colorBg))

  useEffect(() => {
    charsRef.current = chars
    charWidthRef.current = charWidth
    charHeightRef.current = charHeight
    speedRef.current = speed
    brightnessRef.current = brightness
    colorModeRef.current = colorMode
    colorSolidRef.current = hexToRgb(colorSolid)
    colorGradStartRef.current = hexToRgb(colorGradStart)
    colorGradEndRef.current = hexToRgb(colorGradEnd)
    colorBgRef.current = hexToRgb(colorBg)
  }, [
    chars,
    charWidth,
    charHeight,
    speed,
    brightness,
    colorMode,
    colorSolid,
    colorGradStart,
    colorGradEnd,
    colorBg,
  ])

  // Pre-bake the font atlas: a horizontal strip of every ramp glyph, drawn in
  // bold white monospace on black. Uploaded as LUMINANCE / NEAREST so glyph
  // edges stay crisp. Rebuilt only when the ramp or character size changes.
  const buildFontAtlas = useCallback(
    (gl: WebGL2RenderingContext, charsList: string, w: number, h: number) => {
      if (fontAtlasTextureRef.current) {
        gl.deleteTexture(fontAtlasTextureRef.current)
      }

      const atlasCanvas = document.createElement('canvas')
      const ctx = atlasCanvas.getContext('2d')
      if (!ctx) return

      atlasCanvas.width = w * charsList.length
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
    if (gl) buildFontAtlas(gl, chars, charWidth, charHeight)
  }, [chars, charWidth, charHeight, buildFontAtlas])

  // WebGL2 initialization + render loop (set up once).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    if (!gl) {
      console.error('WebGL2 not supported')
      return
    }
    glRef.current = gl

    // Float render targets are required for stable reaction-diffusion.
    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.error('EXT_color_buffer_float not supported')
      return
    }

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

    const createProgram = (vsSource: string, fsSource: string) => {
      const vs = createShader(gl.VERTEX_SHADER, vsSource)
      const fs = createShader(gl.FRAGMENT_SHADER, fsSource)
      if (!vs || !fs) return null
      const program = gl.createProgram()
      if (!program) return null
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program))
        return null
      }
      return program
    }

    const simProgram = createProgram(VERTEX_SHADER, SIM_SHADER)
    const displayProgram = createProgram(VERTEX_SHADER, DISPLAY_SHADER)
    if (!simProgram || !displayProgram) return

    // Full-screen quad (position attribute is locked to location 0).
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    buildFontAtlas(
      gl,
      charsRef.current,
      charWidthRef.current,
      charHeightRef.current,
    )

    // Seed the initial chemical field: A = 1 everywhere, with scattered
    // circular blobs of B that nucleate the pattern.
    const makeSeed = (w: number, h: number) => {
      const data = new Float32Array(w * h * 4)
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = 1.0 // A
        data[i * 4 + 3] = 1.0
      }
      const spots = Math.max(24, Math.floor((w * h) / 1400))
      for (let s = 0; s < spots; s++) {
        const cx = Math.floor(Math.random() * w)
        const cy = Math.floor(Math.random() * h)
        const rad = 2 + Math.floor(Math.random() * 5)
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dy * dy > rad * rad) continue
            const x = (((cx + dx) % w) + w) % w
            const y = (((cy + dy) % h) + h) % h
            const idx = (y * w + x) * 4
            data[idx] = 0.0 // A
            data[idx + 1] = 1.0 // B
          }
        }
      }
      return data
    }

    // (Re)allocate the ping-pong simulation textures at the given size.
    const initSim = (w: number, h: number) => {
      const old = simRef.current
      if (old) {
        old.texs.forEach((t) => gl.deleteTexture(t))
        old.fbos.forEach((f) => gl.deleteFramebuffer(f))
      }
      const seed = makeSeed(w, h)
      const texs: WebGLTexture[] = []
      const fbos: WebGLFramebuffer[] = []
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          w,
          h,
          0,
          gl.RGBA,
          gl.FLOAT,
          i === 0 ? seed : null,
        )
        // NEAREST avoids depending on OES_texture_float_linear (32F textures
        // are not linearly filterable by default in WebGL2).
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        const fbo = gl.createFramebuffer()!
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          tex,
          0,
        )
        texs.push(tex)
        fbos.push(fbo)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      simRef.current = { texs, fbos, w, h, src: 0 }
    }

    const resizeObserver = new ResizeObserver(() => {
      const parent = canvas.parentElement
      if (parent) {
        canvas.width = parent.clientWidth
        canvas.height = parent.clientHeight || 500
        gl.viewport(0, 0, canvas.width, canvas.height)
        // Run the simulation at ~1/3 canvas resolution for performance;
        // the display pass upsamples it smoothly.
        const simW = Math.max(64, Math.floor(canvas.width / 3))
        const simH = Math.max(64, Math.floor(canvas.height / 3))
        initSim(simW, simH)
      }
    })
    resizeObserver.observe(canvas.parentElement || canvas)

    const render = () => {
      const sim = simRef.current
      if (!sim) {
        animationFrameIdRef.current = requestAnimationFrame(render)
        return
      }

      // ── Simulation passes (ping-pong) ──────────────────────────────
      gl.useProgram(simProgram)
      gl.viewport(0, 0, sim.w, sim.h)
      gl.uniform2f(gl.getUniformLocation(simProgram, 'u_res'), sim.w, sim.h)
      gl.uniform1f(gl.getUniformLocation(simProgram, 'u_feed'), FEED)
      gl.uniform1f(gl.getUniformLocation(simProgram, 'u_kill'), KILL)
      gl.uniform1i(gl.getUniformLocation(simProgram, 'u_state'), 0)

      const iters = Math.max(1, Math.min(40, Math.round(14 * speedRef.current)))
      for (let i = 0; i < iters; i++) {
        const dst = 1 - sim.src
        gl.bindFramebuffer(gl.FRAMEBUFFER, sim.fbos[dst])
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sim.texs[sim.src])
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        sim.src = dst
      }

      // ── Display pass ───────────────────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(displayProgram)

      gl.uniform2f(
        gl.getUniformLocation(displayProgram, 'u_resolution'),
        canvas.width,
        canvas.height,
      )
      gl.uniform2f(
        gl.getUniformLocation(displayProgram, 'u_grid_size'),
        charWidthRef.current,
        charHeightRef.current,
      )
      gl.uniform1f(
        gl.getUniformLocation(displayProgram, 'u_char_count'),
        charsRef.current.length,
      )
      gl.uniform1f(
        gl.getUniformLocation(displayProgram, 'u_brightness'),
        brightnessRef.current,
      )
      gl.uniform1i(
        gl.getUniformLocation(displayProgram, 'u_color_mode'),
        colorModeRef.current,
      )
      gl.uniform3fv(
        gl.getUniformLocation(displayProgram, 'u_color_solid'),
        colorSolidRef.current,
      )
      gl.uniform3fv(
        gl.getUniformLocation(displayProgram, 'u_color_grad_start'),
        colorGradStartRef.current,
      )
      gl.uniform3fv(
        gl.getUniformLocation(displayProgram, 'u_color_grad_end'),
        colorGradEndRef.current,
      )
      gl.uniform3fv(
        gl.getUniformLocation(displayProgram, 'u_color_bg'),
        colorBgRef.current,
      )

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sim.texs[sim.src])
      gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_state'), 0)

      if (fontAtlasTextureRef.current) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, fontAtlasTextureRef.current)
        gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_font_atlas'), 1)
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6)
      animationFrameIdRef.current = requestAnimationFrame(render)
    }

    animationFrameIdRef.current = requestAnimationFrame(render)

    return () => {
      resizeObserver.disconnect()
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current)
      }
      const sim = simRef.current
      if (sim) {
        sim.texs.forEach((t) => gl.deleteTexture(t))
        sim.fbos.forEach((f) => gl.deleteFramebuffer(f))
        simRef.current = null
      }
      if (fontAtlasTextureRef.current) {
        gl.deleteTexture(fontAtlasTextureRef.current)
        fontAtlasTextureRef.current = null
      }
      gl.deleteProgram(simProgram)
      gl.deleteProgram(displayProgram)
      gl.deleteBuffer(buffer)
    }
  }, [buildFontAtlas])

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={(el) => {
          canvasRef.current = el
          if (externalCanvasRef) externalCanvasRef.current = el
        }}
        className="block h-full w-full"
        style={{ backgroundColor: colorBg }}
      />
      {crt && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent 3px)',
            mixBlendMode: 'multiply',
          }}
        />
      )}
    </div>
  )
}
