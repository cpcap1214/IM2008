import { useEffect, useState } from "react"
import {
  Check,
  LayoutDashboard,
  Monitor,
  Moon,
  Palette,
  Save,
  Settings,
  Sun,
  Type,
  User,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  ROLE_LABEL,
  usePreferences,
  type AccentColor,
  type DefaultView,
  type FontSize,
  type ProfileRole,
  type ThemeMode,
} from "@/hooks/usePreferences"
import { cn } from "@/lib/utils"

type Tab = "profile" | "appearance" | "preferences"

const TAB_META: Array<{ key: Tab; label: string; icon: typeof Settings }> = [
  { key: "profile", label: "個人資料", icon: User },
  { key: "appearance", label: "外觀", icon: Palette },
  { key: "preferences", label: "偏好", icon: Settings },
]

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "淺色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟隨系統", icon: Monitor },
]

const FONT_OPTIONS: Array<{ value: FontSize; label: string; sample: string }> = [
  { value: "small", label: "小", sample: "Aa" },
  { value: "medium", label: "中", sample: "Aa" },
  { value: "large", label: "大", sample: "Aa" },
]

const VIEW_OPTIONS: Array<{ value: DefaultView; label: string }> = [
  { value: "overview", label: "總覽" },
  { value: "entry", label: "填寫資料" },
  { value: "operations", label: "訂單作業" },
  { value: "customers", label: "客戶" },
  { value: "insights", label: "洞察" },
]

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { prefs, updatePrefs, updateProfile, accentTokens, resetPrefs } = usePreferences()
  const [tab, setTab] = useState<Tab>("profile")
  const [profileDraft, setProfileDraft] = useState(prefs.profile)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (open) {
      setProfileDraft(prefs.profile)
      setTab("profile")
    }
  }, [open, prefs.profile])

  const handleSaveProfile = () => {
    updateProfile({
      displayName: profileDraft.displayName.trim() || "未命名",
      role: profileDraft.role,
      phone: profileDraft.phone.trim(),
      notes: profileDraft.notes.trim(),
    })
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-2xl">
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription>調整個人資料、外觀主題與偏好設定。外觀變更會立即套用。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
          <nav className="flex shrink-0 gap-1 sm:w-40 sm:flex-col">
            {TAB_META.map((meta) => {
              const Icon = meta.icon
              const isActive = tab === meta.key
              return (
                <button
                  key={meta.key}
                  type="button"
                  onClick={() => setTab(meta.key)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  <Icon />
                  <span>{meta.label}</span>
                </button>
              )
            })}
          </nav>

          <Separator className="sm:hidden" />

          <div className="min-h-[320px] flex-1">
            {tab === "profile" ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>顯示名稱</Label>
                  <Input
                    value={profileDraft.displayName}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, displayName: e.target.value }))}
                    placeholder="例如：林老闆"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>角色</Label>
                    <Select
                      value={profileDraft.role}
                      onValueChange={(value) => {
                        if (value) setProfileDraft((p) => ({ ...p, role: value as ProfileRole }))
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(["boss", "customer"] as ProfileRole[]).map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>聯絡電話</Label>
                    <Input
                      value={profileDraft.phone}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="0912345678"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>備註</Label>
                  <Textarea
                    value={profileDraft.notes}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="例如：每週三公休"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  {savedFlash ? (
                    <span className="flex items-center gap-1 text-sm text-primary">
                      <Check />
                      已儲存
                    </span>
                  ) : null}
                  <Button type="button" onClick={handleSaveProfile}>
                    <Save data-icon="inline-start" />
                    儲存個人資料
                  </Button>
                </div>
              </div>
            ) : null}

            {tab === "appearance" ? (
              <div className="flex flex-col gap-5">
                <section className="flex flex-col gap-2">
                  <Label className="flex items-center gap-2">
                    <Sun />
                    主題模式
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {THEME_OPTIONS.map((option) => {
                      const Icon = option.icon
                      const isActive = prefs.themeMode === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updatePrefs({ themeMode: option.value })}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors",
                            isActive
                              ? "border-primary bg-primary/10 text-primary"
                              : "hover:bg-muted",
                          )}
                        >
                          <Icon />
                          <span>{option.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <Label className="flex items-center gap-2">
                    <Type />
                    字體大小
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {FONT_OPTIONS.map((option) => {
                      const isActive = prefs.fontSize === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updatePrefs({ fontSize: option.value })}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors",
                            isActive
                              ? "border-primary bg-primary/10 text-primary"
                              : "hover:bg-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "font-semibold",
                              option.value === "small" && "text-sm",
                              option.value === "medium" && "text-base",
                              option.value === "large" && "text-lg",
                            )}
                          >
                            {option.sample}
                          </span>
                          <span className="text-xs">{option.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <Label className="flex items-center gap-2">
                    <Palette />
                    強調色
                  </Label>
                  <div className="grid grid-cols-5 gap-2">
                    {(Object.keys(accentTokens) as AccentColor[]).map((color) => {
                      const isActive = prefs.accentColor === color
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => updatePrefs({ accentColor: color })}
                          aria-label={accentTokens[color].label}
                          className={cn(
                            "group flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors",
                            isActive ? "border-foreground" : "hover:bg-muted",
                          )}
                        >
                          <span
                            className="flex size-8 items-center justify-center rounded-full ring-2 ring-transparent transition-all"
                            style={{
                              backgroundColor: accentTokens[color].primary,
                              boxShadow: isActive
                                ? `0 0 0 2px var(--background), 0 0 0 4px ${accentTokens[color].primary}`
                                : undefined,
                            }}
                          >
                            {isActive ? (
                              <Check
                                className="text-white"
                                style={{ color: accentTokens[color].primaryFg }}
                              />
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {accentTokens[color].label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </div>
            ) : null}

            {tab === "preferences" ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label className="flex items-center gap-2">
                    <LayoutDashboard />
                    啟動時預設視圖
                  </Label>
                  <Select
                    value={prefs.defaultView}
                    onValueChange={(value) => {
                      if (value) updatePrefs({ defaultView: value as DefaultView })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {VIEW_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    下次重新整理或重新進入網站時，預設停留在這個畫面。
                  </p>
                </div>

                <Separator />

                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="mb-2 font-medium">偏好設定儲存於哪裡？</div>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    <li>個人資料、外觀、偏好都存在你瀏覽器的 localStorage</li>
                    <li>不會上傳至 Firestore，每台裝置可以有自己的設定</li>
                    <li>清除瀏覽器資料會把設定一併清掉</li>
                  </ul>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (window.confirm("將所有設定恢復為預設值？")) {
                        resetPrefs()
                      }
                    }}
                  >
                    重設為預設
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
