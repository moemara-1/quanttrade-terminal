/**
 * The SDK already retries HTTP failures and network errors with a cause.
 * Chrome's cause-less fetch TypeError bypasses that retry classification.
 * Recover that startup case once, never an accepted response or its body.
 */
export async function fetchNanogptWithRecovery(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const signal =
    init?.signal ?? (url instanceof Request ? url.signal : undefined)
  signal?.throwIfAborted()
  try {
    return await fetch(url, init)
  } catch (error) {
    if (
      !(error instanceof TypeError) ||
      error.cause !== undefined ||
      !/^(failed to fetch|fetch failed|load failed)$/i.test(error.message)
    )
      throw error
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, 250)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    signal?.throwIfAborted()
    return fetch(url, init)
  }
}
