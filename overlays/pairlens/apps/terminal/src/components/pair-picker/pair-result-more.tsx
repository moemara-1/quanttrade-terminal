export function PairResultMore({
  remaining,
  onClick,
}: {
  remaining: number
  onClick: () => void
}) {
  if (!remaining) return null
  return (
    <button
      type="button"
      className="w-full rounded border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
      onClick={onClick}
    >
      Show more markets ({remaining} remaining)
    </button>
  )
}
