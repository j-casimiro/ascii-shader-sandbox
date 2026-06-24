import { useEffect, useRef } from 'react';

import type { ShaderProps } from '@/types/shader';

interface LifeGrid {
  cells: Uint8Array;
  next: Uint8Array;
  cols: number;
  rows: number;
  generation: number;
}

const DEFAULT_LIFE_GLYPHS = ' .,:;ox%#@';
const BLOCK_GLYPHS = new Set(['█', '▓', '▒', '░', '▄', '▀', '▌', '▐']);

const GLIDER = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

const LIGHTWEIGHT_SPACESHIP = [
  [1, 0],
  [4, 0],
  [0, 1],
  [0, 2],
  [4, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
];

const PENTOMINO = [
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [1, 2],
];

const PULSAR = [
  [2, 0],
  [3, 0],
  [4, 0],
  [8, 0],
  [9, 0],
  [10, 0],
  [0, 2],
  [5, 2],
  [7, 2],
  [12, 2],
  [0, 3],
  [5, 3],
  [7, 3],
  [12, 3],
  [0, 4],
  [5, 4],
  [7, 4],
  [12, 4],
  [2, 5],
  [3, 5],
  [4, 5],
  [8, 5],
  [9, 5],
  [10, 5],
  [2, 7],
  [3, 7],
  [4, 7],
  [8, 7],
  [9, 7],
  [10, 7],
  [0, 8],
  [5, 8],
  [7, 8],
  [12, 8],
  [0, 9],
  [5, 9],
  [7, 9],
  [12, 9],
  [0, 10],
  [5, 10],
  [7, 10],
  [12, 10],
  [2, 12],
  [3, 12],
  [4, 12],
  [8, 12],
  [9, 12],
  [10, 12],
];

const SEEDS = [GLIDER, LIGHTWEIGHT_SPACESHIP, PENTOMINO, PULSAR];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const p = clamp01(t);
  return [
    Math.round(a[0] + (b[0] - a[0]) * p),
    Math.round(a[1] + (b[1] - a[1]) * p),
    Math.round(a[2] + (b[2] - a[2]) * p),
  ];
}

function toRgba(rgb: [number, number, number], alpha: number) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp01(alpha)})`;
}

function wrap(value: number, limit: number) {
  return (value + limit) % limit;
}

function indexOf(x: number, y: number, cols: number, rows: number) {
  return wrap(y, rows) * cols + wrap(x, cols);
}

function normalizeGlyphs(chars: string) {
  const glyphs = Array.from(chars)
    .filter((char) => char.trim().length > 0 && !BLOCK_GLYPHS.has(char))
    .join('');

  return glyphs.length >= 3 ? glyphs : DEFAULT_LIFE_GLYPHS;
}

function stampPattern(
  cells: Uint8Array,
  cols: number,
  rows: number,
  pattern: number[][],
  originX: number,
  originY: number,
) {
  for (const [x, y] of pattern) {
    cells[indexOf(originX + x, originY + y, cols, rows)] = 1;
  }
}

function seedColony(cells: Uint8Array, cols: number, rows: number) {
  const pattern = SEEDS[Math.floor(Math.random() * SEEDS.length)];
  stampPattern(
    cells,
    cols,
    rows,
    pattern,
    Math.floor(Math.random() * cols),
    Math.floor(Math.random() * rows),
  );
}

function makeGrid(cols: number, rows: number): LifeGrid {
  const size = cols * rows;
  const cells = new Uint8Array(size);
  const next = new Uint8Array(size);
  const seedCount = Math.max(8, Math.floor(size / 1100));

  for (let i = 0; i < seedCount; i++) {
    seedColony(cells, cols, rows);
  }

  return {
    cells,
    next,
    cols,
    rows,
    generation: 0,
  };
}

function countNeighbors(
  cells: Uint8Array,
  x: number,
  y: number,
  cols: number,
  rows: number,
) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (cells[indexOf(x + dx, y + dy, cols, rows)] > 0) count++;
    }
  }
  return count;
}

function stepGrid(grid: LifeGrid) {
  const { cells, next, cols, rows } = grid;
  let liveCount = 0;
  let changedCount = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const alive = cells[idx] > 0;
      const neighbors = countNeighbors(cells, x, y, cols, rows);
      const survives = alive && (neighbors === 2 || neighbors === 3);
      const born = !alive && neighbors === 3;
      const out = survives || born ? Math.min(9, cells[idx] + 1 || 1) : 0;

      next[idx] = out;
      if (out > 0) liveCount++;
      if ((out > 0) !== alive) changedCount++;
    }
  }

  const size = cols * rows;
  if (
    liveCount < Math.max(16, size * 0.015) ||
    changedCount < Math.max(4, size * 0.0015) ||
    grid.generation % 180 === 0
  ) {
    seedColony(next, cols, rows);
  }

  grid.cells = next;
  grid.next = cells;
  grid.generation += 1;
}

function getLifeColor(
  age: number,
  rowRatio: number,
  colorMode: number,
  solid: [number, number, number],
  gradStart: [number, number, number],
  gradEnd: [number, number, number],
) {
  const intensity = clamp01(age / 9);
  if (colorMode === 1) {
    return mixColor(gradStart, gradEnd, rowRatio);
  }
  if (colorMode === 2) {
    return intensity < 0.5
      ? mixColor(gradStart, solid, intensity * 2)
      : mixColor(solid, gradEnd, (intensity - 0.5) * 2);
  }
  if (colorMode === 3) {
    return mixColor([0, 30, 16], solid, 0.28 + intensity * 0.72);
  }
  return solid;
}

function topologyGlyph(cells: Uint8Array, x: number, y: number, grid: LifeGrid) {
  const { cols, rows } = grid;
  const n = cells[indexOf(x, y - 1, cols, rows)] > 0;
  const s = cells[indexOf(x, y + 1, cols, rows)] > 0;
  const w = cells[indexOf(x - 1, y, cols, rows)] > 0;
  const e = cells[indexOf(x + 1, y, cols, rows)] > 0;
  const count = Number(n) + Number(s) + Number(w) + Number(e);

  if (count >= 3) return '+';
  if (n && s) return '|';
  if (w && e) return '-';
  if ((n && e) || (s && w)) return '/';
  if ((n && w) || (s && e)) return '\\';
  if (count === 1) return 'o';
  return '.';
}

/**
 * Mode 8 - Cellular Automata. A sparse Conway Life renderer with seeded
 * colonies and topology-aware ASCII marks instead of per-cell heatmap blocks.
 */
export function CellularAutomataShader({
  chars = DEFAULT_LIFE_GLYPHS,
  charWidth = 8,
  charHeight = 14,
  speed = 1.0,
  brightness = 1.0,
  crt = false,
  colorMode = 2,
  colorSolid = '#38bdf8',
  colorGradStart = '#22c55e',
  colorGradEnd = '#f8fafc',
  colorBg = '#000000',
  externalCanvasRef,
}: ShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const gridRef = useRef<LifeGrid | null>(null);
  const stepAccumulatorRef = useRef(0);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(1, parent?.clientWidth ?? 1);
      const height = Math.max(1, parent?.clientHeight ?? 500);
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.max(1, Math.ceil(width / charWidthRef.current));
      const rows = Math.max(1, Math.ceil(height / charHeightRef.current));
      gridRef.current = makeGrid(cols, rows);
      stepAccumulatorRef.current = 0;
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement || canvas);

    let previousTime = 0;

    const render = (now: number) => {
      if (previousTime === 0) previousTime = now;
      const dt = Math.min(0.05, (now - previousTime) / 1000);
      previousTime = now;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const cellW = charWidthRef.current;
      const cellH = charHeightRef.current;
      const expectedCols = Math.max(1, Math.ceil(width / cellW));
      const expectedRows = Math.max(1, Math.ceil(height / cellH));

      if (
        !gridRef.current ||
        gridRef.current.cols !== expectedCols ||
        gridRef.current.rows !== expectedRows
      ) {
        gridRef.current = makeGrid(expectedCols, expectedRows);
        stepAccumulatorRef.current = 0;
      }

      const grid = gridRef.current;
      const speedFactor = Math.max(0, speedRef.current);
      stepAccumulatorRef.current += dt * speedFactor * 8;

      let steps = 0;
      while (stepAccumulatorRef.current >= 1 && steps < 4) {
        stepGrid(grid);
        stepAccumulatorRef.current -= 1;
        steps++;
      }
      if (steps === 4) stepAccumulatorRef.current = 0;

      const glyphs = normalizeGlyphs(charsRef.current);
      const bg = colorBgRef.current;
      const brightnessGain = brightnessRef.current;

      ctx.fillStyle = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `bold ${Math.max(6, cellH - 2)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let y = 0; y < grid.rows; y++) {
        const rowRatio = grid.rows <= 1 ? 0 : y / (grid.rows - 1);
        for (let x = 0; x < grid.cols; x++) {
          const age = grid.cells[y * grid.cols + x];
          if (age === 0) continue;

          const intensity = clamp01((0.45 + age * 0.07) * brightnessGain);
          const rampIndex = Math.min(
            glyphs.length - 1,
            Math.floor(intensity * (glyphs.length - 1)),
          );
          const glyph =
            age < 3
              ? glyphs[Math.max(0, Math.min(glyphs.length - 1, rampIndex))]
              : topologyGlyph(grid.cells, x, y, grid);
          const color = getLifeColor(
            age,
            rowRatio,
            colorModeRef.current,
            colorSolidRef.current,
            colorGradStartRef.current,
            colorGradEndRef.current,
          );
          const litColor =
            age <= 2 ? mixColor(color, [255, 255, 255], 0.32) : color;

          ctx.fillStyle = toRgba(litColor, 0.42 + intensity * 0.58);
          ctx.fillText(
            glyph,
            x * cellW + cellW / 2,
            y * cellH + cellH / 2,
          );
        }
      }

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    animationFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

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
