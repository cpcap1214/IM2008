import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  type FirestoreDataConverter,
} from "firebase/firestore"

import { getDb } from "./firebase"

export type UserRole = "boss" | "driver" | "customer"

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

export type OrderPaymentStatus = "unpaid" | "paid"
export type OrderPaymentMethod = "cash" | "transfer" | "check"

export type OrderDoc = {
  id: string
  customerId: string
  customerName: string
  driverId: string | null
  items: OrderItem[]
  totalAmount: number
  paymentStatus: OrderPaymentStatus
  paymentMethod: OrderPaymentMethod | null
  orderDate: Date
  deliveryDate: Date | null
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

function dateToTimestamp(value: Date | null): Timestamp | null {
  return value ? Timestamp.fromDate(value) : null
}

const userConverter: FirestoreDataConverter<UserDoc> = {
  toFirestore: (user) => {
    const data = user as UserDoc
    return {
      role: data.role,
      displayName: data.displayName,
      phone: data.phone,
      notes: data.notes,
      createdAt: dateToTimestamp(data.createdAt) ?? Timestamp.now(),
    }
  },
  fromFirestore: (snap) => {
    const data = snap.data()
    return {
      id: snap.id,
      role: (data.role as UserRole) ?? "customer",
      displayName: data.displayName ?? "",
      phone: data.phone ?? "",
      createdAt: tsToDate(data.createdAt),
      notes: data.notes ?? "",
    }
  },
}

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

const orderConverter: FirestoreDataConverter<OrderDoc> = {
  toFirestore: (order) => {
    const data = order as OrderDoc
    return {
      customerId: data.customerId,
      customerName: data.customerName,
      driverId: data.driverId,
      items: data.items,
      totalAmount: data.totalAmount,
      paymentStatus: data.paymentStatus,
      paymentMethod: data.paymentMethod,
      orderDate: dateToTimestamp(data.orderDate) ?? Timestamp.now(),
      deliveryDate: dateToTimestamp(data.deliveryDate),
    }
  },
  fromFirestore: (snap) => {
    const data = snap.data()
    return {
      id: snap.id,
      customerId: data.customerId ?? "",
      customerName: data.customerName ?? "",
      driverId: data.driverId ?? null,
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
      paymentStatus: (data.paymentStatus as OrderPaymentStatus) ?? "unpaid",
      paymentMethod: (data.paymentMethod as OrderPaymentMethod) ?? null,
      orderDate: tsToDate(data.orderDate),
      deliveryDate: data.deliveryDate ? tsToDate(data.deliveryDate) : null,
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

export async function createOrder(order: Omit<OrderDoc, "id">) {
  return addDoc(ordersCol(), order as OrderDoc)
}

export async function updateOrder(id: string, patch: Partial<Omit<OrderDoc, "id">>) {
  const ref = doc(getDb(), "Orders", id)
  const data: Record<string, unknown> = { ...patch }
  if (patch.orderDate instanceof Date) {
    data.orderDate = Timestamp.fromDate(patch.orderDate)
  }
  if ("deliveryDate" in patch) {
    data.deliveryDate = patch.deliveryDate ? Timestamp.fromDate(patch.deliveryDate) : null
  }
  return updateDoc(ref, data)
}

export async function deleteOrder(id: string) {
  return deleteDoc(doc(getDb(), "Orders", id))
}

export async function upsertUser(user: UserDoc) {
  return setDoc(doc(usersCol(), user.id), user)
}

export async function upsertProduct(product: ProductDoc) {
  return setDoc(doc(productsCol(), product.id), product)
}
