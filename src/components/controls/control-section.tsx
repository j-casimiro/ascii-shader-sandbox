import * as React from 'react'

import { cn } from '@/lib/utils'

interface ControlSectionProps {
  /** Section heading, rendered as a mono uppercase label. */
  title: string
  /** Optional trailing element (e.g. a value badge or toggle). */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** A bordered, token-first control group with a mono section label. */
export function ControlSection({
  title,
  action,
  className,
  children,
}: ControlSectionProps) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-4 space-y-4',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider font-mono text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  )
}
