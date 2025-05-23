import { describe, expect, it, vi } from 'vitest'
import { asyncBufferFromUrl, byteLengthFromUrl, toJson } from '../src/utils.js'

describe('toJson', () => {
  it('convert undefined to null', () => {
    expect(toJson(undefined)).toBe(null)
    expect(toJson(null)).toBe(null)
  })

  it('convert bigint to number', () => {
    expect(toJson(123n)).toBe(123)
    expect(toJson([123n, 456n])).toEqual([123, 456])
    expect(toJson({ a: 123n, b: { c: 456n } })).toEqual({ a: 123, b: { c: 456 } })
  })

  it('convert Uint8Array to array of numbers', () => {
    expect(toJson(new Uint8Array([1, 2, 3]))).toEqual([1, 2, 3])
  })

  it('convert Date to ISO string', () => {
    const date = new Date('2023-05-27T00:00:00Z')
    expect(toJson(date)).toBe(date.toISOString())
  })

  it('ignore undefined properties in objects', () => {
    expect(toJson({ a: undefined, b: 123n })).toEqual({ b: 123 })
  })

  it('return null in objects unchanged', () => {
    expect(toJson({ a: null })).toEqual({ a: null })
    expect(toJson([null])).toEqual([null])
  })

  it('return other types unchanged', () => {
    expect(toJson('string')).toBe('string')
    expect(toJson(123)).toBe(123)
    expect(toJson(true)).toBe(true)
  })
})

describe('byteLengthFromUrl', () => {
  it('returns the byte length from Content-Length header', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Map([['Content-Length', '1024']]),
    })

    const result = await byteLengthFromUrl('https://example.com')
    expect(result).toBe(1024)
    expect(fetch).toHaveBeenCalledWith('https://example.com', { method: 'HEAD' })
  })

  it('throws an error if the response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 })

    await expect(byteLengthFromUrl('https://example.com')).rejects.toThrow('fetch head failed 404')
  })

  it('throws an error if Content-Length header is missing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Map(),
    })

    await expect(byteLengthFromUrl('https://example.com')).rejects.toThrow('missing content length')
  })


  it ('passes authentication headers', async () => {
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      if (new Headers(options.headers).get('Authorization') !== 'Bearer token') {
        return Promise.resolve({ ok: false, status: 401 })}
      return Promise.resolve({
        ok: true,
        headers: new Map([['Content-Length', '1024']]),
      })

    })

    const result = await byteLengthFromUrl('https://example.com', { headers: { Authorization: 'Bearer token' } } )
    expect(result).toBe(1024)
    expect(fetch).toHaveBeenCalledWith('https://example.com', { method: 'HEAD', headers: { Authorization: 'Bearer token' } })

    await expect(byteLengthFromUrl('https://example.com')).rejects.toThrow('fetch head failed 401')
  })

  it ('uses the provided fetch function, along with requestInit if passed', async () => {
    const customFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Map([['Content-Length', '2048']]),
    })

    const requestInit = { headers: { authorization: 'Bearer token' } }
    const result = await byteLengthFromUrl('https://example.com', requestInit, customFetch)
    expect(result).toBe(2048)
    expect(customFetch).toHaveBeenCalledWith('https://example.com', { ...requestInit, method: 'HEAD' })
  })
})

describe('asyncBufferFromUrl', () => {
  it('creates an AsyncBuffer with the correct byte length', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map([['Content-Length', '1024']]),
      })

    const buffer = await asyncBufferFromUrl({ url: 'https://example.com' })
    expect(buffer.byteLength).toBe(1024)
  })

  it('uses provided byte length if given', async () => {
    const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 2048 })
    expect(buffer.byteLength).toBe(2048)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('slice method fetches correct byte range', async () => {
    const mockArrayBuffer = new ArrayBuffer(100)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: {},
      status: 206,
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
    })

    const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024 })
    const result = await buffer.slice(0, 100)

    expect(result).toBe(mockArrayBuffer)
    expect(fetch).toHaveBeenCalledWith('https://example.com', {
      headers: new Headers({ Range: 'bytes=0-99' }),
    })
  })

  it('slice method handles undefined end parameter', async () => {
    const mockArrayBuffer = new ArrayBuffer(100)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      body: {},
      status: 206,
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
    })

    const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024 })
    await buffer.slice(100)

    expect(fetch).toHaveBeenCalledWith('https://example.com', {
      headers: new Headers({ Range: 'bytes=100-' }),
    })
  })

  it('slice method throws an error if fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 })

    const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024 })
    await expect(buffer.slice(0, 100)).rejects.toThrow('fetch failed 404')
  })

  it('passes authentication headers to get the byteLength', async () => {
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      if (new Headers(options.headers).get('Authorization') !== 'Bearer token') {
        return Promise.resolve({ ok: false, status: 401 })
      }
      return Promise.resolve({
        ok: true,
        headers: new Map([['Content-Length', '1024']]),
      })
    })

    await expect(asyncBufferFromUrl({ url: 'https://example.com' }))
      .rejects.toThrow('fetch head failed 401')

    const buffer = await asyncBufferFromUrl({ url: 'https://example.com', requestInit: { headers: { Authorization: 'Bearer token' } } } )
    expect(buffer.byteLength).toBe(1024)
  })

  it ('passes authentication headers to fetch byte range', async () => {
    const mockArrayBuffer = new ArrayBuffer(100)
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      if (new Headers(options.headers).get('Authorization') !== 'Bearer token') {
        return Promise.resolve({ ok: false, status: 401 })
      }
      if (options.headers.get('Range') !== 'bytes=0-99') {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        body: {},
        status: 206,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })
    })

    const noHeaders = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024 })
    await expect(noHeaders.slice(0, 100)).rejects.toThrow('fetch failed 401')

    const withHeaders = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024, requestInit: { headers: { Authorization: 'Bearer token' } } } )
    await expect(withHeaders.slice(0, 100)).resolves.toBe(mockArrayBuffer)

    await expect(withHeaders.slice(0, 10)).rejects.toThrow('fetch failed 404')
  })

  describe('when range requests are unsupported', () => {
    it('creates an AsyncBuffer with the correct byte length', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {},
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024 })
      const chunk = await buffer.slice(0, 100)

      expect(fetch).toHaveBeenCalledWith('https://example.com', {
        headers: new Headers({ Range: 'bytes=0-99' }),
      })

      expect(chunk.byteLength).toBe(100)
    })

    it('does not make multiple requests for multiple slices', async () => {
      const mockArrayBuffer = new ArrayBuffer(1024)
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {},
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024 })

      await buffer.slice(0, 100)
      await buffer.slice(550, 600)

      expect(fetch).toBeCalledTimes(1)
    })
  })

  describe('when a custom fetch function is provided', () => {
    it ('is used to get the byte length', async () => {
      const customFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Map([['Content-Length', '2048']]),
      })

      const requestInit = { headers: { authorization: 'Bearer token' } }
      const buffer = await asyncBufferFromUrl({ url: 'https://example.com', requestInit, fetch: customFetch })
      expect(buffer.byteLength).toBe(2048)
      expect(customFetch).toHaveBeenCalledWith('https://example.com', { ...requestInit, method: 'HEAD' })
    })
    it ('is used to fetch the slice', async () => {
      const mockArrayBuffer = new ArrayBuffer(35)
      let counter = 0
      function rateLimitedFetch() {
        counter++
        if (counter === 2) {
          return Promise.resolve({ ok: true, status: 206, body: {}, arrayBuffer: () => Promise.resolve(mockArrayBuffer) })
        }
        return Promise.resolve({ ok: false, status: 429 })
      }
      const customFetch = vi.fn().mockImplementation(async () => {
        while (true) {
          const result = await rateLimitedFetch()
          if (result.ok) {
            return result
          }
          await new Promise(resolve => setTimeout(resolve, 100)) // wait for 100ms before retrying
        }
      })
      const requestInit = { headers: { authorization: 'Bearer token' } }
      const buffer = await asyncBufferFromUrl({ url: 'https://example.com', byteLength: 1024, requestInit, fetch: customFetch })
      const result = await buffer.slice(50, 85)
      expect(result).toBe(mockArrayBuffer)
      expect(customFetch).toHaveBeenCalledWith('https://example.com', { headers: new Headers({ ...requestInit.headers, Range: 'bytes=50-84' }) })
    })
  })
})
