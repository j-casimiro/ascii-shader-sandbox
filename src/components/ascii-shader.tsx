import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ControlPanel } from '@/components/control-panel';
import { ShaderCanvas } from '@/components/shader-canvas';
import { BlackholeShader } from '@/components/blackhole-shader';
import { TuringShader } from '@/components/turing-shader';

import { useTheme } from '@/hooks/use-theme';
import { getTheme, DEFAULT_THEME_ID } from '@/config/themes';
import { DEFAULT_RAMP } from '@/config/ramps';
import { DEFAULT_CONFIG, getModeDef } from '@/config/modes';
import type { ShaderConfig } from '@/types/shader';

const INITIAL_CONFIG: ShaderConfig = {
  mode: DEFAULT_CONFIG.mode,
  chars: DEFAULT_RAMP,
  charWidth: DEFAULT_CONFIG.charWidth,
  charHeight: DEFAULT_CONFIG.charHeight,
  scale: DEFAULT_CONFIG.scale,
  speed: DEFAULT_CONFIG.speed,
  brightness: DEFAULT_CONFIG.brightness,
  crt: DEFAULT_CONFIG.crt,
  themeId: DEFAULT_THEME_ID,
  imageSrc: null,
  imageUseColors: false,
};

/** Container: owns live config, screensaver state, and renderer routing. */
export function AsciiShader() {
  const [config, setConfig] = useState<ShaderConfig>(INITIAL_CONFIG);
  const [screensaver, setScreensaver] = useState(false);
  const { theme: uiTheme, toggleTheme } = useTheme();

  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const copyHtml = useCallback(() => {
    // TODO: emit a themed <pre> embed from the current frame.
    void navigator.clipboard?.writeText('');
  }, []);

  const modeDef = getModeDef(config.mode);

  function renderActiveShader() {
    if (config.mode === 5) {
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
        />
      );
    }
    if (config.mode === 6) {
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
        />
      );
    }
    return (
      <ShaderCanvas config={config} theme={activeTheme} canvasRef={canvasRef} />
    );
  }

  // ── Screensaver: cover the viewport; exits on key/click (listeners above).
  if (screensaver) {
    return (
      <div className="fixed inset-0 z-50 bg-black">{renderActiveShader()}</div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="flex items-center justify-between border-b border-border px-4 md:px-8 lg:px-12 py-3">
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
        </div>
      </header>

      <main className="w-full max-w-none px-4 md:px-8 lg:px-12 py-6 flex-1 flex flex-col lg:flex-row gap-6">
        {/* Full-bleed canvas — no extra card wrapper. */}
        <section className="flex-1 min-h-[50vh] lg:min-h-0 rounded-lg overflow-hidden border border-border">
          {renderActiveShader()}
        </section>

        {/* Constrained right sidebar of controls. */}
        <aside className="sidebar-scroll w-full lg:w-85 lg:shrink-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto pr-1">
          <p className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {modeDef.name}
          </p>
          <ControlPanel
            config={config}
            onChange={update}
            onCopyHtml={copyHtml}
            onDownloadPng={downloadPng}
          />
        </aside>
      </main>
    </div>
  );
}
