import type { OrderDoc, ProductDoc, UserDoc } from "./firestore"

export type SuggestionSeverity = "critical" | "warning" | "info" | "positive"

export type SuggestionCategory =
  | "cashflow"
  | "shipment"
  | "customer"
  | "product"
  | "anomaly"
  | "ops"

export type SuggestionAction = {
  label: string
  view: "overview" | "entry" | "operations" | "customers" | "insights"
}

export type AISuggestion = {
  id: string
  severity: SuggestionSeverity
  category: SuggestionCategory
  title: string
  body: string
  metric?: string
  action?: SuggestionAction
}

export type AIProvider = "rules" | "openai" | "gemini" | "claude"

export type AIAnalysisResult = {
  suggestions: AISuggestion[]
  generatedAt: Date
  provider: AIProvider
  providerLabel: string
  dataPoints: number
}

const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
})

function money(value: number) {
  return currencyFormatter.format(value)
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function daysBetween(later: Date, earlier: Date) {
  return Math.floor((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / 86_400_000)
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function generateLocalSuggestions(
  orders: OrderDoc[],
  products: ProductDoc[],
  users: UserDoc[],
  today: Date,
): AISuggestion[] {
  const suggestions: AISuggestion[] = []
  const monthKey = toMonthKey(today)

  if (orders.length === 0) {
    suggestions.push({
      id: "empty-state",
      severity: "info",
      category: "ops",
      title: "目前資料庫沒有訂單",
      body: "可以從「填寫資料」新增第一筆訂單，或從 Header 點「寫入範例資料」灌入測試資料。",
      action: { label: "新增訂單", view: "entry" },
    })
    return suggestions
  }

  const unpaidOrders = orders.filter((o) => o.paymentStatus === "unpaid")
  const longOverdue = unpaidOrders
    .map((o) => ({ order: o, days: daysBetween(today, o.orderDate) }))
    .filter((x) => x.days > 30)
    .sort((a, b) => b.days - a.days)

  if (longOverdue.length > 0) {
    const total = longOverdue.reduce((sum, x) => sum + x.order.totalAmount, 0)
    const worst = longOverdue[0]
    suggestions.push({
      id: "long-overdue",
      severity: "critical",
      category: "cashflow",
      title: `${longOverdue.length} 筆訂單超過 30 天未收`,
      body: `最久未收：${worst.order.customerName}（${worst.days} 天，${money(worst.order.totalAmount)}）。建議排序催收，優先處理金額大且時間久的客戶。`,
      metric: money(total),
      action: { label: "前往訂單作業", view: "operations" },
    })
  }

  const deliveredUnpaid = unpaidOrders.filter(
    (o) => o.deliveryDate && daysBetween(today, o.deliveryDate) > 14,
  )
  if (deliveredUnpaid.length >= 2) {
    const total = deliveredUnpaid.reduce((sum, o) => sum + o.totalAmount, 0)
    suggestions.push({
      id: "delivered-unpaid",
      severity: "warning",
      category: "cashflow",
      title: `${deliveredUnpaid.length} 筆已出貨但超過 14 天未收款`,
      body: `合計 ${money(total)}。已交貨等於成本已支出，請款週期過長會壓縮現金流，建議建立統一請款日。`,
      metric: money(total),
      action: { label: "前往訂單作業", view: "operations" },
    })
  }

  const pending = orders.filter((o) => !o.deliveryDate)
  if (pending.length >= 5) {
    suggestions.push({
      id: "shipment-pile",
      severity: "warning",
      category: "shipment",
      title: `${pending.length} 筆訂單待出貨`,
      body: `待出貨累積較多，建議檢視配送排程與生產進度。已待超過 7 天的訂單應優先排定出貨日期。`,
      metric: `${pending.length} 筆`,
      action: { label: "前往訂單作業", view: "operations" },
    })
  }

  const monthOrders = orders.filter((o) => toMonthKey(o.orderDate) === monthKey)
  const customerCount = monthOrders.reduce<Record<string, number>>((acc, o) => {
    acc[o.customerName] = (acc[o.customerName] ?? 0) + 1
    return acc
  }, {})
  const topCustomerEntry = Object.entries(customerCount).sort((a, b) => b[1] - a[1])[0]
  if (topCustomerEntry && topCustomerEntry[1] >= 2) {
    const [name, count] = topCustomerEntry
    suggestions.push({
      id: "vip-customer",
      severity: "info",
      category: "customer",
      title: `${name} 是本月高頻客戶`,
      body: `本月已下單 ${count} 次。建議主動建立關係，提供熟客優惠或彈性付款條件以鞏固營收。`,
      metric: `${count} 次`,
    })
  }

  if (monthOrders.length > 0) {
    const productSales = monthOrders
      .flatMap((o) => o.items)
      .reduce<Record<string, number>>((acc, item) => {
        acc[item.productName] = (acc[item.productName] ?? 0) + item.subtotal
        return acc
      }, {})
    const totalSales = Object.values(productSales).reduce((s, v) => s + v, 0)
    const sorted = Object.entries(productSales).sort((a, b) => b[1] - a[1])
    if (sorted.length > 0 && totalSales > 0) {
      const [topName, topAmount] = sorted[0]
      const share = Math.round((topAmount / totalSales) * 100)
      if (share >= 40) {
        suggestions.push({
          id: "product-concentration",
          severity: share > 60 ? "warning" : "info",
          category: "product",
          title: `${topName} 占本月銷售 ${share}%`,
          body:
            share > 60
              ? `主力商品集中度過高，原物料漲價或單一客戶流失將直接衝擊營收。建議擴大其他品項銷售比重。`
              : `為本月主力商品。可考慮推出搭配組合或提早備料，鎖定毛利。`,
          metric: `${share}%`,
          action: { label: "前往洞察", view: "insights" },
        })
      }
    }
  }

  const monthBilled = monthOrders.reduce((s, o) => s + o.totalAmount, 0)
  const monthCollected = monthOrders
    .filter((o) => o.paymentStatus === "paid")
    .reduce((s, o) => s + o.totalAmount, 0)
  if (monthBilled > 0 && monthOrders.length >= 3) {
    const rate = Math.round((monthCollected / monthBilled) * 100)
    if (rate >= 80) {
      suggestions.push({
        id: "collection-healthy",
        severity: "positive",
        category: "cashflow",
        title: `本月收款率 ${rate}%`,
        body: `現金流相當健康，收款流程運作良好。建議維持目前的請款節奏。`,
        metric: `${rate}%`,
      })
    } else if (rate < 40) {
      suggestions.push({
        id: "collection-weak",
        severity: "warning",
        category: "cashflow",
        title: `本月收款率僅 ${rate}%`,
        body: `已開立 ${money(monthBilled)} 但只收回 ${money(monthCollected)}。建議檢討付款條件、減少賒帳比重。`,
        metric: `${rate}%`,
        action: { label: "前往訂單作業", view: "operations" },
      })
    }
  }

  const cashOrders = orders.filter((o) => o.paymentStatus === "paid" && o.paymentMethod === "cash")
  const transferOrders = orders.filter(
    (o) => o.paymentStatus === "paid" && o.paymentMethod === "transfer",
  )
  const checkOrders = orders.filter((o) => o.paymentStatus === "paid" && o.paymentMethod === "check")
  const totalPaidCount = cashOrders.length + transferOrders.length + checkOrders.length
  if (totalPaidCount >= 3) {
    const cashShare = (cashOrders.length / totalPaidCount) * 100
    if (cashShare >= 70) {
      suggestions.push({
        id: "cash-heavy",
        severity: "info",
        category: "ops",
        title: `${Math.round(cashShare)}% 已收訂單為現金`,
        body: `現金比重高有助於即時現金流，但對帳留痕較弱。建議高金額訂單導向匯款，留下交易紀錄。`,
        metric: `${Math.round(cashShare)}%`,
      })
    }
  }

  const recentOrders = orders.filter((o) => daysBetween(today, o.orderDate) <= 7)
  const previousOrders = orders.filter((o) => {
    const d = daysBetween(today, o.orderDate)
    return d > 7 && d <= 14
  })
  if (previousOrders.length >= 3) {
    const recentTotal = recentOrders.reduce((s, o) => s + o.totalAmount, 0)
    const previousTotal = previousOrders.reduce((s, o) => s + o.totalAmount, 0)
    if (previousTotal > 0) {
      const change = Math.round(((recentTotal - previousTotal) / previousTotal) * 100)
      if (change <= -30) {
        suggestions.push({
          id: "revenue-drop",
          severity: "warning",
          category: "anomaly",
          title: `近 7 天訂單金額較前週下滑 ${Math.abs(change)}%`,
          body: `本週 ${money(recentTotal)}，上週 ${money(previousTotal)}。可能是淡季或客戶流失，建議追蹤主要客戶最近聯絡狀況。`,
          metric: `${change}%`,
        })
      } else if (change >= 30) {
        suggestions.push({
          id: "revenue-up",
          severity: "positive",
          category: "anomaly",
          title: `近 7 天訂單金額較前週成長 ${change}%`,
          body: `本週 ${money(recentTotal)}，上週 ${money(previousTotal)}。確認是否有特殊事件帶動，可複製成功經驗。`,
          metric: `+${change}%`,
        })
      }
    }
  }

  const inactiveProducts = products.filter((p) => {
    if (!p.isActive) return false
    return !orders.some((o) => o.items.some((item) => item.productName === p.productName))
  })
  if (inactiveProducts.length > 0 && products.length >= 3) {
    suggestions.push({
      id: "dormant-products",
      severity: "info",
      category: "product",
      title: `${inactiveProducts.length} 樣商品近期完全沒有訂單`,
      body: `「${inactiveProducts
        .slice(0, 2)
        .map((p) => p.productName)
        .join("、")}」尚未在任何訂單中出現。可考慮下架、調整定價或主動推薦給適合的客戶。`,
      metric: `${inactiveProducts.length} 樣`,
    })
  }

  const inactiveCustomers = users.filter((u) => {
    if (u.role !== "customer") return false
    const lastOrder = orders.find((o) => o.customerId === u.id)
    if (!lastOrder) return true
    return daysBetween(today, lastOrder.orderDate) > 30
  })
  if (inactiveCustomers.length >= 2 && users.filter((u) => u.role === "customer").length >= 3) {
    suggestions.push({
      id: "dormant-customers",
      severity: "info",
      category: "customer",
      title: `${inactiveCustomers.length} 位客戶超過 30 天未下單`,
      body: `沉睡客戶清單：${inactiveCustomers
        .slice(0, 3)
        .map((u) => u.displayName)
        .join("、")}${inactiveCustomers.length > 3 ? " 等" : ""}。建議透過 LINE 主動關懷，喚回老客戶。`,
      metric: `${inactiveCustomers.length} 位`,
    })
  }

  return suggestions
}

const PROVIDER_LABEL: Record<AIProvider, string> = {
  rules: "規則引擎",
  openai: "OpenAI GPT-4",
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
}

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "warning", "info", "positive"],
          },
          category: {
            type: "string",
            enum: ["cashflow", "shipment", "customer", "product", "anomaly", "ops"],
          },
          title: { type: "string" },
          body: { type: "string" },
          metric: { type: "string" },
          action: {
            type: "object",
            properties: {
              label: { type: "string" },
              view: {
                type: "string",
                enum: ["overview", "entry", "operations", "customers", "insights"],
              },
            },
          },
        },
        required: ["id", "severity", "category", "title", "body"],
      },
    },
  },
  required: ["suggestions"],
}

function buildContext(
  orders: OrderDoc[],
  products: ProductDoc[],
  users: UserDoc[],
  today: Date,
) {
  const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
  const unpaidOrders = orders.filter((o) => o.paymentStatus === "unpaid")
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  const monthOrders = orders.filter((o) => isoDate(o.orderDate)?.startsWith(monthKey))

  return {
    today: isoDate(today),
    summary: {
      totalOrders: orders.length,
      unpaidCount: unpaidOrders.length,
      pendingShipments: orders.filter((o) => !o.deliveryDate).length,
      totalRevenueAllTime: orders.reduce((s, o) => s + o.totalAmount, 0),
      unpaidAmount: unpaidOrders.reduce((s, o) => s + o.totalAmount, 0),
      monthOrderCount: monthOrders.length,
      monthBilled: monthOrders.reduce((s, o) => s + o.totalAmount, 0),
      monthCollected: monthOrders
        .filter((o) => o.paymentStatus === "paid")
        .reduce((s, o) => s + o.totalAmount, 0),
    },
    recentOrders: orders.slice(0, 30).map((o) => ({
      customerName: o.customerName,
      items: o.items.map((i) => `${i.productName} x${i.quantity}`).join(", "),
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      orderDate: isoDate(o.orderDate),
      deliveryDate: isoDate(o.deliveryDate),
    })),
    products: products.map((p) => ({
      name: p.productName,
      spec: p.spec,
      price: p.price,
      isActive: p.isActive,
    })),
    customers: users
      .filter((u) => u.role === "customer")
      .map((u) => ({ id: u.id, name: u.displayName, notes: u.notes })),
    // Distinct delivery-person labels seen on existing orders.
    // `driverId` is now a free-text string, not a Users ref.
    deliveryLabels: Array.from(
      new Set(
        orders
          .map((o) => (o.driverId ?? "").trim())
          .filter((s): s is string => s.length > 0),
      ),
    ).sort(),
  }
}

async function callGemini(
  orders: OrderDoc[],
  products: ProductDoc[],
  users: UserDoc[],
  today: Date,
): Promise<AISuggestion[]> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  const model = import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-flash"

  if (!apiKey) {
    throw new Error("未設定 VITE_GEMINI_API_KEY，請於 .env.local 填入後重啟 dev server。")
  }

  const context = buildContext(orders, products, users, today)
  const prompt = `你是專業的營運顧問 AI，協助一家水泥/建材工程行的老闆分析營運資料。請僅以繁體中文回答。

# 資料快照
${JSON.stringify(context, null, 2)}

# 任務
基於上方真實資料，提供 3-7 條對營運有實際幫助的建議。每條建議必須符合：

- id: 簡短英數識別字串（如 "long-overdue"、"vip-customer"），同類問題用同一個 id
- title: 簡潔有重點，<= 25 字
- body: 具體說明 + 資料佐證（引用具體金額、客戶名、天數等），<= 80 字
- severity: 依問題嚴重度選一
    * critical: 金額大或時間久的緊急問題（例：超過 30 天未收且金額 > 5 萬）
    * warning: 需要注意的趨勢（例：本月收款率偏低、待出貨堆積）
    * info: 觀察類洞察（例：高頻客戶、商品占比、沉睡客戶）
    * positive: 正向訊號（例：收款健康、營收成長）
- category: 從 cashflow / shipment / customer / product / anomaly / ops 中擇一
- metric: 量化指標字串（如 "NT$120,000" / "45%" / "3 筆"），選填
- action: 建議行動，view 必須是 overview/entry/operations/customers/insights 之一，選填

避免空泛建議，每條都要扣著資料中的具體事實。輸出純 JSON，符合 schema。`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        temperature: 0.7,
      },
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Gemini API 錯誤 (${response.status}): ${errBody.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error("Gemini 沒有回傳內容（可能被安全過濾擋下）")
  }

  let parsed: { suggestions?: AISuggestion[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("Gemini 回傳不是合法 JSON：" + text.slice(0, 200))
  }

  return Array.isArray(parsed.suggestions) ? parsed.suggestions : []
}

export function isGeminiConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY)
}

// === 快取 ===
const CACHE_KEY_PREFIX = "aiAdvisor:cache:"
export const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小時

type CachedEnvelope = {
  result: Omit<AIAnalysisResult, "generatedAt"> & { generatedAt: string }
  cachedAt: number
}

export function loadCachedResult(provider: AIProvider): AIAnalysisResult | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + provider)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedEnvelope
    if (Date.now() - parsed.cachedAt > AI_CACHE_TTL_MS) return null
    return {
      ...parsed.result,
      generatedAt: new Date(parsed.result.generatedAt),
    }
  } catch {
    return null
  }
}

export function saveCachedResult(provider: AIProvider, result: AIAnalysisResult) {
  if (typeof window === "undefined") return
  try {
    const envelope: CachedEnvelope = {
      result: { ...result, generatedAt: result.generatedAt.toISOString() },
      cachedAt: Date.now(),
    }
    window.localStorage.setItem(CACHE_KEY_PREFIX + provider, JSON.stringify(envelope))
  } catch {
    // localStorage 滿了就算了
  }
}

export function getCacheAgeMs(provider: AIProvider): number | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + provider)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedEnvelope
    return Date.now() - parsed.cachedAt
  } catch {
    return null
  }
}

export function clearCachedResult(provider?: AIProvider) {
  if (typeof window === "undefined") return
  if (provider) {
    window.localStorage.removeItem(CACHE_KEY_PREFIX + provider)
    return
  }
  for (const p of ["rules", "openai", "gemini", "claude"] as AIProvider[]) {
    window.localStorage.removeItem(CACHE_KEY_PREFIX + p)
  }
}

export async function requestAISuggestions(
  orders: OrderDoc[],
  products: ProductDoc[],
  users: UserDoc[],
  options: {
    today?: Date
    provider?: AIProvider
    simulateLatencyMs?: number
  } = {},
): Promise<AIAnalysisResult> {
  const today = options.today ?? new Date()
  const provider: AIProvider = options.provider ?? "rules"

  let suggestions: AISuggestion[]

  if (provider === "gemini") {
    suggestions = await callGemini(orders, products, users, today)
  } else {
    // TODO: callOpenAI / callClaude 之後再補
    if (options.simulateLatencyMs && options.simulateLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.simulateLatencyMs))
    }
    suggestions = generateLocalSuggestions(orders, products, users, today)
  }

  return {
    suggestions,
    generatedAt: new Date(),
    provider,
    providerLabel: PROVIDER_LABEL[provider],
    dataPoints: orders.length + products.length + users.length,
  }
}
