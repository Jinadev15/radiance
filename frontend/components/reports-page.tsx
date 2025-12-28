"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Download, Filter, Loader2, Eye, Users } from "lucide-react"

interface AttendanceRecord {
  _id: string
  student: {
    studentId: string
    name: string
  }
  class: {
    _id: string
    name: string
    grade: string
    section: string
  }
  date: string
  status: string
  checkInTime: string
  confidence: number
  markedBy: string
}

interface ClassData {
  _id: string
  name: string
  grade: string
  section: string
}

interface AttendanceStats {
  totalStudents: number
  attendanceStats: Array<{
    _id: string
    count: number
  }>
}

export default function ReportsPageComponent() {
  const [selectedClass, setSelectedClass] = useState("all")
  const [selectedDate, setSelectedDate] = useState("")
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [classes, setClasses] = useState<ClassData[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<AttendanceStats | null>(null)
  const [selectedSummary, setSelectedSummary] = useState<any>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)

  useEffect(() => {
    fetchAttendanceData()
    fetchClasses()
  }, [])

  useEffect(() => {
    if (selectedClass !== "all") {
      fetchClassStats(selectedClass)
    } else {
      setStats(null)
    }
  }, [selectedClass])

  const fetchAttendanceData = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('http://localhost:5000/api/attendance', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        setAttendanceRecords(data)
      }
    } catch (error) {
      console.error('Error fetching attendance data:', error)
    } finally {
      setLoading(false)
    }
  }

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
        setClasses(data)
      }
    } catch (error) {
      console.error('Error fetching classes:', error)
    }
  }

  const fetchClassStats = async (classId: string) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`http://localhost:5000/api/attendance/stats/${classId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Error fetching class stats:', error)
    }
  }

  const filteredData = attendanceRecords.filter((record) => {
    if (selectedClass !== "all" && record.class._id !== selectedClass) return false
    if (selectedDate) {
      const recordDate = new Date(record.date).toISOString().split('T')[0]
      if (recordDate !== selectedDate) return false
    }
    return true
  })

  // Group records by date and class for summary display
  const groupedData = filteredData.reduce((acc, record) => {
    const dateKey = new Date(record.date).toISOString().split('T')[0]
    const classKey = `${record.class.grade}-${record.class.section}`

    if (!acc[dateKey]) {
      acc[dateKey] = {}
    }
    if (!acc[dateKey][classKey]) {
      acc[dateKey][classKey] = {
        total: 0,
        present: 0,
        records: []
      }
    }

    acc[dateKey][classKey].total++
    if (record.status === 'Present' || record.status === 'Late') {
      acc[dateKey][classKey].present++
    }
    acc[dateKey][classKey].records.push(record)

    return acc
  }, {} as Record<string, Record<string, { total: number; present: number; records: AttendanceRecord[] }>>)

  const summaryData = Object.entries(groupedData).flatMap(([date, classes]) =>
    Object.entries(classes).map(([className, data]) => ({
      date,
      class: className,
      present: data.present,
      total: data.total,
      percentage: Math.round((data.present / data.total) * 100),
      records: data.records
    }))
  )

  const exportCSV = () => {
    const csv = [
      ["Date", "Student ID", "Student Name", "Class", "Status", "Check-in Time", "Confidence", "Method"],
      ...filteredData.map((r) => [
        new Date(r.date).toLocaleDateString(),
        r.student.studentId,
        r.student.name,
        `${r.class.grade}-${r.class.section}`,
        r.status,
        r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString() : '',
        r.confidence ? `${(r.confidence * 100).toFixed(1)}%` : '',
        r.markedBy
      ]),
    ]
    const csvString = csv.map((row) => row.join(",")).join("\n")
    const blob = new Blob([csvString], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "attendance-report.csv"
    a.click()
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Filter size={20} className="text-primary" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Class</label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">All Classes</option>
                {classes.map((cls) => (
                  <option key={cls._id} value={cls._id}>
                    {cls.grade}-{cls.section}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  setSelectedDate("")
                  setSelectedClass("all")
                }}
                variant="outline"
                className="w-full border-border"
                suppressHydrationWarning={true}
              >
                Reset Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Card */}
      {stats && selectedClass !== "all" && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Class Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{stats.totalStudents}</div>
                <div className="text-sm text-muted-foreground">Total Students</div>
              </div>
              {stats.attendanceStats.map((stat) => (
                <div key={stat._id} className="text-center">
                  <div className="text-2xl font-bold text-foreground">{stat.count}</div>
                  <div className="text-sm text-muted-foreground">{stat._id}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reports Table */}
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-foreground">Attendance Records</CardTitle>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setLoading(true)
                fetchAttendanceData()
                if (selectedClass !== "all") {
                  fetchClassStats(selectedClass)
                }
              }}
              variant="outline"
              className="border-border"
            >
              <Filter size={16} className="mr-2" />
              Refresh
            </Button>
            <Button onClick={exportCSV} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Download size={16} className="mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Class</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Present</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Total</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Percentage</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summaryData.map((summary, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-border hover:bg-muted transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedSummary(summary)
                      setShowDetailModal(true)
                    }}
                  >
                    <td className="py-3 px-4 text-foreground">{new Date(summary.date).toLocaleDateString()}</td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-3 py-1 rounded-full text-sm bg-primary/10 text-primary">
                        {summary.class}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-foreground font-medium">{summary.present}</td>
                    <td className="py-3 px-4 text-muted-foreground">{summary.total}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-input rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: `${summary.percentage}%` }} />
                        </div>
                        <span className="text-sm font-semibold text-foreground">{summary.percentage}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedSummary(summary)
                          setShowDetailModal(true)
                        }}
                        className="border-border"
                      >
                        <Eye size={16} className="mr-2" />
                        View Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users size={20} className="text-primary" />
              Attendance Details - {selectedSummary?.class} ({new Date(selectedSummary?.date).toLocaleDateString()})
            </DialogTitle>
          </DialogHeader>
          {selectedSummary && (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-green-50 border-green-200">
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-700">{selectedSummary.present}</div>
                      <div className="text-sm text-green-600">Present</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-red-50 border-red-200">
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-700">{selectedSummary.total - selectedSummary.present}</div>
                      <div className="text-sm text-red-600">Absent</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-700">{selectedSummary.percentage}%</div>
                      <div className="text-sm text-blue-600">Attendance Rate</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Student Details */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Student Attendance</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-4 font-semibold text-foreground">Student ID</th>
                        <th className="text-left py-2 px-4 font-semibold text-foreground">Name</th>
                        <th className="text-left py-2 px-4 font-semibold text-foreground">Status</th>
                        <th className="text-left py-2 px-4 font-semibold text-foreground">Check-in Time</th>
                        <th className="text-left py-2 px-4 font-semibold text-foreground">Confidence</th>
                        <th className="text-left py-2 px-4 font-semibold text-foreground">Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSummary.records.map((record: AttendanceRecord) => (
                        <tr key={record._id} className="border-b border-border hover:bg-muted/50">
                          <td className="py-2 px-4 text-foreground">{record.student.studentId}</td>
                          <td className="py-2 px-4 text-foreground font-medium">{record.student.name}</td>
                          <td className="py-2 px-4">
                            <Badge variant={record.status === 'Present' ? 'default' : 'destructive'}>
                              {record.status}
                            </Badge>
                          </td>
                          <td className="py-2 px-4 text-muted-foreground">
                            {record.checkInTime ? new Date(record.checkInTime).toLocaleTimeString() : 'N/A'}
                          </td>
                          <td className="py-2 px-4 text-muted-foreground">
                            {record.confidence ? `${(record.confidence * 100).toFixed(1)}%` : 'N/A'}
                          </td>
                          <td className="py-2 px-4 text-muted-foreground">{record.markedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
