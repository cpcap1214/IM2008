// CLI 範例資料工具
//   寫入：node scripts/seed.mjs
//   清除：node scripts/seed.mjs --clear
// 直接讀 .env.local 的 VITE_FIREBASE_* 變數，不需要 service account。

import { readFileSync } from "node:fs"
import { initializeApp } from "firebase/app"
import {
  Timestamp,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
  collection,
} from "firebase/firestore"

function loadEnv() {
  const text = readFileSync(".env.local", "utf-8")
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

const env = loadEnv()
const required = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
]
for (const key of required) {
  if (!env[key]) {
    console.error(`缺少 ${key}，請檢查 .env.local`)
    process.exit(1)
  }
}

console.warn(
  `⚠ 此 CLI 直接寫入 .env.local 的 Firebase 專案 (${env.VITE_FIREBASE_PROJECT_ID})，` +
    `如果這個 project 是 LINE bot 共用的正式環境，請務必確認再執行。`,
)

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const db = getFirestore(app)

const SEED_PREFIX = "SEED_"

function daysFromToday(days) {
  const date = new Date()
  date.setHours(10, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date
}

const seedUsers = [
  { id: "SEED_USER_BOSS_001", role: "boss", displayName: "林老闆", phone: "0911111111", notes: "" },
  { id: "SEED_USER_CUSTOMER_001", role: "customer", displayName: "永大營造", phone: "0944111111", notes: "每週三公休不送貨" },
  { id: "SEED_USER_CUSTOMER_002", role: "customer", displayName: "洪水泥工", phone: "0944222222", notes: "" },
  { id: "SEED_USER_CUSTOMER_003", role: "customer", displayName: "金池營造", phone: "0944333333", notes: "" },
  { id: "SEED_USER_CUSTOMER_004", role: "customer", displayName: "大成營造", phone: "0944444444", notes: "" },
]

const seedProducts = [
  { id: "SEED_PRODUCT_001", productName: "化糞池", spec: "FRP 標準型", price: 43000, isActive: true },
  { id: "SEED_PRODUCT_002", productName: "陰井", spec: "30 x 30 cm", price: 5250, isActive: true },
  { id: "SEED_PRODUCT_003", productName: "電線桿", spec: "9 公尺 預力", price: 23600, isActive: true },
  { id: "SEED_PRODUCT_004", productName: "涵管", spec: "60 cm 管徑", price: 8000, isActive: true },
  { id: "SEED_PRODUCT_005", productName: "其他水泥製品", spec: "依規格報價", price: 65000, isActive: true },
]

function buildSeedOrders() {
  return [
    {
      id: "SEED_ORDER_001",
      customerId: "SEED_USER_CUSTOMER_001",
      customerName: "永大營造",
      // 尚未送達 → null
      driverId: null,
      deliveryAddress: "",
      items: [{ productName: "化糞池", spec: "FRP 標準型", quantity: 2, unitPrice: 43000, subtotal: 86000 }],
      paymentStatus: "unpaid",
      paymentMethod: null,
      orderDate: daysFromToday(-3),
      deliveryDate: null,
    },
    {
      id: "SEED_ORDER_002",
      customerId: "SEED_USER_CUSTOMER_002",
      customerName: "洪水泥工",
      driverId: "阿凱",
      deliveryAddress: "",
      items: [{ productName: "陰井", spec: "30 x 30 cm", quantity: 8, unitPrice: 5250, subtotal: 42000 }],
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
      deliveryAddress: "",
      items: [{ productName: "電線桿", spec: "9 公尺 預力", quantity: 5, unitPrice: 23600, subtotal: 118000 }],
      paymentStatus: "pending_confirmation",
      paymentMethod: null,
      orderDate: daysFromToday(-2),
      deliveryDate: null,
      paidAt: null,
    },
    {
      id: "SEED_ORDER_004",
      customerId: "SEED_USER_CUSTOMER_004",
      customerName: "大成營造",
      driverId: "阿明",
      deliveryAddress: "",
      items: [{ productName: "涵管", spec: "60 cm 管徑", quantity: 12, unitPrice: 8000, subtotal: 96000 }],
      paymentStatus: "paid",
      paymentMethod: "cash",
      orderDate: daysFromToday(0),
      deliveryDate: daysFromToday(0),
      paidAt: daysFromToday(0),
    },
    {
      id: "SEED_ORDER_005",
      customerId: "SEED_USER_CUSTOMER_001",
      customerName: "永大營造",
      driverId: "阿凱",
      deliveryAddress: "",
      items: [{ productName: "其他水泥製品", spec: "依規格報價", quantity: 1, unitPrice: 65000, subtotal: 65000 }],
      paymentStatus: "paid",
      paymentMethod: "transfer",
      orderDate: daysFromToday(-15),
      deliveryDate: daysFromToday(-10),
      paidAt: daysFromToday(-9),
    },
  ]
}

function dateToTs(value) {
  return value ? Timestamp.fromDate(value) : null
}

async function seed() {
  console.log("→ 開始寫入範例資料 ...")
  const batch = writeBatch(db)
  const baseTime = Date.now()

  for (const u of seedUsers) {
    // 不寫 id 欄位 — doc ID 已是唯一識別。
    batch.set(doc(db, "Users", u.id), {
      role: u.role,
      displayName: u.displayName,
      phone: u.phone,
      notes: u.notes,
      createdAt: Timestamp.fromDate(new Date(baseTime - 90 * 86_400_000)),
    })
  }

  for (const p of seedProducts) {
    // 不寫 id 欄位 — doc ID 已是唯一識別。
    batch.set(doc(db, "Products", p.id), {
      productName: p.productName,
      spec: p.spec,
      price: p.price,
      isActive: p.isActive,
    })
  }

  for (const o of buildSeedOrders()) {
    // 不寫 id 欄位 — doc ID 已是唯一識別。
    batch.set(doc(db, "Orders", o.id), {
      customerId: o.customerId,
      customerName: o.customerName,
      driverId: o.driverId,
      deliveryAddress: o.deliveryAddress ?? "",
      items: o.items,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      totalAmount: o.items.reduce((sum, item) => sum + item.subtotal, 0),
      orderDate: dateToTs(o.orderDate),
      deliveryDate: dateToTs(o.deliveryDate),
      paidAt: dateToTs(o.paidAt ?? null),
      createdAt: serverTimestamp(),
    })
  }

  await batch.commit()
  console.log(`✓ 寫入完成：Users x${seedUsers.length}、Products x${seedProducts.length}、Orders x${buildSeedOrders().length}`)
}

async function clear() {
  console.log("→ 開始清除範例資料 ...")
  let total = 0
  for (const colName of ["Users", "Products", "Orders"]) {
    const snap = await getDocs(collection(db, colName))
    const targets = snap.docs.filter((d) => d.id.startsWith(SEED_PREFIX))
    if (targets.length === 0) continue
    const batch = writeBatch(db)
    for (const t of targets) batch.delete(t.ref)
    await batch.commit()
    console.log(`  - ${colName} 刪除 ${targets.length} 筆`)
    total += targets.length
  }
  console.log(`✓ 共刪除 ${total} 筆 SEED_ 範例文件`)
}

const mode = process.argv.includes("--clear") ? "clear" : "seed"
try {
  if (mode === "clear") await clear()
  else await seed()
  process.exit(0)
} catch (err) {
  console.error("✗ 失敗：", err.message ?? err)
  process.exit(1)
}
