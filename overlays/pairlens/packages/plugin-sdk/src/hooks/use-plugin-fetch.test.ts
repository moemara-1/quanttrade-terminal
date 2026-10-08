import { describe, expect, test } from 'bun:test'
import { pluginRequestHeaders } from './use-plugin-fetch'

describe('plugin authentication headers', () => {
  test('signed-out background requests do not override browser authentication', async () => {
    for (const token of [null, undefined, '', '  ']) {
      const headers = await pluginRequestHeaders(undefined, async () => token)
      expect(headers.has('Authorization')).toBe(false)
    }
  })

  test('valid app server sessions supply bearer authentication', async () => {
    const headers = await pluginRequestHeaders(undefined, async () => 'session')
    expect(headers.get('Authorization')).toBe('Bearer session')
  })

  test('preserves explicit credentials and Headers values when signed out', async () => {
    const headers = await pluginRequestHeaders(
      {
        method: 'POST',
        headers: new Headers({
          Authorization: 'Basic supplied',
          'Content-Type': 'text/plain',
        }),
      },
      async () => '',
    )
    expect(headers.get('Authorization')).toBe('Basic supplied')
    expect(headers.get('Content-Type')).toBe('text/plain')
  })
})
