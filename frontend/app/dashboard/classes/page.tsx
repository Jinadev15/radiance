"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import PageHeader from "@/components/page-header"
import { Plus, Edit2, Trash2, Users, Loader2 } from "lucide-react"

interface Class {
  _id: string
  name: string
  grade: string
  section: string
  teacher?: {
    _id: string
    name: string
    email: string
  }
  room?: string
  studentCount?: number
}

interface User {
  _id: string
  name: string
  email: string
}

export default function ManageClassesPage() {
  const [classes, setClasses] = useState<Class[]>([])
  const [teachers, setTeachers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingClass, setEditingClass] = useState<Class | null>(null)
  const [editingTeacherId, setEditingTeacherId] = useState('')
  const [newClass, setNewClass] = useState({
    name: '',
    grade: '',
    section: '',
    teacherId: '',
    room: ''
  })
  const itemsPerPage = 5
  const totalPages = Math.ceil(classes.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedClasses = classes.slice(startIndex, startIndex + itemsPerPage)

  useEffect(() => {
    fetchClasses()
    fetchTeachers()
  }, [])

  const fetchClasses = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('http://localhost:5000/api/classes', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        // Add student count for each class
        const classesWithCount = await Promise.all(
          data.map(async (classItem: Class) => {
            try {
              const studentResponse = await fetch(`http://localhost:5000/api/students?classId=${classItem._id}`, {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              })
              if (studentResponse.ok) {
                const students = await studentResponse.json()
                return { ...classItem, studentCount: students.length }
              }
            } catch (error) {
              console.error('Error fetching students for class:', error)
            }
            return { ...classItem, studentCount: 0 }
          })
        )
        setClasses(classesWithCount)
      }
    } catch (error) {
      console.error('Error fetching classes:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTeachers = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('http://localhost:5000/api/auth/users?role=teacher', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        setTeachers(data)
      }
    } catch (error) {
      console.error('Error fetching teachers:', error)
    }
  }

  const addClass = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('http://localhost:5000/api/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newClass)
      })

      if (response.ok) {
        const addedClass = await response.json()
        setClasses([...classes, { ...addedClass, studentCount: 0 }])
        setNewClass({ name: '', grade: '', section: '', teacherId: '', room: '' })
        setIsAddModalOpen(false)
        alert('Class added successfully!')
      } else {
        const error = await response.json()
        alert(error.msg || 'Failed to add class')
      }
    } catch (error) {
      console.error('Error adding class:', error)
      alert('Error adding class')
    }
  }

  const deleteClass = async (id: string) => {
    if (!confirm('Are you sure you want to delete this class?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`http://localhost:5000/api/classes/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        setClasses(classes.filter((c) => c._id !== id))
      } else {
        alert('Failed to delete class')
      }
    } catch (error) {
      console.error('Error deleting class:', error)
      alert('Error deleting class')
    }
  }

  const handleEdit = (classItem: Class) => {
    setEditingClass(classItem)
    setEditingTeacherId(classItem.teacher?._id || '')
    setIsEditModalOpen(true)
  }

  const updateClass = async () => {
    if (!editingClass) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`http://localhost:5000/api/classes/${editingClass._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editingClass.name,
          grade: editingClass.grade,
          section: editingClass.section,
          teacherId: editingClass.teacher?._id || '',
          room: editingClass.room
        })
      })

      if (response.ok) {
        const updatedClass = await response.json()
        setClasses(classes.map((c) => c._id === editingClass._id ? updatedClass : c))
        setIsEditModalOpen(false)
        setEditingClass(null)
        alert('Class updated successfully!')
      } else {
        const error = await response.json()
        alert(error.msg || 'Failed to update class')
      }
    } catch (error) {
      console.error('Error updating class:', error)
      alert('Error updating class')
    }
  }

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <PageHeader title="Manage Classes" description="View and manage all classes in the system" />
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true)
              fetchClasses()
            }}
            className="flex items-center gap-2 px-4 py-2 border border-border bg-background text-foreground rounded-lg hover:bg-muted transition-colors font-medium"
            suppressHydrationWarning={true}
          >
            <Users size={16} />
            Refresh
          </button>
          <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium" suppressHydrationWarning={true}>
                <Plus size={20} />
                Add Class
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Class</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Class Name
                  </Label>
                  <Input
                    id="name"
                    value={newClass.name}
                    onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                    className="col-span-3"
                    placeholder="e.g., 10-A"
                    suppressHydrationWarning={true}
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="grade" className="text-right">
                    Grade
                  </Label>
                  <Select value={newClass.grade} onValueChange={(value) => setNewClass({ ...newClass, grade: value })}>
                    <SelectTrigger className="col-span-3" suppressHydrationWarning={true}>
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {[9, 10, 11, 12].map((grade) => (
                        <SelectItem key={grade} value={grade.toString()}>
                          Grade {grade}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="section" className="text-right">
                    Section
                  </Label>
                  <Select value={newClass.section} onValueChange={(value) => setNewClass({ ...newClass, section: value })}>
                    <SelectTrigger className="col-span-3" suppressHydrationWarning={true}>
                      <SelectValue placeholder="Select section" />
                    </SelectTrigger>
                    <SelectContent>
                      {['A', 'B', 'C', 'D'].map((section) => (
                        <SelectItem key={section} value={section}>
                          Section {section}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="teacher" className="text-right">
                    Teacher
                  </Label>
                  <Select value={newClass.teacherId} onValueChange={(value) => setNewClass({ ...newClass, teacherId: value })}>
                    <SelectTrigger className="col-span-3" suppressHydrationWarning={true}>
                      <SelectValue placeholder="Select teacher" />
                    </SelectTrigger>
                    <SelectContent>
                      {teachers.map((teacher) => (
                        <SelectItem key={teacher._id} value={teacher._id}>
                          {teacher.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="room" className="text-right">
                    Room
                  </Label>
                  <Input
                    id="room"
                    value={newClass.room}
                    onChange={(e) => setNewClass({ ...newClass, room: e.target.value })}
                    className="col-span-3"
                    placeholder="e.g., 101"
                    suppressHydrationWarning={true}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsAddModalOpen(false)} suppressHydrationWarning={true}>
                  Cancel
                </Button>
                <Button onClick={addClass} disabled={!newClass.name || !newClass.grade || !newClass.section || !newClass.teacherId} suppressHydrationWarning={true}>
                  Add Class
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit Class Modal */}
          <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Edit Class</DialogTitle>
              </DialogHeader>
              {editingClass && (
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-name" className="text-right">
                      Class Name
                    </Label>
                    <Input
                      id="edit-name"
                      value={editingClass.name}
                      onChange={(e) => setEditingClass({ ...editingClass, name: e.target.value })}
                      className="col-span-3"
                      placeholder="e.g., 10-A"
                      suppressHydrationWarning={true}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-grade" className="text-right">
                      Grade
                    </Label>
                    <Select value={editingClass.grade} onValueChange={(value) => setEditingClass({ ...editingClass, grade: value })}>
                      <SelectTrigger className="col-span-3" suppressHydrationWarning={true}>
                        <SelectValue placeholder="Select grade" />
                      </SelectTrigger>
                      <SelectContent>
                        {[9, 10, 11, 12].map((grade) => (
                          <SelectItem key={grade} value={grade.toString()}>
                            Grade {grade}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-section" className="text-right">
                      Section
                    </Label>
                    <Select value={editingClass.section} onValueChange={(value) => setEditingClass({ ...editingClass, section: value })}>
                      <SelectTrigger className="col-span-3" suppressHydrationWarning={true}>
                        <SelectValue placeholder="Select section" />
                      </SelectTrigger>
                      <SelectContent>
                        {['A', 'B', 'C', 'D'].map((section) => (
                          <SelectItem key={section} value={section}>
                            Section {section}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-teacher" className="text-right">
                      Teacher
                    </Label>
                    <Select value={editingTeacherId} onValueChange={setEditingTeacherId}>
                      <SelectTrigger className="col-span-3" suppressHydrationWarning={true}>
                        <SelectValue placeholder="Select teacher" />
                      </SelectTrigger>
                      <SelectContent>
                        {teachers.map((teacher) => (
                          <SelectItem key={teacher._id} value={teacher._id}>
                            {teacher.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="edit-room" className="text-right">
                      Room
                    </Label>
                    <Input
                      id="edit-room"
                      value={editingClass.room || ''}
                      onChange={(e) => setEditingClass({ ...editingClass, room: e.target.value })}
                      className="col-span-3"
                      placeholder="e.g., 101"
                      suppressHydrationWarning={true}
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsEditModalOpen(false)} suppressHydrationWarning={true}>
                  Cancel
                </Button>
                <Button onClick={updateClass} disabled={!editingClass?.name || !editingClass?.grade || !editingClass?.section || !editingTeacherId} suppressHydrationWarning={true}>
                  Update Class
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm mb-1">Total Classes</p>
              <p className="text-3xl font-bold text-foreground">{classes.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm mb-1">Total Students</p>
              <p className="text-3xl font-bold text-foreground">
                {classes.reduce((sum, c) => sum + (c.studentCount ?? 0), 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm mb-1">Avg Students/Class</p>
              <p className="text-3xl font-bold text-foreground">
                {classes.length > 0 ? Math.round(classes.reduce((sum, c) => sum + (c.studentCount ?? 0), 0) / classes.length) : 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Classes Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Classes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading classes...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Class Name</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Grade & Section</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Teacher</th>
                    <th className="text-center px-4 py-3 text-muted-foreground font-semibold">
                      <div className="flex items-center justify-center gap-1">
                        <Users size={16} />
                        Students
                      </div>
                    </th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-semibold">Room</th>
                    <th className="text-center px-4 py-3 text-muted-foreground font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedClasses.map((classItem) => (
                    <tr key={classItem._id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-foreground font-medium">{classItem.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">Grade {classItem.grade} - {classItem.section}</td>
                      <td className="px-4 py-3 text-muted-foreground">{classItem.teacher?.name || 'Not assigned'}</td>
                      <td className="px-4 py-3 text-foreground text-center font-medium">{classItem.studentCount || 0}</td>
                      <td className="px-4 py-3 text-muted-foreground">{classItem.room || 'Not assigned'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEdit(classItem)}
                            className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                            title="Edit"
                            suppressHydrationWarning={true}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => deleteClass(classItem._id)}
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title="Delete"
                            suppressHydrationWarning={true}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, classes.length)} of {classes.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                suppressHydrationWarning={true}
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"
                  }`}
                  suppressHydrationWarning={true}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
