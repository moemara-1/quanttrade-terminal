import { createFileRoute } from '@tanstack/react-router'
import { ScannersPane } from '@/components/scanners/scanners-pane'

export const Route = createFileRoute('/_terminal/scanners')({
  component: ScannersPage,
})
function ScannersPage() {
  return (
    <div className="h-full min-h-0">
      <ScannersPane />
    </div>
  )
}
