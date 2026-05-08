import { Timestamp, collection, doc, getDocs, writeBatch } from "firebase/firestore"

import { getDb } from "./firebase"
import { type OrderItem, type UserRole } from "./firestore"

const SEED_PREFIX = "SEED_"

function daysFromToday(days: number) {
  const date = new Date()
  date.setHours(10, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date
}

const seedUsers: Array<{ id: string; role: UserRole; displayName: string; phone: string; notes: string }> = [
  { id: "SEED_USER_BOSS_001", role: "boss", displayName: "林老闆", phone: "0911111111", notes: "" },
  { id: "SEED_USER_DRIVER_001", role: "driver", displayName: "司機 阿明", phone: "0922222222", notes: "" },
  { id: "SEED_USER_DRIVER_002", role: "driver", displayName: "司機 阿凱", phone: "0933333333", notes: "" },
  { id: "SEED_USER_CUSTOMER_001", role: "customer", displayName: "永大營造", phone: "0944111111", notes: "每週三公休不送貨" },
  { id: "SEED_USER_CUSTOMER_002", role: "customer", displayName: "洪水泥工", phone: "0944222222", notes: "" },
  { id: "SEED_USER_CUSTOMER_003", role: "customer", displayName: "金池營造", phone: "0944333333", notes: "" },
  { id: "SEED_USER_CUSTOMER_004", role: "customer", displayName: "大成營造", phone: "0944444444", notes: "" },
]

const seedProducts: Array<{ id: string; productName: string; spec: string; price: number; isActive: boolean }> = [
  { id: "SEED_PRODUCT_001", productName: "化糞池", spec: "FRP 標準型", price: 43000, isActive: true },
  { id: "SEED_PRODUCT_002", productName: "陰井", spec: "30 x 30 cm", price: 5250, isActive: true },
  { id: "SEED_PRODUCT_003", productName: "電線桿", spec: "9 公尺 預力", price: 23600, isActive: true },
  { id: "SEED_PRODUCT_004", productName: "涵管", spec: "60 cm 管徑", price: 8000, isActive: true },
  { id: "SEED_PRODUCT_005", productName: "其他水泥製品", spec: "依規格報價", price: 65000, isActive: true },
]

type SeedOrder = {
  id: string
  customerId: string
  customerName: string
  driverId: string | null
  items: OrderItem[]
  paymentStatus: "unpaid" | "paid"
  paymentMethod: "cash" | "transfer" | "check" | null
  orderDate: Date
  deliveryDate: Date | null
}

function buildSeedOrders(): SeedOrder[] {
  return [
    {
      id: "SEED_ORDER_001",
      customerId: "SEED_USER_CUSTOMER_001",
      customerName: "永大營造",
      driverId: "SEED_USER_DRIVER_001",
      items: [
        { productName: "化糞池", spec: "FRP 標準型", quantity: 2, unitPrice: 43000, subtotal: 86000 },
      ],
      paymentStatus: "unpaid",
      paymentMethod: null,
      orderDate: daysFromToday(-3),
      deliveryDate: null,
    },
    {
      id: "SEED_ORDER_002",
      customerId: "SEED_USER_CUSTOMER_002",
      customerName: "洪水泥工",
      driverId: "SEED_USER_DRIVER_002",
      items: [
        { productName: "陰井", spec: "30 x 30 cm", quantity: 8, unitPrice: 5250, subtotal: 42000 },
      ],
      paymentStatus: "unpaid",
      paymentMethod: null,
      orderDate: daysFromToday(-7),
      deliveryDate: daysFromToday(-1),
    },
    {
      id: "SEED_ORDER_003",
      customerId: "SEED_USER_CUSTOMER_003",
      customerName: "金池營造",
      driverId: null,
      items: [
        { productName: "電線桿", spec: "9 公尺 預力", quantity: 5, unitPrice: 23600, subtotal: 118000 },
      ],
      paymentStatus: "unpaid",
      paymentMethod: null,
      orderDate: daysFromToday(-2),
      deliveryDate: null,
    },
    {
      id: "SEED_ORDER_004",
      customerId: "SEED_USER_CUSTOMER_004",
      customerName: "大成營造",
      driverId: "SEED_USER_DRIVER_001",
      items: [
        { productName: "涵管", spec: "60 cm 管徑", quantity: 12, unitPrice: 8000, subtotal: 96000 },
      ],
      paymentStatus: "paid",
      paymentMethod: "cash",
      orderDate: daysFromToday(0),
      deliveryDate: daysFromToday(0),
    },
    {
      id: "SEED_ORDER_005",
      customerId: "SEED_USER_CUSTOMER_001",
      customerName: "永大營造",
      driverId: "SEED_USER_DRIVER_002",
      items: [
        { productName: "其他水泥製品", spec: "依規格報價", quantity: 1, unitPrice: 65000, subtotal: 65000 },
      ],
      paymentStatus: "paid",
      paymentMethod: "transfer",
      orderDate: daysFromToday(-15),
      deliveryDate: daysFromToday(-10),
    },
  ]
}

export async function seedSampleData() {
  const db = getDb()
  const batch = writeBatch(db)
  const baseTime = Timestamp.now().toDate().getTime()

  for (const user of seedUsers) {
    batch.set(doc(db, "Users", user.id), {
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      phone: user.phone,
      notes: user.notes,
      createdAt: Timestamp.fromDate(new Date(baseTime - 90 * 86_400_000)),
    })
  }

  for (const product of seedProducts) {
    batch.set(doc(db, "Products", product.id), product)
  }

  for (const order of buildSeedOrders()) {
    batch.set(doc(db, "Orders", order.id), {
      ...order,
      totalAmount: order.items.reduce((sum, item) => sum + item.subtotal, 0),
      orderDate: Timestamp.fromDate(order.orderDate),
      deliveryDate: order.deliveryDate ? Timestamp.fromDate(order.deliveryDate) : null,
    })
  }

  await batch.commit()
}

export async function clearSampleData() {
  const db = getDb()

  const [usersSnap, productsSnap, ordersSnap] = await Promise.all([
    getDocs(collection(db, "Users")),
    getDocs(collection(db, "Products")),
    getDocs(collection(db, "Orders")),
  ])

  const seedDocs = [
    ...usersSnap.docs.filter((d) => d.id.startsWith(SEED_PREFIX)),
    ...productsSnap.docs.filter((d) => d.id.startsWith(SEED_PREFIX)),
    ...ordersSnap.docs.filter((d) => d.id.startsWith(SEED_PREFIX)),
  ]

  if (seedDocs.length === 0) {
    return { deleted: 0 }
  }

  const batch = writeBatch(db)
  for (const docSnap of seedDocs) {
    batch.delete(docSnap.ref)
  }
  await batch.commit()

  return { deleted: seedDocs.length }
}

export const SEED_DOC_PREFIX = SEED_PREFIX
