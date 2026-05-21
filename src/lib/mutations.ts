import { toast } from "sonner"

/**
 * Wraps a Firestore mutation so every call site gets a uniform success/error
 * toast and a console error trail. Returns the operation's result, or `null`
 * if the operation threw (so callers can branch without re-throwing).
 */
export async function withWriteFeedback<T>(
  label: string,
  op: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await op()
    toast.success(`${label} 成功`)
    return result
  } catch (err) {
    console.error(`[mutation] ${label} failed`, err)
    const message = err instanceof Error ? err.message : "未知錯誤"
    toast.error(`${label} 失敗：${message}`)
    return null
  }
}
