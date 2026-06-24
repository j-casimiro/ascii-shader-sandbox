import { useCallback, useEffect, useState } from 'react'

export type UiTheme = 'dark' | 'light'

const STORAGE_KEY = 'ascii-shader:ui-theme'

function readStored(): UiTheme {
  if (typeof localStorage === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

function applyTheme(theme: UiTheme) {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(theme)
}

/**
 * Light/dark UI theme, persisted to localStorage and reflected as a `.dark` /
 * `.light` class on the document root so the token bridge does the work.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<UiTheme>(readStored)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: UiTheme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return { theme, setTheme, toggleTheme }
}
