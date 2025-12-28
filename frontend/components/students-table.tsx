"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Edit2, Trash2, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Student {
  _id: string
  studentId: string
  name: string
  email: string
  class: {
    _id: string
    name: string
    grade: string
    section: string
  }
  isActive: boolean
}

export default function StudentsTable() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const itemsPerPage = 5
  const { toast } = useToast()

  const fetchStudents = async () => {
    try {
      setLoading(true)
      setError(null)

      const token = localStorage.getItem('token')
      if (!token) {
        setError('No authentication token found')
        return
      }

      const response = await fetch('http://localhost:5000/api/students', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch students')
      }

      const data = await response.json()
      setStudents(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStudents()
  }, [])

  const handleEdit = (student: Student) => {
    setEditingStudent(student)
    setShowEditModal(true)
  }

  const handleDelete = async (studentId: string) => {
    try {
      const token = localStorage.getItem('token')
      if (!token) {
        toast({
          title: "Error",
          description: "No authentication token found",
          variant: "destructive",
        })
        return
      }

      const response = await fetch(`http://localhost:5000/api/students/${studentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error('Failed to delete student')
      }

      toast({
        title: "Success",
        description: "Student deactivated successfully",
      })

      fetchStudents()
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete student",
        variant: "destructive",
      })
    }
  }

  const totalPages = Math.ceil(students.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedData = students.slice(startIndex, startIndex + itemsPerPage)

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin mr-2" />
          <span className="text-muted-foreground">Loading students...</span>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8">
          <p className="text-center text-destructive">{error}</p>
          <div className="flex justify-center mt-4">
            <Button onClick={fetchStudents} variant="outline">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Student Records ({students.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No students registered yet.</p>
            <p className="text-sm text-muted-foreground">Click "Add Student" to register your first student.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground">ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Email</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Class</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.map((student) => (
                    <tr key={student._id} className="border-b border-border hover:bg-muted transition-colors">
                      <td className="py-3 px-4 text-foreground">#{student.studentId}</td>
                      <td className="py-3 px-4 text-foreground font-medium">{student.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{student.email}</td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-3 py-1 rounded-full text-sm bg-primary/10 text-primary">
                          {student.class ? `${student.class.grade}-${student.class.section}` : 'N/A'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs ${
                          student.isActive
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}>
                          {student.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary hover:bg-primary/10"
                            onClick={() => handleEdit(student)}
                          >
                            <Edit2 size={16} />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
                                <Trash2 size={16} />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Student</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to deactivate {student.name}? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(student._id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, students.length)} of{" "}
                {students.length}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="border-border"
                >
                  <ChevronLeft size={16} />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <Button
                    key={i + 1}
                    variant={currentPage === i + 1 ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(i + 1)}
                    className={currentPage === i + 1 ? "bg-primary" : "border-border"}
                  >
                    {i + 1}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="border-border"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* Edit Modal */}
      {showEditModal && editingStudent && (
        <EditStudentModal
          student={editingStudent}
          onClose={() => {
            setShowEditModal(false)
            setEditingStudent(null)
          }}
          onSave={() => {
            setShowEditModal(false)
            setEditingStudent(null)
            fetchStudents()
          }}
        />
      )}
    </Card>
  )
}

// Edit Student Modal Component
function EditStudentModal({ student, onClose, onSave }: { student: Student, onClose: () => void, onSave: () => void }) {
  const [formData, setFormData] = useState({
    name: student.name,
    email: student.email,
    classId: student.class._id,
  })
  const [classes, setClasses] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const token = localStorage.getItem('token')
        if (!token) return

        const response = await fetch('http://localhost:5000/api/classes', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })

        if (response.ok) {
          const data = await response.json()
          setClasses(data)
        }
      } catch (err) {
        console.error('Error fetching classes:', err)
      }
    }

    fetchClasses()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      if (!token) {
        toast({
          title: "Error",
          description: "No authentication token found",
          variant: "destructive",
        })
        return
      }

      const response = await fetch(`http://localhost:5000/api/students/${student._id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        throw new Error('Failed to update student')
      }

      toast({
        title: "Success",
        description: "Student updated successfully",
      })

      onSave()
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update student",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle>Edit Student</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-input rounded-md bg-background"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-input rounded-md bg-background"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Class</label>
              <select
                value={formData.classId}
                onChange={(e) => setFormData(prev => ({ ...prev, classId: e.target.value }))}
                className="w-full px-3 py-2 border border-input rounded-md bg-background"
                required
              >
                {classes.map((cls) => (
                  <option key={cls._id} value={cls._id}>
                    {cls.grade}-{cls.section}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="flex-1">
                {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                Update Student
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
