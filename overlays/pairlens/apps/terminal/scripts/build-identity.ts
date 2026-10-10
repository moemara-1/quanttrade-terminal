import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Stable across client/server/prerender, including uncommitted overlay files. */
export function sourceBuildIdentity(root: string, commit: string): string {
  const hash = createHash('sha256')
  const visit = (path: string): void => {
    if (!existsSync(path)) return
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = join(path, entry.name)
      if (file === join(root, 'public', 'version.json')) continue
      // Vite stages this runtime after resolving config; hashing it would
      // disagree between the first and subsequent build environments.
      if (file === join(root, 'public', '_pyodide')) continue
      if (['node_modules', 'dist', 'build', '.turbo', '.cache'].includes(entry.name))
        continue
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) {
        hash.update(relative(root, file).replaceAll('\\', '/'))
        hash.update('\0')
        hash.update(readFileSync(file))
        hash.update('\0')
      }
    }
  }
  visit(join(root, 'src'))
  visit(join(root, 'scripts'))
  visit(join(root, 'public'))
  const packages = join(root, '..', '..', 'packages')
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue
      const directory = join(packages, entry.name)
      visit(join(directory, 'src'))
      for (const config of ['package.json', 'tsconfig.json']) {
        const file = join(directory, config)
        if (!existsSync(file)) continue
        hash.update(relative(root, file).replaceAll('\\', '/'))
        hash.update('\0')
        hash.update(readFileSync(file))
        hash.update('\0')
      }
    }
  }
  for (const file of ['vite.config.ts', 'package.json', 'tsconfig.json']) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(join(root, file)))
    hash.update('\0')
  }
  return `${commit || 'source'}-${hash.digest('hex').slice(0, 16)}`
}
