import { useCallback, useEffect, useRef } from 'react';

import type { ShaderProps } from '@/types/shader';

// ─── Vertex Shader (GLSL ES 1.00) ─────────────────────────────────────
const VERTEX_SHADER = `
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

// ─── Fragment Shader — Gargantua gravitational lensing ────────────────
// A Schwarzschild null-geodesic raymarcher: photons are integrated backward
// from the camera, bent toward the singularity, and sampled against an
// infinitely-thin Keplerian accretion disk (with Doppler beaming + turbulent
// gas). The resulting glow is quantized onto the ASCII glyph grid and tinted by
// the active theme, exactly like the shared back end.
const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2  u_resolution;
  uniform float u_time;
  uniform vec2  u_grid_size;
  uniform float u_speed;
  uniform float u_brightness;

  // Color theme uniforms
  uniform int   u_color_mode;
  uniform vec3  u_color_solid;
  uniform vec3  u_color_grad_start;
  uniform vec3  u_color_grad_end;
  uniform vec3  u_color_bg;

  // Font atlas
  uniform sampler2D u_font_atlas;
  uniform float     u_char_count;
  uniform int       u_is_data_pass;

  varying vec2 vUv;

  // ── Noise helpers ──────────────────────────────────────────────
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.0 + vec2(100.0);
      a *= 0.5;
    }
    return v;
  }

  // Helper for color temperature grading
  vec3 getTemperatureColor(float r_eff) {
    vec3 tempColor;
    if (u_color_mode == 0) {
      tempColor = u_color_solid;
    } else if (u_color_mode == 1 || u_color_mode == 3) {
      float factor = clamp((r_eff - 2.6) / 6.4, 0.0, 1.0);
      tempColor = mix(u_color_grad_start, u_color_grad_end, factor);
    } else {
      // mode 2: 3-stop heat ramp; inner ring (r=2.6) is hottest → gradEnd,
      // outer edge (r=9.0) is coolest → gradStart.
      float t = 1.0 - clamp((r_eff - 2.6) / 6.4, 0.0, 1.0);
      if (t < 0.5) {
        tempColor = mix(u_color_grad_start, u_color_solid, t / 0.5);
      } else {
        tempColor = mix(u_color_solid, u_color_grad_end, (t - 0.5) / 0.5);
      }
    }
    return tempColor;
  }

  // Ray-Sphere intersection helper
  vec2 intersectSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  void main() {
    // 1. Grid setup for ASCII lookup
    vec2 gridCoords = floor(gl_FragCoord.xy / u_grid_size);
    vec2 localCoords = fract(gl_FragCoord.xy / u_grid_size);
    vec2 uv = (gridCoords + 0.5) * u_grid_size / u_resolution;

    // Aspect-corrected coordinates centered at (0,0)
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = uv - 0.5;
    p.x *= aspect;

    // 2. Camera Setup
    // Nearly edge-on position — small inclination gives the flat Gargantua silhouette
    vec3 ro = vec3(0.0, 1.15, -15.0);
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 ww = normalize(target - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = normalize(cross(uu, ww));
    // Standard FOV — camera is far enough back to see full disk
    vec3 rd = normalize(p.x * uu + p.y * vv + 1.5 * ww);

    // 3. Geodesic integration parameters
    float Rs = 1.0;        // Schwarzschild radius (event horizon)
    float r_in = 2.2;      // Inner radius of the accretion disk
    float r_out = 8.5;     // Outer radius of the accretion disk

    vec3 color = vec3(0.0);
    float alpha = 0.0;
    bool hitHorizon = false;

    // ── Photon geodesic state ──────────────────────────────────────
    // Integrate the Schwarzschild null geodesic so light bends strongly
    // near the hole, wrapping the far side of the disk up and over the
    // shadow (the defining Gargantua lensing halo).
    vec3 pos = ro;
    vec3 vel = rd;
    // Conserved angular momentum (per unit) squared — drives the bending term
    vec3 angMom = cross(pos, vel);
    float h2 = dot(angMom, angMom);

    // Dither start position slightly to break up banding
    float dither = hash(gridCoords);
    pos += vel * dither * 0.18;

    vec3 dir = vel;

    const int steps = 220;
    const float dt = 0.16;

    for (int i = 0; i < steps; i++) {
      float r2 = dot(pos, pos);
      float r = sqrt(r2);

      // Event horizon capture
      if (r < Rs * 1.02) {
        hitHorizon = true;
        break;
      }
      // Escaped to infinity — stop tracing
      if (r > 22.0 && dot(pos, vel) > 0.0) break;

      // Advance the geodesic (leapfrog-ish): step position, then bend velocity.
      vec3 prevPos = pos;
      pos += vel * dt;
      // Schwarzschild photon deflection toward the singularity
      vec3 accel = -1.5 * h2 * pos / pow(dot(pos, pos), 2.5);
      vel += accel * dt;

      // ── Disk-plane crossing test ─────────────────────────────────
      // Detect where the ray crosses the equatorial plane (y = 0) and
      // sample the infinitely-thin disk exactly there. A single ray may
      // cross multiple times — front face, then the lensed far face.
      if (prevPos.y * pos.y < 0.0) {
        float frac = prevPos.y / (prevPos.y - pos.y);
        vec3 hit = mix(prevPos, pos, frac);
        float d_xz = length(hit.xz);

        if (d_xz >= r_in && d_xz <= r_out) {
          dir = normalize(vel);

          // Keplerian rotation
          float speed = u_time * u_speed * 1.5 / (sqrt(d_xz) + 0.1);
          float cosA = cos(speed);
          float sinA = sin(speed);
          vec2 pr = vec2(hit.x * cosA - hit.z * sinA, hit.x * sinA + hit.z * cosA);

          // Turbulent gas
          float swirl = fbm(pr * 1.4 + vec2(0.0, d_xz * 0.8));
          float fine = fbm(pr * 4.0);

          // Smooth radial brightness falloff (hot inner, dim outer)
          float radial = exp(-0.42 * (d_xz - r_in));
          // Soft inner & outer edge fade
          float edge = smoothstep(r_in, r_in + 0.6, d_xz) * (1.0 - smoothstep(r_out - 2.0, r_out, d_xz));

          float local_val = (0.35 + 0.95 * swirl) * (0.6 + 0.4 * fine) * (0.3 + 1.7 * radial) * edge;

          // Doppler beaming — orbital direction at the hit point
          vec3 rot_dir = normalize(vec3(-hit.z, 0.0, hit.x));
          float doppler = 1.0 + 1.8 * dot(dir, rot_dir) * (0.45 / sqrt(d_xz));
          doppler = clamp(doppler, 0.05, 4.5);
          local_val *= doppler;

          // Temperature color
          float r_eff = 2.6 + (d_xz - r_in) * 1.1;
          vec3 stepColor = getTemperatureColor(r_eff);
          // Hot-white on the approaching side, dark red on the receding side
          stepColor = mix(stepColor, vec3(1.25, 1.18, 1.05), clamp((doppler - 1.0) * 0.5, 0.0, 1.0));
          stepColor = mix(stepColor, vec3(0.42, 0.05, 0.01), clamp((1.0 - doppler) * 0.9, 0.0, 1.0));

          // Composite this disk crossing over what's accumulated so far
          float a = clamp(local_val * 0.9, 0.0, 1.0);
          color += (1.0 - alpha) * stepColor * local_val * 1.5;
          alpha += (1.0 - alpha) * a;

          if (alpha > 0.99) { alpha = 1.0; break; }
        }
      }
    }

    // 4. Background Starfield with gravitational lensing deflection
    if (!hitHorizon) {
      vec3 starDir = normalize(vel);
      float starIntensity = step(0.9968, hash(floor(starDir.xy * 240.0))) * 0.15;
      starIntensity += step(0.9991, hash(floor(starDir.xz * 360.0 + vec2(42.0, 79.0)))) * 0.45;
      vec3 starColor = vec3(0.9, 0.93, 1.0) * starIntensity;

      // Add stars, masked by accretion disk alpha
      color += (1.0 - alpha) * starColor;
      alpha += (1.0 - alpha) * starIntensity;
    }

    // Apply brightness control
    float finalGlow = alpha * u_brightness * 1.5;
    float val = clamp(finalGlow, 0.0, 1.0);

    // ─── ASCII character lookup ─────────────────────────────
    float charIdx = floor(val * u_char_count);
    charIdx = clamp(charIdx, 0.0, u_char_count - 1.0);

    if (u_is_data_pass == 1) {
      gl_FragColor = vec4(charIdx / 255.0, color.r, color.g, color.b);
      return;
    }

    vec2 fontUv = vec2((charIdx + localCoords.x) / u_char_count, localCoords.y);
    float charIntensity = texture2D(u_font_atlas, fontUv).r;

    // Mix final color with theme background color
    gl_FragColor = vec4(mix(u_color_bg, color, charIntensity), 1.0);
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
  ];
}

/**
 * Mode 5 — Blackhole. A Gargantua-style gravitational-lensing effect on its own
 * WebGL1 context: photon null-geodesics are raymarched backward from the camera,
 * bent toward the singularity, and sampled against a Keplerian accretion disk
 * (turbulent gas + Doppler beaming + a lensed background starfield). The single
 * fragment pass quantizes the resulting glow onto the ASCII glyph grid and tints
 * it with the active theme. The context uses `preserveDrawingBuffer: true` so
 * text/PNG exports can read back the framebuffer. Screensaver state is owned by
 * the parent container, so this component renders only the canvas surface (+
 * optional CRT overlay).
 */
export function BlackholeShader({
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
  exportRef,
}: ShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const fontAtlasTextureRef = useRef<WebGLTexture | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const timeRef = useRef(0);

  // Live props are read through refs so the render loop (set up once) always
  // sees the latest values without re-initializing the WebGL context.
  const charsRef = useRef(chars);
  const charWidthRef = useRef(charWidth);
  const charHeightRef = useRef(charHeight);
  const speedRef = useRef(speed);
  const brightnessRef = useRef(brightness);
  const colorModeRef = useRef(colorMode);
  const colorSolidRef = useRef(hexToRgb(colorSolid));
  const colorGradStartRef = useRef(hexToRgb(colorGradStart));
  const colorGradEndRef = useRef(hexToRgb(colorGradEnd));
  const colorBgRef = useRef(hexToRgb(colorBg));

  useEffect(() => {
    charsRef.current = chars;
    charWidthRef.current = charWidth;
    charHeightRef.current = charHeight;
    speedRef.current = speed;
    brightnessRef.current = brightness;
    colorModeRef.current = colorMode;
    colorSolidRef.current = hexToRgb(colorSolid);
    colorGradStartRef.current = hexToRgb(colorGradStart);
    colorGradEndRef.current = hexToRgb(colorGradEnd);
    colorBgRef.current = hexToRgb(colorBg);
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
  ]);

  // Pre-bake the font atlas: a horizontal strip of every ramp glyph, drawn in
  // bold white monospace on black. Uploaded as LUMINANCE / NEAREST so glyph
  // edges stay crisp. Rebuilt only when the ramp or character size changes.
  const buildFontAtlas = useCallback(
    (gl: WebGLRenderingContext, charsList: string, w: number, h: number) => {
      if (fontAtlasTextureRef.current) {
        gl.deleteTexture(fontAtlasTextureRef.current);
      }

      const atlasCanvas = document.createElement('canvas');
      const ctx = atlasCanvas.getContext('2d');
      if (!ctx) return;

      atlasCanvas.width = w * charsList.length;
      atlasCanvas.height = h;

      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
      ctx.fillStyle = 'white';
      ctx.font = `bold ${h - 2}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < charsList.length; i++) {
        ctx.fillText(charsList[i], i * w + w / 2, h / 2);
      }

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        atlasCanvas,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      fontAtlasTextureRef.current = texture;
    },
    [],
  );

  // Rebuild the font atlas when the ramp or character size changes.
  useEffect(() => {
    const gl = glRef.current;
    if (gl) buildFontAtlas(gl, chars, charWidth, charHeight);
  }, [chars, charWidth, charHeight, buildFontAtlas]);

  useEffect(() => {
    if (exportRef) {
      exportRef.current = {
        getHtml: () => {
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
    'u_resolution', 'u_time', 'u_grid_size', 'u_speed', 'u_brightness',
    'u_color_mode', 'u_color_solid', 'u_color_grad_start', 'u_color_grad_end',
    'u_color_bg', 'u_font_atlas', 'u_char_count', 'u_is_data_pass'
  ].forEach(name => {
    uniforms[name] = gl.getUniformLocation(program, name);
  });

  const chars = ${JSON.stringify(chars)};
  const charWidth = ${charWidth};
  const charHeight = ${charHeight};

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
  const colorSolid = hexToRgb(${JSON.stringify(colorSolid)});
  const colorGradStart = hexToRgb(${JSON.stringify(colorGradStart)});
  const colorGradEnd = hexToRgb(${JSON.stringify(colorGradEnd)});
  const colorBg = hexToRgb(${JSON.stringify(colorBg)});

  let elapsed = 0;
  let prevTime = 0;
  const speed = ${speed};

  function render(ts) {
    if (prevTime === 0) prevTime = ts;
    const dt = (ts - prevTime) / 1000;
    prevTime = ts;
    elapsed += dt * speed;

    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.u_time, elapsed);
    gl.uniform2f(uniforms.u_grid_size, charWidth, charHeight);
    gl.uniform1f(uniforms.u_char_count, chars.length);
    gl.uniform1f(uniforms.u_speed, speed);
    gl.uniform1f(uniforms.u_brightness, ${brightness});
    gl.uniform1i(uniforms.u_color_mode, ${colorMode});
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
  <title>ASCII Blackhole Shader Export</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${colorBg};
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
    }
    ${crt ? `
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
  ${crt ? '<div class="crt-overlay"></div>' : ''}
  <script>
    ${setupJsCode}
  </script>
</body>
</html>`
        }
      };
    }
    return () => {
      if (exportRef) {
        exportRef.current = null;
      }
    };
  }, [crt, exportRef]);

  // WebGL1 initialization + render loop (set up once).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    glRef.current = gl;

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = createShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);
    programRef.current = program;

    // Full-screen quad.
    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    buildFontAtlas(
      gl,
      charsRef.current,
      charWidthRef.current,
      charHeightRef.current,
    );

    const resizeObserver = new ResizeObserver(() => {
      const parent = canvas.parentElement;
      if (parent) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = (parent.clientHeight || 500) * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    });
    resizeObserver.observe(canvas.parentElement || canvas);

    let lastTime = 0;

    const render = (now: number) => {
      if (lastTime === 0) {
        lastTime = now;
        animationFrameIdRef.current = requestAnimationFrame(render);
        return;
      }
      const dt = (now - lastTime) * 0.001;
      lastTime = now;
      timeRef.current += dt;

      gl.useProgram(program);

      gl.uniform2f(
        gl.getUniformLocation(program, 'u_resolution'),
        canvas.width,
        canvas.height,
      );
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), timeRef.current);
      gl.uniform2f(
        gl.getUniformLocation(program, 'u_grid_size'),
        charWidthRef.current,
        charHeightRef.current,
      );
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_char_count'),
        charsRef.current.length,
      );
      gl.uniform1f(gl.getUniformLocation(program, 'u_speed'), speedRef.current);
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_brightness'),
        brightnessRef.current,
      );

      gl.uniform1i(
        gl.getUniformLocation(program, 'u_color_mode'),
        colorModeRef.current,
      );
      gl.uniform3fv(
        gl.getUniformLocation(program, 'u_color_solid'),
        colorSolidRef.current,
      );
      gl.uniform3fv(
        gl.getUniformLocation(program, 'u_color_grad_start'),
        colorGradStartRef.current,
      );
      gl.uniform3fv(
        gl.getUniformLocation(program, 'u_color_grad_end'),
        colorGradEndRef.current,
      );
      gl.uniform3fv(
        gl.getUniformLocation(program, 'u_color_bg'),
        colorBgRef.current,
      );
      gl.uniform1i(
        gl.getUniformLocation(program, 'u_is_data_pass'),
        0,
      );

      // Bind font atlas
      if (fontAtlasTextureRef.current) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fontAtlasTextureRef.current);
        gl.uniform1i(gl.getUniformLocation(program, 'u_font_atlas'), 0);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    animationFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      glRef.current = null;
      programRef.current = null;
      if (fontAtlasTextureRef.current) {
        gl.deleteTexture(fontAtlasTextureRef.current);
        fontAtlasTextureRef.current = null;
      }
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    };
  }, [buildFontAtlas]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={(el) => {
          canvasRef.current = el;
          if (externalCanvasRef) externalCanvasRef.current = el;
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
  );
}
