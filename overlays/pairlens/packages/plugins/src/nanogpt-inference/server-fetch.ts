const endpoint = '/_quanttrade/api/ai/nanogpt/jobs'
const target = 'https://api.nano-gpt.com/api/v1/chat/completions'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const connectionError = () => new TypeError('NanoGPT server connection failed')

export class NanoGPTServerError extends Error {
  constructor(readonly statusCode: number) {
    super(
      statusCode === 401 || statusCode === 403
        ? 'NanoGPT server session requires sign-in'
        : statusCode === 404
          ? 'NanoGPT server response expired; no request was replayed'
          : statusCode === 429
            ? 'NanoGPT server capacity limit reached'
            : 'NanoGPT server request failed',
    )
    this.name = 'NanoGPTServerError'
  }
}

/** Opt-in server transport. Resumes bytes from one job, never repeats model work. */
export async function fetchNanogptOnServer(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const address = url instanceof Request ? url.url : String(url)
  let request: unknown
  let apiKey: string | undefined
  try {
    if (
      address !== target ||
      init?.method?.toUpperCase() !== 'POST' ||
      typeof init.body !== 'string'
    )
      throw new Error()
    request = JSON.parse(init.body)
    if (
      !request ||
      typeof request !== 'object' ||
      !('stream' in request) ||
      request.stream !== true
    )
      throw new Error()
    apiKey = new Headers(init.headers)
      .get('authorization')
      ?.match(/^Bearer (\S+)$/i)?.[1]
    if (!apiKey) throw new Error()
  } catch {
    throw new TypeError('Invalid NanoGPT server request')
  }

  const controller = new AbortController()
  const signal = controller.signal
  const callerSignal =
    init?.signal ?? (url instanceof Request ? url.signal : undefined)
  let jobId: string | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let finished = false
  const abortError = () =>
    new DOMException('NanoGPT request canceled', 'AbortError')
  const clean = () => {
    clearTimeout(deadline)
    callerSignal?.removeEventListener('abort', abort)
  }
  const removeJob = () => {
    if (jobId)
      void fetch(`${endpoint}/${jobId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => undefined)
  }
  const abort = () => {
    if (finished) return
    finished = true
    controller.abort(abortError())
    void reader?.cancel().catch(() => undefined)
    streamController?.error(abortError())
    removeJob()
    clean()
  }
  const deadline = setTimeout(abort, 10 * 60 * 1000)
  callerSignal?.addEventListener('abort', abort, { once: true })
  if (callerSignal?.aborted) abort()
  const check = () => {
    if (signal.aborted) throw abortError()
  }
  const pause = (duration: number) =>
    new Promise<void>((resolve, reject) => {
      check()
      const onAbort = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(abortError())
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, duration)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  const rawFetch = async (
    path: string,
    options: RequestInit,
  ): Promise<Response> => {
    check()
    try {
      return await fetch(path, {
        ...options,
        credentials: 'same-origin',
        signal,
      })
    } catch {
      check()
      throw connectionError()
    }
  }
  const body = JSON.stringify({
    requestId: crypto.randomUUID(),
    apiKey,
    request,
  })
  let offset = 0
  let failures = 0
  const readResponse = async (): Promise<Response> => {
    for (;;) {
      check()
      let response: Response
      try {
        response = await rawFetch(`${endpoint}/${jobId}?offset=${offset}`, {
          method: 'GET',
        })
      } catch {
        check()
        if (++failures >= 3) throw connectionError()
        await pause(failures * 250)
        continue
      }
      if (response.status === 202) {
        await response.body?.cancel()
        await pause(1000)
        continue
      }
      if (
        !response.ok &&
        response.headers.get('x-quanttrade-ai-upstream') !== '1'
      ) {
        await response.body?.cancel()
        throw new NanoGPTServerError(response.status)
      }
      return response
    }
  }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await rawFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        if (!created.ok) {
          await created.body?.cancel()
          throw new NanoGPTServerError(created.status)
        }
        const result: unknown = await created.json()
        if (
          !result ||
          typeof result !== 'object' ||
          !('id' in result) ||
          typeof result.id !== 'string' ||
          !uuid.test(result.id)
        )
          throw connectionError()
        jobId = result.id
        if (signal.aborted) removeJob()
        break
      } catch (error) {
        check()
        if (error instanceof NanoGPTServerError) throw error
        if (attempt === 2) throw connectionError()
        await pause((attempt + 1) * 250)
      }
    }
    if (!jobId) throw connectionError()
    check()
    const response = await readResponse()
    reader = response.body?.getReader()
    if (!reader) {
      finished = true
      clean()
      return new Response(null, { status: response.status })
    }
    const stream = new ReadableStream<Uint8Array>(
      {
        start(value) {
          streamController = value
        },
        async pull(value) {
          try {
            for (;;) {
              check()
              let chunk: Awaited<
                ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>
              >
              try {
                chunk = await reader!.read()
              } catch {
                check()
                if (++failures >= 3) throw connectionError()
                await pause(failures * 250)
                const resumed = await readResponse()
                if (resumed.status !== response.status || !resumed.body)
                  throw connectionError()
                reader = resumed.body.getReader()
                continue
              }
              if (chunk.done) {
                finished = true
                clean()
                value.close()
                return
              }
              offset += chunk.value.byteLength
              failures = 0
              value.enqueue(chunk.value)
              return
            }
          } catch (error) {
            if (!finished) {
              finished = true
              clean()
              value.error(
                signal.aborted
                  ? abortError()
                  : error instanceof NanoGPTServerError
                    ? error
                    : connectionError(),
              )
            }
          }
        },
        cancel() {
          abort()
        },
      },
      { highWaterMark: 0 },
    )
    return new Response(stream, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('content-type') ?? 'text/event-stream',
      },
    })
  } catch (error) {
    if (!finished) {
      finished = true
      clean()
    }
    throw signal.aborted
      ? abortError()
      : error instanceof NanoGPTServerError
        ? error
        : connectionError()
  }
}
