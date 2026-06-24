import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

interface SliderControlProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Formats the numeric value for the mono badge (defaults to the raw value). */
  format?: (value: number) => string
  onChange: (value: number) => void
}

/** A labeled slider with a live mono value readout. */
export function SliderControl({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: SliderControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs text-secondary-foreground">
          {label}
        </Label>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}
