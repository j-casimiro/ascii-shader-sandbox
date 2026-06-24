import { useEffect, useRef } from 'react';

import type { ShaderProps } from '@/types/shader';

interface ColumnState {
  head: number;
  speed: number;
  length: number;
  drift: number;
}

const FALLBACK_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*+=-:;';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const p = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * p),
    Math.round(a[1] + (b[1] - a[1]) * p),
    Math.round(a[2] + (b[2] - a[2]) * p),
  ];
}

function toRgba(rgb: [number, number, number], alpha: number) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

function pickGlyph(pool: string, column: number, row: number, tick: number) {
  const n = Math.sin(column * 12.9898 + row * 78.233 + tick * 0.37) * 43758.5453;
  return pool[Math.abs(Math.floor(n)) % pool.length];
}

function getTrailColor(
  intensity: number,
  rowRatio: number,
  colorMode: number,
  solid: [number, number, number],
  gradStart: [number, number, number],
  gradEnd: [number, number, number],
) {
  if (colorMode === 1) {
    return mixColor(gradStart, gradEnd, rowRatio);
  }
  if (colorMode === 2) {
    return intensity < 0.5
      ? mixColor(gradStart, solid, intensity * 2)
      : mixColor(solid, gradEnd, (intensity - 0.5) * 2);
  }
  if (colorMode === 3) {
    return mixColor([0, 36, 18], solid, 0.35 + intensity * 0.65);
  }
  return solid;
}

function makeColumn(rows: number): ColumnState {
  return {
    head: -Math.random() * rows,
    speed: 5 + Math.random() * 12,
    length: 8 + Math.floor(Math.random() * 22),
    drift: Math.random() * 1000,
  };
}

function syncColumns(
  existing: ColumnState[],
  cols: number,
  rows: number,
): ColumnState[] {
  return Array.from({ length: cols }, (_, i) => existing[i] ?? makeColumn(rows));
}

/**
 * Mode 7 - Matrix Rain. This renderer uses 2D canvas instead of the scalar
 * shader pipeline so each column can own a falling head, trail length, and
 * independent glyph churn.
 */
export function MatrixRainShader({
  chars = ' .,:;+*?%S#@',
  charWidth = 8,
  charHeight = 14,
  speed = 1.0,
  brightness = 1.0,
  crt = false,
  colorMode = 3,
  colorSolid = '#22c55e',
  colorGradStart = '#38bdf8',
  colorGradEnd = '#d9f99d',
  colorBg = '#000000',
  externalCanvasRef,
  exportRef,
}: ShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const columnsRef = useRef<ColumnState[]>([]);
  const gridRef = useRef({ cols: 0, rows: 0 });
  const tickRef = useRef(0);

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
    if (exportRef) {
      exportRef.current = {
        getHtml: () => {
          const setupJsCode = `
(function() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const FALLBACK_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*+=-:;';

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.substring(0, 2), 16),
      parseInt(clean.substring(2, 4), 16),
      parseInt(clean.substring(4, 6), 16)
    ];
  }

  function mixColor(a, b, t) {
    const p = Math.max(0, Math.min(1, t));
    return [
      Math.round(a[0] + (b[0] - a[0]) * p),
      Math.round(a[1] + (b[1] - a[1]) * p),
      Math.round(a[2] + (b[2] - a[2]) * p)
    ];
  }

  function toRgba(rgb, alpha) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + Math.max(0, Math.min(1, alpha)) + ')';
  }

  function pickGlyph(pool, column, row, tick) {
    const n = Math.sin(column * 12.9898 + row * 78.233 + tick * 0.37) * 43758.5453;
    return pool[Math.abs(Math.floor(n)) % pool.length];
  }

  function getTrailColor(intensity, rowRatio, colorMode, solid, gradStart, gradEnd) {
    if (colorMode === 1) {
      return mixColor(gradStart, gradEnd, rowRatio);
    }
    if (colorMode === 2) {
      return intensity < 0.5
        ? mixColor(gradStart, solid, intensity * 2)
        : mixColor(solid, gradEnd, (intensity - 0.5) * 2);
    }
    if (colorMode === 3) {
      return mixColor([0, 36, 18], solid, 0.35 + intensity * 0.65);
    }
    return solid;
  }

  function makeColumn(rows) {
    return {
      head: -Math.random() * rows,
      speed: 5 + Math.random() * 12,
      length: 8 + Math.floor(Math.random() * 22),
      drift: Math.random() * 1000
    };
  }

  function syncColumns(existing, cols, rows) {
    const result = [];
    for (let i = 0; i < cols; i++) {
      result.push(existing[i] || makeColumn(rows));
    }
    return result;
  }

  const chars = ${JSON.stringify(chars)};
  const charWidth = ${charWidth};
  const charHeight = ${charHeight};
  const speed = ${speed};
  const brightness = ${brightness};
  const colorMode = ${colorMode};
  const colorSolid = hexToRgb(${JSON.stringify(colorSolid)});
  const colorGradStart = hexToRgb(${JSON.stringify(colorGradStart)});
  const colorGradEnd = hexToRgb(${JSON.stringify(colorGradEnd)});
  const colorBg = hexToRgb(${JSON.stringify(colorBg)});

  let columns = [];
  let cols = 0;
  let rows = 0;
  let tick = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const expectedCols = Math.max(1, Math.ceil(canvas.width / charWidth));
    const expectedRows = Math.max(1, Math.ceil(canvas.height / charHeight));
    columns = syncColumns(columns, expectedCols, expectedRows);
    cols = expectedCols;
    rows = expectedRows;
  }
  window.addEventListener('resize', resize);
  resize();

  let previousTime = 0;

  function render(now) {
    if (previousTime === 0) previousTime = now;
    const dt = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;
    tick += dt * 60 * speed;

    const glyphs = chars.replace(/\\s/g, '') || FALLBACK_GLYPHS;

    ctx.fillStyle = 'rgb(' + colorBg[0] + ',' + colorBg[1] + ',' + colorBg[2] + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold ' + Math.max(6, charHeight - 2) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let col = 0; col < cols; col++) {
      const column = columns[col];
      column.head += dt * column.speed * speed;

      if (column.head - column.length > rows + 2) {
        columns[col] = makeColumn(rows);
        columns[col].head = -Math.random() * rows * 0.35;
        continue;
      }

      const head = Math.floor(column.head);
      for (let offset = 0; offset < column.length; offset++) {
        const row = head - offset;
        if (row < 0 || row >= rows) continue;

        const trail = 1 - offset / column.length;
        const pulse = 0.75 + 0.25 * Math.sin(tick * 0.08 + column.drift + row * 0.7);
        const intensity = Math.min(1, trail * pulse * brightness);
        const rowRatio = rows <= 1 ? 0 : row / (rows - 1);
        const color = getTrailColor(intensity, rowRatio, colorMode, colorSolid, colorGradStart, colorGradEnd);
        const glyph = pickGlyph(glyphs, col, row, Math.floor(tick / 5));

        ctx.fillStyle = offset === 0
          ? toRgba(mixColor(color, [245, 255, 245], 0.72), intensity)
          : toRgba(color, Math.pow(intensity, 1.35));

        ctx.fillText(glyph, col * charWidth + charWidth / 2, row * charHeight + charHeight / 2);
      }
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
`

          return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ASCII Matrix Rain Export</title>
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
  }, [brightness, charHeight, charWidth, chars, colorBg, colorGradEnd, colorGradStart, colorMode, colorSolid, crt, exportRef, speed]);

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
      columnsRef.current = syncColumns(columnsRef.current, cols, rows);
      gridRef.current = { cols, rows };
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement || canvas);

    let previousTime = 0;

    const render = (now: number) => {
      if (previousTime === 0) previousTime = now;
      const dt = Math.min(0.05, (now - previousTime) / 1000);
      previousTime = now;
      const speedFactor = Math.max(0, speedRef.current);
      tickRef.current += dt * 60 * speedFactor;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const cols = gridRef.current.cols;
      const rows = gridRef.current.rows;
      const cellW = charWidthRef.current;
      const cellH = charHeightRef.current;
      const expectedCols = Math.max(1, Math.ceil(width / cellW));
      const expectedRows = Math.max(1, Math.ceil(height / cellH));
      const glyphs = charsRef.current.replace(/\s/g, '') || FALLBACK_GLYPHS;
      const bg = colorBgRef.current;
      const brightnessGain = brightnessRef.current;

      if (expectedCols !== cols || expectedRows !== rows) {
        gridRef.current = { cols: expectedCols, rows: expectedRows };
        columnsRef.current = syncColumns(
          columnsRef.current,
          expectedCols,
          expectedRows,
        );
      }

      ctx.fillStyle = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `bold ${Math.max(6, cellH - 2)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let col = 0; col < gridRef.current.cols; col++) {
        const column = columnsRef.current[col];
        column.head += dt * column.speed * speedFactor;

        if (column.head - column.length > gridRef.current.rows + 2) {
          columnsRef.current[col] = makeColumn(gridRef.current.rows);
          columnsRef.current[col].head =
            -Math.random() * gridRef.current.rows * 0.35;
          continue;
        }

        const head = Math.floor(column.head);
        for (let offset = 0; offset < column.length; offset++) {
          const row = head - offset;
          if (row < 0 || row >= gridRef.current.rows) continue;

          const trail = 1 - offset / column.length;
          const pulse =
            0.75 +
            0.25 * Math.sin(tickRef.current * 0.08 + column.drift + row * 0.7);
          const intensity = Math.min(1, trail * pulse * brightnessGain);
          const rowRatio =
            gridRef.current.rows <= 1 ? 0 : row / (gridRef.current.rows - 1);
          const color = getTrailColor(
            intensity,
            rowRatio,
            colorModeRef.current,
            colorSolidRef.current,
            colorGradStartRef.current,
            colorGradEndRef.current,
          );
          const glyph = pickGlyph(
            glyphs,
            col,
            row,
            Math.floor(tickRef.current / 5),
          );

          ctx.fillStyle =
            offset === 0
              ? toRgba(mixColor(color, [245, 255, 245], 0.72), intensity)
              : toRgba(color, Math.pow(intensity, 1.35));
          ctx.fillText(glyph, col * cellW + cellW / 2, row * cellH + cellH / 2);
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
