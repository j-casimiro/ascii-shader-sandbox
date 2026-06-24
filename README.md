# ASCII Shader Sandbox

A real-time, GPU-accelerated ASCII-art generator. Procedural and simulated
visuals are rendered with WebGL, then resampled onto a grid of monospace glyphs
so the output always reads as terminal-style text art.

## Run / build

```bash
npm install
npm run dev      # start the Vite dev server
npm run build    # typecheck + production build to dist/
npm run preview  # preview the production build
npm run lint     # eslint
```

## Render pipeline

Every effect funnels into one identical back end. A fragment shader computes a
single scalar **intensity** `val ∈ [0,1]` **once per character cell**, evaluated
at the cell center (not per pixel, not area-averaged). `val` is scaled by
brightness and **quantized** to a glyph index
(`floor(val * charCount)`), which selects a glyph from a pre-baked font-atlas
texture; the glyph's own bitmap is sampled at the sub-cell position for
per-pixel detail. The lit glyph is tinted by the active color theme and
composited over the theme background. Tonal resolution is intentionally capped
by ramp length — the grid + ramp quantizations are the quality envelope (no area
averaging or error-diffusion dithering).

## Architecture

```
src/
├── components/
│   ├── ascii-shader.tsx       container: owns live config, screensaver, routing
│   ├── shader-canvas.tsx      host for shared WebGL1 effects (modes 0–4)
│   ├── blackhole-shader.tsx   mode 5 — own WebGL1 context
│   ├── turing-shader.tsx      mode 6 — own WebGL2 context
│   ├── control-panel.tsx      right-hand sidebar of live controls + exports
│   ├── controls/              small reusable control primitives
│   └── ui/                    shadcn/ui primitives over Radix
├── config/                    themes, glyph ramps, shader-mode definitions
├── hooks/                     useTheme (light/dark, persisted)
├── lib/                       cn() helper
└── types/                     shared type contract (ShaderConfig, ShaderProps, …)
```

Three rendering contexts, one output: modes 0–4 share one WebGL1 context and
fragment shader (switched on a `u_mode` integer uniform); modes 5 and 6 own
their own contexts in dedicated components. The container is the single source
of truth for live config and screensaver state.

> **Status:** architecture, controls, and canvas hosts are in place. The GLSL
> effect pipeline (font atlas, per-cell intensity, glyph compositing) and the
> text/HTML export snapshots are authored next; canvas surfaces currently show a
> placeholder.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 (`@tailwindcss/vite`) ·
shadcn/ui over Radix · lucide-react · hand-written GLSL only.
