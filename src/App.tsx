import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Coins,
  CreditCard,
  Database,
  FilePenLine,
  Home,
  LayoutDashboard,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Truck,
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
  createOrder,
  deleteOrder as deleteOrderDoc,
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
import { clearSampleData, seedSampleData } from "@/lib/seed"
import { cn } from "@/lib/utils"
import { ROLE_LABEL, usePreferences } from "@/hooks/usePreferences"
import { SettingsDialog } from "@/components/SettingsDialog"
import { AIAdvisorPanel } from "@/components/AIAdvisorPanel"
import { Settings } from "lucide-react"

const paymentMethodOptions: Array<{ value: OrderPaymentMethod; label: string }> = [
  { value: "cash", label: "現金" },
  { value: "transfer", label: "匯款" },
  { value: "check", label: "支票" },
]

type ViewKey = "overview" | "entry" | "payments" | "shipments" | "analytics" | "alerts"

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
  { key: "payments", label: "帳款", icon: CreditCard },
  { key: "shipments", label: "出貨", icon: Truck },
  { key: "analytics", label: "分析", icon: BarChart3 },
  { key: "alerts", label: "提醒", icon: BellRing },
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
  const drivers = useMemo(() => users.filter((u) => u.role === "driver"), [users])
  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products])

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
      if (editingId) {
        await updateOrder(editingId, {
          customerId,
          customerName,
          driverId,
          items,
          totalAmount,
          paymentStatus,
          paymentMethod,
          orderDate,
          deliveryDate,
        })
      } else {
        await createOrder({
          customerId,
          customerName,
          driverId,
          items,
          totalAmount,
          paymentStatus,
          paymentMethod,
          orderDate,
          deliveryDate,
        })
      }
      resetForm()
      setActiveView("overview")
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
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
      await deleteOrderDoc(orderId)
      if (editingId === orderId) resetForm()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSeed = async () => {
    if (!window.confirm("將寫入範例 Users / Products / Orders 至 Firestore (ID 帶 SEED_ 前綴可辨認)，確認繼續？")) return
    setBusy(true)
    try {
      await seedSampleData()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleClearSeed = async () => {
    if (!window.confirm("將刪除所有 ID 以 SEED_ 開頭的範例資料 (你手動建立的訂單不會被動到)，確認繼續？")) return
    setBusy(true)
    try {
      const result = await clearSampleData()
      window.alert(`已刪除 ${result.deleted} 筆範例資料。`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const dashboard = useMemo(() => {
    const todayDate = parseDate(today)
    const monthKey = today.slice(0, 7)

    const todayOrders = orders.filter((order) => isSameDay(order.orderDate, todayDate))
    const todayPaid = todayOrders.filter((order) => order.paymentStatus === "paid")
    const todayUnpaid = todayOrders.filter((order) => order.paymentStatus === "unpaid")

    const unpaidOrders = orders.filter((order) => order.paymentStatus === "unpaid")
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

    const stalestUnpaid = unpaidOrders
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

    return {
      todayReceivableAmount: sum(todayOrders),
      todayPaidAmount: sum(todayPaid),
      todayUnpaidAmount: sum(todayUnpaid),
      totalUnpaidAmount: sum(unpaidOrders),
      monthPaidAmount: sum(monthPaidOrders),
      pendingShipmentsCount: pendingShipments.length,
      activeOrderCount: orders.filter((order) => order.paymentStatus !== "paid" || !order.deliveryDate).length,
      todayDeliveries,
      pendingShipments,
      unpaidOrders,
      stalestUnpaid: stalestUnpaid.map((item) => item.order),
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
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-background p-5 lg:flex">
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
                  {item.key === "payments" && dashboard.unpaidOrders.length > 0 ? (
                    <Badge variant="secondary">{dashboard.unpaidOrders.length}</Badge>
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
                {orders.length === 0 && products.length === 0 && users.length === 0 ? (
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
                )}
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
                drivers={drivers}
                products={activeProducts}
                busy={busy}
              />
            ) : null}

            {activeView === "payments" ? (
              <PaymentsView
                unpaidOrders={dashboard.unpaidOrders}
                today={todayDate}
                onEdit={editOrder}
                onDelete={removeOrder}
              />
            ) : null}

            {activeView === "shipments" ? (
              <ShipmentsView
                pendingShipments={dashboard.pendingShipments}
                drivers={drivers}
                onEdit={editOrder}
                onDelete={removeOrder}
              />
            ) : null}

            {activeView === "analytics" ? (
              <AnalyticsView
                orders={orders}
                dashboard={dashboard}
                paymentColors={paymentColors}
              />
            ) : null}

            {activeView === "alerts" ? (
              <AlertsView
                stalestUnpaid={dashboard.stalestUnpaid}
                today={todayDate}
                orders={orders}
                products={products}
                users={users}
                onNavigate={(view) => setActiveView(view as ViewKey)}
              />
            ) : null}
          </div>
        </section>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
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
      : profile.role === "driver"
        ? "bg-chart-2/80 text-foreground"
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

function StatusBadge({ children, tone }: { children: string; tone: "default" | "muted" | "danger" }) {
  const variant = tone === "danger" ? "destructive" : tone === "muted" ? "secondary" : "outline"
  return <Badge variant={variant}>{children}</Badge>
}

function stateTone(state: DerivedOrderState) {
  if (state === "已完成") return "default" as const
  if (state === "待收款") return "muted" as const
  return "danger" as const
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
  todayDeliveries: OrderDoc[]
  pendingShipments: OrderDoc[]
  unpaidOrders: OrderDoc[]
  stalestUnpaid: OrderDoc[]
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
            <CompactOrderTable orders={recentOrders} today={today} onEdit={onEdit} onDelete={onDelete} />
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
  drivers,
  products,
  busy,
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
  drivers: UserDoc[]
  products: ProductDoc[]
  busy: boolean
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

  const onPickCustomer = (customerId: string | null) => {
    if (!customerId) return
    const customer = customers.find((u) => u.id === customerId)
    if (!customer) return
    setField("customerId", customer.id)
    setField("customerName", customer.displayName)
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
        <form className="flex flex-col gap-5" onSubmit={submitOrder}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
            <Field label="客戶名稱">
              <Input
                value={form.customerName}
                onChange={(event) => setField("customerName", event.target.value)}
                placeholder="例如：永大營造"
                required
              />
            </Field>
            <Field label="從客戶名單帶入">
              <Select value={form.customerId} onValueChange={onPickCustomer}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={customers.length === 0 ? "尚無客戶" : "選擇既有客戶"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="出貨司機">
              <Select
                value={form.driverId || "none"}
                onValueChange={(value) =>
                  setField("driverId", value && value !== "none" ? value : "")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="未指定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">未指定</SelectItem>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="manual">自訂</SelectItem>
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.productName}
                                </SelectItem>
                              ))}
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

function PaymentsView({
  unpaidOrders,
  today,
  onEdit,
  onDelete,
}: {
  unpaidOrders: OrderDoc[]
  today: Date
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>未收款追蹤</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>客戶</TableHead>
              <TableHead>品項</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>下單日</TableHead>
              <TableHead>距今</TableHead>
              <TableHead>出貨狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unpaidOrders.length === 0 ? (
              <EmptyRow colSpan={7} text="目前沒有未收款訂單。" />
            ) : (
              unpaidOrders.map((order) => {
                const days = daysBetween(today, order.orderDate)
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.customerName}</TableCell>
                    <TableCell>{summarizeItems(order.items)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {money(order.totalAmount)}
                    </TableCell>
                    <TableCell>{formatDate(order.orderDate)}</TableCell>
                    <TableCell>{days > 0 ? `${days} 天` : "今日"}</TableCell>
                    <TableCell>
                      <StatusBadge tone={order.deliveryDate ? "muted" : "danger"}>
                        {order.deliveryDate ? "已出貨" : "未出貨"}
                      </StatusBadge>
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

function ShipmentsView({
  pendingShipments,
  drivers,
  onEdit,
  onDelete,
}: {
  pendingShipments: OrderDoc[]
  drivers: UserDoc[]
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
}) {
  const driverName = (driverId: string | null) => {
    if (!driverId) return "未指派"
    return drivers.find((u) => u.id === driverId)?.displayName ?? driverId
  }

  const aggregated = useMemo(() => aggregatePendingItems(pendingShipments), [pendingShipments])
  const totalProductTypes = aggregated.length
  const uniqueCustomers = useMemo(
    () => new Set(pendingShipments.map((o) => o.customerName)).size,
    [pendingShipments],
  )

  // FIFO 排序：愈早下單的愈優先出貨
  const sortedOrders = useMemo(
    () => [...pendingShipments].sort((a, b) => a.orderDate.getTime() - b.orderDate.getTime()),
    [pendingShipments],
  )

  const today = useMemo(() => new Date(), [])

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package />
            待備商品總覽
          </CardTitle>
          <CardAction>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary">
                {pendingShipments.length} 筆訂單
              </Badge>
              <Badge variant="secondary">{uniqueCustomers} 位客戶</Badge>
              <Badge variant="secondary">{totalProductTypes} 樣商品</Badge>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {aggregated.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-chart-1/10 text-chart-1">
                <CheckCircle2 />
              </div>
              <p className="font-medium">目前沒有待備商品</p>
              <p className="text-sm text-muted-foreground">所有訂單都已安排出貨</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {aggregated.map((item) => (
                <div
                  key={`${item.productName}-${item.spec}`}
                  className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium leading-tight">{item.productName}</div>
                      {item.spec ? (
                        <div className="truncate text-xs text-muted-foreground">{item.spec}</div>
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
                    {item.orderCount} 筆訂單　·
                    {item.customers.slice(0, 2).join("、")}
                    {item.customers.length > 2 ? ` 等 ${item.customers.length} 位` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck />
            訂單明細
          </CardTitle>
          <CardAction>
            <span className="text-xs text-muted-foreground">依下單時間排序（最舊優先）</span>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">客戶</TableHead>
                <TableHead>訂單品項</TableHead>
                <TableHead className="text-right">訂單金額</TableHead>
                <TableHead>下單日</TableHead>
                <TableHead>司機</TableHead>
                <TableHead>收款</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOrders.length === 0 ? (
                <EmptyRow colSpan={7} text="目前沒有待出貨訂單。" />
              ) : (
                sortedOrders.map((order) => {
                  const waited = daysBetween(today, order.orderDate)
                  const urgent = waited >= 7
                  return (
                    <TableRow key={order.id} className="align-top">
                      <TableCell className="py-3 font-medium">{order.customerName}</TableCell>
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
                              urgent ? "font-medium text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {waited === 0 ? "今日" : `已等 ${waited} 天`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">{driverName(order.driverId)}</TableCell>
                      <TableCell className="py-3">
                        <StatusBadge tone={order.paymentStatus === "paid" ? "default" : "muted"}>
                          {order.paymentStatus === "paid" ? "已結清" : "未收款"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="py-3">
                        <RowActions order={order} onEdit={onEdit} onDelete={onDelete} />
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

function AnalyticsView({
  orders,
  dashboard,
  paymentColors,
}: {
  orders: OrderDoc[]
  dashboard: DashboardShape
  paymentColors: string[]
}) {
  const stateBuckets: DerivedOrderState[] = ["進行中", "待收款", "已完成"]

  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle>付款方式分析（已結清）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {dashboard.paymentMethodStats.map((item, index) => {
            const percent =
              dashboard.paymentMethodTotal > 0
                ? Math.round((item.amount / dashboard.paymentMethodTotal) * 100)
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
                  <span className="font-medium tabular-nums">{money(item.amount)}</span>
                </div>
                <Progress value={percent}>
                  <ProgressTrack>
                    <ProgressIndicator style={{ backgroundColor: paymentColors[index] }} />
                  </ProgressTrack>
                </Progress>
              </div>
            )
          })}
          {dashboard.paymentMethodTotal === 0 ? (
            <span className="text-sm text-muted-foreground">尚無已結清訂單可供分析。</span>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>訂單狀態總覽</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {stateBuckets.map((state) => {
            const count = orders.filter((order) => deriveState(order) === state).length
            return (
              <div
                key={state}
                className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
              >
                <span>{state}</span>
                <span className="font-semibold tabular-nums">{count}</span>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function AlertsView({
  stalestUnpaid,
  today,
  orders,
  products,
  users,
  onNavigate,
}: {
  stalestUnpaid: OrderDoc[]
  today: Date
  orders: OrderDoc[]
  products: ProductDoc[]
  users: UserDoc[]
  onNavigate: (view: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <AIAdvisorPanel
        orders={orders}
        products={products}
        users={users}
        today={today}
        onNavigate={(view) => onNavigate(view)}
      />

      <Card>
        <CardHeader>
          <CardTitle>久未收款明細</CardTitle>
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
              {stalestUnpaid.length === 0 ? (
                <EmptyRow colSpan={5} text="目前沒有久未收款訂單。" />
              ) : (
                stalestUnpaid.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.customerName}</TableCell>
                    <TableCell>{summarizeItems(order.items)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {money(order.totalAmount)}
                    </TableCell>
                    <TableCell>{daysBetween(today, order.orderDate)} 天</TableCell>
                    <TableCell>
                      <StatusBadge tone={order.deliveryDate ? "muted" : "danger"}>
                        {order.deliveryDate ? "已出貨" : "未出貨"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function CompactOrderTable({
  orders,
  today,
  onEdit,
  onDelete,
}: {
  orders: OrderDoc[]
  today: Date
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
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
                <TableCell className="font-medium">{order.customerName}</TableCell>
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

function RowActions({
  order,
  onEdit,
  onDelete,
}: {
  order: OrderDoc
  onEdit: (order: OrderDoc) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex justify-end gap-1">
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
