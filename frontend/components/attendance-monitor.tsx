"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle, Clock, AlertCircle, Camera as CameraIcon, Loader2 } from "lucide-react"

interface Class {
  _id: string
  name: string
  grade: string
  section: string
}

interface Student {
  _id: string
  studentId: string
  name: string
}

interface AttendanceRecord {
  _id: string
  student: Student
  class: Class
  status: string
  checkInTime: string
  confidence: number
  markedBy: string
}

export default function AttendanceMonitor() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [classes, setClasses] = useState<Class[]>([])
  const [selectedClass, setSelectedClass] = useState<string>("")
  const [presentStudents, setPresentStudents] = useState<AttendanceRecord[]>([])
  const [recognizedStudent, setRecognizedStudent] = useState<AttendanceRecord | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraLoading, setCameraLoading] = useState(true)
  const [isMarking, setIsMarking] = useState(false)
  const [lastCaptureTime, setLastCaptureTime] = useState<number>(0)

  // Fetch classes on component mount
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
          const classesData = await response.json()
          setClasses(classesData)
        }
      } catch (error) {
        console.error('Error fetching classes:', error)
      }
    }

    fetchClasses()
  }, [])

  // Fetch today's attendance when class is selected
  useEffect(() => {
    if (selectedClass) {
      fetchTodaysAttendance()
    }
  }, [selectedClass])

  const fetchTodaysAttendance = async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const today = new Date().toISOString().split('T')[0]
      const response = await fetch(`http://localhost:5000/api/attendance?classId=${selectedClass}&date=${today}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        const attendanceData = await response.json()
        setPresentStudents(attendanceData.filter((record: AttendanceRecord) => record.status === 'Present'))
      }
    } catch (error) {
      console.error('Error fetching attendance:', error)
    }
  }

  useEffect(() => {
    const startCamera = async () => {
      try {
        setCameraLoading(true)
        setCameraError(null)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (error) {
        let errorMessage = "Unable to access camera"
        if (error instanceof DOMException) {
          if (error.name === "NotAllowedError") {
            errorMessage = "Camera permission denied. Please allow camera access in your browser settings."
          } else if (error.name === "NotFoundError") {
            errorMessage = "No camera device found on this system"
          } else if (error.name === "NotReadableError") {
            errorMessage = "Camera is being used by another application"
          }
        }
        setCameraError(errorMessage)
        console.error("[v0] Camera error:", error)
      } finally {
        setCameraLoading(false)
      }
    }

    startCamera()

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
        tracks.forEach((track) => track.stop())
      }
    }
  }, [])

  const captureAndMarkAttendance = async () => {
    if (!selectedClass || isMarking) return

    const now = Date.now()
    if (now - lastCaptureTime < 3000) return // Prevent rapid captures

    setIsMarking(true)
    setLastCaptureTime(now)

    try {
      // Capture image from video
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return

      const context = canvas.getContext('2d')
      if (!context) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0)

      const imageData = canvas.toDataURL('image/jpeg', 0.8)

      // Send to backend for attendance marking
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch('http://localhost:5000/api/attendance/mark', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          classId: selectedClass,
          faceImage: imageData
        })
      })

      const result = await response.json()

      if (response.ok) {
        // Show recognition result
        setRecognizedStudent(result.attendance)

        // Add to present students list if not already there
        setPresentStudents(prev => {
          const exists = prev.find(s => s.student._id === result.attendance.student._id)
          if (!exists) {
            return [result.attendance, ...prev]
          }
          return prev
        })

        // Hide recognition after 3 seconds
        setTimeout(() => setRecognizedStudent(null), 3000)
      } else {
        // Show error message
        setRecognizedStudent({
          _id: '',
          student: { _id: '', studentId: '', name: 'Error' },
          class: { _id: '', name: '', grade: '', section: '' },
          status: 'Error',
          checkInTime: new Date().toISOString(),
          confidence: 0,
          markedBy: 'Auto'
        } as AttendanceRecord)

        setTimeout(() => setRecognizedStudent(null), 3000)
      }
    } catch (error) {
      console.error('Error marking attendance:', error)
      setRecognizedStudent({
        _id: '',
        student: { _id: '', studentId: '', name: 'Error' },
        class: { _id: '', name: '', grade: '', section: '' },
        status: 'Error',
        checkInTime: new Date().toISOString(),
        confidence: 0,
        markedBy: 'Auto'
      } as AttendanceRecord)

      setTimeout(() => setRecognizedStudent(null), 3000)
    } finally {
      setIsMarking(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Camera Feed */}
      <div className="lg:col-span-2 space-y-4">
        <Card className="bg-card border-border overflow-hidden">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <CameraIcon size={20} className="text-primary" />
              Live Camera Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="bg-background rounded-lg overflow-hidden border-2 border-border relative">
              {cameraError ? (
                <div className="w-full aspect-video bg-muted flex flex-col items-center justify-center gap-3">
                  <AlertCircle size={48} className="text-destructive" />
                  <div className="text-center px-4">
                    <p className="text-foreground font-medium mb-1">Camera Not Available</p>
                    <p className="text-sm text-muted-foreground">{cameraError}</p>
                  </div>
                </div>
              ) : cameraLoading ? (
                <div className="w-full aspect-video bg-muted flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Initializing camera...</p>
                  </div>
                </div>
              ) : (
                <video ref={videoRef} autoPlay playsInline className="w-full aspect-video object-cover" />
              )}
              {recognizedStudent && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
                  <div className="text-center text-white">
                    {recognizedStudent.student.name === 'Error' ? (
                      <>
                        <AlertCircle size={48} className="mx-auto mb-2 text-red-400" />
                        <p className="text-2xl font-bold">Face Not Recognized</p>
                        <p className="text-lg text-gray-200">Please try again</p>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={48} className="mx-auto mb-2 text-green-400" />
                        <p className="text-2xl font-bold">{recognizedStudent.student.name}</p>
                        <p className="text-lg text-gray-200">Roll: {recognizedStudent.student.studentId}</p>
                        <p className="text-sm text-gray-300">Confidence: {(recognizedStudent.confidence * 100).toFixed(1)}%</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </CardContent>
        </Card>

        {/* Class Selection and Capture Button */}
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground mb-2 block">Select Class</label>
                <Select value={selectedClass} onValueChange={setSelectedClass}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a class..." />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((classItem) => (
                      <SelectItem key={classItem._id} value={classItem._id}>
                        {classItem.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={captureAndMarkAttendance}
                disabled={!selectedClass || isMarking || cameraError !== null}
                className="px-6"
              >
                {isMarking ? (
                  <>
                    <Loader2 size={18} className="mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CameraIcon size={18} className="mr-2" />
                    Mark Attendance
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recognition Status */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-sm">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
              <div
                className={`w-3 h-3 rounded-full ${
                  cameraError ? "bg-destructive" :
                  selectedClass ? "bg-green-500 animate-pulse" :
                  "bg-yellow-500"
                }`}
              />
              <p className="text-sm text-muted-foreground">
                {cameraError ? "Camera unavailable" :
                 !selectedClass ? "Select a class to start monitoring" :
                 "Camera active & ready for attendance marking"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Present Students List */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Present Today</CardTitle>
          <p className="text-sm text-muted-foreground">{presentStudents.length} present</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {presentStudents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock size={48} className="mx-auto mb-2 opacity-50" />
                <p>No students marked present yet</p>
                <p className="text-sm">Select a class and start marking attendance</p>
              </div>
            ) : (
              presentStudents.map((record) => (
                <div
                  key={record._id}
                  className="p-3 rounded-lg bg-muted border border-border hover:bg-accent/10 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{record.student.name}</p>
                      <p className="text-xs text-muted-foreground">Roll: {record.student.studentId}</p>
                      {record.confidence && (
                        <p className="text-xs text-green-600">Confidence: {(record.confidence * 100).toFixed(1)}%</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Clock size={14} className="text-primary" />
                      <p className="text-xs text-muted-foreground">
                        {new Date(record.checkInTime).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
