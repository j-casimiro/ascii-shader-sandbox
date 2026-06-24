import { useEffect, useRef } from 'react';

import type { ShaderProps } from '@/types/shader';

/**
 * Mode 5 — Blackhole. Owns its own WebGL1 context (created later with
 * `preserveDrawingBuffer: true`). This is currently a host stub: it presents
 * the canvas surface and honors the shared prop contract; the gravitational
 * lensing fragment shader is authored later.
 */
export function BlackholeShader({
  colorBg = '#000000',
  colorSolid = '#ffffff',
  externalCanvasRef,
}: ShaderProps) {
  const internalRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = externalCanvasRef ?? internalRef;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(container.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(container.clientHeight * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = colorBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = colorSolid;
      ctx.globalAlpha = 0.5;
      ctx.font = `${12 * dpr}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'blackhole — not yet wired',
        canvas.width / 2,
        canvas.height / 2,
      );
      ctx.globalAlpha = 1;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [canvasRef, colorBg, colorSolid]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ backgroundColor: colorBg }}
      />
    </div>
  );
}
