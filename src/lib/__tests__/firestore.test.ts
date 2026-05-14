import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const SERVER_TIMESTAMP_SENTINEL = Symbol.for("firestore.serverTimestamp.sentinel")

class FakeTimestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  toDate() {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000))
  }
  static fromDate(date: Date) {
    const ms = date.getTime()
    return new FakeTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1_000_000)
  }
}

const updateDocMock = vi.fn(async () => undefined)
const setDocMock = vi.fn(async () => undefined)
const addDocMock = vi.fn(async () => ({ id: "new-id" }))

function makeCollection(name: string) {
  const col: { name: string; withConverter: (c: unknown) => typeof col } = {
    name,
    withConverter: () => col,
  }
  return col
}

vi.mock("firebase/firestore", () => {
  return {
    Timestamp: FakeTimestamp,
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
    doc: (col: { name: string } | unknown, idOrCollection?: string, maybeId?: string) => {
      // Two call shapes: doc(db, "Collection", "id")  OR  doc(collectionRef, "id")
      if (typeof idOrCollection === "string" && typeof maybeId === "string") {
        return { id: maybeId }
      }
      return { id: idOrCollection ?? "auto-id" }
    },
    collection: (_db: unknown, name: string) => makeCollection(name),
    addDoc: addDocMock,
    setDoc: setDocMock,
    updateDoc: updateDocMock,
    deleteDoc: vi.fn(async () => undefined),
    onSnapshot: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
  }
})

vi.mock("../firebase", () => ({
  getDb: () => ({}),
  isFirebaseConfigured: true,
  firebaseApp: null,
}))

// Re-import lazily so the mocks above are in place.
async function loadModule() {
  return await import("../firestore")
}

function makeSnap(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
    // Firestore's QueryDocumentSnapshot has many other fields, but the converter
    // only touches .id and .data() — that's all we need to stub.
  } as unknown as Parameters<
    import("../firestore")["orderConverter"]["fromFirestore"]
  >[0]
}

describe("orderConverter.fromFirestore", () => {
  test("hydrates paidAt when present", async () => {
    const { orderConverter } = await loadModule()
    const paidDate = new Date("2026-04-01T05:30:00Z")
    const result = orderConverter.fromFirestore(
      makeSnap("ORDER_1", {
        customerId: "U1",
        customerName: "甲客戶",
        driverId: "D1",
        items: [],
        totalAmount: 0,
        paymentStatus: "paid",
        paymentMethod: "cash",
        orderDate: FakeTimestamp.fromDate(new Date("2026-03-31T00:00:00Z")),
        deliveryDate: null,
        paidAt: FakeTimestamp.fromDate(paidDate),
      }),
    )
    expect(result.paidAt).toBeInstanceOf(Date)
    expect(result.paidAt?.getTime()).toBe(paidDate.getTime())
  })

  test("returns paidAt = null when missing", async () => {
    const { orderConverter } = await loadModule()
    const result = orderConverter.fromFirestore(
      makeSnap("ORDER_2", {
        customerId: "U1",
        customerName: "甲客戶",
        driverId: null,
        items: [],
        totalAmount: 0,
        paymentStatus: "unpaid",
        paymentMethod: null,
        orderDate: FakeTimestamp.fromDate(new Date("2026-03-31T00:00:00Z")),
        deliveryDate: null,
      }),
    )
    expect(result.paidAt).toBeNull()
  })

  test("falls back unknown paymentStatus to 'unpaid' but preserves 'pending_confirmation'", async () => {
    const { orderConverter } = await loadModule()
    const unknown = orderConverter.fromFirestore(
      makeSnap("ORDER_3", {
        customerId: "U1",
        customerName: "甲",
        paymentStatus: "totally_made_up_value",
        orderDate: FakeTimestamp.fromDate(new Date("2026-03-31T00:00:00Z")),
      }),
    )
    expect(unknown.paymentStatus).toBe("unpaid")

    const pending = orderConverter.fromFirestore(
      makeSnap("ORDER_4", {
        customerId: "U1",
        customerName: "乙",
        paymentStatus: "pending_confirmation",
        orderDate: FakeTimestamp.fromDate(new Date("2026-03-31T00:00:00Z")),
      }),
    )
    expect(pending.paymentStatus).toBe("pending_confirmation")
  })
})

describe("orderConverter.toFirestore", () => {
  test("writes paidAt as Timestamp when Date is provided", async () => {
    const { orderConverter } = await loadModule()
    const paidAt = new Date("2026-04-15T12:00:00Z")
    const out = orderConverter.toFirestore({
      id: "ORDER_5",
      customerId: "U1",
      customerName: "甲",
      driverId: null,
      items: [],
      totalAmount: 0,
      paymentStatus: "paid",
      paymentMethod: "cash",
      orderDate: new Date("2026-04-15T00:00:00Z"),
      deliveryDate: null,
      paidAt,
    }) as Record<string, unknown>
    expect(out.paidAt).toBeInstanceOf(FakeTimestamp)
  })

  test("writes paidAt = null when paidAt is null", async () => {
    const { orderConverter } = await loadModule()
    const out = orderConverter.toFirestore({
      id: "ORDER_6",
      customerId: "U1",
      customerName: "甲",
      driverId: null,
      items: [],
      totalAmount: 0,
      paymentStatus: "unpaid",
      paymentMethod: null,
      orderDate: new Date(),
      deliveryDate: null,
      paidAt: null,
    }) as Record<string, unknown>
    expect(out.paidAt).toBeNull()
  })
})

describe("updateOrder auto-fill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('auto-fills paidAt when paymentStatus = "paid" and paidAt is not provided', async () => {
    const { updateOrder } = await loadModule()
    await updateOrder("ORDER_1", { paymentStatus: "paid" })
    expect(updateDocMock).toHaveBeenCalledTimes(1)
    const patch = updateDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.paymentStatus).toBe("paid")
    expect(patch.paidAt).toBe(SERVER_TIMESTAMP_SENTINEL)
  })

  test('nulls out paidAt and paymentMethod when paymentStatus = "unpaid"', async () => {
    const { updateOrder } = await loadModule()
    await updateOrder("ORDER_1", { paymentStatus: "unpaid" })
    expect(updateDocMock).toHaveBeenCalledTimes(1)
    const patch = updateDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.paymentStatus).toBe("unpaid")
    expect(patch.paidAt).toBeNull()
    expect(patch.paymentMethod).toBeNull()
  })

  test('nulls out paidAt and paymentMethod when paymentStatus = "pending_confirmation"', async () => {
    const { updateOrder } = await loadModule()
    await updateOrder("ORDER_1", { paymentStatus: "pending_confirmation" })
    expect(updateDocMock).toHaveBeenCalledTimes(1)
    const patch = updateDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(patch.paymentStatus).toBe("pending_confirmation")
    expect(patch.paidAt).toBeNull()
    expect(patch.paymentMethod).toBeNull()
  })

  test('preserves explicit paidAt when caller provides one with status="paid"', async () => {
    const { updateOrder } = await loadModule()
    const explicit = new Date("2026-04-10T12:00:00Z")
    await updateOrder("ORDER_1", { paymentStatus: "paid", paidAt: explicit })
    const patch = updateDocMock.mock.calls[0][1] as Record<string, unknown>
    // Should be a Timestamp, not the server-timestamp sentinel.
    expect(patch.paidAt).not.toBe(SERVER_TIMESTAMP_SENTINEL)
    expect(patch.paidAt).toBeInstanceOf(FakeTimestamp)
  })
})

describe("confirmOrderPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("writes the expected patch shape", async () => {
    const { confirmOrderPayment } = await loadModule()
    await confirmOrderPayment("ORDER_42", "transfer")
    expect(updateDocMock).toHaveBeenCalledTimes(1)
    const [ref, patch] = updateDocMock.mock.calls[0] as [
      { id: string },
      Record<string, unknown>,
    ]
    expect(ref).toEqual({ id: "ORDER_42" })
    expect(patch).toEqual({
      paymentStatus: "paid",
      paymentMethod: "transfer",
      paidAt: SERVER_TIMESTAMP_SENTINEL,
    })
  })
})

describe("upsertUser / upsertProduct merge mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("upsertUser uses { merge: true }", async () => {
    const { upsertUser } = await loadModule()
    await upsertUser({
      id: "U_1",
      role: "customer",
      displayName: "test",
      phone: "0900",
      createdAt: new Date(),
      notes: "",
    })
    expect(setDocMock).toHaveBeenCalledTimes(1)
    const options = setDocMock.mock.calls[0][2]
    expect(options).toEqual({ merge: true })
  })

  test("upsertProduct uses { merge: true }", async () => {
    const { upsertProduct } = await loadModule()
    await upsertProduct({
      id: "P_1",
      productName: "test",
      spec: "",
      price: 100,
      isActive: true,
    })
    expect(setDocMock).toHaveBeenCalledTimes(1)
    const options = setDocMock.mock.calls[0][2]
    expect(options).toEqual({ merge: true })
  })
})

describe("createOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("writes createdAt = serverTimestamp() and orderDate = Timestamp", async () => {
    const { createOrder } = await loadModule()
    await createOrder({
      customerId: "U1",
      customerName: "客戶",
      driverId: null,
      items: [],
      totalAmount: 0,
      paymentStatus: "unpaid",
      paymentMethod: null,
      orderDate: new Date("2026-05-01T00:00:00Z"),
      deliveryDate: null,
    })
    expect(addDocMock).toHaveBeenCalledTimes(1)
    const data = addDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(data.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL)
    expect(data.orderDate).toBeInstanceOf(FakeTimestamp)
    expect(data.paidAt).toBeNull()
  })

  test('writes paidAt = serverTimestamp() when paymentStatus = "paid" without explicit paidAt', async () => {
    const { createOrder } = await loadModule()
    await createOrder({
      customerId: "U1",
      customerName: "客戶",
      driverId: null,
      items: [],
      totalAmount: 0,
      paymentStatus: "paid",
      paymentMethod: "cash",
      orderDate: new Date("2026-05-01T00:00:00Z"),
      deliveryDate: null,
    })
    const data = addDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(data.paidAt).toBe(SERVER_TIMESTAMP_SENTINEL)
    expect(data.paymentMethod).toBe("cash")
  })
})
