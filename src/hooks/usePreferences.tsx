import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type ThemeMode = "light" | "dark" | "system"
export type FontSize = "small" | "medium" | "large"
export type AccentColor = "violet" | "teal" | "rose" | "amber" | "slate"
export type DefaultView =
  | "overview"
  | "entry"
  | "operations"
  | "customers"
  | "insights"

export type ProfileRole = "boss" | "customer"

export type Profile = {
  displayName: string
  role: ProfileRole
  phone: string
  notes: string
}

export type Preferences = {
  themeMode: ThemeMode
  fontSize: FontSize
  accentColor: AccentColor
  defaultView: DefaultView
  profile: Profile
}

const STORAGE_KEY = "yaoshun-prefs-v1"

const DEFAULT_PREFS: Preferences = {
  themeMode: "system",
  fontSize: "medium",
  accentColor: "violet",
  defaultView: "overview",
  profile: {
    displayName: "林老闆",
    role: "boss",
    phone: "",
    notes: "",
  },
}

// Legacy view keys we still accept from older localStorage payloads — the
// navigation was reorganized so payments/shipments collapsed into "operations"
// and analytics/alerts into "insights". Map on load so the preferences UI
// never offers retired values again.
const LEGACY_VIEW_MAP: Record<string, DefaultView> = {
  payments: "operations",
  shipments: "operations",
  analytics: "insights",
  alerts: "insights",
}

const ALLOWED_VIEWS: DefaultView[] = [
  "overview",
  "entry",
  "operations",
  "customers",
  "insights",
]

function coerceDefaultView(raw: unknown): DefaultView {
  if (typeof raw !== "string") return DEFAULT_PREFS.defaultView
  if (raw in LEGACY_VIEW_MAP) return LEGACY_VIEW_MAP[raw]
  return (ALLOWED_VIEWS as string[]).includes(raw)
    ? (raw as DefaultView)
    : DEFAULT_PREFS.defaultView
}

const ACCENT_TOKENS: Record<
  AccentColor,
  { primary: string; primaryFg: string; ring: string; chart4: string; label: string }
> = {
  violet: {
    primary: "oklch(0.54 0.23 278)",
    primaryFg: "oklch(0.985 0 0)",
    ring: "oklch(0.65 0.15 278)",
    chart4: "oklch(0.61 0.2 278)",
    label: "薰衣草紫",
  },
  teal: {
    primary: "oklch(0.62 0.13 195)",
    primaryFg: "oklch(0.985 0 0)",
    ring: "oklch(0.72 0.10 195)",
    chart4: "oklch(0.66 0.13 195)",
    label: "湖水青",
  },
  rose: {
    primary: "oklch(0.62 0.22 15)",
    primaryFg: "oklch(0.985 0 0)",
    ring: "oklch(0.72 0.18 15)",
    chart4: "oklch(0.66 0.20 15)",
    label: "玫瑰紅",
  },
  amber: {
    primary: "oklch(0.68 0.16 70)",
    primaryFg: "oklch(0.18 0.02 80)",
    ring: "oklch(0.78 0.13 70)",
    chart4: "oklch(0.72 0.15 70)",
    label: "琥珀橘",
  },
  slate: {
    primary: "oklch(0.42 0.04 265)",
    primaryFg: "oklch(0.985 0 0)",
    ring: "oklch(0.55 0.04 265)",
    chart4: "oklch(0.50 0.04 265)",
    label: "石墨黑",
  },
}

const FONT_SIZE_PX: Record<FontSize, number> = {
  small: 14,
  medium: 16,
  large: 18,
}

function loadPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      defaultView: coerceDefaultView(parsed.defaultView),
      profile: { ...DEFAULT_PREFS.profile, ...(parsed.profile ?? {}) },
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function applyTheme(themeMode: ThemeMode) {
  if (typeof document === "undefined") return
  const isDark =
    themeMode === "dark" ||
    (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", isDark)
}

function applyFontSize(fontSize: FontSize) {
  if (typeof document === "undefined") return
  document.documentElement.style.fontSize = `${FONT_SIZE_PX[fontSize]}px`
}

function applyAccent(accent: AccentColor) {
  if (typeof document === "undefined") return
  const tokens = ACCENT_TOKENS[accent]
  const root = document.documentElement.style
  root.setProperty("--primary", tokens.primary)
  root.setProperty("--primary-foreground", tokens.primaryFg)
  root.setProperty("--ring", tokens.ring)
  root.setProperty("--chart-4", tokens.chart4)
  root.setProperty("--sidebar-primary", tokens.primary)
}

// Apply preferences synchronously on module load — prevents theme flash
if (typeof window !== "undefined") {
  const initial = loadPrefs()
  applyTheme(initial.themeMode)
  applyFontSize(initial.fontSize)
  applyAccent(initial.accentColor)
}

type PreferencesContextValue = {
  prefs: Preferences
  updatePrefs: (patch: Partial<Omit<Preferences, "profile">>) => void
  updateProfile: (patch: Partial<Profile>) => void
  resetPrefs: () => void
  accentTokens: typeof ACCENT_TOKENS
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs)

  const persist = (next: Preferences) => {
    setPrefs(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore quota errors
    }
  }

  const updatePrefs: PreferencesContextValue["updatePrefs"] = (patch) => {
    persist({ ...prefs, ...patch })
  }

  const updateProfile: PreferencesContextValue["updateProfile"] = (patch) => {
    persist({ ...prefs, profile: { ...prefs.profile, ...patch } })
  }

  const resetPrefs = () => {
    persist(DEFAULT_PREFS)
  }

  useEffect(() => {
    applyTheme(prefs.themeMode)
    if (prefs.themeMode !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyTheme("system")
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [prefs.themeMode])

  useEffect(() => {
    applyFontSize(prefs.fontSize)
  }, [prefs.fontSize])

  useEffect(() => {
    applyAccent(prefs.accentColor)
  }, [prefs.accentColor])

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, updatePrefs, updateProfile, resetPrefs, accentTokens: ACCENT_TOKENS }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext)
  if (!ctx) {
    throw new Error("usePreferences 必須在 PreferencesProvider 之內呼叫。")
  }
  return ctx
}

export const ROLE_LABEL: Record<ProfileRole, string> = {
  boss: "老闆",
  customer: "客戶",
}
