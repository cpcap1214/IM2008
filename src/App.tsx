import { useMemo, useState } from "react"
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Coins,
  CreditCard,
  FilePenLine,
  Home,
  LayoutDashboard,
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "yaoshun-dashboard-orders-v1"

const orderStatuses = ["接單", "生產中", "待出貨", "配送中", "已出貨", "已完成"] as const
const paymentMethods = ["現金", "匯款", "支票", "賒帳", "尚未付款"] as const
const paymentStatuses = ["未收款", "部分付款", "已收款", "已逾期"] as const
const shippingStatuses = ["未安排", "待出貨", "配送中", "已送達"] as const

type OrderStatus = (typeof orderStatuses)[number]
type PaymentMethod = (typeof paymentMethods)[number]
type PaymentStatus = (typeof paymentStatuses)[number]
type ShippingStatus = (typeof shippingStatuses)[number]
type ViewKey = "overview" | "entry" | "payments" | "shipments" | "analytics" | "alerts"

type OrderRecord = {
  id: string
  customerName: string
  itemName: string
  quantity: string
  orderDate: string
  expectedShipDate: string
  orderStatus: OrderStatus
  receivableAmount: number
  paidAmount: number
  paymentMethod: PaymentMethod
  collector: string
  paymentDueDate: string
  paymentStatus: PaymentStatus
  driver: string
  shippingStatus: ShippingStatus
  note: string
  createdAt: string
  updatedAt: string
}

type OrderFormData = Omit<
  OrderRecord,
  "id" | "receivableAmount" | "paidAmount" | "createdAt" | "updatedAt"
> & {
  receivableAmount: string
  paidAmount: string
}

type KpiItem = {
  label: string
  value: string
  icon: typeof Coins
  tone: "default" | "mint" | "aqua" | "violet" | "amber" | "danger"
}

type DashboardShape = {
  todayReceivableAmount: number
  todayPaidAmount: number
  todayUnpaidAmount: number
  totalUnpaidAmount: number
  overdueUnpaidAmount: number
  todayShipments: OrderRecord[]
  activeOrderCount: number
  monthPaidAmount: number
  unpaidOrders: OrderRecord[]
  overdueOrders: OrderRecord[]
  completedUnpaid: OrderRecord[]
  paymentStats: Array<{ method: PaymentMethod; amount: number }>
  paymentTotal: number
  topOverdueCustomer: [string, number] | undefined
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

function addDays(base: Date, days: number) {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  return date
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function formatDate(value: string) {
  if (!value) return "-"
  return parseDate(value).toLocaleDateString("zh-TW", {
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

function getUnpaidAmount(order: OrderRecord) {
  return Math.max(order.receivableAmount - order.paidAmount, 0)
}

function isOverdue(order: OrderRecord, today: string) {
  return order.paymentDueDate < today && getUnpaidAmount(order) > 0
}

function getOverdueDays(order: OrderRecord, today: string) {
  if (!isOverdue(order, today)) return 0
  const diff = parseDate(today).getTime() - parseDate(order.paymentDueDate).getTime()
  return Math.max(Math.floor(diff / 86_400_000), 0)
}

function getDisplayPaymentStatus(order: OrderRecord, today: string): PaymentStatus {
  if (getUnpaidAmount(order) === 0) return "已收款"
  if (isOverdue(order, today)) return "已逾期"
  if (order.paidAmount > 0) return "部分付款"
  return order.paymentStatus
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function createDefaultForm(today: string): OrderFormData {
  return {
    customerName: "",
    itemName: "",
    quantity: "",
    orderDate: today,
    expectedShipDate: today,
    orderStatus: "接單",
    receivableAmount: "",
    paidAmount: "",
    paymentMethod: "尚未付款",
    collector: "",
    paymentDueDate: today,
    paymentStatus: "未收款",
    driver: "",
    shippingStatus: "未安排",
    note: "",
  }
}

function createMockOrders(today: string): OrderRecord[] {
  const now = new Date().toISOString()
  const todayDate = parseDate(today)

  return [
    {
      id: "seed-1",
      customerName: "永大營造",
      itemName: "化糞池",
      quantity: "2 座",
      orderDate: toLocalDateString(addDays(todayDate, -3)),
      expectedShipDate: today,
      orderStatus: "待出貨",
      receivableAmount: 86000,
      paidAmount: 30000,
      paymentMethod: "匯款",
      collector: "林老闆",
      paymentDueDate: today,
      paymentStatus: "部分付款",
      driver: "阿明",
      shippingStatus: "待出貨",
      note: "上午先送第一座，現場需吊車。",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-2",
      customerName: "洪水泥工",
      itemName: "陰井",
      quantity: "8 個",
      orderDate: toLocalDateString(addDays(todayDate, -7)),
      expectedShipDate: toLocalDateString(addDays(todayDate, -1)),
      orderStatus: "已出貨",
      receivableAmount: 42000,
      paidAmount: 0,
      paymentMethod: "賒帳",
      collector: "會計小婷",
      paymentDueDate: toLocalDateString(addDays(todayDate, -2)),
      paymentStatus: "未收款",
      driver: "阿凱",
      shippingStatus: "已送達",
      note: "客戶說月底一起結。",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-3",
      customerName: "金池營造",
      itemName: "電線桿",
      quantity: "5 支",
      orderDate: toLocalDateString(addDays(todayDate, -2)),
      expectedShipDate: toLocalDateString(addDays(todayDate, 1)),
      orderStatus: "生產中",
      receivableAmount: 118000,
      paidAmount: 50000,
      paymentMethod: "支票",
      collector: "林老闆",
      paymentDueDate: toLocalDateString(addDays(todayDate, 5)),
      paymentStatus: "部分付款",
      driver: "未定",
      shippingStatus: "未安排",
      note: "需確認施工道路可否進車。",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-4",
      customerName: "大成營造",
      itemName: "涵管",
      quantity: "12 支",
      orderDate: today,
      expectedShipDate: today,
      orderStatus: "配送中",
      receivableAmount: 96000,
      paidAmount: 96000,
      paymentMethod: "現金",
      collector: "阿明",
      paymentDueDate: today,
      paymentStatus: "已收款",
      driver: "阿明",
      shippingStatus: "配送中",
      note: "現場收現金，送達後回報。",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-5",
      customerName: "海天工坊",
      itemName: "其他水泥製品",
      quantity: "1 批",
      orderDate: toLocalDateString(addDays(todayDate, -15)),
      expectedShipDate: toLocalDateString(addDays(todayDate, -10)),
      orderStatus: "已完成",
      receivableAmount: 65000,
      paidAmount: 20000,
      paymentMethod: "匯款",
      collector: "會計小婷",
      paymentDueDate: toLocalDateString(addDays(todayDate, -6)),
      paymentStatus: "部分付款",
      driver: "阿凱",
      shippingStatus: "已送達",
      note: "已完成但尾款尚未入帳。",
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function loadInitialOrders(today: string) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      const seededOrders = createMockOrders(today)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seededOrders))
      return seededOrders
    }
    const parsed = JSON.parse(saved) as OrderRecord[]
    return Array.isArray(parsed) ? parsed : createMockOrders(today)
  } catch {
    return createMockOrders(today)
  }
}

function money(value: number) {
  return currencyFormatter.format(value)
}

function statusTone(status: string) {
  if (status === "已逾期") return "danger" as const
  if (status === "已收款" || status === "已完成" || status === "已送達") return "default" as const
  return "muted" as const
}

function StatusBadge({ children, tone }: { children: string; tone?: "default" | "muted" | "danger" }) {
  const variant = tone === "danger" ? "destructive" : tone === "muted" ? "secondary" : "outline"
  return <Badge variant={variant}>{children}</Badge>
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function AppSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => nextValue && onChange(nextValue as T)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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
}: {
  segments: Array<{ value: number; color: string }>
}) {
  const total = segments.reduce((sum, item) => sum + item.value, 0)
  let cursor = 0
  const gradient = total
    ? segments
        .map((item) => {
          const start = cursor
          const end = cursor + (item.value / total) * 100
          cursor = end
          return `${item.color} ${start}% ${end}%`
        })
        .join(", ")
    : "var(--muted) 0% 100%"

  return (
    <div
      className="relative size-40 rounded-full"
      style={{ background: `conic-gradient(${gradient})` }}
      aria-label="付款方式比例"
    >
      <div className="absolute inset-11 rounded-full bg-card" />
    </div>
  )
}

function App() {
  const today = toLocalDateString(new Date())
  const [orders, setOrders] = useState<OrderRecord[]>(() => loadInitialOrders(today))
  const [form, setForm] = useState<OrderFormData>(() => createDefaultForm(today))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [activeView, setActiveView] = useState<ViewKey>("overview")

  const persistOrders = (nextOrders: OrderRecord[]) => {
    setOrders(nextOrders)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextOrders))
    setLastUpdated(new Date())
  }

  const setField = <K extends keyof OrderFormData>(key: K, value: OrderFormData[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const resetForm = () => {
    setForm(createDefaultForm(today))
    setEditingId(null)
  }

  const submitOrder = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const now = new Date().toISOString()
    const normalizedReceivable = Number(form.receivableAmount) || 0
    const normalizedPaid = Math.min(Number(form.paidAmount) || 0, normalizedReceivable)

    if (!form.customerName.trim() || !form.itemName.trim()) return

    if (editingId) {
      const nextOrders = orders.map((order) =>
        order.id === editingId
          ? {
              ...order,
              ...form,
              customerName: form.customerName.trim(),
              itemName: form.itemName.trim(),
              quantity: form.quantity.trim(),
              collector: form.collector.trim(),
              driver: form.driver.trim(),
              note: form.note.trim(),
              receivableAmount: normalizedReceivable,
              paidAmount: normalizedPaid,
              updatedAt: now,
            }
          : order,
      )
      persistOrders(nextOrders)
    } else {
      const nextOrder: OrderRecord = {
        id: createId(),
        ...form,
        customerName: form.customerName.trim(),
        itemName: form.itemName.trim(),
        quantity: form.quantity.trim(),
        collector: form.collector.trim(),
        driver: form.driver.trim(),
        note: form.note.trim(),
        receivableAmount: normalizedReceivable,
        paidAmount: normalizedPaid,
        createdAt: now,
        updatedAt: now,
      }
      persistOrders([nextOrder, ...orders])
    }

    resetForm()
    setActiveView("overview")
  }

  const editOrder = (order: OrderRecord) => {
    setEditingId(order.id)
    setForm({
      customerName: order.customerName,
      itemName: order.itemName,
      quantity: order.quantity,
      orderDate: order.orderDate,
      expectedShipDate: order.expectedShipDate,
      orderStatus: order.orderStatus,
      receivableAmount: String(order.receivableAmount),
      paidAmount: String(order.paidAmount),
      paymentMethod: order.paymentMethod,
      collector: order.collector,
      paymentDueDate: order.paymentDueDate,
      paymentStatus: order.paymentStatus,
      driver: order.driver,
      shippingStatus: order.shippingStatus,
      note: order.note,
    })
    setActiveView("entry")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const deleteOrder = (orderId: string) => {
    const target = orders.find((order) => order.id === orderId)
    if (!target) return
    if (!window.confirm(`確定刪除「${target.customerName} - ${target.itemName}」？`)) return
    persistOrders(orders.filter((order) => order.id !== orderId))
    if (editingId === orderId) resetForm()
  }

  const resetMockData = () => {
    if (!window.confirm("確定重設為初始範例資料？目前輸入的資料會被覆蓋。")) return
    persistOrders(createMockOrders(today))
    resetForm()
    setActiveView("overview")
  }

  const dashboard = useMemo(() => {
    const todayReceivables = orders.filter((order) => order.paymentDueDate === today)
    const unpaidOrders = orders.filter((order) => getUnpaidAmount(order) > 0)
    const overdueOrders = unpaidOrders.filter((order) => isOverdue(order, today))
    const todayShipments = orders.filter((order) => order.expectedShipDate === today)
    const monthKey = today.slice(0, 7)
    const monthOrders = orders.filter((order) => order.orderDate.startsWith(monthKey))
    const completedUnpaid = unpaidOrders.filter((order) => order.orderStatus === "已完成")

    const paymentStats = paymentMethods.map((method) => {
      const amount = orders
        .filter((order) => order.paymentMethod === method)
        .reduce((sum, order) => sum + order.receivableAmount, 0)
      return { method, amount }
    })
    const paymentTotal = paymentStats.reduce((sum, item) => sum + item.amount, 0)

    const overdueByCustomer = overdueOrders.reduce<Record<string, number>>((acc, order) => {
      acc[order.customerName] = (acc[order.customerName] ?? 0) + getUnpaidAmount(order)
      return acc
    }, {})
    const topOverdueCustomer = Object.entries(overdueByCustomer).sort((a, b) => b[1] - a[1])[0]

    return {
      todayReceivableAmount: todayReceivables.reduce((sum, order) => sum + order.receivableAmount, 0),
      todayPaidAmount: todayReceivables.reduce((sum, order) => sum + order.paidAmount, 0),
      todayUnpaidAmount: todayReceivables.reduce((sum, order) => sum + getUnpaidAmount(order), 0),
      totalUnpaidAmount: unpaidOrders.reduce((sum, order) => sum + getUnpaidAmount(order), 0),
      overdueUnpaidAmount: overdueOrders.reduce((sum, order) => sum + getUnpaidAmount(order), 0),
      todayShipments,
      activeOrderCount: orders.filter((order) => order.orderStatus !== "已完成").length,
      monthPaidAmount: monthOrders.reduce((sum, order) => sum + order.paidAmount, 0),
      unpaidOrders,
      overdueOrders,
      completedUnpaid,
      paymentStats,
      paymentTotal,
      topOverdueCustomer,
    }
  }, [orders, today])

  const kpiItems: KpiItem[] = [
    { label: "今日應收", value: money(dashboard.todayReceivableAmount), icon: Coins, tone: "aqua" },
    { label: "今日已收", value: money(dashboard.todayPaidAmount), icon: Wallet, tone: "mint" },
    { label: "今日未收", value: money(dashboard.todayUnpaidAmount), icon: Banknote, tone: "amber" },
    { label: "總未收", value: money(dashboard.totalUnpaidAmount), icon: CreditCard, tone: "violet" },
    { label: "逾期未收", value: money(dashboard.overdueUnpaidAmount), icon: AlertTriangle, tone: "danger" },
    { label: "今日出貨", value: `${dashboard.todayShipments.length} 筆`, icon: Truck, tone: "default" },
    { label: "進行中", value: `${dashboard.activeOrderCount} 筆`, icon: ClipboardList, tone: "aqua" },
    { label: "本月收入", value: money(dashboard.monthPaidAmount), icon: CheckCircle2, tone: "mint" },
  ]

  const reminders = [
    dashboard.overdueOrders.length > 0
      ? `目前有 ${dashboard.overdueOrders.length} 筆帳款已逾期，逾期未收合計 ${money(dashboard.overdueUnpaidAmount)}。`
      : "目前沒有逾期未收款。",
    dashboard.topOverdueCustomer
      ? `${dashboard.topOverdueCustomer[0]} 是目前逾期金額最高客戶，未收 ${money(dashboard.topOverdueCustomer[1])}。`
      : "尚無逾期金額最高客戶。",
    dashboard.todayShipments.length > 0
      ? `今天有 ${dashboard.todayShipments.length} 筆訂單需要出貨。`
      : "今天沒有預計出貨訂單。",
    dashboard.completedUnpaid.length > 0
      ? `有 ${dashboard.completedUnpaid.length} 筆訂單已完成但尚未收完款。`
      : "已完成訂單目前沒有未收尾款。",
    `本月目前已收金額為 ${money(dashboard.monthPaidAmount)}。`,
  ]

  const recentOrders = [...orders]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4)

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
        <aside className="hidden w-16 shrink-0 flex-col items-center border-r bg-background py-4 lg:flex">
          <div className="mb-6 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Home />
          </div>
          <nav className="flex flex-col gap-2">
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <Button
                  key={item.key}
                  type="button"
                  variant={activeView === item.key ? "default" : "ghost"}
                  size="icon"
                  onClick={() => setActiveView(item.key)}
                  aria-label={item.label}
                >
                  <Icon />
                </Button>
              )
            })}
          </nav>
        </aside>

        <aside className="hidden w-80 shrink-0 border-r bg-background p-5 xl:block">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">營運</h2>
            <Button type="button" size="sm" onClick={() => setActiveView("entry")}>
              <Plus data-icon="inline-start" />
              新增
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="bg-chart-1/10">
              <CardContent className="flex flex-col gap-3 pt-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium">本月收入</span>
                  <span className="text-xl font-semibold">{money(dashboard.monthPaidAmount)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="font-medium">總未收</span>
                  <span className="font-semibold">{money(dashboard.totalUnpaidAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">逾期</span>
                  <span className="font-semibold text-destructive">{money(dashboard.overdueUnpaidAmount)}</span>
                </div>
              </CardContent>
            </Card>

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

            <Card>
              <CardHeader>
                <CardTitle>客戶追蹤</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {dashboard.unpaidOrders.slice(0, 4).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{order.customerName}</div>
                      <div className="truncate text-sm text-muted-foreground">{order.itemName}</div>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{money(getUnpaidAmount(order))}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
            <header className="flex flex-col gap-4 rounded-xl border bg-background p-4 shadow-sm md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-1">
                <Badge variant="secondary" className="w-fit">內部管理工具</Badge>
                <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">堯順工程行智慧儀表板</h1>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2 rounded-lg border bg-chart-2/10 px-3 py-2 text-sm">
                  <RefreshCw />
                  {formatDateTime(lastUpdated)}
                </div>
                <Button type="button" variant="outline" onClick={resetMockData}>
                  <RefreshCw data-icon="inline-start" />
                  重設範例
                </Button>
              </div>
            </header>

            <nav
              className="grid gap-2 lg:hidden"
              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
            >
              {navigationItems.map((item) => {
                const Icon = item.icon
                return (
                  <Button
                    key={item.key}
                    type="button"
                    variant={activeView === item.key ? "default" : "outline"}
                    onClick={() => setActiveView(item.key)}
                  >
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </Button>
                )
              })}
            </nav>

            {activeView === "overview" ? (
              <OverviewView
                dashboard={dashboard}
                kpiItems={kpiItems}
                orders={orders}
                recentOrders={recentOrders}
                reminders={reminders}
                today={today}
                onEdit={editOrder}
                onDelete={deleteOrder}
                paymentColors={paymentColors}
              />
            ) : null}

            {activeView === "entry" ? (
              <EntryView
                editingId={editingId}
                form={form}
                setField={setField}
                submitOrder={submitOrder}
                resetForm={resetForm}
              />
            ) : null}

            {activeView === "payments" ? (
              <PaymentsView
                unpaidOrders={dashboard.unpaidOrders}
                today={today}
                onEdit={editOrder}
                onDelete={deleteOrder}
              />
            ) : null}

            {activeView === "shipments" ? (
              <ShipmentsView
                shipments={dashboard.todayShipments}
                onEdit={editOrder}
                onDelete={deleteOrder}
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
              <AlertsView reminders={reminders} overdueOrders={dashboard.overdueOrders} today={today} />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}

function KpiCard({ item }: { item: KpiItem }) {
  const Icon = item.icon
  return (
    <Card
      size="sm"
      className={cn(
        "min-h-28",
        item.tone === "mint" && "bg-chart-1/10",
        item.tone === "aqua" && "bg-chart-2/10",
        item.tone === "violet" && "bg-chart-4/10",
        item.tone === "amber" && "bg-chart-3/10",
        item.tone === "danger" && "bg-destructive/10",
      )}
    >
      <CardHeader>
        <CardTitle className="text-sm">{item.label}</CardTitle>
        <CardAction>
          <div className="flex size-8 items-center justify-center rounded-lg bg-background/80">
            <Icon />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{item.value}</div>
      </CardContent>
    </Card>
  )
}

function OverviewView({
  dashboard,
  kpiItems,
  orders,
  recentOrders,
  reminders,
  today,
  onEdit,
  onDelete,
  paymentColors,
}: {
  dashboard: DashboardShape
  kpiItems: KpiItem[]
  orders: OrderRecord[]
  recentOrders: OrderRecord[]
  reminders: string[]
  today: string
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
  paymentColors: string[]
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <Card className="bg-background">
        <CardHeader>
          <CardTitle>今日營運</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiItems.slice(0, 4).map((item) => (
            <KpiCard key={item.label} item={item} />
          ))}
        </CardContent>
      </Card>

      <Card className="bg-background">
        <CardHeader>
          <CardTitle>付款方式</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
          <DonutChart
            segments={dashboard.paymentStats.map((item, index) => ({
              value: item.amount,
              color: paymentColors[index] ?? "var(--muted)",
            }))}
          />
          <div className="flex w-full flex-col gap-2">
            {dashboard.paymentStats.map((item, index) => {
              const percent = dashboard.paymentTotal > 0 ? Math.round((item.amount / dashboard.paymentTotal) * 100) : 0
              return (
                <div key={item.method} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: paymentColors[index] }} />
                    {item.method}
                  </span>
                  <span className="text-sm tabular-nums">{percent}%</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-1">
        <CardHeader>
          <CardTitle>近期訂單</CardTitle>
        </CardHeader>
        <CardContent>
          <CompactOrderTable orders={recentOrders} today={today} onEdit={onEdit} onDelete={onDelete} />
        </CardContent>
      </Card>

      <Card className="bg-chart-1/10">
        <CardHeader>
          <CardTitle>智慧提醒</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {reminders.slice(0, 4).map((reminder) => (
            <div key={reminder} className="flex items-start gap-3 rounded-lg border bg-background/70 p-3">
              <Sparkles />
              <span className="text-sm leading-6">{reminder}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:col-span-2 md:grid-cols-4">
        {kpiItems.slice(4).map((item) => (
          <KpiCard key={item.label} item={item} />
        ))}
      </section>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>訂單狀態</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orderStatuses.map((status) => {
            const count = orders.filter((order) => order.orderStatus === status).length
            return (
              <div key={status} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-3">
                <div className="flex items-center gap-2">
                  <PackageCheck />
                  <span className="font-medium">{status}</span>
                </div>
                <Badge variant={status === "已完成" ? "default" : "secondary"}>
                  {numberFormatter.format(count)} 筆
                </Badge>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function EntryView({
  editingId,
  form,
  setField,
  submitOrder,
  resetForm,
}: {
  editingId: string | null
  form: OrderFormData
  setField: <K extends keyof OrderFormData>(key: K, value: OrderFormData[K]) => void
  submitOrder: (event: React.FormEvent<HTMLFormElement>) => void
  resetForm: () => void
}) {
  return (
    <Card id="order-form">
      <CardHeader>
        <CardTitle>{editingId ? "編輯資料" : "新增資料"}</CardTitle>
        <CardAction>
          {editingId ? <StatusBadge tone="muted">編輯中</StatusBadge> : <StatusBadge>新增模式</StatusBadge>}
        </CardAction>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={submitOrder}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="客戶名稱">
              <Input value={form.customerName} onChange={(event) => setField("customerName", event.target.value)} placeholder="例如：永大營造" required />
            </Field>
            <Field label="訂單品項">
              <Input value={form.itemName} onChange={(event) => setField("itemName", event.target.value)} placeholder="例如：化糞池、涵管" required />
            </Field>
            <Field label="數量">
              <Input value={form.quantity} onChange={(event) => setField("quantity", event.target.value)} placeholder="例如：2 座、12 支" />
            </Field>
            <Field label="訂單日期">
              <Input type="date" value={form.orderDate} onChange={(event) => setField("orderDate", event.target.value)} />
            </Field>
            <Field label="預計出貨日期">
              <Input type="date" value={form.expectedShipDate} onChange={(event) => setField("expectedShipDate", event.target.value)} />
            </Field>
            <Field label="訂單狀態">
              <AppSelect value={form.orderStatus} options={orderStatuses} onChange={(value) => setField("orderStatus", value)} />
            </Field>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="應收金額">
              <Input type="number" min="0" value={form.receivableAmount} onChange={(event) => setField("receivableAmount", event.target.value)} placeholder="0" />
            </Field>
            <Field label="已收金額">
              <Input type="number" min="0" value={form.paidAmount} onChange={(event) => setField("paidAmount", event.target.value)} placeholder="0" />
            </Field>
            <Field label="付款方式">
              <AppSelect value={form.paymentMethod} options={paymentMethods} onChange={(value) => setField("paymentMethod", value)} />
            </Field>
            <Field label="收款負責人">
              <Input value={form.collector} onChange={(event) => setField("collector", event.target.value)} placeholder="例如：林老闆、會計小婷" />
            </Field>
            <Field label="付款到期日">
              <Input type="date" value={form.paymentDueDate} onChange={(event) => setField("paymentDueDate", event.target.value)} />
            </Field>
            <Field label="收款狀態">
              <AppSelect value={form.paymentStatus} options={paymentStatuses} onChange={(value) => setField("paymentStatus", value)} />
            </Field>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="出貨負責人／司機">
              <Input value={form.driver} onChange={(event) => setField("driver", event.target.value)} placeholder="例如：阿明" />
            </Field>
            <Field label="出貨狀態">
              <AppSelect value={form.shippingStatus} options={shippingStatuses} onChange={(value) => setField("shippingStatus", value)} />
            </Field>
            <Field label="備註">
              <Textarea value={form.note} onChange={(event) => setField("note", event.target.value)} placeholder="例如：現場需吊車、送達後回報" />
            </Field>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm}>
                取消編輯
              </Button>
            )}
            <Button type="submit">
              {editingId ? <Save data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {editingId ? "更新資料" : "新增資料"}
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
  unpaidOrders: OrderRecord[]
  today: string
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>未收款追蹤</CardTitle>
      </CardHeader>
      <CardContent>
        <UnpaidTable unpaidOrders={unpaidOrders} today={today} onEdit={onEdit} onDelete={onDelete} />
      </CardContent>
    </Card>
  )
}

function ShipmentsView({
  shipments,
  onEdit,
  onDelete,
}: {
  shipments: OrderRecord[]
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>今日出貨</CardTitle>
      </CardHeader>
      <CardContent>
        <ShipmentTable shipments={shipments} onEdit={onEdit} onDelete={onDelete} />
      </CardContent>
    </Card>
  )
}

function AnalyticsView({
  orders,
  dashboard,
  paymentColors,
}: {
  orders: OrderRecord[]
  dashboard: DashboardShape
  paymentColors: string[]
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle>付款方式分析</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {dashboard.paymentStats.map((item, index) => {
            const percent = dashboard.paymentTotal > 0 ? Math.round((item.amount / dashboard.paymentTotal) * 100) : 0
            return (
              <div key={item.method} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: paymentColors[index] }} />
                    {item.method}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>訂單狀態總覽</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {orderStatuses.map((status) => {
            const count = orders.filter((order) => order.orderStatus === status).length
            return (
              <div key={status} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-3">
                <span className="font-medium">{status}</span>
                <Badge variant={status === "已完成" ? "default" : "secondary"}>{count} 筆</Badge>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function AlertsView({
  reminders,
  overdueOrders,
  today,
}: {
  reminders: string[]
  overdueOrders: OrderRecord[]
  today: string
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <Card className="bg-chart-1/10">
        <CardHeader>
          <CardTitle>智慧提醒</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {reminders.map((reminder) => (
            <div key={reminder} className="flex items-start gap-3 rounded-lg border bg-background/70 p-3">
              <Sparkles />
              <span className="text-sm leading-6">{reminder}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>逾期帳款</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客戶名稱</TableHead>
                <TableHead>品項</TableHead>
                <TableHead className="text-right">未收金額</TableHead>
                <TableHead>逾期</TableHead>
                <TableHead>負責人</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overdueOrders.length === 0 ? (
                <EmptyRow colSpan={5} text="目前沒有逾期帳款。" />
              ) : (
                overdueOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.customerName}</TableCell>
                    <TableCell>{order.itemName}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(getUnpaidAmount(order))}</TableCell>
                    <TableCell>{getOverdueDays(order, today)} 天</TableCell>
                    <TableCell>{order.collector || "-"}</TableCell>
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
  orders: OrderRecord[]
  today: string
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>客戶</TableHead>
          <TableHead>品項</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead className="text-right">未收</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.length === 0 ? (
          <EmptyRow colSpan={5} text="目前沒有訂單。" />
        ) : (
          orders.map((order) => {
            const paymentStatus = getDisplayPaymentStatus(order, today)
            return (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.customerName}</TableCell>
                <TableCell>{order.itemName}</TableCell>
                <TableCell>
                  <StatusBadge tone={statusTone(paymentStatus)}>{paymentStatus}</StatusBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(getUnpaidAmount(order))}</TableCell>
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

function UnpaidTable({
  unpaidOrders,
  today,
  onEdit,
  onDelete,
}: {
  unpaidOrders: OrderRecord[]
  today: string
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>客戶名稱</TableHead>
          <TableHead>訂單品項</TableHead>
          <TableHead className="text-right">應收金額</TableHead>
          <TableHead className="text-right">已收金額</TableHead>
          <TableHead className="text-right">未收金額</TableHead>
          <TableHead>付款方式</TableHead>
          <TableHead>到期日</TableHead>
          <TableHead>逾期</TableHead>
          <TableHead>負責人</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {unpaidOrders.length === 0 ? (
          <EmptyRow colSpan={11} text="目前沒有未收款訂單。" />
        ) : (
          unpaidOrders.map((order) => {
            const status = getDisplayPaymentStatus(order, today)
            const overdueDays = getOverdueDays(order, today)
            return (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.customerName}</TableCell>
                <TableCell>{order.itemName}</TableCell>
                <TableCell className="text-right tabular-nums">{money(order.receivableAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(order.paidAmount)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(getUnpaidAmount(order))}</TableCell>
                <TableCell>{order.paymentMethod}</TableCell>
                <TableCell>{formatDate(order.paymentDueDate)}</TableCell>
                <TableCell>{overdueDays > 0 ? `${overdueDays} 天` : "-"}</TableCell>
                <TableCell>{order.collector || "-"}</TableCell>
                <TableCell>
                  <StatusBadge tone={statusTone(status)}>{status}</StatusBadge>
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

function ShipmentTable({
  shipments,
  onEdit,
  onDelete,
}: {
  shipments: OrderRecord[]
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>客戶名稱</TableHead>
          <TableHead>品項</TableHead>
          <TableHead>數量</TableHead>
          <TableHead>司機／負責人</TableHead>
          <TableHead>出貨狀態</TableHead>
          <TableHead>備註</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shipments.length === 0 ? (
          <EmptyRow colSpan={7} text="今天沒有預計出貨訂單。" />
        ) : (
          shipments.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="font-medium">{order.customerName}</TableCell>
              <TableCell>{order.itemName}</TableCell>
              <TableCell>{order.quantity || "-"}</TableCell>
              <TableCell>{order.driver || "-"}</TableCell>
              <TableCell>
                <StatusBadge tone={statusTone(order.shippingStatus)}>{order.shippingStatus}</StatusBadge>
              </TableCell>
              <TableCell className="max-w-80 whitespace-normal text-muted-foreground">{order.note || "-"}</TableCell>
              <TableCell>
                <RowActions order={order} onEdit={onEdit} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))
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
  order: OrderRecord
  onEdit: (order: OrderRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEdit(order)} aria-label="編輯">
        <Pencil />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDelete(order.id)} aria-label="刪除">
        <Trash2 />
      </Button>
    </div>
  )
}

export default App
