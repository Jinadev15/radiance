"use client"

import AddStudentForm from "@/components/add-student-form"
import PageHeader from "@/components/page-header"

export default function AddStudentPage() {
  return (
    <div className="space-y-8 p-8">
      <PageHeader title="Add New Student" description="Register a new student and capture facial data" />
      <div className="max-w-2xl">
        <AddStudentForm />
      </div>
    </div>
  )
}
