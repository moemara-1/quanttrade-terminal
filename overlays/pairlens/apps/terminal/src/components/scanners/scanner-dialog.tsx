import { Dialog } from '@base-ui/react/dialog'
import { ReleaseSheetFocusTraps } from '@pairlens/ui/lib/use-release-sheet-focus-traps'
import type { ReactNode } from 'react'

export function ScannerDialog({
  open,
  onClose,
  busy = false,
  title,
  wide = false,
  children,
}: {
  open: boolean
  onClose: () => void
  busy?: boolean
  title: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, event) => {
        if (!next) {
          if (busy) event.cancel()
          else onClose()
        }
      }}
    >
      <Dialog.Portal keepMounted>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-closed:hidden" />
        <Dialog.Popup
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            if (!busy) onClose()
          }}
          className={`fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none data-closed:hidden ${wide ? 'h-[min(860px,calc(100dvh-24px))] max-w-[1000px]' : 'h-[min(760px,calc(100dvh-24px))] max-w-[780px]'}`}
        >
          {open && <ReleaseSheetFocusTraps />}
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
