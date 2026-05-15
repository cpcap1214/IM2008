import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  Database,
  FilePenLine,
  Home,
  LayoutDashboard,
  Lightbulb,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Truck,
  Undo2,
  Users,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { isFirebaseConfigured } from "@/lib/firebase"
import {
  confirmOrderPayment,
  createOrder,
  deleteOrder as deleteOrderDoc,
  markOrderDelivered,
  resetOrderDelivery,
  subscribeOrders,
  subscribeProducts,
  subscribeUsers,
  updateOrder,
  type OrderDoc,
  type OrderItem,
  type OrderPaymentMethod,
  type OrderPaymentStatus,
  type ProductDoc,
  type UserDoc,
} from "@/lib/firestore"
import { withWriteFeedback } from "@/lib/mutations"
import {
  hasExactMatch,
  nearMatchSuggestions,
  rankCustomers,
  type CustomerSuggestion,
} from "@/lib/customerSearch"
import { clearSampleData, isSeedEnabled, seedSampleData } from "@/lib/seed"
import { cn } from "@/lib/utils"
import { ROLE_LABEL, usePreferences } from "@/hooks/usePreferences"
import { SettingsDialog } from "@/components/SettingsDialog"
import { AIAdvisorPanel } from "@/components/AIAdvisorPanel"
import { ExportBar, type ExportColumn } from "@/components/ExportBar"
import { Settings } from "lucide-react"

const paymentMethodOptions: Array<{ value: OrderPaymentMethod; label: string }> = [
  { value: "cash", label: "現金" },
  { value: "transfer", label: "匯款" },
  { value: "check", label: "支票" },
]

type ViewKey = "overview" | "entry" | "operations" | "customers" | "insights"

// Legacy keys can still surface from cached Gemini/Claude responses written
// before the navigation was reorganized — coerce them here so the AI panel's
// "前往帳款" buttons keep landing somewhere sensible instead of a blank screen.
const LEGACY_VIEW_KEY_MAP: Record<string, ViewKey> = {
  payments: "operations",
  shipments: "operations",
  analytics: "insights",
  alerts: "insights",
}

function coerceViewKey(value: string): ViewKey {
  if (value in LEGACY_VIEW_KEY_MAP) return LEGACY_VIEW_KEY_MAP[value]
  const allowed: ViewKey[] = ["overview", "entry", "operations", "customers", "insights"]
  return (allowed as string[]).includes(value) ? (value as ViewKey) : "overview"
}

type ItemFormRow = {
  productId: string
  productName: string
  spec: string
  quantity: string
  unitPrice: string
}

type OrderFormData = {
  customerId: string
  customerName: string
  driverId: string
  orderDate: string
  deliveryDate: string
  paymentStatus: OrderPaymentStatus
  paymentMethod: OrderPaymentMethod | ""
  items: ItemFormRow[]
}

type DerivedOrderState = "進行中" | "待收款" | "已完成"

type KpiItem = {
  label: string
  value: string
  icon: typeof Coins
  accent?: "danger"
}

const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat("zh-TW")

const navigationItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "overview", label: "總覽", icon: LayoutDashboard },
  { key: "entry", label: "填寫資料", icon: FilePenLine },
  { key: "operations", label: "訂單作業", icon: ClipboardList },
  { key: "customers", label: "客戶", icon: Users },
  { key: "insights", label: "洞察", icon: Lightbulb },
]

function toLocalDateString(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function formatDate(value: Date | null) {
  if (!value) return "-"
  return value.toLocaleDateString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  })
}

function formatDateTime(value: Date) {
  return value.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function money(value: number) {
  return currencyFormatter.format(value)
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

function daysBetween(later: Date, earlier: Date) {
  const diff = startOfDay(later).getTime() - startOfDay(earlier).getTime()
  return Math.floor(diff / 86_400_000)
}

function deriveState(order: OrderDoc): DerivedOrderState {
  if (order.paymentStatus === "paid") return "已完成"
  if (order.deliveryDate) return "待收款"
  return "進行中"
}

const paymentStatusLabel: Record<OrderPaymentStatus, string> = {
  unpaid: "未收款",
  paid: "已結清",
  pending_confirmation: "待老闆確認",
}

function deliveryPersonLabel(driverId: string | null) {
  if (!driverId || !driverId.trim()) return "未指派"
  return driverId
}

function summarizeItems(items: OrderItem[]) {
  if (items.length === 0) return "-"
  const head = items[0].productName + (items[0].spec ? ` (${items[0].spec})` : "")
  if (items.length === 1) return head
  return `${head} 等 ${items.length} 樣`
}

function createDefaultForm(today: string): OrderFormData {
  return {
    customerId: "",
    customerName: "",
    driverId: "",
    orderDate: today,
    deliveryDate: "",
    paymentStatus: "unpaid",
    paymentMethod: "",
    items: [createEmptyItemRow()],
  }
}

function createEmptyItemRow(): ItemFormRow {
  return {
    productId: "",
    productName: "",
    spec: "",
    quantity: "1",
    unitPrice: "",
  }
}

function rowSubtotal(row: ItemFormRow) {
  const qty = Number(row.quantity) || 0
  const price = Number(row.unitPrice) || 0
  return qty * price
}

function App() {
  if (!isFirebaseConfigured) {
    return <SetupNotice />
  }
  return <DashboardApp />
}

function DashboardApp() {
  const today = toLocalDateString(new Date())
  const { prefs } = usePreferences()

  const [orders, setOrders] = useState<OrderDoc[]>([])
  const [products, setProducts] = useState<ProductDoc[]>([])
  const [users, setUsers] = useState<UserDoc[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  const [form, setForm] = useState<OrderFormData>(() => createDefaultForm(today))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ViewKey>(prefs.defaultView)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<OrderDoc | null>(null)
  const [deliveryTarget, setDeliveryTarget] = useState<OrderDoc | null>(null)
  // Customer drill-in lives at app scope so any view (overview, operations,
  // insights, customers list) can hand off to the customer history dialog
  // without prop-drilling through every table.
  const [historyCustomer, setHistoryCustomer] = useState<string | null>(null)
  // Last-save status surfaced on the entry form so the boss has positive
  // feedback after submitting without us yanking them off the page.
  const [entryFlash, setEntryFlash] = useState<{ kind: "created" | "updated"; customerName: string } | null>(null)
  const seedEnabled = isSeedEnabled()

  // Auto-dismiss the entry-flash banner after a few seconds so a stale
  // "已新增 X 的訂單" doesn't haunt the next save. The timer lives in
  // DashboardApp scope so leaving and re-entering the entry tab can't
  // resurrect a long-dead flash — it'll have cleared by then.
  useEffect(() => {
    if (!entryFlash) return
    const timer = window.setTimeout(() => setEntryFlash(null), 4000)
    return () => window.clearTimeout(timer)
  }, [entryFlash])

  useEffect(() => {
    const unsubOrders = subscribeOrders(
      (next) => {
        setOrders(next)
        setLastUpdated(new Date())
      },
      (err) => setLoadError(err.message),
    )
    const unsubProducts = subscribeProducts(
      (next) => setProducts(next),
      (err) => setLoadError(err.message),
    )
    const unsubUsers = subscribeUsers(
      (next) => setUsers(next),
      (err) => setLoadError(err.message),
    )
    return () => {
      unsubOrders()
      unsubProducts()
      unsubUsers()
    }
  }, [])

  const customers = useMemo(() => users.filter((u) => u.role === "customer"), [users])
  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products])

  // Unified pool for the customer-name fuzzy picker. Users docs are the
  // primary source; we also fold in distinct customerName values from
  // existing orders so "ghost" customers (orders without a Users doc) still
  // surface in autocomplete and the near-match warning. Keyed by normalized
  // name to dedupe across the two sources.
  const customerSuggestions = useMemo<CustomerSuggestion[]>(() => {
    const byKey = new Map<string, CustomerSuggestion>()
    for (const u of customers) {
      const name = u.displayName.trim()
      if (!name) continue
      const key = name.toLocaleLowerCase().replace(/\s+/g, "")
      if (!byKey.has(key)) byKey.set(key, { name, id: u.id })
    }
    for (const o of orders) {
      const name = o.customerName.trim()
      if (!name) continue
      const key = name.toLocaleLowerCase().replace(/\s+/g, "")
      if (!byKey.has(key)) byKey.set(key, { name, id: o.customerId || null })
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-Hant"),
    )
  }, [customers, orders])

  // Autocomplete pool for the free-text "送貨人員" field — distinct non-empty
  // driverId values from existing orders so the boss can quickly re-use names.
  const driverLabelSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      if (o.driverId && o.driverId.trim()) set.add(o.driverId.trim())
    }
    return Array.from(set).sort()
  }, [orders])

  const setField = <K extends keyof OrderFormData>(key: K, value: OrderFormData[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateItem = (index: number, patch: Partial<ItemFormRow>) => {
    setForm((current) => {
      const next = current.items.slice()
      next[index] = { ...next[index], ...patch }
      return { ...current, items: next }
    })
  }

  const addItemRow = () => {
    setForm((current) => ({ ...current, items: [...current.items, createEmptyItemRow()] }))
  }

  const removeItemRow = (index: number) => {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((_, i) => i !== index) : current.items,
    }))
  }

  const resetForm = () => {
    setForm(createDefaultForm(today))
    setEditingId(null)
  }

  const submitOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const customerId = form.customerId.trim()
    const customerName = form.customerName.trim()
    if (!customerId || !customerName) return

    const items: OrderItem[] = form.items
      .map((row) => ({
        productName: row.productName.trim(),
        spec: row.spec.trim(),
        quantity: Math.max(Number(row.quantity) || 0, 0),
        unitPrice: Math.max(Number(row.unitPrice) || 0, 0),
        subtotal: rowSubtotal(row),
      }))
      .filter((item) => item.productName && item.quantity > 0)

    if (items.length === 0) return

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0)
    const paymentStatus = form.paymentStatus
    const paymentMethod = paymentStatus === "paid" && form.paymentMethod ? form.paymentMethod : null
    const orderDate = parseDate(form.orderDate)
    const deliveryDate = form.deliveryDate ? parseDate(form.deliveryDate) : null
    const driverId = form.driverId.trim() || null

    setBusy(true)
    try {
      const result = editingId
        ? await withWriteFeedback("更新訂單", () =>
            updateOrder(editingId, {
              customerId,
              customerName,
              driverId,
              items,
              totalAmount,
              paymentStatus,
              paymentMethod,
              orderDate,
              deliveryDate,
            }),
          )
        : await withWriteFeedback("新增訂單", () =>
            createOrder({
              customerId,
              customerName,
              driverId,
              items,
              totalAmount,
              paymentStatus,
              paymentMethod,
              orderDate,
              deliveryDate,
            }),
          )
      if (result === null) {
        setLoadError("訂單儲存失敗，請查看右上角通知或瀏覽器主控台。")
      } else {
        // Stay on the entry view so the boss can keep adding orders. Edit
        // mode submits also land here — the form resets to a fresh blank
        // entry and the flash confirms what was saved.
        setEntryFlash({
          kind: editingId ? "updated" : "created",
          customerName,
        })
        resetForm()
      }
    } finally {
      setBusy(false)
    }
  }

  const editOrder = (order: OrderDoc) => {
    setEditingId(order.id)
    setForm({
      customerId: order.customerId,
      customerName: order.customerName,
      driverId: order.driverId ?? "",
      orderDate: toLocalDateString(order.orderDate),
      deliveryDate: order.deliveryDate ? toLocalDateString(order.deliveryDate) : "",
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod ?? "",
      items:
        order.items.length > 0
          ? order.items.map((item) => ({
              productId: "",
              productName: item.productName,
              spec: item.spec,
              quantity: String(item.quantity),
              unitPrice: String(item.unitPrice),
            }))
          : [createEmptyItemRow()],
    })
    setActiveView("entry")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const removeOrder = async (orderId: string) => {
    const target = orders.find((order) => order.id === orderId)
    if (!target) return
    if (!window.confirm(`確定刪除「${target.customerName} - ${summarizeItems(target.items)}」？`)) return
    setBusy(true)
    try {
      const result = await withWriteFeedback("刪除訂單", () => deleteOrderDoc(orderId))
      if (result !== null && editingId === orderId) resetForm()
    } finally {
      setBusy(false)
    }
  }

  const confirmPayment = async (orderId: string, method: OrderPaymentMethod) => {
    setBusy(true)
    try {
      const result = await withWriteFeedback("確認入帳", () =>
        confirmOrderPayment(orderId, method),
      )
      if (result !== null) setConfirmTarget(null)
    } finally {
      setBusy(false)
    }
  }

  const markDelivered = async (orderId: string, driverLabel: string | null) => {
    setBusy(true)
    try {
      const result = await withWriteFeedback("標記送達", () =>
        markOrderDelivered(orderId, driverLabel),
      )
      if (result !== null) setDeliveryTarget(null)
    } finally {
      setBusy(false)
    }
  }

  const undoDelivery = async (orderId: string) => {
    const target = orders.find((o) => o.id === orderId)
    if (!target) return
    if (!window.confirm(`確定將「${target.customerName} - ${summarizeItems(target.items)}」改回未送達？`)) return
    setBusy(true)
    try {
      await withWriteFeedback("重設送達", () => resetOrderDelivery(orderId))
    } finally {
      setBusy(false)
    }
  }

  // Single entry point for "show me this customer's history." All tables
  // funnel through this so the dialog state stays in one place.
  const openCustomerHistory = (customerName: string) => {
    const trimmed = customerName.trim()
    if (!trimmed) return
    setHistoryCustomer(trimmed)
  }

  const handleSeed = async () => {
    if (!window.confirm("將寫入範例 Users / Products / Orders 至 Firestore (ID 帶 SEED_ 前綴可辨認)，確認繼續？")) return
    setBusy(true)
    try {
      await withWriteFeedback("寫入範例資料", () => seedSampleData())
    } finally {
      setBusy(false)
    }
  }

  const handleClearSeed = async () => {
    if (!window.confirm("將刪除所有 ID 以 SEED_ 開頭的範例資料 (你手動建立的訂單不會被動到)，確認繼續？")) return
    setBusy(true)
    try {
      const result = await withWriteFeedback("清除範例資料", () => clearSampleData())
      if (result !== null) window.alert(`已刪除 ${result.deleted} 筆範例資料。`)
    } finally {
      setBusy(false)
    }
  }

  const dashboard = useMemo(() => {
    const todayDate = parseDate(today)
    const monthKey = today.slice(0, 7)

    const todayOrders = orders.filter((order) => isSameDay(order.orderDate, todayDate))
    const todayPaid = todayOrders.filter((order) => order.paymentStatus === "paid")
    const todayUnpaid = todayOrders.filter((order) => order.paymentStatus !== "paid")

    const unpaidOrders = orders.filter((order) => order.paymentStatus === "unpaid")
    const pendingConfirmationOrders = orders.filter(
      (order) => order.paymentStatus === "pending_confirmation",
    )
    const outstandingOrders = orders.filter((order) => order.paymentStatus !== "paid")
    const pendingShipments = orders.filter((order) => !order.deliveryDate)
    const todayDeliveries = orders.filter(
      (order) => order.deliveryDate && isSameDay(order.deliveryDate, todayDate),
    )

    const monthPaidOrders = orders.filter(
      (order) =>
        order.paymentStatus === "paid" && toLocalDateString(order.orderDate).startsWith(monthKey),
    )

    const sum = (list: OrderDoc[]) => list.reduce((acc, order) => acc + order.totalAmount, 0)

    const paymentMethodStats = paymentMethodOptions.map(({ value, label }) => ({
      method: value,
      label,
      amount: orders
        .filter((order) => order.paymentStatus === "paid" && order.paymentMethod === value)
        .reduce((acc, order) => acc + order.totalAmount, 0),
    }))
    const paymentMethodTotal = paymentMethodStats.reduce((acc, item) => acc + item.amount, 0)

    const stalestUnpaid = outstandingOrders
      .map((order) => ({
        order,
        days: daysBetween(todayDate, order.orderDate),
      }))
      .filter((item) => item.days >= 7)
      .sort((a, b) => b.days - a.days)

    const overdueByCustomer = stalestUnpaid.reduce<Record<string, number>>((acc, item) => {
      acc[item.order.customerName] = (acc[item.order.customerName] ?? 0) + item.order.totalAmount
      return acc
    }, {})
    const topOverdueCustomer = Object.entries(overdueByCustomer).sort((a, b) => b[1] - a[1])[0]

    // Orders that need the boss's attention: anything not paid OR not
    // shipped. Used to drive the operations-tab badge and the unified
    // "action required" list in OperationsView.
    const actionRequiredOrders = orders.filter(
      (order) => order.paymentStatus !== "paid" || !order.deliveryDate,
    )

    return {
      todayReceivableAmount: sum(todayOrders),
      todayPaidAmount: sum(todayPaid),
      todayUnpaidAmount: sum(todayUnpaid),
      totalUnpaidAmount: sum(outstandingOrders),
      monthPaidAmount: sum(monthPaidOrders),
      pendingShipmentsCount: pendingShipments.length,
      activeOrderCount: actionRequiredOrders.length,
      actionRequiredOrders,
      actionRequiredCount: actionRequiredOrders.length,
      todayDeliveries,
      pendingShipments,
      unpaidOrders,
      pendingConfirmationOrders,
      outstandingOrders,
      stalestUnpaid: stalestUnpaid.map((item) => item.order),
      overdueByCustomer,
      paymentMethodStats,
      paymentMethodTotal,
      topOverdueCustomer,
    }
  }, [orders, today])

  const kpiItems: KpiItem[] = [
    { label: "今日應收", value: money(dashboard.todayReceivableAmount), icon: Coins },
    { label: "今日已收", value: money(dashboard.todayPaidAmount), icon: Wallet },
    { label: "今日未收", value: money(dashboard.todayUnpaidAmount), icon: AlertTriangle, accent: dashboard.todayUnpaidAmount > 0 ? "danger" : undefined },
    { label: "總未收", value: money(dashboard.totalUnpaidAmount), icon: CreditCard },
    { label: "待出貨", value: `${dashboard.pendingShipmentsCount} 筆`, icon: Truck },
    { label: "進行中", value: `${dashboard.activeOrderCount} 筆`, icon: ClipboardList },
    { label: "本月收入", value: money(dashboard.monthPaidAmount), icon: CheckCircle2 },
    { label: "訂單總數", value: `${numberFormatter.format(orders.length)} 筆`, icon: Database },
  ]

  const todayDate = parseDate(today)

  const reminders = [
    dashboard.stalestUnpaid.length > 0
      ? `有 ${dashboard.stalestUnpaid.length} 筆未收款超過 7 天，合計 ${money(
          dashboard.stalestUnpaid.reduce((sum, order) => sum + order.totalAmount, 0),
        )}。`
      : "沒有久未收款的訂單。",
    dashboard.topOverdueCustomer
      ? `${dashboard.topOverdueCustomer[0]} 是目前累積未收最多的客戶，未收 ${money(dashboard.topOverdueCustomer[1])}。`
      : "尚無高額未收客戶。",
    dashboard.pendingShipmentsCount > 0
      ? `目前有 ${dashboard.pendingShipmentsCount} 筆訂單尚未出貨。`
      : "所有訂單皆已安排出貨。",
    dashboard.todayDeliveries.length > 0
      ? `今天已有 ${dashboard.todayDeliveries.length} 筆訂單出貨。`
      : "今天尚無出貨紀錄。",
    `本月已收金額 ${money(dashboard.monthPaidAmount)}，共 ${orders.length} 筆訂單在系統中。`,
  ]

  const recentOrders = useMemo(() => orders.slice(0, 5), [orders])

  const paymentColors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ]

  return (
    <main className="min-h-screen bg-muted/50">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-background p-5 lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-y-auto">
          <div className="mb-6 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Home />
            </div>
            <h2 className="text-lg font-semibold">堯順儀表板</h2>
          </div>

          <Button
            type="button"
            size="sm"
            className="mb-5 w-full"
            onClick={() => setActiveView("entry")}
          >
            <Plus data-icon="inline-start" />
            新增訂單
          </Button>

          <nav className="flex flex-col gap-1">
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                    activeView === item.key && "bg-primary/10 text-primary",
                  )}
                  onClick={() => setActiveView(item.key)}
                >
                  <span className="flex items-center gap-2">
                    <Icon />
                    {item.label}
                  </span>
                  {item.key === "operations" && dashboard.actionRequiredCount > 0 ? (
                    <Badge variant="secondary">{dashboard.actionRequiredCount}</Badge>
                  ) : null}
                </button>
              )
            })}
          </nav>

          <Separator className="my-5" />

          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">本月收入</span>
              <span className="font-semibold tabular-nums">{money(dashboard.monthPaidAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">總未收</span>
              <span className="font-semibold tabular-nums">{money(dashboard.totalUnpaidAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">待出貨</span>
              <span className="font-semibold tabular-nums">{dashboard.pendingShipmentsCount} 筆</span>
            </div>
          </div>

          <SidebarUserFooter onOpenSettings={() => setSettingsOpen(true)} />
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">堯順工程行智慧儀表板</h1>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <RefreshCw />
                  最後更新 {formatDateTime(lastUpdated)}（Firestore 即時同步）
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {seedEnabled ? (
                  orders.length === 0 && products.length === 0 && users.length === 0 ? (
                    <Button type="button" variant="default" size="sm" onClick={handleSeed} disabled={busy}>
                      <Database data-icon="inline-start" />
                      寫入範例資料
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={handleSeed} disabled={busy}>
                        <RefreshCw data-icon="inline-start" />
                        補充範例
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={handleClearSeed} disabled={busy}>
                        <Trash2 data-icon="inline-start" />
                        清除範例
                      </Button>
                    </>
                  )
                ) : null}
              </div>
            </header>

            {loadError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Firestore 連線錯誤：{loadError}
              </div>
            ) : null}

            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
              {navigationItems.map((item) => {
                const Icon = item.icon
                return (
                  <Button
                    key={item.key}
                    type="button"
                    size="sm"
                    variant={activeView === item.key ? "default" : "outline"}
                    onClick={() => setActiveView(item.key)}
                    className="shrink-0"
                  >
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </Button>
                )
              })}
            </nav>

            {activeView === "overview" ? (
              <OverviewView
                kpiItems={kpiItems}
                dashboard={dashboard}
                orders={orders}
                recentOrders={recentOrders}
                reminders={reminders}
                today={todayDate}
                onEdit={editOrder}
                onDelete={removeOrder}
                onSelectCustomer={openCustomerHistory}
                paymentColors={paymentColors}
              />
            ) : null}

            {activeView === "entry" ? (
              <EntryView
                editingId={editingId}
                form={form}
                setField={setField}
                updateItem={updateItem}
                addItemRow={addItemRow}
                removeItemRow={removeItemRow}
                submitOrder={submitOrder}
                resetForm={resetForm}
                customers={customers}
                customerSuggestions={customerSuggestions}
                driverLabelOptions={driverLabelSuggestions}
                products={activeProducts}
                busy={busy}
                flash={entryFlash}
                onDismissFlash={() => setEntryFlash(null)}
              />
            ) : null}

            {activeView === "operations" ? (
              <OperationsView
                actionRequiredOrders={dashboard.actionRequiredOrders}
                today={todayDate}
                onEdit={editOrder}
                onDelete={removeOrder}
                onConfirmPayment={(order) => setConfirmTarget(order)}
                onMarkDelivered={(order) => setDeliveryTarget(order)}
                onResetDelivery={undoDelivery}
                onSelectCustomer={openCustomerHistory}
              />
            ) : null}

            {activeView === "customers" ? (
              <CustomersView
                orders={orders}
                users={users}
                today={todayDate}
                onSelectCustomer={openCustomerHistory}
              />
            ) : null}

            {activeView === "insights" ? (
              <InsightsView
                orders={orders}
                products={products}
                users={users}
                dashboard={dashboard}
                paymentColors={paymentColors}
                today={todayDate}
                onSelectCustomer={openCustomerHistory}
                onNavigate={(view) => setActiveView(coerceViewKey(view))}
              />
            ) : null}
          </div>
        </section>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConfirmPaymentDialog
        order={confirmTarget}
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null)
        }}
        onConfirm={confirmPayment}
        busy={busy}
      />
      <ConfirmDeliveryDialog
        order={deliveryTarget}
        open={deliveryTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeliveryTarget(null)
        }}
        onConfirm={markDelivered}
        suggestions={driverLabelSuggestions}
        busy={busy}
      />
      <CustomerHistoryDialog
        customerName={historyCustomer}
        orders={orders}
        today={todayDate}
        open={historyCustomer !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryCustomer(null)
        }}
        onEdit={(order) => {
          setHistoryCustomer(null)
          editOrder(order)
        }}
        onConfirmPayment={(order) => {
          setHistoryCustomer(null)
          setConfirmTarget(order)
        }}
        onMarkDelivered={(order) => {
          setHistoryCustomer(null)
          setDeliveryTarget(order)
        }}
        onResetDelivery={undoDelivery}
        onDelete={removeOrder}
      />
    </main>
  )
}

function SidebarUserFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { prefs } = usePreferences()
  const profile = prefs.profile
  const initial = profile.displayName.trim().charAt(0).toUpperCase() || "?"

  const avatarTone =
    profile.role === "boss"
      ? "bg-primary text-primary-foreground"
      : "bg-chart-1/80 text-foreground"

  return (
    <div className="mt-auto flex items-center gap-2 border-t pt-3">
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted"
        aria-label="開啟個人設定"
      >
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            avatarTone,
          )}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{profile.displayName}</div>
          <div className="truncate text-xs text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
        </div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onOpenSettings}
        aria-label="開啟設定"
      >
        <Settings />
      </Button>
    </div>
  )
}

function SetupNotice() {
  return (
    <main className="min-h-screen bg-muted/50">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold">尚未設定 Firebase</h1>
        <p className="text-muted-foreground">
          請在專案根目錄複製 <code className="rounded bg-muted px-1">.env.example</code> 為{" "}
          <code className="rounded bg-muted px-1">.env.local</code>，填入 Firebase 控制台 → 專案設定 → 你的應用程式 (Web) 中的設定值，並重新啟動開發伺服器。
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-background p-4 text-xs leading-6">
{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=xxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=xxx
VITE_FIREBASE_STORAGE_BUCKET=xxx.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...:web:...`}
        </pre>
        <p className="text-sm text-muted-foreground">
          首次啟動後，可在儀表板上方點「寫入範例資料」按鈕，將範例 Users / Products / Orders 寫入 Firestore，方便驗收。
        </p>
      </div>
    </main>
  )
}

function KpiCard({ item }: { item: KpiItem }) {
  const Icon = item.icon
  const isDanger = item.accent === "danger"
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
        <CardAction>
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              isDanger ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
            )}
          >
            <Icon />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold tabular-nums", isDanger && "text-destructive")}>
          {item.value}
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ children, tone }: { children: string; tone: "default" | "muted" | "danger" | "warning" }) {
  if (tone === "warning") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
      >
        <Clock className="size-3" />
        {children}
      </Badge>
    )
  }
  const variant = tone === "danger" ? "destructive" : tone === "muted" ? "secondary" : "outline"
  return <Badge variant={variant}>{children}</Badge>
}

function PaymentStatusBadge({ status }: { status: OrderPaymentStatus }) {
  if (status === "pending_confirmation") {
    return <StatusBadge tone="warning">{paymentStatusLabel.pending_confirmation}</StatusBadge>
  }
  if (status === "paid") {
    return <StatusBadge tone="default">{paymentStatusLabel.paid}</StatusBadge>
  }
  return <StatusBadge tone="muted">{paymentStatusLabel.unpaid}</StatusBadge>
}

function stateTone(state: DerivedOrderState): "default" | "muted" | "danger" | "warning" {
  if (state === "已完成") return "default"
  if (state === "待收款") return "muted"
  return "danger"
}

function ConfirmDeliveryDialog({
  order,
  open,
  onOpenChange,
  onConfirm,
  suggestions,
  busy,
}: {
  order: OrderDoc | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (orderId: string, driverLabel: string | null) => Promise<void> | void
  suggestions: string[]
  busy: boolean
}) {
  const [label, setLabel] = useState("")
  const listId = "delivery-label-suggestions"

  useEffect(() => {
    if (open) setLabel(order?.driverId ?? "")
  }, [open, order?.id, order?.driverId])

  if (!order) return null

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onConfirm(order.id, label)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>標記送達</DialogTitle>
            <DialogDescription>
              將 <span className="font-medium text-foreground">{order.customerName}</span> 的訂單標記為已送達，
              送達時間會用伺服器時間記錄。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">訂單金額</span>
              <span className="font-semibold tabular-nums">{money(order.totalAmount)}</span>
            </div>
            <Field label="送貨人員 (選填，自由輸入)">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="例如：阿明 / 車號 9527"
                list={listId}
                autoFocus
              />
              {suggestions.length > 0 ? (
                <datalist id={listId}>
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              ) : null}
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              <Truck data-icon="inline-start" />
              標記送達
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmPaymentDialog({
  order,
  open,
  onOpenChange,
  onConfirm,
  busy,
}: {
  order: OrderDoc | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (orderId: string, method: OrderPaymentMethod) => Promise<void> | void
  busy: boolean
}) {
  const [method, setMethod] = useState<OrderPaymentMethod>("cash")

  useEffect(() => {
    if (open) setMethod("cash")
  }, [open, order?.id])

  if (!order) return null

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onConfirm(order.id, method)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>確認入帳</DialogTitle>
            <DialogDescription>
              確認 <span className="font-medium text-foreground">{order.customerName}</span> 已收款後，
              系統會將狀態改為「已結清」並紀錄入帳時間。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">訂單金額</span>
              <span className="font-semibold tabular-nums">{money(order.totalAmount)}</span>
            </div>
            <Field label="付款方式">
              <Select
                value={method}
                onValueChange={(value) => {
                  if (value) setMethod(value as OrderPaymentMethod)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {paymentMethodOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              <CheckCircle2 data-icon="inline-start" />
              確認入帳
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-20 text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  )
}

function DonutChart({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: Array<{ value: number; color: string }>
  centerLabel?: string
  centerValue?: string
}) {
  const total = segments.reduce((sum, item) => sum + item.value, 0)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let cursor = 0

  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-label="付款方式比例">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--muted)" strokeWidth="14" />
        {total > 0 &&
          segments.map((segment, index) => {
            if (segment.value === 0) return null
            const length = (segment.value / total) * circumference
            const dashOffset = -cursor
            cursor += length
            return (
              <circle
                key={index}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth="14"
                strokeDasharray={`${length} ${circumference}`}
                strokeDashoffset={dashOffset}
              />
            )
          })}
      </svg>
      {centerValue ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerLabel ? <span className="text-xs text-muted-foreground">{centerLabel}</span> : null}
          <span className="text-base font-semibold tabular-nums leading-tight">{centerValue}</span>
        </div>
      ) : null}
    </div>
  )
}

type DashboardShape = {
  todayReceivableAmount: number
  todayPaidAmount: number
  todayUnpaidAmount: number
  totalUnpaidAmount: number
  monthPaidAmount: number
  pendingShipmentsCount: number
  activeOrderCount: number
  actionRequiredOrders: OrderDoc[]
  actionRequiredCount: number
  todayDeliveries: OrderDoc[]
  pendingShipments: OrderDoc[]
  unpaidOrders: OrderDoc[]
  pendingConfirmationOrders: OrderDoc[]
  outstandingOrders: OrderDoc[]
  stalestUnpaid: OrderDoc[]
  overdueByCustomer: Record<string, number>
  paymentMethodStats: Array<{ method: OrderPaymentMethod; label: string; amount: number }>
  paymentMethodTotal: number
  topOverdueCustomer: [string, number] | undefined
}

function OverviewView({
  kpiItems,
  dashboard,
  orders,
  recentOrders,
  reminders,
  today,
  onEdit,
  onDelete,
  onSelectCustomer,
  paymentColors,
}: {
  kpiItems: KpiItem[]
  dashboard: DashboardShape
  orders: OrderDoc[]
  recentOrders: OrderDoc[]
  reminders: string[]
  today: Date
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
  onSelectCustomer: (customerName: string) => void
  paymentColors: string[]
}) {
  const stateBuckets: DerivedOrderState[] = ["進行中", "待收款", "已完成"]

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiItems.map((item) => (
          <KpiCard key={item.label} item={item} />
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>近期訂單</CardTitle>
          </CardHeader>
          <CardContent>
            <CompactOrderTable
              orders={recentOrders}
              today={today}
              onEdit={onEdit}
              onDelete={onDelete}
              onSelectCustomer={onSelectCustomer}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>付款方式</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-5 sm:flex-row">
            <DonutChart
              segments={dashboard.paymentMethodStats.map((item, index) => ({
                value: item.amount,
                color: paymentColors[index] ?? "var(--muted)",
              }))}
              centerLabel="已收合計"
              centerValue={money(dashboard.paymentMethodTotal)}
            />
            <div className="flex w-full flex-col gap-2">
              {dashboard.paymentMethodStats.map((item, index) => {
                if (item.amount === 0) return null
                const percent =
                  dashboard.paymentMethodTotal > 0
                    ? Math.round((item.amount / dashboard.paymentMethodTotal) * 100)
                    : 0
                return (
                  <div key={item.method} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: paymentColors[index] }}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="tabular-nums text-muted-foreground">{money(item.amount)}</span>
                      <span className="w-10 text-right font-medium tabular-nums">{percent}%</span>
                    </span>
                  </div>
                )
              })}
              {dashboard.paymentMethodTotal === 0 ? (
                <span className="text-sm text-muted-foreground">尚無已收款訂單。</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>智慧提醒</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {reminders.slice(0, 4).map((reminder) => (
              <div key={reminder} className="flex items-start gap-2.5 text-sm leading-6">
                <Sparkles />
                <span>{reminder}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>訂單狀態</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {stateBuckets.map((state) => {
              const count = orders.filter((order) => deriveState(order) === state).length
              return (
                <div
                  key={state}
                  className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <PackageCheck />
                    {state}
                  </span>
                  <span className="font-semibold tabular-nums">{numberFormatter.format(count)}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CustomerCombobox({
  value,
  onValueChange,
  onPick,
  suggestions,
  required,
  placeholder,
}: {
  value: string
  onValueChange: (next: string) => void
  onPick: (suggestion: CustomerSuggestion) => void
  suggestions: CustomerSuggestion[]
  required?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ranked = useMemo(
    () => rankCustomers(value, suggestions).slice(0, 6),
    [value, suggestions],
  )
  const exact = useMemo(() => hasExactMatch(value, suggestions), [value, suggestions])
  const nearMatches = useMemo(
    () => nearMatchSuggestions(value, suggestions),
    [value, suggestions],
  )
  const trimmed = value.trim()
  const showDropdown = open && trimmed.length > 0 && ranked.length > 0
  // Tells the boss "you're entering a brand-new name" only when their input
  // is sufficiently long AND doesn't even fuzzy-match anything — avoids
  // flashing the "new customer" hint on every keystroke.
  const showNewHint =
    !exact && nearMatches.length === 0 && trimmed.length >= 2 && suggestions.length > 0

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so clicks on dropdown items register before the input blurs.
          window.setTimeout(() => setOpen(false), 150)
        }}
        placeholder={placeholder ?? "輸入客戶名稱，會即時搜尋既有客戶"}
        required={required}
        autoComplete="off"
      />

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border bg-popover p-1 shadow-md">
          {ranked.map((r) => (
            <button
              key={`${r.suggestion.name}::${r.suggestion.id ?? ""}`}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
              onMouseDown={(event) => {
                // mousedown → prevent default keeps the input focused so the
                // blur-close doesn't race with the click handler.
                event.preventDefault()
                onPick(r.suggestion)
                setOpen(false)
              }}
            >
              <span className="truncate">
                {r.suggestion.name}
                {r.suggestion.id ? (
                  <span className="ml-2 text-xs text-muted-foreground">{r.suggestion.id}</span>
                ) : (
                  <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                    （無 Users 文件）
                  </span>
                )}
              </span>
              {r.score >= 95 ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  相近
                </Badge>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {nearMatches.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>資料庫已有相似客戶，請點選帶入避免重複建立：</span>
          {nearMatches.map((m) => (
            <Button
              key={`${m.name}::${m.id ?? ""}`}
              type="button"
              size="xs"
              variant="outline"
              className="h-6"
              onClick={() => onPick(m)}
            >
              {m.name}
            </Button>
          ))}
        </div>
      ) : null}

      {showNewHint ? (
        <p className="mt-2 text-xs text-muted-foreground">
          資料庫沒有相似的客戶，送出後會建立成新客戶。
        </p>
      ) : null}
    </div>
  )
}

function EntryView({
  editingId,
  form,
  setField,
  updateItem,
  addItemRow,
  removeItemRow,
  submitOrder,
  resetForm,
  customers,
  customerSuggestions,
  driverLabelOptions,
  products,
  busy,
  flash,
  onDismissFlash,
}: {
  editingId: string | null
  form: OrderFormData
  setField: <K extends keyof OrderFormData>(key: K, value: OrderFormData[K]) => void
  updateItem: (index: number, patch: Partial<ItemFormRow>) => void
  addItemRow: () => void
  removeItemRow: (index: number) => void
  submitOrder: (event: React.FormEvent<HTMLFormElement>) => void
  resetForm: () => void
  customers: UserDoc[]
  customerSuggestions: CustomerSuggestion[]
  driverLabelOptions: string[]
  products: ProductDoc[]
  busy: boolean
  flash: { kind: "created" | "updated"; customerName: string } | null
  onDismissFlash: () => void
}) {
  const total = form.items.reduce((sum, row) => sum + rowSubtotal(row), 0)

  const onPickProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    updateItem(index, {
      productId,
      productName: product.productName,
      spec: product.spec,
      unitPrice: String(product.price),
    })
  }

  return (
    <Card id="order-form">
      <CardHeader>
        <CardTitle>{editingId ? "編輯訂單" : "新增訂單"}</CardTitle>
        <CardAction>
          <StatusBadge tone={editingId ? "muted" : "default"}>
            {editingId ? "編輯中" : "新增模式"}
          </StatusBadge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {flash ? (
          <button
            type="button"
            onClick={onDismissFlash}
            className="mb-4 flex w-full items-center gap-2 rounded-lg border border-chart-1/40 bg-chart-1/10 px-3 py-2 text-left text-sm transition-colors hover:bg-chart-1/15"
            aria-label="關閉提示"
            role="status"
          >
            <CheckCircle2 className="size-4 shrink-0 text-chart-1" />
            <span className="text-foreground">
              已{flash.kind === "updated" ? "更新" : "新增"}
              <span className="mx-1 font-medium">{flash.customerName}</span>
              的訂單，可以直接繼續新增下一筆。
            </span>
          </button>
        ) : null}
        <form className="flex flex-col gap-5" onSubmit={submitOrder}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="客戶名稱">
              <CustomerCombobox
                value={form.customerName}
                onValueChange={(next) => setField("customerName", next)}
                onPick={(picked) => {
                  setField("customerName", picked.name)
                  if (picked.id) setField("customerId", picked.id)
                }}
                suggestions={customerSuggestions}
                required
                placeholder="輸入名稱即時搜尋（例如：永大營造）"
              />
            </Field>
            <Field label="客戶 (LINE ID)">
              <Input
                value={form.customerId}
                onChange={(event) => setField("customerId", event.target.value)}
                placeholder="U1234567890..."
                list="customer-options"
                required
              />
              <datalist id="customer-options">
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id} label={customer.displayName} />
                ))}
              </datalist>
            </Field>
            <Field label="送貨人員 (選填)">
              <Input
                value={form.driverId}
                onChange={(event) => setField("driverId", event.target.value)}
                placeholder="例如：阿明 / 車號 9527"
                list="driver-label-options"
              />
              {driverLabelOptions.length > 0 ? (
                <datalist id="driver-label-options">
                  {driverLabelOptions.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              ) : null}
            </Field>
            <Field label="訂單日期">
              <Input
                type="date"
                value={form.orderDate}
                onChange={(event) => setField("orderDate", event.target.value)}
                required
              />
            </Field>
            <Field label="出貨日期 (留空＝尚未出貨)">
              <Input
                type="date"
                value={form.deliveryDate}
                onChange={(event) => setField("deliveryDate", event.target.value)}
              />
            </Field>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>訂單品項</Label>
              <Button type="button" size="sm" variant="outline" onClick={addItemRow}>
                <Plus data-icon="inline-start" />
                新增品項
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              {form.items.map((row, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-lg border bg-muted/30 p-3 md:grid-cols-[1.4fr_1fr_0.6fr_0.8fr_auto] md:items-end"
                >
                  <Field label={`品項 ${index + 1}`}>
                    <div className="flex gap-2">
                      <Input
                        value={row.productName}
                        onChange={(event) => updateItem(index, { productName: event.target.value })}
                        placeholder="例如：水泥"
                        required={index === 0}
                      />
                      {products.length > 0 ? (
                        <Select
                          value={row.productId || "manual"}
                          onValueChange={(value) => {
                            if (!value || value === "manual") {
                              updateItem(index, { productId: "" })
                            } else {
                              onPickProduct(index, value)
                            }
                          }}
                        >
                          <SelectTrigger className="w-32 shrink-0">
                            <SelectValue placeholder="選單" />
                          </SelectTrigger>
                          {/* Override the auto-anchor width so the dropdown is
                              wide enough to show 「商品·規格」 without truncation. */}
                          <SelectContent
                            alignItemWithTrigger={false}
                            className="w-[min(22rem,calc(100vw-2rem))]"
                          >
                            <SelectGroup>
                              <SelectItem value="manual">自訂</SelectItem>
                              {products.map((product) => {
                                // Many products share a name and differ only by
                                // spec (e.g. 「水泥」 vs 「水泥 (40kg)」). Showing
                                // the spec inline disambiguates the dropdown so
                                // the boss doesn't pick the wrong SKU.
                                const label = product.spec
                                  ? `${product.productName}・${product.spec}`
                                  : product.productName
                                return (
                                  <SelectItem key={product.id} value={product.id}>
                                    {label}
                                  </SelectItem>
                                )
                              })}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  </Field>
                  <Field label="規格">
                    <Input
                      value={row.spec}
                      onChange={(event) => updateItem(index, { spec: event.target.value })}
                      placeholder="例如：特級 10kg 箱裝"
                    />
                  </Field>
                  <Field label="數量">
                    <Input
                      type="number"
                      min="0"
                      value={row.quantity}
                      onChange={(event) => updateItem(index, { quantity: event.target.value })}
                    />
                  </Field>
                  <Field label="單價">
                    <Input
                      type="number"
                      min="0"
                      value={row.unitPrice}
                      onChange={(event) => updateItem(index, { unitPrice: event.target.value })}
                      placeholder="0"
                    />
                  </Field>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-sm font-semibold tabular-nums">{money(rowSubtotal(row))}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeItemRow(index)}
                      disabled={form.items.length <= 1}
                      aria-label="刪除品項"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-muted-foreground">合計</span>
              <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="收款狀態">
              <Select
                value={form.paymentStatus}
                onValueChange={(value) => {
                  if (value) setField("paymentStatus", value as OrderPaymentStatus)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="unpaid">未收款</SelectItem>
                    <SelectItem value="pending_confirmation">待老闆確認</SelectItem>
                    <SelectItem value="paid">已結清</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="付款方式 (僅在已結清時)">
              <Select
                value={form.paymentMethod || "none"}
                onValueChange={(value) =>
                  setField(
                    "paymentMethod",
                    value && value !== "none" ? (value as OrderPaymentMethod) : "",
                  )
                }
                disabled={form.paymentStatus !== "paid"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="未指定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">未指定</SelectItem>
                    {paymentMethodOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={busy}>
                取消編輯
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {editingId ? <Save data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {editingId ? "更新訂單" : "新增訂單"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

type AggregatedItem = {
  productName: string
  spec: string
  totalQuantity: number
  orderCount: number
  customers: string[]
}

function aggregatePendingItems(orders: OrderDoc[]): AggregatedItem[] {
  const map = new Map<
    string,
    {
      productName: string
      spec: string
      totalQuantity: number
      orderIds: Set<string>
      customers: Set<string>
    }
  >()

  for (const order of orders) {
    for (const item of order.items) {
      const key = `${item.productName}||${item.spec}`
      const existing = map.get(key) ?? {
        productName: item.productName,
        spec: item.spec,
        totalQuantity: 0,
        orderIds: new Set<string>(),
        customers: new Set<string>(),
      }
      existing.totalQuantity += item.quantity
      existing.orderIds.add(order.id)
      existing.customers.add(order.customerName)
      map.set(key, existing)
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      productName: entry.productName,
      spec: entry.spec,
      totalQuantity: entry.totalQuantity,
      orderCount: entry.orderIds.size,
      customers: Array.from(entry.customers),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
}

type OperationsStatus =
  | "all"
  | "shipping"
  | "collecting"
  | "confirming"
  | "overdue"

type DriverFilter = string // "all" | "unassigned" | <driverId>

function OperationsView({
  actionRequiredOrders,
  today,
  onEdit,
  onDelete,
  onConfirmPayment,
  onMarkDelivered,
  onResetDelivery,
  onSelectCustomer,
}: {
  actionRequiredOrders: OrderDoc[]
  today: Date
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
  onConfirmPayment: (order: OrderDoc) => void
  onMarkDelivered: (order: OrderDoc) => void
  onResetDelivery: (id: string) => void
  onSelectCustomer: (name: string) => void
}) {
  const [statusFilter, setStatusFilter] = useState<OperationsStatus>("all")
  const [driverFilter, setDriverFilter] = useState<DriverFilter>("all")
  const [showBackorder, setShowBackorder] = useState(false)

  const driverName = (driverId: string | null) => deliveryPersonLabel(driverId)
  const paymentMethodLabel = (method: OrderPaymentMethod | null) =>
    paymentMethodOptions.find((opt) => opt.value === method)?.label ?? ""

  const driverOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of actionRequiredOrders) {
      if (o.driverId && o.driverId.trim()) set.add(o.driverId.trim())
    }
    return Array.from(set).sort()
  }, [actionRequiredOrders])

  // Counts feed the chip badges. Recomputed alongside the underlying list so
  // the chip totals always agree with what the filter would produce.
  const counts = useMemo(() => {
    let shipping = 0
    let collecting = 0
    let confirming = 0
    let overdue = 0
    for (const order of actionRequiredOrders) {
      if (!order.deliveryDate) shipping += 1
      if (order.paymentStatus === "unpaid") collecting += 1
      if (order.paymentStatus === "pending_confirmation") confirming += 1
      if (
        order.paymentStatus !== "paid" &&
        daysBetween(today, order.orderDate) >= 7
      ) {
        overdue += 1
      }
    }
    return {
      total: actionRequiredOrders.length,
      shipping,
      collecting,
      confirming,
      overdue,
    }
  }, [actionRequiredOrders, today])

  const pendingShipments = useMemo(
    () => actionRequiredOrders.filter((o) => !o.deliveryDate),
    [actionRequiredOrders],
  )
  const aggregated = useMemo(
    () => aggregatePendingItems(pendingShipments),
    [pendingShipments],
  )

  const filteredOrders = useMemo(() => {
    const matchStatus = (order: OrderDoc) => {
      switch (statusFilter) {
        case "shipping":
          return !order.deliveryDate
        case "collecting":
          return order.paymentStatus === "unpaid"
        case "confirming":
          return order.paymentStatus === "pending_confirmation"
        case "overdue":
          return (
            order.paymentStatus !== "paid" &&
            daysBetween(today, order.orderDate) >= 7
          )
        default:
          return true
      }
    }
    const matchDriver = (order: OrderDoc) => {
      if (driverFilter === "all") return true
      if (driverFilter === "unassigned") return !order.driverId || !order.driverId.trim()
      return (order.driverId ?? "").trim() === driverFilter
    }
    return actionRequiredOrders.filter((order) => matchStatus(order) && matchDriver(order))
  }, [actionRequiredOrders, statusFilter, driverFilter, today])

  // FIFO so the oldest pending order surfaces first; mirrors the previous
  // 出貨 view's expectation that aging orders rise to the top.
  const sortedOrders = useMemo(
    () => [...filteredOrders].sort((a, b) => a.orderDate.getTime() - b.orderDate.getTime()),
    [filteredOrders],
  )

  const exportColumns: ExportColumn<OrderDoc>[] = [
    { key: "customer", label: "客戶", getValue: (o) => o.customerName },
    { key: "items", label: "訂單品項", getValue: (o) => summarizeItems(o.items) },
    { key: "amount", label: "訂單金額", getValue: (o) => o.totalAmount },
    { key: "orderDate", label: "下單日", getValue: (o) => o.orderDate },
    { key: "driver", label: "送貨人員", getValue: (o) => driverName(o.driverId) },
    {
      key: "deliveryStatus",
      label: "出貨狀態",
      getValue: (o) => (o.deliveryDate ? "已出貨" : "未出貨"),
    },
    {
      key: "paymentStatus",
      label: "收款",
      getValue: (o) => o.paymentStatus,
      formatText: (o) => paymentStatusLabel[o.paymentStatus],
    },
    {
      key: "paymentMethod",
      label: "付款方式",
      getValue: (o) => paymentMethodLabel(o.paymentMethod),
      defaultSelected: false,
    },
    {
      key: "waited",
      label: "等候天數",
      getValue: (o) => daysBetween(today, o.orderDate),
      defaultSelected: false,
    },
  ]

  const chips: Array<{
    key: OperationsStatus
    label: string
    count: number
    tone?: "danger"
  }> = [
    { key: "all", label: "全部待辦", count: counts.total },
    { key: "shipping", label: "待出貨", count: counts.shipping },
    { key: "collecting", label: "待收款", count: counts.collecting },
    { key: "confirming", label: "待確認入帳", count: counts.confirming },
    { key: "overdue", label: "久未收 ≥7天", count: counts.overdue, tone: "danger" },
  ]

  const summaryStats: ReadonlyArray<{
    label: string
    value: string
    icon: typeof Coins
    accent?: "danger"
  }> = [
    { label: "需處理訂單", value: `${counts.total} 筆`, icon: ClipboardList },
    { label: "待出貨", value: `${counts.shipping} 筆`, icon: Truck },
    { label: "待收款", value: `${counts.collecting} 筆`, icon: CreditCard },
    {
      label: "久未收 ≥7天",
      value: `${counts.overdue} 筆`,
      icon: AlertTriangle,
      accent: counts.overdue > 0 ? "danger" : undefined,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaryStats.map((stat) => (
          <KpiCard key={stat.label} item={stat} />
        ))}
      </section>

      {pendingShipments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package />
              待備商品總覽
            </CardTitle>
            <CardAction>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {pendingShipments.length} 筆待出貨 · {aggregated.length} 樣商品
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBackorder((prev) => !prev)}
                >
                  {showBackorder ? "收合" : "展開"}
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          {showBackorder ? (
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {aggregated.map((item) => (
                  <div
                    key={`${item.productName}-${item.spec}`}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium leading-tight">
                          {item.productName}
                        </div>
                        {item.spec ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {item.spec}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Package className="size-4" />
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold tabular-nums leading-none">
                        {numberFormatter.format(item.totalQuantity)}
                      </span>
                      <span className="text-xs text-muted-foreground">件 / 套</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.orderCount} 筆訂單 ·{" "}
                      {item.customers.slice(0, 2).join("、")}
                      {item.customers.length > 2
                        ? ` 等 ${item.customers.length} 位`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>訂單作業</CardTitle>
          <CardAction>
            <span className="text-xs text-muted-foreground">FIFO，最舊優先</span>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Button
                  key={chip.key}
                  type="button"
                  size="sm"
                  variant={statusFilter === chip.key ? "default" : "outline"}
                  onClick={() => setStatusFilter(chip.key)}
                  className={cn(
                    chip.tone === "danger" &&
                      statusFilter !== chip.key &&
                      "border-destructive/40 text-destructive",
                  )}
                >
                  {chip.label}
                  <Badge variant="secondary" className="ml-1.5">
                    {chip.count}
                  </Badge>
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Label className="text-xs text-muted-foreground">送貨人員</Label>
              <Select
                value={driverFilter}
                onValueChange={(value) => {
                  if (value) setDriverFilter(value)
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="unassigned">未指派</SelectItem>
                    {driverOptions.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ExportBar
            rows={sortedOrders}
            columns={exportColumns}
            filename="訂單作業"
            title="訂單作業"
          />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">客戶</TableHead>
                <TableHead>訂單品項</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>下單 / 等候</TableHead>
                <TableHead>出貨</TableHead>
                <TableHead>收款</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOrders.length === 0 ? (
                <EmptyRow colSpan={7} text="目前沒有符合條件的訂單。" />
              ) : (
                sortedOrders.map((order) => {
                  const waited = daysBetween(today, order.orderDate)
                  const urgent =
                    order.paymentStatus !== "paid" && waited >= 7
                  return (
                    <TableRow key={order.id} className="align-top">
                      <TableCell className="py-3 font-medium">
                        <CustomerNameButton
                          name={order.customerName}
                          onSelect={onSelectCustomer}
                        />
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-1">
                          {order.items.length === 0 ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            order.items.map((item, index) => (
                              <div
                                key={`${order.id}-${index}`}
                                className="flex items-center gap-2 text-sm"
                              >
                                <span className="font-medium">{item.productName}</span>
                                {item.spec ? (
                                  <span className="text-xs text-muted-foreground">
                                    {item.spec}
                                  </span>
                                ) : null}
                                <span className="ml-auto whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                                  × {item.quantity}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-right font-medium tabular-nums">
                        {money(order.totalAmount)}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-0.5">
                          <span>{formatDate(order.orderDate)}</span>
                          <span
                            className={cn(
                              "text-xs",
                              urgent
                                ? "font-medium text-destructive"
                                : "text-muted-foreground",
                            )}
                          >
                            {waited === 0 ? "今日" : `已等 ${waited} 天`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        {order.deliveryDate ? (
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge tone="default">已送達</StatusBadge>
                            <span className="text-xs text-muted-foreground">
                              {driverName(order.driverId)} ·{" "}
                              {formatDate(order.deliveryDate)}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge tone="warning">待出貨</StatusBadge>
                            <span className="text-xs text-muted-foreground">
                              {driverName(order.driverId)}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </TableCell>
                      <TableCell className="py-3">
                        <RowActions
                          order={order}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onConfirmPayment={
                            order.paymentStatus === "pending_confirmation"
                              ? () => onConfirmPayment(order)
                              : undefined
                          }
                          onMarkDelivered={
                            order.deliveryDate
                              ? undefined
                              : () => onMarkDelivered(order)
                          }
                          onResetDelivery={
                            order.deliveryDate
                              ? () => onResetDelivery(order.id)
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

type CustomerStat = {
  name: string
  customerId: string | null
  orderCount: number
  paidAmount: number
  outstandingAmount: number
  lastOrder: Date | null
  hasOpenAction: boolean
}

function normalizeCustomerKey(name: string) {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, "")
}

function buildCustomerStats(orders: OrderDoc[], customers: UserDoc[]): CustomerStat[] {
  const map = new Map<string, CustomerStat>()
  // Seed with Users docs first so customers with zero orders still appear in
  // the directory. Orders then upsert / enrich each entry.
  for (const u of customers) {
    const key = normalizeCustomerKey(u.displayName)
    if (!key) continue
    map.set(key, {
      name: u.displayName,
      customerId: u.id,
      orderCount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      lastOrder: null,
      hasOpenAction: false,
    })
  }
  for (const o of orders) {
    const name = o.customerName.trim()
    if (!name) continue
    const key = normalizeCustomerKey(name)
    const existing = map.get(key) ?? {
      name,
      customerId: o.customerId || null,
      orderCount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      lastOrder: null,
      hasOpenAction: false,
    }
    if (!existing.customerId && o.customerId) existing.customerId = o.customerId
    existing.orderCount += 1
    if (o.paymentStatus === "paid") existing.paidAmount += o.totalAmount
    else existing.outstandingAmount += o.totalAmount
    if (o.paymentStatus !== "paid" || !o.deliveryDate) existing.hasOpenAction = true
    if (!existing.lastOrder || o.orderDate > existing.lastOrder) {
      existing.lastOrder = o.orderDate
    }
    map.set(key, existing)
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.outstandingAmount !== a.outstandingAmount) {
      return b.outstandingAmount - a.outstandingAmount
    }
    if (b.paidAmount !== a.paidAmount) return b.paidAmount - a.paidAmount
    return a.name.localeCompare(b.name, "zh-Hant")
  })
}

function CustomersView({
  orders,
  users,
  today,
  onSelectCustomer,
}: {
  orders: OrderDoc[]
  users: UserDoc[]
  today: Date
  onSelectCustomer: (name: string) => void
}) {
  const customerUsers = useMemo(
    () => users.filter((u) => u.role === "customer"),
    [users],
  )
  const stats = useMemo(
    () => buildCustomerStats(orders, customerUsers),
    [orders, customerUsers],
  )
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase()
    if (!q) return stats
    return stats.filter((s) => s.name.toLocaleLowerCase().includes(q))
  }, [stats, search])

  const totalCustomers = stats.length
  const withOutstanding = stats.filter((s) => s.outstandingAmount > 0).length
  const totalOutstanding = stats.reduce(
    (sum, s) => sum + s.outstandingAmount,
    0,
  )

  const exportColumns: ExportColumn<CustomerStat>[] = [
    { key: "name", label: "客戶名稱", getValue: (s) => s.name },
    { key: "orderCount", label: "訂單筆數", getValue: (s) => s.orderCount },
    { key: "paidAmount", label: "累積已收", getValue: (s) => s.paidAmount },
    {
      key: "outstandingAmount",
      label: "目前未收",
      getValue: (s) => s.outstandingAmount,
    },
    {
      key: "lastOrder",
      label: "最近訂單",
      getValue: (s) => s.lastOrder,
    },
  ]

  const kpis: KpiItem[] = [
    {
      label: "總客戶數",
      value: `${numberFormatter.format(totalCustomers)} 位`,
      icon: Users,
    },
    {
      label: "有未收客戶",
      value: `${withOutstanding} 位`,
      icon: AlertTriangle,
      accent: withOutstanding > 0 ? "danger" : undefined,
    },
    {
      label: "客戶累計未收",
      value: money(totalOutstanding),
      icon: CreditCard,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 sm:grid-cols-3">
        {kpis.map((item) => (
          <KpiCard key={item.label} item={item} />
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>客戶名冊</CardTitle>
          <CardAction>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜尋客戶名稱"
                className="pl-8"
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ExportBar
            rows={filtered}
            columns={exportColumns}
            filename="客戶名冊"
            title="客戶名冊"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客戶</TableHead>
                <TableHead className="text-right">訂單筆數</TableHead>
                <TableHead className="text-right">累積已收</TableHead>
                <TableHead className="text-right">目前未收</TableHead>
                <TableHead>最近訂單</TableHead>
                <TableHead className="text-right">歷史</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={6} text="沒有符合的客戶。" />
              ) : (
                filtered.map((s) => {
                  const lastLabel = s.lastOrder
                    ? isSameDay(s.lastOrder, today)
                      ? "今日"
                      : formatDate(s.lastOrder)
                    : "—"
                  return (
                    <TableRow key={`${s.name}-${s.customerId ?? ""}`}>
                      <TableCell className="font-medium">
                        <CustomerNameButton
                          name={s.name}
                          onSelect={onSelectCustomer}
                        />
                        {s.hasOpenAction ? (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            進行中
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numberFormatter.format(s.orderCount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {money(s.paidAmount)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          s.outstandingAmount > 0 && "text-destructive",
                        )}
                      >
                        {money(s.outstandingAmount)}
                      </TableCell>
                      <TableCell>{lastLabel}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onSelectCustomer(s.name)}
                        >
                          <Search data-icon="inline-start" />
                          查看歷史
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function InsightsView({
  orders,
  products,
  users,
  dashboard,
  paymentColors,
  today,
  onSelectCustomer,
  onNavigate,
}: {
  orders: OrderDoc[]
  products: ProductDoc[]
  users: UserDoc[]
  dashboard: DashboardShape
  paymentColors: string[]
  today: Date
  onSelectCustomer: (name: string) => void
  onNavigate: (view: string) => void
}) {
  const stateBuckets: DerivedOrderState[] = ["進行中", "待收款", "已完成"]

  const topOverdueCustomers = useMemo(() => {
    const entries: Array<{ name: string; amount: number }> = []
    for (const [name, amount] of Object.entries(dashboard.overdueByCustomer)) {
      entries.push({ name, amount })
    }
    return entries.sort((a, b) => b.amount - a.amount).slice(0, 5)
  }, [dashboard.overdueByCustomer])

  return (
    <div className="flex flex-col gap-5">
      <AIAdvisorPanel
        orders={orders}
        products={products}
        users={users}
        today={today}
        onNavigate={(view) => onNavigate(view)}
      />

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>付款方式分析（已結清）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {dashboard.paymentMethodStats.map((item, index) => {
              const percent =
                dashboard.paymentMethodTotal > 0
                  ? Math.round(
                      (item.amount / dashboard.paymentMethodTotal) * 100,
                    )
                  : 0
              return (
                <div key={item.method} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: paymentColors[index] }}
                      />
                      {item.label}
                    </span>
                    <span className="font-medium tabular-nums">
                      {money(item.amount)}
                    </span>
                  </div>
                  <Progress value={percent}>
                    <ProgressTrack>
                      <ProgressIndicator
                        style={{ backgroundColor: paymentColors[index] }}
                      />
                    </ProgressTrack>
                  </Progress>
                </div>
              )
            })}
            {dashboard.paymentMethodTotal === 0 ? (
              <span className="text-sm text-muted-foreground">
                尚無已結清訂單可供分析。
              </span>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>訂單狀態總覽</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {stateBuckets.map((state) => {
              const count = orders.filter(
                (order) => deriveState(order) === state,
              ).length
              return (
                <div
                  key={state}
                  className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <PackageCheck />
                    {state}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {numberFormatter.format(count)}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>久未收款明細 (≥ 7 天)</CardTitle>
            <CardAction>
              <Badge variant="secondary">
                {dashboard.stalestUnpaid.length} 筆
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客戶名稱</TableHead>
                  <TableHead>品項</TableHead>
                  <TableHead className="text-right">未收金額</TableHead>
                  <TableHead>距今</TableHead>
                  <TableHead>狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.stalestUnpaid.length === 0 ? (
                  <EmptyRow colSpan={5} text="目前沒有久未收款訂單。" />
                ) : (
                  dashboard.stalestUnpaid.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        <CustomerNameButton
                          name={order.customerName}
                          onSelect={onSelectCustomer}
                        />
                      </TableCell>
                      <TableCell>{summarizeItems(order.items)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(order.totalAmount)}
                      </TableCell>
                      <TableCell>
                        {daysBetween(today, order.orderDate)} 天
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle />
              累積未收排行
            </CardTitle>
            <CardAction>
              <Badge variant="secondary">前 {topOverdueCustomers.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {topOverdueCustomers.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                目前沒有累積未收的客戶。
              </span>
            ) : (
              topOverdueCustomers.map((row, index) => {
                const max = topOverdueCustomers[0].amount || 1
                const percent = Math.round((row.amount / max) * 100)
                return (
                  <div key={row.name} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left font-medium underline-offset-4 hover:underline"
                        onClick={() => onSelectCustomer(row.name)}
                      >
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                          {index + 1}
                        </span>
                        {row.name}
                      </button>
                      <span className="font-medium tabular-nums">
                        {money(row.amount)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-destructive/70"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CustomerHistoryDialog({
  customerName,
  orders,
  today,
  open,
  onOpenChange,
  onEdit,
  onConfirmPayment,
  onMarkDelivered,
  onResetDelivery,
  onDelete,
}: {
  customerName: string | null
  orders: OrderDoc[]
  today: Date
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (order: OrderDoc) => void
  onConfirmPayment: (order: OrderDoc) => void
  onMarkDelivered: (order: OrderDoc) => void
  onResetDelivery: (id: string) => void
  onDelete: (id: string) => void
}) {
  const customerOrders = useMemo(() => {
    if (!customerName) return [] as OrderDoc[]
    const key = normalizeCustomerKey(customerName)
    return orders
      .filter((o) => normalizeCustomerKey(o.customerName) === key)
      .sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime())
  }, [orders, customerName])

  const summary = useMemo(() => {
    let totalAmount = 0
    let paidAmount = 0
    let outstandingAmount = 0
    let firstOrder: Date | null = null
    let lastOrder: Date | null = null
    for (const o of customerOrders) {
      totalAmount += o.totalAmount
      if (o.paymentStatus === "paid") paidAmount += o.totalAmount
      else outstandingAmount += o.totalAmount
      if (!firstOrder || o.orderDate < firstOrder) firstOrder = o.orderDate
      if (!lastOrder || o.orderDate > lastOrder) lastOrder = o.orderDate
    }
    return { totalAmount, paidAmount, outstandingAmount, firstOrder, lastOrder }
  }, [customerOrders])

  if (!customerName) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users />
            {customerName}
          </DialogTitle>
          <DialogDescription>
            共 {customerOrders.length} 筆訂單，第一筆：
            {summary.firstOrder ? formatDate(summary.firstOrder) : "—"}，最近：
            {summary.lastOrder ? formatDate(summary.lastOrder) : "—"}。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">累積營收</div>
            <div className="text-lg font-semibold tabular-nums">
              {money(summary.totalAmount)}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">已結清</div>
            <div className="text-lg font-semibold tabular-nums">
              {money(summary.paidAmount)}
            </div>
          </div>
          <div
            className={cn(
              "rounded-lg border p-3",
              summary.outstandingAmount > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "bg-muted/40",
            )}
          >
            <div className="text-xs opacity-80">目前未收</div>
            <div className="text-lg font-semibold tabular-nums">
              {money(summary.outstandingAmount)}
            </div>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>下單日</TableHead>
                <TableHead>品項</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>出貨</TableHead>
                <TableHead>收款</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerOrders.length === 0 ? (
                <EmptyRow colSpan={6} text="這位客戶還沒有訂單。" />
              ) : (
                customerOrders.map((order) => {
                  const waited = daysBetween(today, order.orderDate)
                  return (
                    <TableRow key={order.id} className="align-top">
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-0.5">
                          <span>{formatDate(order.orderDate)}</span>
                          <span className="text-xs text-muted-foreground">
                            {waited === 0 ? "今日" : `${waited} 天前`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        {summarizeItems(order.items)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-medium tabular-nums">
                        {money(order.totalAmount)}
                      </TableCell>
                      <TableCell className="py-3">
                        {order.deliveryDate ? (
                          <StatusBadge tone="default">已送達</StatusBadge>
                        ) : (
                          <StatusBadge tone="warning">待出貨</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </TableCell>
                      <TableCell className="py-3">
                        <RowActions
                          order={order}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onConfirmPayment={
                            order.paymentStatus === "pending_confirmation"
                              ? () => onConfirmPayment(order)
                              : undefined
                          }
                          onMarkDelivered={
                            order.deliveryDate
                              ? undefined
                              : () => onMarkDelivered(order)
                          }
                          onResetDelivery={
                            order.deliveryDate
                              ? () => onResetDelivery(order.id)
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function CompactOrderTable({
  orders,
  today,
  onEdit,
  onDelete,
  onSelectCustomer,
}: {
  orders: OrderDoc[]
  today: Date
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
  onSelectCustomer?: (customerName: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>客戶</TableHead>
          <TableHead>品項</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead className="text-right">金額</TableHead>
          <TableHead>下單日</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.length === 0 ? (
          <EmptyRow colSpan={6} text="目前沒有訂單。" />
        ) : (
          orders.map((order) => {
            const state = deriveState(order)
            return (
              <TableRow key={order.id}>
                <TableCell className="font-medium">
                  <CustomerNameButton
                    name={order.customerName}
                    onSelect={onSelectCustomer}
                  />
                </TableCell>
                <TableCell>{summarizeItems(order.items)}</TableCell>
                <TableCell>
                  <StatusBadge tone={stateTone(state)}>{state}</StatusBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(order.totalAmount)}</TableCell>
                <TableCell>
                  {isSameDay(order.orderDate, today) ? "今日" : formatDate(order.orderDate)}
                </TableCell>
                <TableCell>
                  <RowActions order={order} onEdit={onEdit} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

// Shared cell renderer: when a customer-history handler is wired, the name
// becomes a clickable link styled like the row text; otherwise it's plain
// inline text so the table reads the same in dialogs or export previews.
function CustomerNameButton({
  name,
  onSelect,
}: {
  name: string
  onSelect?: (name: string) => void
}) {
  if (!onSelect) return <>{name}</>
  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      className="text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
      title={`查看 ${name} 的歷史訂單`}
    >
      {name}
    </button>
  )
}

function RowActions({
  order,
  onEdit,
  onDelete,
  onConfirmPayment,
  onMarkDelivered,
  onResetDelivery,
}: {
  order: OrderDoc
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
  onConfirmPayment?: () => void
  onMarkDelivered?: () => void
  onResetDelivery?: () => void
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {onConfirmPayment ? (
        <Button type="button" size="sm" onClick={onConfirmPayment}>
          <CheckCircle2 data-icon="inline-start" />
          確認入帳
        </Button>
      ) : null}
      {onMarkDelivered ? (
        <Button type="button" size="sm" variant="outline" onClick={onMarkDelivered}>
          <Truck data-icon="inline-start" />
          標記送達
        </Button>
      ) : null}
      {onResetDelivery ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onResetDelivery}
          aria-label="重設送達"
          title="重設送達"
        >
          <Undo2 />
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEdit(order)} aria-label="編輯">
        <Pencil />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onDelete(order.id)}
        aria-label="刪除"
      >
        <Trash2 />
      </Button>
    </div>
  )
}

export default App
