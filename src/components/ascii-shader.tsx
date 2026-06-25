import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Moon,
  Sun,
  SlidersHorizontal,
  Shuffle,
  Square,
  X,
} from 'lucide-react';

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="currentColor"
    className="size-4"
    {...props}
  >
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

import { Button } from '@/components/ui/button';
import { ControlPanel } from '@/components/control-panel';
import { ShaderCanvas } from '@/components/shader-canvas';
import { BlackholeShader } from '@/components/blackhole-shader';
import { TuringShader } from '@/components/turing-shader';
import { MatrixRainShader } from '@/components/matrix-rain-shader';
import { CellularAutomataShader } from '@/components/cellular-automata-shader';

import { useTheme } from '@/hooks/use-theme';
import { COLOR_THEMES, getTheme } from '@/config/themes';
import {
  DEFAULT_CONFIG,
  SHADER_MODES,
  getModeDef,
  getModeDefaults,
} from '@/config/modes';
import type { ShaderConfig, ShaderMode } from '@/types/shader';

/** Each shader holds the stage for this long before showcase mode advances. */
const SHOWCASE_INTERVAL_MS = 3500;

/**
 * Shaders cycled in showcase mode, in display order. The rotation is linear —
 * first to last, then repeat — so the algorithm never jumps around or repeats
 * back-to-back; only the per-shader *settings* are randomized. Cellular Automata
 * (mode 8) is intentionally excluded.
 */
const SHOWCASE_MODES: ShaderMode[] = SHADER_MODES.map((m) => m.mode).filter(
  (m) => m !== 8,
);

const INITIAL_MODE_DEFAULTS = getModeDefaults(DEFAULT_CONFIG.mode);

const INITIAL_CONFIG: ShaderConfig = {
  mode: DEFAULT_CONFIG.mode,
  chars: INITIAL_MODE_DEFAULTS.chars,
  charWidth: INITIAL_MODE_DEFAULTS.charWidth,
  charHeight: INITIAL_MODE_DEFAULTS.charHeight,
  scale: INITIAL_MODE_DEFAULTS.scale,
  speed: INITIAL_MODE_DEFAULTS.speed,
  brightness: INITIAL_MODE_DEFAULTS.brightness,
  crt: DEFAULT_CONFIG.crt,
  themeId: INITIAL_MODE_DEFAULTS.themeId,
  imageSrc: null,
  imageEnabled: false,
  imageUseColors: false,
  showRealColors: false,
  auroraRealGraphics: false,
};

/** Container: owns live config, screensaver state, and renderer routing. */
export function AsciiShader() {
  const [config, setConfig] = useState<ShaderConfig>(INITIAL_CONFIG);
  const [screensaver, setScreensaver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Showcase mode: an auto-playing gallery. Keeps the header, hides the sidebar,
  // and rotates to a new shader + randomized settings every SHOWCASE_INTERVAL_MS.
  const [showcase, setShowcase] = useState(false);
  // Whether the user has ever started showcase mode. Drives the "new" badge on
  // the toggle, which drops away for good after first use. Persisted so it does
  // not reappear on reload.
  const [showcaseSeen, setShowcaseSeen] = useState(() => {
    try {
      return localStorage.getItem('showcase-seen') === '1';
    } catch {
      return false;
    }
  });
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

  // ── Showcase cycling engine ────────────────────────────────────────────
  // While active, step LINEARLY through SHOWCASE_MODES — first to last, then
  // repeat — so the algorithm order is fixed and never repeats back-to-back.
  // Each switch starts from that mode's curated defaults (so it looks as
  // intended, same as the control panel) and layers on randomized *settings*: a
  // fresh theme every time plus light speed/brightness jitter and an occasional
  // CRT pass. Heavy params (glyph ramp, cell size, noise scale) stay at the
  // defaults to keep every frame looking deliberate.
  useEffect(() => {
    if (!showcase) return;

    let i = 0;
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const advance = () => {
      const mode = SHOWCASE_MODES[i % SHOWCASE_MODES.length];
      i++;

      const defaults = getModeDefaults(mode);
      const theme =
        COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)];

      update({
        mode,
        ...defaults,
        themeId: theme.id,
        speed: round2(defaults.speed * rand(0.7, 1.4)),
        brightness: round2(defaults.brightness * rand(0.85, 1.2)),
        crt: Math.random() < 0.3,
        // Showcase is about the algorithms — never the source image, and always
        // the ASCII rendering for the effects that can also go "real graphics".
        imageEnabled: false,
        showRealColors: false,
        auroraRealGraphics: false,
      });
    };

    advance(); // first shader immediately, then on the interval
    const id = window.setInterval(advance, SHOWCASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [showcase, update]);

  // Showcase exits on Escape (the header stays interactive, so — unlike the
  // screensaver — it must NOT exit on every mouse/key event).
  useEffect(() => {
    if (!showcase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowcase(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showcase]);

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
          showRealColors={config.showRealColors}
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
      <ShaderCanvas
        config={config}
        theme={activeTheme}
        canvasRef={canvasRef}
        exportRef={exportRef}
      />
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
          <div className="relative">
            <Button
              variant={showcase ? 'default' : 'outline'}
              size="icon"
              onClick={() => {
                setShowcase((on) => !on);
                if (!showcaseSeen) {
                  setShowcaseSeen(true);
                  try {
                    localStorage.setItem('showcase-seen', '1');
                  } catch {
                    // Storage unavailable (private mode) — badge just stays.
                  }
                }
              }}
              aria-label={showcase ? 'Stop showcase' : 'Start showcase'}
              title={showcase ? 'Stop showcase' : 'Showcase mode'}
            >
              {showcase ? <Square /> : <Shuffle />}
            </Button>
            {/* "New feature" badge — drops away for good after first use. */}
            {!showcaseSeen && (
              <span className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-primary px-1 py-px text-[8px] font-bold uppercase leading-none tracking-wide text-primary-foreground ring-2 ring-background">
                new
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setScreensaver(true)}
            aria-label="Activate screensaver"
          >
            <Maximize2 />
          </Button>
          {!showcase && (
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="Toggle settings sidebar"
            >
              <SlidersHorizontal />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            asChild
          >
            <a
              href="https://github.com/j-casimiro/ascii-shader-sandbox"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub Repository"
            >
              <GithubIcon />
            </a>
          </Button>
        </div>
      </header>

      <main
        className={`w-full min-h-0 flex-1 flex flex-col lg:flex-row lg:gap-6 overflow-hidden relative ${
          showcase ? 'p-0' : 'p-0 lg:p-4'
        }`}
      >
        {/* Full-bleed canvas — no extra card wrapper. In showcase it goes edge
            to edge (no rounding/border) so only the header frames it. */}
        <section
          className={`flex-1 min-h-0 overflow-hidden ${
            showcase ? '' : 'lg:rounded-lg border-0 lg:border border-border'
          }`}
        >
          {renderActiveShader()}
        </section>

        {/* Showcase: a single, deliberately faint shader-name label so the eye
            stays on the art — no chrome, no icon, no theme, no progress bar. */}
        {showcase && (
          <span className="pointer-events-none absolute bottom-3 left-3 z-20 font-mono text-[11px] tracking-wide text-white/35 [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
            {modeDef.name}
          </span>
        )}

        {/* Sidebar (and its mobile backdrop) — hidden entirely in showcase. */}
        {!showcase && (
          <>
            {/* Sidebar Backdrop for Mobile */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 bg-black/60 z-30 lg:hidden transition-opacity"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Constrained right sidebar of controls. */}
            <aside
              className={`sidebar-scroll fixed inset-y-0 right-0 z-40 w-[85vw] sm:w-95 bg-sidebar border-l border-border flex flex-col transform transition-transform duration-300 ease-in-out lg:static lg:w-85 lg:shrink-0 lg:h-full lg:flex lg:flex-col lg:bg-transparent lg:border-l-0 lg:translate-x-0 ${
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
          </>
        )}
      </main>
    </div>
  );
}
