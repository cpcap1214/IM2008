import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const batchSetMock = vi.fn()
const batchDeleteMock = vi.fn()
const batchCommitMock = vi.fn(async () => undefined)

vi.mock("firebase/firestore", () => {
  return {
    Timestamp: {
      fromDate: (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }),
      now: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0, toDate: () => new Date() }),
    },
    serverTimestamp: () => Symbol.for("server-ts"),
    collection: (_db: unknown, name: string) => ({ name }),
    doc: (_db: unknown, name: string, id: string) => ({ name, id }),
    getDocs: vi.fn(async () => ({ docs: [] })),
    writeBatch: () => ({
      set: batchSetMock,
      delete: batchDeleteMock,
      commit: batchCommitMock,
    }),
  }
})

vi.mock("../firebase", () => ({
  getDb: () => ({}),
  isFirebaseConfigured: true,
  firebaseApp: null,
}))

const ORIGINAL_ENV = { ...import.meta.env }

afterEach(() => {
  vi.clearAllMocks()
  // Reset env between tests so the first test's mutation doesn't bleed.
  for (const key of Object.keys(import.meta.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete (import.meta.env as Record<string, unknown>)[key]
    }
  }
  Object.assign(import.meta.env, ORIGINAL_ENV)
})

describe("seedSampleData gating", () => {
  beforeEach(() => {
    // Default: disabled.
    ;(import.meta.env as Record<string, unknown>).VITE_ENABLE_SEED = "false"
  })

  test('throws when VITE_ENABLE_SEED is not "true"', async () => {
    const { seedSampleData } = await import("../seed")
    await expect(seedSampleData()).rejects.toThrow(/VITE_ENABLE_SEED/)
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  test('clearSampleData throws when VITE_ENABLE_SEED is not "true"', async () => {
    const { clearSampleData } = await import("../seed")
    await expect(clearSampleData()).rejects.toThrow(/VITE_ENABLE_SEED/)
  })

  test('seedSampleData proceeds when VITE_ENABLE_SEED = "true"', async () => {
    ;(import.meta.env as Record<string, unknown>).VITE_ENABLE_SEED = "true"
    const { seedSampleData } = await import("../seed")
    await seedSampleData()
    expect(batchCommitMock).toHaveBeenCalledTimes(1)
    expect(batchSetMock).toHaveBeenCalled()
  })
})

describe("seed bodies do not include id field", () => {
  test('Users / Products / Orders writes omit "id"', async () => {
    ;(import.meta.env as Record<string, unknown>).VITE_ENABLE_SEED = "true"
    const { seedSampleData } = await import("../seed")
    await seedSampleData()
    for (const call of batchSetMock.mock.calls) {
      const data = call[1] as Record<string, unknown>
      expect(data).not.toHaveProperty("id")
    }
  })
})
