import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { sourceBuildIdentity } from '../../../scripts/build-identity'

test('overlay content changes identity without changing Git HEAD or release', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'quanttrade-build-'))
  const root = join(workspace, 'apps', 'terminal')
  try {
    mkdirSync(root, { recursive: true })
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'public'))
    for (const file of ['vite.config.ts', 'package.json', 'tsconfig.json'])
      writeFileSync(join(root, file), '{}')
    writeFileSync(join(root, 'src', 'ticket.ts'), 'old ticket')
    const first = sourceBuildIdentity(root, 'same-commit')
    expect(sourceBuildIdentity(root, 'same-commit')).toBe(first)
    writeFileSync(join(root, 'public', 'version.json'), first)
    expect(sourceBuildIdentity(root, 'same-commit')).toBe(first)
    mkdirSync(join(root, 'public', '_pyodide'))
    writeFileSync(join(root, 'public', '_pyodide', 'runtime.js'), 'staged runtime')
    expect(sourceBuildIdentity(root, 'same-commit')).toBe(first)
    writeFileSync(join(root, 'public', 'logo.svg'), '<svg/>')
    const branded = sourceBuildIdentity(root, 'same-commit')
    expect(branded).not.toBe(first)
    const plugin = join(workspace, 'packages', 'plugins', 'src')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'connector.ts'), 'connector fix')
    const connected = sourceBuildIdentity(root, 'same-commit')
    expect(connected).not.toBe(branded)
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'output.js'), 'generated output')
    expect(sourceBuildIdentity(root, 'same-commit')).toBe(connected)
    writeFileSync(join(root, 'src', 'ticket.ts'), 'corrected ticket')
    expect(sourceBuildIdentity(root, 'same-commit')).not.toBe(first)
    expect(sourceBuildIdentity(root, '')).toMatch(/^source-[a-f0-9]{16}$/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
