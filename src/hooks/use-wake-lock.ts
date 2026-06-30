import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Screen Wake Lock — keeps the display awake (no dimming/sleep) while a shader
 * plays in the full-screen view. Thin wrapper around the Screen Wake Lock API.
 *
 * Two pieces of state matter:
 *   - `enabled` is the user's *intent* (toggle on/off).
 *   - `active` is whether a sentinel is *currently held*.
 * They can diverge: the OS silently releases the sentinel whenever the tab is
 * hidden (switch/minimize), so when `enabled` we re-acquire on `visibilitychange`
 * to keep the lock effective for the whole session.
 *
 * `supported` is false on browsers without the API (notably non-HTTPS origins or
 * older Safari) — callers should hide their toggle in that case.
 */
export function useWakeLock() {
  const [supported] = useState(
    () => typeof navigator !== 'undefined' && 'wakeLock' in navigator,
  );
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  const releaseSentinel = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // Already released (e.g. by the OS on tab hide) — nothing to do.
      }
    }
  }, []);

  // Acquire / re-acquire while enabled, and release when disabled or unmounted.
  // Re-acquisition on visibility change is what keeps the lock alive after a
  // tab switch, since the OS drops the sentinel out from under us.
  useEffect(() => {
    if (!supported || !enabled) return;

    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      if (sentinelRef.current) return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          // Toggled off / unmounted mid-request — don't keep the lock.
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setActive(true);
        // The OS may auto-release (low battery, tab hidden). Reflect that, and
        // let the visibility handler re-acquire when we're foregrounded again.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setActive(false);
          }
        });
      } catch {
        // Request rejected (low battery, no user gesture, permissions policy).
        if (!cancelled) setActive(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void releaseSentinel();
    };
  }, [supported, enabled, releaseSentinel]);

  const enable = useCallback(() => setEnabled(true), []);
  const disable = useCallback(() => setEnabled(false), []);
  const toggle = useCallback(() => setEnabled((on) => !on), []);

  return { supported, enabled, active, enable, disable, toggle };
}
