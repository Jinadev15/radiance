"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import DashboardCards from "@/components/dashboard-cards"
import PageHeader from "@/components/page-header"

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.push('/login')
    }
  }, [router])

  return (
    <div className="space-y-8 p-8">
      <PageHeader title="Dashboard" description="Welcome back to your attendance system" />
      <DashboardCards />
    </div>
  )
}
