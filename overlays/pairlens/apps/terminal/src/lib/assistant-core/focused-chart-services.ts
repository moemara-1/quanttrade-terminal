// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
type ChartEntry<T> = { service: T; publish: (service: T) => () => void }
/** Same focus ownership as chart keyboard shortcuts, with a mounted fallback. */
export class FocusedChartServices<T> {
  private entries: Array<ChartEntry<T>> = []
  private active: ChartEntry<T> | null = null
  private unpublish: (() => void) | null = null
  register(service: T, publish: (service: T) => () => void) {
    const entry = { service, publish }
    this.entries.push(entry)
    const activate = () => {
      if (!this.entries.includes(entry)) return
      this.unpublish?.()
      this.active = entry
      this.unpublish = entry.publish(entry.service)
    }
    activate()
    return {
      activate,
      dispose: () => {
        const index = this.entries.indexOf(entry)
        if (index === -1) return
        this.entries.splice(index, 1)
        if (this.active !== entry) return
        this.unpublish?.()
        this.unpublish = null
        this.active = this.entries.at(-1) ?? null
        if (this.active)
          this.unpublish = this.active.publish(this.active.service)
      },
    }
  }
}
