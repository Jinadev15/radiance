"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Users, BarChart3, BookOpen, AlertTriangle, RefreshCw, Eye, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface DashboardStats {
  totalStudents: number
  studentsWithoutEmbeddings: number
  todaysAttendance: number
  attendancePercentage: number
  activeClasses: number
  loading: boolean
  error: string | null
}

export default function DashboardCards() {
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    studentsWithoutEmbeddings: 0,
    todaysAttendance: 0,
    attendancePercentage: 0,
    activeClasses: 0,
    loading: true,
    error: null
  })

  const fetchDashboardData = async () => {
    try {
      setStats(prev => ({ ...prev, loading: true, error: null }))

      const token = localStorage.getItem('token')
      if (!token) {
        setStats(prev => ({ ...prev, loading: false, error: 'No authentication token found' }))
        return
      }

      // Fetch students
      const studentsResponse = await fetch('http://localhost:5000/api/students', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!studentsResponse.ok) {
        throw new Error('Failed to fetch students')
      }

      const students = await studentsResponse.json()

      // Fetch classes
      const classesResponse = await fetch('http://localhost:5000/api/classes', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!classesResponse.ok) {
        throw new Error('Failed to fetch classes')
      }

      const classes = await classesResponse.json()

      // Calculate stats
      const totalStudents = students.length
      const studentsWithoutEmbeddings = students.filter((s: any) => !s.faceEmbedding).length

      // Mock today's attendance (this would come from attendance API)
      const todaysAttendance = Math.floor(totalStudents * 0.85) // Mock 85% attendance
      const attendancePercentage = totalStudents > 0 ? Math.round((todaysAttendance / totalStudents) * 100) : 0

      setStats({
        totalStudents,
        studentsWithoutEmbeddings,
        todaysAttendance,
        attendancePercentage,
        activeClasses: classes.length,
        loading: false,
        error: null
      })

    } catch (err) {
      console.error('Error fetching dashboard data:', err)
      setStats(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load dashboard data'
      }))
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const handleRefresh = () => {
    fetchDashboardData()
  }

  const cards = [
    {
      title: "Total Students",
      value: stats.loading ? "..." : stats.totalStudents.toString(),
      description: stats.loading ? "Loading..." : `${stats.studentsWithoutEmbeddings} need face setup`,
      icon: Users,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      onClick: () => router.push("/dashboard/students"),
      actionLabel: "View Students",
      badge: stats.studentsWithoutEmbeddings > 0 ? `${stats.studentsWithoutEmbeddings} pending` : null
    },
    {
      title: "Today's Attendance",
      value: stats.loading ? "..." : stats.todaysAttendance.toString(),
      description: stats.loading ? "Loading..." : `${stats.attendancePercentage}% present`,
      icon: BarChart3,
      color: "text-green-600",
      bgColor: "bg-green-50",
      onClick: () => router.push("/dashboard/attendance"),
      actionLabel: "View Attendance"
    },
    {
      title: "Active Classes",
      value: stats.loading ? "..." : stats.activeClasses.toString(),
      description: stats.loading ? "Loading..." : "All classes running",
      icon: BookOpen,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      onClick: () => router.push("/dashboard/classes"),
      actionLabel: "Manage Classes"
    }
  ]

  if (stats.error) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-destructive" size={24} />
              <div>
                <h3 className="font-semibold text-foreground">Dashboard Error</h3>
                <p className="text-sm text-muted-foreground">{stats.error}</p>
              </div>
            </div>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              <RefreshCw size={16} className="mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} variant="outline" size="sm" disabled={stats.loading}>
          <RefreshCw size={16} className={`mr-2 ${stats.loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Card
              key={card.title}
              className="bg-card border-border hover:shadow-lg transition-all duration-200 cursor-pointer group"
              onClick={card.onClick}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle className="text-foreground group-hover:text-primary transition-colors">
                  {card.title}
                </CardTitle>
                <div className={`${card.bgColor} p-3 rounded-lg group-hover:scale-110 transition-transform`}>
                  <Icon className={card.color} size={24} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-3xl font-bold text-foreground">{card.value}</div>
                  {card.badge && (
                    <Badge variant="secondary" className="text-xs">
                      {card.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-sm mb-3">{card.description}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-0 h-auto text-primary hover:text-primary/80 font-medium"
                  onClick={(e) => {
                    e.stopPropagation()
                    card.onClick()
                  }}
                >
                  <Eye size={14} className="mr-1" />
                  {card.actionLabel}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Face Recognition Alert - Commented out for now */}
      {/* {stats.studentsWithoutEmbeddings > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="text-amber-600" size={24} />
                <div>
                  <h3 className="font-semibold text-amber-800">Face Recognition Setup Needed</h3>
                  <p className="text-sm text-amber-700">
                    {stats.studentsWithoutEmbeddings} student{stats.studentsWithoutEmbeddings !== 1 ? 's' : ''} need face recognition setup.
                    Attendance tracking will be limited until completed.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => router.push("/dashboard/students")}
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  <Eye size={16} className="mr-2" />
                  View Students
                </Button>
                <Button
                  onClick={() => router.push("/dashboard/students/add")}
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <Plus size={16} className="mr-2" />
                  Add Student
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )} */}
    </div>
  )
}
