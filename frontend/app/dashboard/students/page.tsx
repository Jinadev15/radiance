"use client"
import { useRouter } from "next/navigation"
import StudentsTable from "@/components/students-table"
import PageHeader from "@/components/page-header"
import { Button } from "@/components/ui/button"

export default function StudentsPage() {
  const router = useRouter()

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <PageHeader title="Manage Students" description="View and manage all student records" />
        <Button onClick={() => router.push("/dashboard/students/add")} className="bg-primary hover:bg-primary/90">
          + Add Student
        </Button>
      </div>
      <StudentsTable />
    </div>
  )
}
