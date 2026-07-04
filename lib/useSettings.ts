"use client";

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_SETTINGS, coerceSettings, type Settings } from "@/lib/settings";

const KEY = "zero-to-launch-settings";

/**
 * Settings persisted in localStorage. Model NAMES only — never keys (those stay
 * server-side). Loads after mount (localStorage is client-only), so the first
 * render uses DEFAULT_SETTINGS and hydration stays consistent.
 */
export function useSettings(): [Settings, (s: Settings) => void, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage after mount — it's client-only, so the first
    // (SSR) render must use defaults and this effect syncs the saved value.
    // setState-in-effect is the correct pattern for a client-only store here.
    let next = DEFAULT_SETTINGS;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) next = coerceSettings(JSON.parse(raw));
    } catch {
      /* corrupt / unavailable — keep defaults */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(next);
    setLoaded(true);
  }, []);

  const update = useCallback((s: Settings) => {
    setSettings(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable — session-only is fine */
    }
  }, []);

  return [settings, update, loaded];
}
