"use client"

import ReportsPage from "@/components/reports-page"
import PageHeader from "@/components/page-header"

export default function ReportsPageWrapper() {
  return (
    <div className="space-y-8 p-8">
      <PageHeader title="Reports" description="View and export attendance reports" />
      <ReportsPage />
    </div>
  )
}
