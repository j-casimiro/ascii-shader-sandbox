import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Moon, Sun, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ControlPanel } from '@/components/control-panel';
import { ShaderCanvas } from '@/components/shader-canvas';
import { BlackholeShader } from '@/components/blackhole-shader';
import { TuringShader } from '@/components/turing-shader';
import { MatrixRainShader } from '@/components/matrix-rain-shader';
import { CellularAutomataShader } from '@/components/cellular-automata-shader';

import { useTheme } from '@/hooks/use-theme';
import { getTheme } from '@/config/themes';
import { DEFAULT_CONFIG, getModeDef, getModeDefaults } from '@/config/modes';
import type { ShaderConfig } from '@/types/shader';

const INITIAL_MODE_DEFAULTS = getModeDefaults(DEFAULT_CONFIG.mode);

const INITIAL_CONFIG: ShaderConfig = {
  mode: DEFAULT_CONFIG.mode,
  chars: INITIAL_MODE_DEFAULTS.chars,
  charWidth: DEFAULT_CONFIG.charWidth,
  charHeight: DEFAULT_CONFIG.charHeight,
  scale: DEFAULT_CONFIG.scale,
  speed: INITIAL_MODE_DEFAULTS.speed,
  brightness: DEFAULT_CONFIG.brightness,
  crt: DEFAULT_CONFIG.crt,
  themeId: INITIAL_MODE_DEFAULTS.themeId,
  imageSrc: null,
  imageEnabled: false,
  imageUseColors: false,
};

/** Container: owns live config, screensaver state, and renderer routing. */
export function AsciiShader() {
  const [config, setConfig] = useState<ShaderConfig>(INITIAL_CONFIG);
  const [screensaver, setScreensaver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme: uiTheme, toggleTheme } = useTheme();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportRef = useRef<{ getHtml?: () => string } | null>(null);
  const activeTheme = getTheme(config.themeId);

  const update = useCallback((patch: Partial<ShaderConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  // Screensaver exits on any key press or mouse click.
  useEffect(() => {
    if (!screensaver) return;
    const exit = () => setScreensaver(false);
    window.addEventListener('keydown', exit);
    window.addEventListener('mousedown', exit);
    return () => {
      window.removeEventListener('keydown', exit);
      window.removeEventListener('mousedown', exit);
    };
  }, [screensaver]);

  // ── Export actions (framebuffer/CPU snapshot wiring lands with the shaders).
  const downloadPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'ascii-shader.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const exportHtml = useCallback(async () => {
    if (exportRef.current?.getHtml) {
      const html = await exportRef.current.getHtml();
      if (html) {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'ascii-shader.html';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    }
  }, []);

  const modeDef = getModeDef(config.mode);
  // The source image overrides the selected algorithm when enabled, including
  // the separate-component effects (Blackhole / Turing / Matrix Rain / Automata).
  const imageActive = config.imageEnabled && !!config.imageSrc;
  const activeLabel = imageActive ? 'Source Image' : modeDef.name;

  function renderActiveShader() {
    if (!imageActive && config.mode === 5) {
      return (
        <BlackholeShader
          chars={config.chars}
          charWidth={config.charWidth}
          charHeight={config.charHeight}
          speed={config.speed}
          brightness={config.brightness}
          crt={config.crt}
          colorMode={activeTheme.mode}
          colorSolid={activeTheme.accent}
          colorGradStart={activeTheme.gradStart}
          colorGradEnd={activeTheme.gradEnd}
          colorBg={activeTheme.bg}
          isParentScreensaver={screensaver}
          onExitParentScreensaver={() => setScreensaver(false)}
          externalCanvasRef={canvasRef}
          exportRef={exportRef}
        />
      );
    }
    if (!imageActive && config.mode === 6) {
      return (
        <TuringShader
          chars={config.chars}
          charWidth={config.charWidth}
          charHeight={config.charHeight}
          speed={config.speed}
          brightness={config.brightness}
          crt={config.crt}
          colorMode={activeTheme.mode}
          colorSolid={activeTheme.accent}
          colorGradStart={activeTheme.gradStart}
          colorGradEnd={activeTheme.gradEnd}
          colorBg={activeTheme.bg}
          isParentScreensaver={screensaver}
          onExitParentScreensaver={() => setScreensaver(false)}
          externalCanvasRef={canvasRef}
          exportRef={exportRef}
        />
      );
    }
    if (!imageActive && config.mode === 7) {
      return (
        <MatrixRainShader
          chars={config.chars}
          charWidth={config.charWidth}
          charHeight={config.charHeight}
          speed={config.speed}
          brightness={config.brightness}
          crt={config.crt}
          colorMode={activeTheme.mode}
          colorSolid={activeTheme.accent}
          colorGradStart={activeTheme.gradStart}
          colorGradEnd={activeTheme.gradEnd}
          colorBg={activeTheme.bg}
          isParentScreensaver={screensaver}
          onExitParentScreensaver={() => setScreensaver(false)}
          externalCanvasRef={canvasRef}
          exportRef={exportRef}
        />
      );
    }
    if (!imageActive && config.mode === 8) {
      return (
        <CellularAutomataShader
          chars={config.chars}
          charWidth={config.charWidth}
          charHeight={config.charHeight}
          speed={config.speed}
          brightness={config.brightness}
          crt={config.crt}
          colorMode={activeTheme.mode}
          colorSolid={activeTheme.accent}
          colorGradStart={activeTheme.gradStart}
          colorGradEnd={activeTheme.gradEnd}
          colorBg={activeTheme.bg}
          isParentScreensaver={screensaver}
          onExitParentScreensaver={() => setScreensaver(false)}
          externalCanvasRef={canvasRef}
          exportRef={exportRef}
        />
      );
    }
    return (
      <ShaderCanvas config={config} theme={activeTheme} canvasRef={canvasRef} exportRef={exportRef} />
    );
  }

  // ── Screensaver: cover the viewport; exits on key/click (listeners above).
  if (screensaver) {
    return (
      <div className="fixed inset-0 z-50 bg-black">{renderActiveShader()}</div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground flex flex-col font-sans">
      <header className="flex items-center justify-between border-b border-border px-4 md:px-8 lg:px-12 py-3 shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[18px] font-semibold tracking-tight">
            ASCII Shader Sandbox
          </h1>
          <span className="hidden sm:inline text-[13px] text-muted-foreground">
            GPU ASCII-art generator
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle light/dark theme"
          >
            {uiTheme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScreensaver(true)}
          >
            <Maximize2 />
            Screensaver
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle settings sidebar"
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </header>

      <main className="w-full min-h-0 p-0 lg:p-4 flex-1 flex flex-col lg:flex-row lg:gap-6 overflow-hidden relative">
        {/* Full-bleed canvas — no extra card wrapper. */}
        <section className="flex-1 min-h-0 lg:rounded-lg overflow-hidden border-0 lg:border border-border">
          {renderActiveShader()}
        </section>

        {/* Sidebar Backdrop for Mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-30 lg:hidden transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Constrained right sidebar of controls. */}
        <aside
          className={`sidebar-scroll fixed inset-y-0 right-0 z-40 w-[85vw] sm:w-[380px] bg-sidebar border-l border-border flex flex-col transform transition-transform duration-300 ease-in-out lg:static lg:w-85 lg:shrink-0 lg:h-full lg:flex lg:flex-col lg:bg-transparent lg:border-l-0 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {/* Mobile Sidebar Header */}
          <div className="flex items-center justify-between p-4 border-b border-border lg:hidden shrink-0">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Shader Settings
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close settings"
            >
              <X />
            </Button>
          </div>

          <div className="sidebar-scroll flex-1 overflow-y-auto p-4 lg:p-0">
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground hidden lg:block">
              {activeLabel}
            </p>
            <ControlPanel
              config={config}
              onChange={update}
              onExportHtml={exportHtml}
              onDownloadPng={downloadPng}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
