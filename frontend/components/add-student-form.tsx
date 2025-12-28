"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import CaptureImageModal from "@/components/capture-image-modal"
import { Camera, User, Hash, BookOpen, Loader2 } from "lucide-react"

export default function AddStudentForm() {
  const [formData, setFormData] = useState({
    name: "",
    rollNo: "",
    class: "",
  })
  const [classes, setClasses] = useState<any[]>([])
  const [classesLoading, setClassesLoading] = useState(true)
  const [showCamera, setShowCamera] = useState(false)
  const [capturedImages, setCapturedImages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // Fetch classes on component mount
  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const token = localStorage.getItem('token')
        if (!token) {
          setError('No authentication token found. Please login again.')
          return
        }

        const response = await fetch('http://localhost:5000/api/classes', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })

        if (!response.ok) {
          throw new Error('Failed to fetch classes')
        }

        const classesData = await response.json()
        setClasses(classesData)
      } catch (err) {
        console.error('Error fetching classes:', err)
        setError('Failed to load classes. Please refresh the page.')
      } finally {
        setClassesLoading(false)
      }
    }

    fetchClasses()
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleImagesCapture = (images: string[]) => {
    setCapturedImages(images)
    setShowCamera(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (capturedImages.length === 0) {
      setError("Please capture facial images first")
      return
    }

    if (!formData.name || !formData.rollNo || !formData.class) {
      setError("Please fill in all required fields")
      return
    }

    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      if (!token) {
        setError('No authentication token found. Please login again.')
        return
      }

      // Find selected class by ID
      const selectedClass = classes.find((c: any) => c._id === formData.class)

      if (!selectedClass) {
        throw new Error('Selected class not found')
      }

      // Use the first captured image for face embedding
      const faceImage = capturedImages[0]

      const studentData = {
        studentId: formData.rollNo,
        name: formData.name,
        email: `${formData.rollNo.toLowerCase()}@school.edu`, // Generate email from roll number
        classId: selectedClass._id,
        faceImage: faceImage
      }

      const response = await fetch('http://localhost:5000/api/students', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(studentData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.msg || 'Failed to create student')
      }

      const newStudent = await response.json()
      console.log('Student created successfully:', newStudent)

      // Show warning if face recognition failed but student was created
      if (newStudent.warning) {
        alert(newStudent.warning)
      }

      // Redirect to students page
      router.push("/dashboard/students")
    } catch (err) {
      console.error('Error creating student:', err)
      setError(err instanceof Error ? err.message : 'An error occurred while creating the student')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Student Information</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Field */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <User size={16} className="text-primary" />
                Full Name
              </label>
              <input
                type="text"
                name="name"
                placeholder="e.g., Ahmed Hassan"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                suppressHydrationWarning={true}
              />
            </div>

            {/* Roll No Field */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Hash size={16} className="text-primary" />
                Roll Number
              </label>
              <input
                type="text"
                name="rollNo"
                placeholder="e.g., 001"
                value={formData.rollNo}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                suppressHydrationWarning={true}
              />
            </div>

            {/* Class Dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <BookOpen size={16} className="text-primary" />
                Select Class
              </label>
              {classesLoading ? (
                <div className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Loading classes...
                </div>
              ) : (
                <select
                  name="class"
                  value={formData.class}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  suppressHydrationWarning={true}
                >
                  <option value="">Choose a class...</option>
                  {classes.map((classItem) => (
                    <option key={classItem._id} value={classItem._id}>
                      {classItem.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Facial Data Section */}
            <div className="border-t border-border pt-6">
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Camera className="text-primary" size={20} />
                Facial Recognition Data
              </h3>

              {capturedImages.length > 0 ? (
                <div className="space-y-4">
                  <div className="bg-muted rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-3">
                      ✓ {capturedImages.length} images captured (10-20 recommended)
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {capturedImages.slice(0, 4).map((img, idx) => (
                        <div
                          key={idx}
                          className="w-20 h-20 rounded-lg bg-background border-2 border-primary overflow-hidden"
                        >
                          <img
                            src={img || "/placeholder.svg"}
                            alt={`Capture ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                      {capturedImages.length > 4 && (
                        <div className="w-20 h-20 rounded-lg bg-background border-2 border-border flex items-center justify-center">
                          <p className="text-xs text-muted-foreground">+{capturedImages.length - 4}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      setCapturedImages([])
                      setShowCamera(true)
                    }}
                    variant="outline"
                    className="w-full border-border text-foreground hover:bg-muted"
                    suppressHydrationWarning={true}
                  >
                    Recapture Images
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2.5 rounded-lg"
                  suppressHydrationWarning={true}
                >
                  <Camera size={18} className="mr-2" />
                  Capture Face
                </Button>
              )}
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => router.back()} className="flex-1 border-border" suppressHydrationWarning={true}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={capturedImages.length === 0 || loading || classesLoading}
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
                suppressHydrationWarning={true}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="mr-2 animate-spin" />
                    Creating Student...
                  </>
                ) : (
                  'Add Student'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <CaptureImageModal open={showCamera} onClose={() => setShowCamera(false)} onCapture={handleImagesCapture} />
    </>
  )
}
