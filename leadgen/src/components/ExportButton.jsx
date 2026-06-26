import { Download } from 'lucide-react'
import { exportCsvUrl } from '../api/client.js'

export function ExportButton({ jobId, leadCount }) {
  if (!jobId || !leadCount) return null
  return (
    <a className="lg-btn-ghost" href={exportCsvUrl(jobId)} download>
      <Download size={14} />
      Export CSV ({leadCount})
    </a>
  )
}
