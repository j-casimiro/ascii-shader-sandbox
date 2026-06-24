import { useRef } from 'react';
import { Code2, Download, ImagePlus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ControlSection } from '@/components/controls/control-section';
import { SliderControl } from '@/components/controls/slider-control';

import { COLOR_THEMES } from '@/config/themes';
import { GLYPH_RAMPS } from '@/config/ramps';
import { SHADER_MODES, getModeDef, getModeDefaults } from '@/config/modes';
import type { ShaderConfig, ShaderMode } from '@/types/shader';

interface ControlPanelProps {
  config: ShaderConfig;
  onChange: (patch: Partial<ShaderConfig>) => void;
  onExportHtml: () => void;
  onDownloadPng: () => void;
}

export function ControlPanel({
  config,
  onChange,
  onExportHtml,
  onDownloadPng,
}: ControlPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeDef = getModeDef(config.mode);

  function handleModeChange(value: string) {
    const mode = Number(value) as ShaderMode;
    const defaults = getModeDefaults(mode);
    onChange({ mode, ...defaults });
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    // Uploading auto-enables image rendering so it shows immediately.
    onChange({ imageSrc: url, imageEnabled: true });
  }

  return (
    <div className="space-y-4">
      {/* ── Shader Algorithm ─────────────────────────────────────────── */}
      <ControlSection title="Shader Algorithm">
        <Select
          value={String(config.mode)}
          onValueChange={handleModeChange}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHADER_MODES.map((m) => (
              <SelectItem key={m.mode} value={String(m.mode)}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{modeDef.description}</p>
      </ControlSection>

      {/* ── Source Image (dedicated input source, not an algorithm) ───── */}
      <ControlSection title="Source Image">
        <p className="text-xs text-muted-foreground">
          Render an uploaded image as ASCII, overriding the algorithm above.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
        {config.imageSrc && (
          <div className="overflow-hidden rounded-md border border-border">
            <img
              src={config.imageSrc}
              alt="Source preview"
              className="block max-h-32 w-full object-cover"
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus />
            {config.imageSrc ? 'Replace image' : 'Upload image'}
          </Button>
          {config.imageSrc && (
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                onChange({ imageSrc: null, imageEnabled: false })
              }
            >
              <Trash2 />
              <span className="sr-only">Remove image</span>
            </Button>
          )}
        </div>
        {config.imageSrc && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="image-enabled" className="text-xs">
                Show on canvas
              </Label>
              <Switch
                id="image-enabled"
                checked={config.imageEnabled}
                onCheckedChange={(c) => onChange({ imageEnabled: c })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="use-colors" className="text-xs">
                Use image colors
              </Label>
              <Switch
                id="use-colors"
                checked={config.imageUseColors}
                onCheckedChange={(c) => onChange({ imageUseColors: c })}
              />
            </div>
          </>
        )}
      </ControlSection>

      {/* ── Character size ───────────────────────────────────────────── */}
      <ControlSection title="Character Size">
        <SliderControl
          id="char-width"
          label="Width"
          value={config.charWidth}
          min={5}
          max={24}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v) => onChange({ charWidth: v })}
        />
        <SliderControl
          id="char-height"
          label="Height"
          value={config.charHeight}
          min={8}
          max={36}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v) => onChange({ charHeight: v })}
        />
      </ControlSection>

      {/* ── Glyph Ramp ───────────────────────────────────────────────── */}
      <ControlSection title="Glyph Ramp">
        <Input
          value={config.chars}
          spellCheck={false}
          className="font-mono"
          aria-label="Glyph ramp (dark to light)"
          onChange={(e) => onChange({ chars: e.target.value })}
        />
        <div className="flex flex-wrap gap-2">
          {GLYPH_RAMPS.map((ramp) => (
            <Button
              key={ramp.id}
              variant="outline"
              size="sm"
              className="font-mono px-2"
              onClick={() => onChange({ chars: ramp.chars })}
            >
              {ramp.chars.length > 12 ? ramp.label : (ramp.chars.trim() || ramp.label)}
            </Button>
          ))}
        </div>
      </ControlSection>

      {/* ── Field & Animation ────────────────────────────────────────── */}
      <ControlSection title="Field & Animation">
        {modeDef.usesScale && (
          <SliderControl
            id="scale"
            label="Noise Zoom / Scale"
            value={config.scale}
            min={0.5}
            max={12}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => onChange({ scale: v })}
          />
        )}
        <SliderControl
          id="speed"
          label="Animation Speed"
          value={config.speed}
          min={0}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => onChange({ speed: v })}
        />
        <SliderControl
          id="brightness"
          label="Brightness Gain"
          value={config.brightness}
          min={0.2}
          max={2}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ brightness: v })}
        />
      </ControlSection>

      {/* ── Appearance ───────────────────────────────────────────────── */}
      <ControlSection title="Appearance">
        <div className="space-y-2">
          <Label htmlFor="color-theme" className="text-xs">
            Color Theme
          </Label>
          <Select
            value={config.themeId}
            onValueChange={(v) => onChange({ themeId: v })}
          >
            <SelectTrigger id="color-theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_THEMES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-3 rounded-full border border-border"
                      style={{ background: t.accent }}
                    />
                    {t.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="crt" className="text-xs">
            CRT Scanlines
          </Label>
          <Switch
            id="crt"
            checked={config.crt}
            onCheckedChange={(c) => onChange({ crt: c })}
          />
        </div>
      </ControlSection>

      {/* ── Export ───────────────────────────────────────────────────── */}
      <ControlSection title="Export">
        <Button variant="outline" className="w-full" onClick={onExportHtml}>
          <Code2 />
          Export HTML File
        </Button>
        <Button variant="outline" className="w-full" onClick={onDownloadPng}>
          <Download />
          Download PNG Image
        </Button>
      </ControlSection>
    </div>
  );
}
