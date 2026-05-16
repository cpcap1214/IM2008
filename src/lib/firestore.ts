import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type FieldValue,
  type FirestoreDataConverter,
} from "firebase/firestore"

import { getDb } from "./firebase"

export type UserRole = "boss" | "customer"

export type UserDoc = {
  id: string
  role: UserRole
  displayName: string
  phone: string
  createdAt: Date
  notes: string
}

export type ProductDoc = {
  id: string
  productName: string
  spec: string
  price: number
  isActive: boolean
}

export type OrderItem = {
  productName: string
  spec: string
  quantity: number
  unitPrice: number
  subtotal: number
}

export type OrderPaymentStatus = "unpaid" | "paid" | "pending_confirmation"
export type OrderPaymentMethod = "cash" | "transfer" | "check"

export type OrderDoc = {
  id: string
  customerId: string
  customerName: string
  /**
   * driverId — free-text label of who physically delivered the order
   * (e.g. "阿明" or a vehicle number). NOT a foreign key into Users.
   * `null` when not yet assigned. Set by the boss in the dashboard's
   * "標記送達" dialog.
   *
   * The field name is preserved on disk for compatibility with the LINE bot;
   * renaming it would require a coordinated two-phase migration.
   */
  driverId: string | null
  /**
   * Free-text delivery address as captured by the boss or the LINE bot.
   * Empty string ("") is the canonical "not provided" value — never null or
   * undefined — to match the LINE bot's Firestore schema contract.
   */
  deliveryAddress: string
  items: OrderItem[]
  totalAmount: number
  paymentStatus: OrderPaymentStatus
  paymentMethod: OrderPaymentMethod | null
  orderDate: Date
  deliveryDate: Date | null
  paidAt: Date | null
}

function tsToDate(value: unknown, fallback: Date = new Date()): Date {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? fallback : parsed
  }
  return fallback
}

function tsToDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function dateToTimestamp(value: Date | null): Timestamp | null {
  return value ? Timestamp.fromDate(value) : null
}

// Tracks which legacy driver user IDs we've already warned about in this
// session so we don't flood the console as Firestore re-emits snapshots.
const legacyDriverIdsWarned = new Set<string>()

function coerceUserRole(rawRole: unknown, docId: string): UserRole {
  if (rawRole === "boss") return "boss"
  if (rawRole === "customer") return "customer"
  if (rawRole === "driver") {
    if (!legacyDriverIdsWarned.has(docId)) {
      legacyDriverIdsWarned.add(docId)
      console.warn(
        `[firestore] legacy Users/${docId} has role="driver"; coercing to "customer". ` +
          `Run a one-off cleanup to flip stale documents on disk.`,
      )
    }
    return "customer"
  }
  return "customer"
}

/** Test-only hook for resetting the warned-once memo. Not part of the public API. */
export function __resetLegacyDriverWarnings() {
  legacyDriverIdsWarned.clear()
}

const userConverter: FirestoreDataConverter<UserDoc> = {
  toFirestore: (user) => {
    const data = user as Partial<UserDoc>
    const createdAtValue: Timestamp | FieldValue = data.createdAt
      ? Timestamp.fromDate(data.createdAt as Date)
      : serverTimestamp()
    return {
      role: data.role,
      displayName: data.displayName,
      phone: data.phone,
      notes: data.notes,
      createdAt: createdAtValue,
    }
  },
  fromFirestore: (snap) => {
    const data = snap.data()
    return {
      id: snap.id,
      role: coerceUserRole(data.role, snap.id),
      displayName: data.displayName ?? "",
      phone: data.phone ?? "",
      createdAt: tsToDate(data.createdAt),
      notes: data.notes ?? "",
    }
  },
}

export { userConverter }

const productConverter: FirestoreDataConverter<ProductDoc> = {
  toFirestore: (product) => ({
    productName: product.productName,
    spec: product.spec,
    price: product.price,
    isActive: product.isActive,
  }),
  fromFirestore: (snap) => {
    const data = snap.data()
    return {
      id: snap.id,
      productName: data.productName ?? "",
      spec: data.spec ?? "",
      price: Number(data.price ?? 0),
      isActive: Boolean(data.isActive ?? true),
    }
  },
}

const KNOWN_PAYMENT_STATUSES: ReadonlySet<OrderPaymentStatus> = new Set([
  "unpaid",
  "paid",
  "pending_confirmation",
])

export const orderConverter: FirestoreDataConverter<OrderDoc> = {
  toFirestore: (order) => {
    const data = order as Partial<OrderDoc>
    const orderDateValue: Timestamp | FieldValue = data.orderDate
      ? Timestamp.fromDate(data.orderDate as Date)
      : serverTimestamp()
    return {
      customerId: data.customerId,
      customerName: data.customerName,
      driverId: data.driverId ?? null,
      deliveryAddress: data.deliveryAddress ?? "",
      items: data.items,
      totalAmount: data.totalAmount,
      paymentStatus: data.paymentStatus,
      paymentMethod: data.paymentMethod ?? null,
      orderDate: orderDateValue,
      deliveryDate: dateToTimestamp(data.deliveryDate ?? null),
      paidAt: dateToTimestamp(data.paidAt ?? null),
    }
  },
  fromFirestore: (snap) => {
    const data = snap.data()
    const rawStatus = data.paymentStatus as OrderPaymentStatus | undefined
    const paymentStatus: OrderPaymentStatus =
      rawStatus && KNOWN_PAYMENT_STATUSES.has(rawStatus) ? rawStatus : "unpaid"
    return {
      id: snap.id,
      customerId: data.customerId ?? "",
      customerName: data.customerName ?? "",
      driverId: data.driverId ?? null,
      deliveryAddress: typeof data.deliveryAddress === "string" ? data.deliveryAddress : "",
      items: Array.isArray(data.items)
        ? data.items.map((raw: Partial<OrderItem>) => ({
            productName: raw.productName ?? "",
            spec: raw.spec ?? "",
            quantity: Number(raw.quantity ?? 0),
            unitPrice: Number(raw.unitPrice ?? 0),
            subtotal: Number(raw.subtotal ?? 0),
          }))
        : [],
      totalAmount: Number(data.totalAmount ?? 0),
      paymentStatus,
      paymentMethod: (data.paymentMethod as OrderPaymentMethod) ?? null,
      orderDate: tsToDate(data.orderDate),
      deliveryDate: tsToDateOrNull(data.deliveryDate),
      paidAt: tsToDateOrNull(data.paidAt),
    }
  },
}

export function usersCol() {
  return collection(getDb(), "Users").withConverter(userConverter)
}

export function productsCol() {
  return collection(getDb(), "Products").withConverter(productConverter)
}

export function ordersCol() {
  return collection(getDb(), "Orders").withConverter(orderConverter)
}

export function subscribeOrders(
  onChange: (orders: OrderDoc[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(ordersCol(), orderBy("orderDate", "desc"))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  )
}

export function subscribeProducts(
  onChange: (products: ProductDoc[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(productsCol(), orderBy("productName"))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  )
}

export function subscribeUsers(
  onChange: (users: UserDoc[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(usersCol(), orderBy("createdAt", "desc"))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  )
}

export async function createOrder(order: Omit<OrderDoc, "id" | "paidAt"> & { paidAt?: Date | null }) {
  // Bypass converter so we can write FieldValue (serverTimestamp) for createdAt.
  const ref = collection(getDb(), "Orders")
  const paidAt =
    order.paymentStatus === "paid"
      ? order.paidAt
        ? Timestamp.fromDate(order.paidAt)
        : serverTimestamp()
      : null
  return addDoc(ref, {
    customerId: order.customerId,
    customerName: order.customerName,
    driverId: order.driverId ?? null,
    // deliveryAddress: always-written field. "" is the valid "not provided"
    // value to match the LINE bot's Firestore schema contract.
    deliveryAddress: order.deliveryAddress ?? "",
    items: order.items,
    totalAmount: order.totalAmount,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentStatus === "paid" ? order.paymentMethod ?? null : null,
    orderDate: Timestamp.fromDate(order.orderDate),
    deliveryDate: order.deliveryDate ? Timestamp.fromDate(order.deliveryDate) : null,
    paidAt,
    createdAt: serverTimestamp(),
  })
}

/**
 * Patch an existing order. System-managed fields are auto-reconciled:
 * - When `paymentStatus` is set to `"paid"` and `paidAt` is not supplied, `paidAt`
 *   is filled with `serverTimestamp()` (system clock, not the user's laptop clock).
 * - When `paymentStatus` is set to anything other than `"paid"` (e.g. re-opening an
 *   order back to `unpaid` or `pending_confirmation`), `paidAt` and `paymentMethod`
 *   are forced to `null` so stale values do not linger.
 *
 * For payment confirmation specifically, prefer {@link confirmOrderPayment}.
 */
export async function updateOrder(
  id: string,
  patch: Partial<Omit<OrderDoc, "id">>,
) {
  const ref = doc(getDb(), "Orders", id)
  const data: Record<string, unknown> = { ...patch }
  if (patch.orderDate instanceof Date) {
    data.orderDate = Timestamp.fromDate(patch.orderDate)
  }
  if ("deliveryDate" in patch) {
    data.deliveryDate = patch.deliveryDate ? Timestamp.fromDate(patch.deliveryDate) : null
  }
  if ("paidAt" in patch) {
    data.paidAt = patch.paidAt ? Timestamp.fromDate(patch.paidAt) : null
  }
  if (patch.paymentStatus === "paid") {
    if (!("paidAt" in patch) || patch.paidAt === undefined) {
      data.paidAt = serverTimestamp()
    }
  } else if (patch.paymentStatus !== undefined) {
    data.paidAt = null
    data.paymentMethod = null
  }
  return updateDoc(ref, data)
}

export async function deleteOrder(id: string) {
  return deleteDoc(doc(getDb(), "Orders", id))
}

/**
 * Boss-only action: stamp the order as delivered with the server clock and
 * record an optional free-text label for who physically delivered it.
 * Whitespace-only labels are normalized to `null`.
 */
export async function markOrderDelivered(
  id: string,
  driverLabel: string | null,
) {
  const trimmed = driverLabel && driverLabel.trim() ? driverLabel.trim() : null
  return updateDoc(doc(getDb(), "Orders", id), {
    deliveryDate: serverTimestamp(),
    driverId: trimmed,
  })
}

/**
 * Boss-only correction: roll the order back to "not yet delivered" so the
 * boss can re-stamp it with the right date. Keeps `driverId` on the doc for
 * audit — the boss can edit it via the "標記送達" dialog when re-marking.
 */
export async function resetOrderDelivery(id: string) {
  return updateDoc(doc(getDb(), "Orders", id), {
    deliveryDate: null,
  })
}

/**
 * Boss-confirms a customer's reported payment. Transitions the order from
 * `pending_confirmation` (or any other state) to `paid`, records the chosen
 * payment method, and stamps `paidAt` with the server clock.
 */
export async function confirmOrderPayment(
  id: string,
  method: OrderPaymentMethod,
) {
  const ref = doc(getDb(), "Orders", id)
  return updateDoc(ref, {
    paymentStatus: "paid",
    paymentMethod: method,
    paidAt: serverTimestamp(),
  })
}

export async function upsertUser(user: UserDoc) {
  // Merge so bot-only fields (e.g. lastSeenAt, liffConsent) are not overwritten.
  return setDoc(doc(usersCol(), user.id), user, { merge: true })
}

export async function upsertProduct(product: ProductDoc) {
  return setDoc(doc(productsCol(), product.id), product, { merge: true })
}
