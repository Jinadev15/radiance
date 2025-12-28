"use client"

import AttendanceMonitor from "@/components/attendance-monitor"
import PageHeader from "@/components/page-header"

export default function AttendancePage() {
  return (
    <div className="space-y-8 p-8">
      <PageHeader title="Attendance" description="Real-time student recognition and attendance tracking" />
      <AttendanceMonitor />
    </div>
  )
}
