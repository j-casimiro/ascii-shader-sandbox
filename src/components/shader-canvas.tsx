import { useCallback, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import type { ColorTheme, ShaderConfig } from '@/types/shader'
import { toBase64 } from '@/lib/export'

interface ShaderCanvasProps {
  config: ShaderConfig
  theme: ColorTheme
  /** Forwarded so exports can read back the framebuffer. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  exportRef?: React.RefObject<{ getHtml?: () => Promise<string> | string } | null>
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
  uniform int   u_is_data_pass;
  uniform int   u_glyph_overlay;   // mode 12: 1 = render the field as ASCII glyphs

  // Source-image uniforms (mode 3)
  uniform sampler2D u_image;
  uniform float u_image_aspect;       // image width / height
  uniform int   u_use_image_colors;   // 1 = passthrough image color, 0 = theme tint

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

  // ── Connected-Truchet primitive (mode 11) ─────────────────────────
  // Distance to the full circle of radius r centered at c. Only the segment
  // inside the unit cell is ever shaded, so a corner-centered circle reads as
  // a quarter arc and an edge-centered one as a half-bump.
  float tCircle(vec2 p, vec2 c, float r) { return abs(length(p - c) - r); }

  // ── Source image sampling (mode 3) ────────────────────────────────
  // "Cover" fit: scale the sampled region so the image fills the canvas with
  // no stretching (overflow on the long axis is cropped). Y is flipped because
  // the GL texture origin is bottom-left while images decode top-left.
  vec2 imageUv(vec2 uv) {
    float ca = u_resolution.x / u_resolution.y;
    float ia = max(u_image_aspect, 0.0001);
    vec2 c = uv - 0.5;
    if (ca > ia) {
      c.y *= ia / ca;                 // canvas wider: fit width, crop height
    } else {
      c.x *= ca / ia;                 // canvas taller: fit height, crop width
    }
    c += 0.5;
    return vec2(c.x, 1.0 - c.y);
  }

  vec3 sampleImage(vec2 uv) {
    return texture2D(u_image, imageUv(uv)).rgb;
  }

  // ── Aurora mesh-gradient (mode 12) ────────────────────────────────
  // Inigo-Quilez-style domain-warped fBm: displace the sample point by a
  // low-frequency flow field, then sample fBm at the warped position. The
  // result reads as soft, organic colour blobs that drift diagonally. The
  // secondary warp component g is returned alongside the primary field f
  // so the colouriser can place the cooler blue pools independently of the
  // dominant warm field — giving distinct crimson and blue regions rather
  // than one blended ramp.
  float auroraFields(vec2 uv, out float g) {
    vec2 p = uv;
    p.x *= u_resolution.x / u_resolution.y;     // aspect-correct so blobs stay round
    p *= u_scale;                               // low u_scale -> large soft blobs
    float t = u_time * 0.5;
    p += vec2(0.7, 0.45) * t * 0.3;             // slow diagonal drift

    vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
    vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + 0.15 * t),
                  fbm(p + 2.0 * q + vec2(8.3, 2.8) - 0.12 * t));
    g = r.x;
    return fbm(p + 2.5 * r);
  }

  // Per-pixel smooth colour for the mesh gradient. Maps the two fields across
  // the theme's four stops (bg -> gradStart -> solid, plus gradEnd pools) and
  // adds a soft white bloom and fine film grain to match the reference look.
  vec3 auroraColor(vec2 uv) {
    float g;
    float f = auroraFields(uv, g);

    vec3 col = u_color_bg;                                              // navy base
    col = mix(col, u_color_grad_start, smoothstep(0.20, 0.55, f));      // deep maroon
    col = mix(col, u_color_solid,      smoothstep(0.40, 0.82, f));      // crimson
    col = mix(col, u_color_grad_end,   smoothstep(0.55, 0.95, g) * 0.85); // blue pools

    float bloom = smoothstep(0.72, 1.0, 0.6 * f + 0.6 * g);            // bright overlap
    col = mix(col, vec3(1.0), bloom * 0.5);

    float grain = hash(gl_FragCoord.xy * 1.7 + vec2(u_time)) - 0.5;
    col += grain * 0.09;

    col *= u_brightness;
    return clamp(col, 0.0, 1.0);
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
    } else if (u_mode == 3) {
      // Mode 3 — Source Image: glyph intensity = perceptual luminance of the
      // sampled pixel, so darker regions map to sparser glyphs.
      vec3 rgb = sampleImage(uv);
      return dot(rgb, vec3(0.299, 0.587, 0.114));
    } else if (u_mode == 9) {
      // Mode 9 — PewDiePie: traveling sine-wave diagonal stripes.
      // Stripes run along (x − y); the wave travels along the perpendicular
      // axis (x + y). Amplitude × frequency > 1 so stripes fold slightly at
      // wave troughs, producing the tight-convergence bands in the reference.
      vec2 p = uv;
      p.x *= u_resolution.x / u_resolution.y;
      float t = u_time * 0.45;
      float along  = p.x + p.y;  // wave travel axis
      float across = p.x - p.y;  // stripe axis
      // Primary wave (Ak = 1.12 → slight fold) + softer second harmonic
      float wave = sin(along * 3.2 - t)        * 0.35
                 + sin(along * 1.6 + t * 0.55) * 0.15;
      float stripe = sin((across + wave) * u_scale * 4.5);
      return smoothstep(-0.25, 0.25, stripe);
    } else if (u_mode == 10) {
      // Mode 10 — Truchet: quarter-circle arcs in randomly oriented cells weave
      // an endless maze/circuit. Each cell slowly rewires on its own cycle
      // (crossfading through a momentary full ring), while a traveling shimmer
      // runs along the weave like data on wires. u_scale sets tile density.
      vec2 p = uv;
      p.x *= u_resolution.x / u_resolution.y;   // aspect-correct square tiles
      p *= u_scale;
      vec2 cell = floor(p);
      vec2 f = fract(p);

      // Distance to each of the two arc pairs = the two tile orientations.
      // Arcs are radius-0.5 quarter circles centered on opposite corners, so
      // they always pass through edge midpoints and join across tile borders.
      float dA = min(abs(length(f - vec2(0.0, 0.0)) - 0.5),
                     abs(length(f - vec2(1.0, 1.0)) - 0.5));
      float dB = min(abs(length(f - vec2(1.0, 0.0)) - 0.5),
                     abs(length(f - vec2(0.0, 1.0)) - 0.5));

      // Per-cell orientation. Each cell rewires at its OWN random rate and
      // phase (not a shared frequency), so flips scatter unpredictably across
      // the grid instead of sweeping through as one linear wave.
      vec2 rnd = hash2(cell);
      float freq   = 0.12 + rnd.x * rnd.x * 0.85;   // squared → many slow, few fast
      float orient = sin(u_time * freq + rnd.y * 6.2831);
      float blend  = smoothstep(-0.12, 0.12, orient);

      float lineA = smoothstep(0.11, 0.0, dA);
      float lineB = smoothstep(0.11, 0.0, dB);
      float line  = mix(lineA, lineB, blend);

      // Traveling shimmer along the weave, with a per-cell random phase and
      // speed so the flow doesn't read as one uniform marching gradient.
      float pulse = 0.6 + 0.4 * sin((f.x + f.y) * 3.1416
                     + rnd.x * 6.2831 - u_time * (1.2 + rnd.y * 1.6));

      return line * pulse;
    } else if (u_mode == 11) {
      // Mode 11 — Connected Truchet: a 2-port-per-edge tile set. The trick is
      // that EVERY tile, in EVERY orientation, terminates its arcs/lines at the
      // same eight fixed edge points (the 1/4 and 3/4 marks on each side). Those
      // eight points map onto themselves under a 90° turn, so a tile spun by any
      // multiple of 90° still meets its neighbours — the weave can never break.
      //
      // Tiles never translate: each cell draws one fixed random tile at a fixed
      // random load orientation, then snaps through crisp 90° rotations — it
      // detaches mid-turn and clicks back connected at each quarter-turn rest.
      vec2 p = uv;
      p.x *= u_resolution.x / u_resolution.y;     // aspect-correct square tiles
      p *= u_scale;
      vec2 cell = floor(p);
      vec2 f = fract(p);

      vec2 rnd = hash2(cell);

      // Stepped quarter-turn: hold for the first ~65% of each beat (a clean,
      // connected rest), then ease one 90° turn over the last ~35%. Per-cell
      // rate + phase so cells turn independently, never as one marching wave.
      float rate  = 0.25 + rnd.y * 0.6;
      float beat  = u_time * rate + rnd.x * 12.566;       // + random phase
      float turns = floor(beat) + smoothstep(0.65, 1.0, fract(beat));
      float init  = floor(rnd.x * 4.0);                   // random load orientation
      float ang   = (turns + init) * 1.5707963;           // radians

      // Spin the cell's local coords about its own centre by the animated angle.
      vec2 q = f - 0.5;
      float cs = cos(ang), sn = sin(ang);
      q = mat2(cs, -sn, sn, cs) * q;
      f = q + 0.5;

      // Pick one fixed tile from the 7-tile family for this cell. Each tile is
      // a perfect matching of the eight ports built from three primitives:
      // small corner arc (r=.25), large corner arc (r=.75), edge bump (r=.25),
      // and axis-aligned straight lines at the 1/4 and 3/4 marks.
      int tile = int(floor(hash(cell + 31.7) * 7.0));
      float d = 10.0;
      if (tile == 0) {
        // four small corner arcs (90°-symmetric)
        d = min(min(tCircle(f, vec2(0.0, 0.0), 0.25), tCircle(f, vec2(1.0, 0.0), 0.25)),
                min(tCircle(f, vec2(1.0, 1.0), 0.25), tCircle(f, vec2(0.0, 1.0), 0.25)));
      } else if (tile == 1) {
        // concentric double arcs on two opposite corners
        d = min(min(tCircle(f, vec2(0.0, 0.0), 0.25), tCircle(f, vec2(0.0, 0.0), 0.75)),
                min(tCircle(f, vec2(1.0, 1.0), 0.25), tCircle(f, vec2(1.0, 1.0), 0.75)));
      } else if (tile == 2) {
        // two parallel straights + two edge bumps (the classic "t2" look)
        d = min(min(abs(f.y - 0.25), abs(f.y - 0.75)),
                min(tCircle(f, vec2(0.5, 0.0), 0.25), tCircle(f, vec2(0.5, 1.0), 0.25)));
      } else if (tile == 3) {
        // woven grid: two verticals crossing two horizontals (90°-symmetric)
        d = min(min(abs(f.x - 0.25), abs(f.x - 0.75)),
                min(abs(f.y - 0.25), abs(f.y - 0.75)));
      } else if (tile == 4) {
        // one straight + a bump + two small corner arcs (asymmetric)
        d = min(min(abs(f.y - 0.25), tCircle(f, vec2(0.5, 0.0), 0.25)),
                min(tCircle(f, vec2(1.0, 1.0), 0.25), tCircle(f, vec2(0.0, 1.0), 0.25)));
      } else if (tile == 5) {
        // small arc + large sweeping arc + a vertical + a horizontal (busy weave)
        d = min(min(tCircle(f, vec2(0.0, 0.0), 0.25), tCircle(f, vec2(1.0, 1.0), 0.75)),
                min(abs(f.x - 0.75), abs(f.y - 0.75)));
      } else {
        // four edge bumps — pairs with neighbours' bumps into full rings
        d = min(min(tCircle(f, vec2(0.5, 0.0), 0.25), tCircle(f, vec2(1.0, 0.5), 0.25)),
                min(tCircle(f, vec2(0.5, 1.0), 0.25), tCircle(f, vec2(0.0, 0.5), 0.25)));
      }

      // Bold solid core + soft outer glow so thin ramps still read as a line.
      float line = smoothstep(0.085, 0.03, d) + 0.35 * smoothstep(0.2, 0.085, d);
      return clamp(line, 0.0, 1.0);
    } else if (u_mode == 12) {
      // Mode 12 — Aurora Haze (ASCII overlay path): the smooth mesh field
      // sampled at the cell centre and mapped to glyph intensity. The smooth
      // per-pixel colour path is handled directly in main().
      float g;
      return auroraFields(uv, g);
    }
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
    // Mode 12 (Aurora Haze) smooth path: bypass the glyph atlas entirely and
    // emit a per-pixel soft mesh gradient. The ASCII-overlay toggle
    // (u_glyph_overlay == 1) falls through to the normal glyph pipeline below.
    if (u_mode == 12 && u_glyph_overlay == 0 && u_is_data_pass == 0) {
      vec2 puv = gl_FragCoord.xy / u_resolution;   // true per-pixel, not cell-snapped
      gl_FragColor = vec4(auroraColor(puv), 1.0);
      return;
    }

    vec2 gridCoords  = floor(gl_FragCoord.xy / u_grid_size);   // which cell
    vec2 localCoords = fract(gl_FragCoord.xy / u_grid_size);   // where in the cell
    vec2 uv = (gridCoords + 0.5) * u_grid_size / u_resolution; // cell CENTER

    float val = computeIntensity(uv);
    val *= u_brightness;
    val = clamp(val, 0.0, 1.0);

    float charIdx = clamp(floor(val * u_char_count), 0.0, u_char_count - 1.0);
    
    vec3 color = getColor(val, uv);
    if (u_mode == 3 && u_use_image_colors == 1) {
      color = sampleImage(uv);                 // passthrough the image's own color
    }

    if (u_is_data_pass == 1) {
      gl_FragColor = vec4(charIdx / 255.0, color.r, color.g, color.b);
      return;
    }

    vec2  fontUv  = vec2((charIdx + localCoords.x) / u_char_count, localCoords.y);
    float charIntensity = texture2D(u_font_atlas, fontUv).r;

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
export function ShaderCanvas({ config, theme, canvasRef, exportRef }: ShaderCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const fontAtlasTextureRef = useRef<WebGLTexture | null>(null)
  const imageTextureRef = useRef<WebGLTexture | null>(null)
  const imageAspectRef = useRef(1)

  // Whether the source image overrides the selected algorithm (renders mode 3).
  const imageActive = config.imageEnabled && !!config.imageSrc

  // Live values read through refs so the render loop is set up only once.
  const charsRef = useRef(config.chars)
  const charWidthRef = useRef(config.charWidth)
  const charHeightRef = useRef(config.charHeight)
  const scaleRef = useRef(config.scale)
  const speedRef = useRef(config.speed)
  const brightnessRef = useRef(config.brightness)
  const modeRef = useRef(config.mode)
  const auroraRealGraphicsRef = useRef(config.auroraRealGraphics)
  const imageActiveRef = useRef(imageActive)
  const imageUseColorsRef = useRef(config.imageUseColors)
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
    auroraRealGraphicsRef.current = config.auroraRealGraphics
    imageActiveRef.current = imageActive
    imageUseColorsRef.current = config.imageUseColors
    colorModeRef.current = theme.mode
    colorSolidRef.current = hexToRgb(theme.accent)
    colorGradStartRef.current = hexToRgb(theme.gradStart)
    colorGradEndRef.current = hexToRgb(theme.gradEnd)
    colorBgRef.current = hexToRgb(theme.bg)
  }, [config, theme, imageActive])

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

  // Load the source image into a GPU texture whenever the upload changes.
  // LINEAR filtering keeps the down-sampled image smooth across cells.
  useEffect(() => {
    const src = config.imageSrc
    if (!src) {
      const gl = glRef.current
      if (gl && imageTextureRef.current) {
        gl.deleteTexture(imageTextureRef.current)
        imageTextureRef.current = null
      }
      return
    }

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const gl = glRef.current
      if (cancelled || !gl) return
      if (imageTextureRef.current) gl.deleteTexture(imageTextureRef.current)

      const texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

      imageTextureRef.current = texture
      imageAspectRef.current = img.height > 0 ? img.width / img.height : 1
    }
    img.src = src

    return () => {
      cancelled = true
    }
  }, [config.imageSrc])

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
    programRef.current = program

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
      'u_image',
      'u_image_aspect',
      'u_use_image_colors',
      'u_is_data_pass',
      'u_glyph_overlay',
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
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, container.clientWidth)
      const h = Math.max(1, container.clientHeight)
      canvas.width = w * dpr
      canvas.height = h * dpr
      gl.viewport(0, 0, w * dpr, h * dpr)
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
      // Render mode 3 (source image) only once the texture has finished
      // loading; until then fall back to the selected algorithm.
      const renderMode =
        imageActiveRef.current && imageTextureRef.current ? 3 : modeRef.current
      gl.uniform1i(u.u_mode, renderMode)
      gl.uniform1f(u.u_image_aspect, imageAspectRef.current)
      gl.uniform1i(u.u_use_image_colors, imageUseColorsRef.current ? 1 : 0)
      // Real Graphics ON => smooth (overlay off); default OFF => ASCII glyphs.
      gl.uniform1i(u.u_glyph_overlay, auroraRealGraphicsRef.current ? 0 : 1)
      gl.uniform1i(u.u_color_mode, colorModeRef.current)
      gl.uniform3fv(u.u_color_solid, colorSolidRef.current)
      gl.uniform3fv(u.u_color_grad_start, colorGradStartRef.current)
      gl.uniform3fv(u.u_color_grad_end, colorGradEndRef.current)
      gl.uniform3fv(u.u_color_bg, colorBgRef.current)
      gl.uniform1i(u.u_is_data_pass, 0)

      if (fontAtlasTextureRef.current) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, fontAtlasTextureRef.current)
        gl.uniform1i(u.u_font_atlas, 0)
      }

      if (imageTextureRef.current) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, imageTextureRef.current)
        gl.uniform1i(u.u_image, 1)
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
      if (imageTextureRef.current) {
        gl.deleteTexture(imageTextureRef.current)
        imageTextureRef.current = null
      }
      gl.deleteProgram(program)
      gl.deleteBuffer(buffer)
      glRef.current = null
      programRef.current = null
    }
  }, [canvasRef, buildFontAtlas])

  useEffect(() => {
    if (exportRef) {
      exportRef.current = {
        getHtml: async () => {
          let inlinedImageSrc = ''
          if (config.imageEnabled && config.imageSrc) {
            inlinedImageSrc = await toBase64(config.imageSrc)
          }

          const setupJsCode = `
(function() {
  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl');
  if (!gl) {
    console.error('WebGL not supported');
    return;
  }

  const vsSource = \`${VERTEX_SHADER.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
  const fsSource = \`${FRAGMENT_SHADER.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  const vs = createShader(gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);

  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {};
  [
    'u_font_atlas', 'u_resolution', 'u_grid_size', 'u_char_count', 'u_brightness',
    'u_time', 'u_scale', 'u_mode', 'u_color_mode', 'u_color_solid',
    'u_color_grad_start', 'u_color_grad_end', 'u_color_bg', 'u_image',
    'u_image_aspect', 'u_use_image_colors', 'u_is_data_pass', 'u_glyph_overlay'
  ].forEach(name => {
    uniforms[name] = gl.getUniformLocation(program, name);
  });

  const chars = ${JSON.stringify(config.chars)};
  const charWidth = ${config.charWidth};
  const charHeight = ${config.charHeight};

  function buildFontAtlas(charsList, w, h) {
    const atlasCanvas = document.createElement('canvas');
    const ctx = atlasCanvas.getContext('2d');
    atlasCanvas.width = Math.max(1, w * charsList.length);
    atlasCanvas.height = h;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    ctx.fillStyle = 'white';
    ctx.font = 'bold ' + (h - 2) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < charsList.length; i++) {
      ctx.fillText(charsList[i], i * w + w / 2, h / 2);
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }
  const fontAtlasTexture = buildFontAtlas(chars, charWidth, charHeight);

  let imageTexture = null;
  let imageAspect = 1.0;
  const imageSrc = ${JSON.stringify(inlinedImageSrc)};
  const imageActive = ${config.imageEnabled && !!config.imageSrc};

  if (imageActive && imageSrc) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      imageAspect = img.width / img.height;
    };
    img.src = imageSrc;
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.substring(0, 2), 16) / 255,
      parseInt(clean.substring(2, 4), 16) / 255,
      parseInt(clean.substring(4, 6), 16) / 255
    ];
  }
  const colorSolid = hexToRgb(${JSON.stringify(theme.accent)});
  const colorGradStart = hexToRgb(${JSON.stringify(theme.gradStart)});
  const colorGradEnd = hexToRgb(${JSON.stringify(theme.gradEnd)});
  const colorBg = hexToRgb(${JSON.stringify(theme.bg)});

  let elapsed = 0;
  let prevTime = 0;
  const speed = ${config.speed};

  function render(ts) {
    if (prevTime === 0) prevTime = ts;
    const dt = (ts - prevTime) / 1000;
    prevTime = ts;
    elapsed += dt * speed;

    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.u_grid_size, charWidth, charHeight);
    gl.uniform1f(uniforms.u_char_count, chars.length);
    gl.uniform1f(uniforms.u_brightness, ${config.brightness});
    gl.uniform1f(uniforms.u_time, elapsed);
    gl.uniform1f(uniforms.u_scale, ${config.scale});
    gl.uniform1i(uniforms.u_mode, imageActive && imageTexture ? 3 : ${config.mode});
    gl.uniform1f(uniforms.u_image_aspect, imageAspect);
    gl.uniform1i(uniforms.u_use_image_colors, ${config.imageUseColors ? 1 : 0});
    gl.uniform1i(uniforms.u_glyph_overlay, ${config.auroraRealGraphics ? 0 : 1});
    gl.uniform1i(uniforms.u_color_mode, ${theme.mode});
    gl.uniform3fv(uniforms.u_color_solid, colorSolid);
    gl.uniform3fv(uniforms.u_color_grad_start, colorGradStart);
    gl.uniform3fv(uniforms.u_color_grad_end, colorGradEnd);
    gl.uniform3fv(uniforms.u_color_bg, colorBg);
    gl.uniform1i(uniforms.u_is_data_pass, 0);

    if (fontAtlasTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fontAtlasTexture);
      gl.uniform1i(uniforms.u_font_atlas, 0);
    }
    if (imageTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      gl.uniform1i(uniforms.u_image, 1);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
`

          return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ASCII Shader Sandbox Export</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${theme.bg};
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
    }
    ${config.crt ? `
    .crt-overlay {
      pointer-events: none;
      position: absolute;
      inset: 0;
      background-image: repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent 3px);
      mix-blend-mode: multiply;
      z-index: 999;
    }
    ` : ''}
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  ${config.crt ? '<div class="crt-overlay"></div>' : ''}
  <script>
    ${setupJsCode}
  </script>
</body>
</html>`
        }
      }
    }
    return () => {
      if (exportRef) {
        exportRef.current = null
      }
    }
  }, [config, theme, canvasRef, exportRef])

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
