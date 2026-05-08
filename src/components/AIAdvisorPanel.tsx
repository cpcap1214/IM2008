import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Box,
  CheckCircle2,
  CircleAlert,
  Info,
  Loader2,
  Sparkles,
  Truck,
  Users as UsersIcon,
  Wand2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AI_CACHE_TTL_MS,
  isGeminiConfigured,
  loadCachedResult,
  requestAISuggestions,
  saveCachedResult,
  type AIAnalysisResult,
  type AIProvider,
  type AISuggestion,
  type SuggestionCategory,
  type SuggestionSeverity,
} from "@/lib/aiAdvisor"
import type { OrderDoc, ProductDoc, UserDoc } from "@/lib/firestore"
import { cn } from "@/lib/utils"

const SEVERITY_META: Record<
  SuggestionSeverity,
  { icon: typeof Info; label: string; barClass: string; iconClass: string; chipClass: string }
> = {
  critical: {
    icon: CircleAlert,
    label: "重要警示",
    barClass: "bg-destructive",
    iconClass: "text-destructive bg-destructive/10",
    chipClass: "bg-destructive/10 text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    label: "提醒注意",
    barClass: "bg-chart-3",
    iconClass: "text-chart-3 bg-chart-3/15",
    chipClass: "bg-chart-3/15 text-foreground",
  },
  info: {
    icon: Info,
    label: "洞察觀察",
    barClass: "bg-chart-2",
    iconClass: "text-chart-2 bg-chart-2/15",
    chipClass: "bg-chart-2/15 text-foreground",
  },
  positive: {
    icon: CheckCircle2,
    label: "持續觀察",
    barClass: "bg-chart-1",
    iconClass: "text-chart-1 bg-chart-1/15",
    chipClass: "bg-chart-1/15 text-foreground",
  },
}

const CATEGORY_ICON: Record<SuggestionCategory, typeof Banknote> = {
  cashflow: Banknote,
  shipment: Truck,
  customer: UsersIcon,
  product: Box,
  anomaly: AlertTriangle,
  ops: Sparkles,
}

const CATEGORY_LABEL: Record<SuggestionCategory, string> = {
  cashflow: "現金流",
  shipment: "出貨",
  customer: "客戶",
  product: "商品",
  anomaly: "異常",
  ops: "營運",
}

const PROVIDER_LABEL_MAP: Record<AIProvider, string> = {
  rules: "規則引擎",
  openai: "OpenAI GPT-4",
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatRelativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "剛剛"
  if (minutes < 60) return `${minutes} 分鐘前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function formatNextRefresh(generatedAt: Date): string {
  const next = new Date(generatedAt.getTime() + AI_CACHE_TTL_MS)
  return next.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function AIAdvisorPanel({
  orders,
  products,
  users,
  today,
  onNavigate,
}: {
  orders: OrderDoc[]
  products: ProductDoc[]
  users: UserDoc[]
  today: Date
  onNavigate?: (view: NonNullable<AISuggestion["action"]>["view"]) => void
}) {
  const geminiAvailable = isGeminiConfigured()
  const [provider, setProvider] = useState<AIProvider>(geminiAvailable ? "gemini" : "rules")
  const [result, setResult] = useState<AIAnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const ordersRef = useRef(orders)
  const productsRef = useRef(products)
  const usersRef = useRef(users)
  const todayRef = useRef(today)

  // 把最新資料用 ref 保存，避免每次資料變動都觸發重新分析
  useEffect(() => {
    ordersRef.current = orders
    productsRef.current = products
    usersRef.current = users
    todayRef.current = today
  }, [orders, products, users, today])

  const runAnalysis = async (p: AIProvider, opts: { simulate?: boolean } = {}) => {
    setAnalyzing(true)
    setError(null)
    setFromCache(false)
    try {
      const r = await requestAISuggestions(
        ordersRef.current,
        productsRef.current,
        usersRef.current,
        {
          today: todayRef.current,
          provider: p,
          simulateLatencyMs: opts.simulate && p === "rules" ? 500 : 0,
        },
      )
      setResult(r)
      saveCachedResult(p, r)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      // 失敗回退規則引擎，至少給使用者看一些建議
      try {
        const fallback = await requestAISuggestions(
          ordersRef.current,
          productsRef.current,
          usersRef.current,
          { today: todayRef.current, provider: "rules" },
        )
        setResult(fallback)
        saveCachedResult("rules", fallback)
      } catch {
        // 規則引擎也壞？罕見，不額外處理
      }
    } finally {
      setAnalyzing(false)
    }
  }

  // 切 provider 時：先看 24 小時內的快取，沒有才呼叫 API
  useEffect(() => {
    const cached = loadCachedResult(provider)
    if (cached) {
      setResult(cached)
      setFromCache(true)
      setError(null)
      return
    }
    runAnalysis(provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  const handleManualRefresh = () => runAnalysis(provider, { simulate: true })

  const suggestions = result?.suggestions ?? []
  const grouped = {
    critical: suggestions.filter((s) => s.severity === "critical").length,
    warning: suggestions.filter((s) => s.severity === "warning").length,
    info: suggestions.filter((s) => s.severity === "info").length,
    positive: suggestions.filter((s) => s.severity === "positive").length,
  }

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/8 via-primary/3 to-transparent"
      />
      <CardHeader className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Wand2 />
          </div>
          <CardTitle className="text-base">AI 智慧建議</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {result?.providerLabel ?? PROVIDER_LABEL_MAP[provider]}
          </Badge>
          {provider === "rules" && !geminiAvailable ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              未設定 Gemini API key
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {geminiAvailable ? (
              <div className="flex rounded-md border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setProvider("gemini")}
                  disabled={analyzing}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    provider === "gemini" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  Gemini
                </button>
                <button
                  type="button"
                  onClick={() => setProvider("rules")}
                  disabled={analyzing}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    provider === "rules" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  規則
                </button>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={analyzing}
            >
              {analyzing ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  分析中
                </>
              ) : (
                <>
                  <Sparkles data-icon="inline-start" />
                  重新分析
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>基於 {result?.dataPoints ?? 0} 筆資料分析</span>
          {result?.generatedAt ? (
            <span className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-muted-foreground/50" aria-hidden />
              最後分析：{formatTime(result.generatedAt)}（{formatRelativeAge(Date.now() - result.generatedAt.getTime())}）
            </span>
          ) : null}
          {result?.generatedAt && fromCache ? (
            <span className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-muted-foreground/50" aria-hidden />
              <span>下次自動分析：{formatNextRefresh(result.generatedAt)}</span>
            </span>
          ) : null}
          {fromCache ? (
            <Badge variant="outline" className="text-[10px]">
              快取（24h 內不重打 API）
            </Badge>
          ) : null}
        </div>

        {error ? (
          <div className="relative rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span className="font-medium">{provider === "gemini" ? "Gemini" : "AI"} 呼叫失敗，已自動切回規則引擎。</span>
            <br />
            {error}
          </div>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="relative flex flex-wrap gap-1.5 pt-1">
            {grouped.critical > 0 ? (
              <SeverityChip severity="critical" count={grouped.critical} />
            ) : null}
            {grouped.warning > 0 ? (
              <SeverityChip severity="warning" count={grouped.warning} />
            ) : null}
            {grouped.info > 0 ? <SeverityChip severity="info" count={grouped.info} /> : null}
            {grouped.positive > 0 ? (
              <SeverityChip severity="positive" count={grouped.positive} />
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="relative flex flex-col gap-3">
        {analyzing && suggestions.length === 0 ? (
          <ThinkingState />
        ) : suggestions.length === 0 ? (
          <EmptyState />
        ) : (
          suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onNavigate={onNavigate} />
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SeverityChip({
  severity,
  count,
}: {
  severity: SuggestionSeverity
  count: number
}) {
  const meta = SEVERITY_META[severity]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        meta.chipClass,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
      <span className="tabular-nums opacity-80">×{count}</span>
    </span>
  )
}

function SuggestionCard({
  suggestion,
  onNavigate,
}: {
  suggestion: AISuggestion
  onNavigate?: (view: NonNullable<AISuggestion["action"]>["view"]) => void
}) {
  const meta = SEVERITY_META[suggestion.severity]
  const CategoryIcon = CATEGORY_ICON[suggestion.category]
  const SeverityIcon = meta.icon
  const isCritical = suggestion.severity === "critical"

  return (
    <div className="group relative flex gap-3 overflow-hidden rounded-lg border bg-card pr-3 pl-0 transition-colors hover:bg-muted/30">
      <div className={cn("w-1 shrink-0", meta.barClass)} />

      <div className="flex flex-1 flex-col gap-1.5 py-3">
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              meta.iconClass,
              isCritical && "animate-pulse",
            )}
          >
            <SeverityIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-medium leading-snug">{suggestion.title}</h3>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CategoryIcon className="size-3" />
                {CATEGORY_LABEL[suggestion.category]}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{suggestion.body}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-9">
          {suggestion.metric ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
                meta.chipClass,
              )}
            >
              {suggestion.metric}
            </span>
          ) : null}
          {suggestion.action ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onNavigate?.(suggestion.action!.view)}
              className="ml-auto h-7 px-2 text-xs"
            >
              {suggestion.action.label}
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ThinkingState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Loader2 className="animate-spin" />
        <span>AI 正在分析營運資料...</span>
      </div>
      <p className="text-xs">解析訂單、客戶與商品趨勢中</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-chart-1/10 text-chart-1">
        <CheckCircle2 />
      </div>
      <h3 className="font-medium">營運狀況良好</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        目前沒有需要注意的訊號。資料庫變動時會自動重新分析。
      </p>
    </div>
  )
}

