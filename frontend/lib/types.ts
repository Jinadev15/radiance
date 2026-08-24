// Shared response shapes for the backend API. Previously every call in
// api.ts returned `any`, which meant TypeScript did zero structural
// checking at the one boundary that most needs it — a backend field rename
// would compile cleanly here and only surface as `undefined` rendering
// somewhere downstream. These mirror the Mongoose schemas in
// backend/models/*.js.

export interface Site {
  _id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  shiftStart: string;
  shiftEnd: string;
  isActive: boolean;
}

export interface Shift {
  _id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  crossesMidnight: boolean;
  isActive?: boolean;
}

export interface Service {
  _id: string;
  name: string;
  isActive?: boolean;
}

export interface Contractor {
  _id: string;
  name: string;
  contactPhone?: string;
  workLocation?: { _id: string; name: string } | null;
  headcountCap?: number | null;
  currentHeadcount: number;
  isActive?: boolean;
}

export type EmployeeStatus = 'ACTIVE' | 'PENDING_APPROVAL' | 'INACTIVE' | 'REJECTED';

export interface Employee {
  _id: string;
  employeeId: string;
  name: string;
  phone: string;
  nationalId: string;
  dateOfBirth: string;
  shiftTemplate: { _id: string; name: string; startTime: string; endTime: string } | null;
  workLocation: { _id: string; name: string; address?: string } | null;
  serviceTag?: { _id: string; name: string } | null;
  contractor?: { _id: string; name: string } | null;
  // `isActive` is derived server-side (status === 'ACTIVE') and kept for
  // existing pages; `status` carries the fuller PENDING/REJECTED lifecycle.
  isActive: boolean;
  status?: EmployeeStatus;
  hasBiometrics?: boolean;
  weeklyOff?: number[];
  createdAt: string;
}

export interface DashboardUser {
  id: string;
  _id?: string;
  name: string;
  email: string;
  role: 'admin' | 'hr' | 'supervisor';
  workLocation?: { _id: string; name: string } | null;
}

export type AttendanceStatus = 'VALID' | 'LATE' | 'EARLY_DEPARTURE' | 'LOCATION_MISMATCH' | 'SPOOF_ATTEMPT';

export interface AttendanceLog {
  _id: string;
  employee: { _id: string; name: string; employeeId: string; phone?: string; workLocation?: string; status?: EmployeeStatus } | null;
  date: string;
  sessionNumber?: number;
  siteName: string | null;
  service?: string | null;
  clockInTime: string;
  clockOutTime?: string;
  totalHours?: number;
  regularHours?: number;
  overtimeHours?: number;
  isHalfDay?: boolean;
  status: AttendanceStatus;
  confidence?: number;
  matchMargin?: number | null;
  markedBy?: 'AUTO' | 'MANUAL' | 'OFFLINE_SYNC' | 'SUPERVISOR_OVERRIDE' | 'AUTO_CLOSED';
  notes?: string;
}

export interface SpoofAttempt {
  _id: string;
  targetedEmployee: { name: string; employeeId: string } | null;
  workLocation: { name: string } | null;
  action: 'CLOCK_IN' | 'CLOCK_OUT';
  confidence?: number;
  livenessDetails: string;
  createdAt: string;
}

export interface RegularizationRequest {
  _id: string;
  employee: { _id: string; name: string; employeeId: string } | null;
  date: string;
  reason: string;
  requestedClockIn?: string | null;
  requestedClockOut?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote?: string;
  reviewedBy?: { name: string } | null;
  reviewedAt?: string;
  createdAt: string;
}

export type LeaveType = 'CASUAL' | 'SICK' | 'UNPAID' | 'COMP_OFF' | 'MATERNITY' | 'OTHER';

export interface LeaveRequest {
  _id: string;
  employee: { _id: string; name: string; employeeId: string; workLocation?: string } | null;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  isHalfDay: boolean;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewedBy?: { name: string } | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  source: 'KIOSK' | 'DASHBOARD';
  createdAt: string;
}

export interface Holiday {
  _id: string;
  date: string;
  name: string;
  workLocations: { _id: string; name: string }[];
  isPaid: boolean;
  createdAt: string;
}

export interface AuditEntry {
  _id: string;
  actor: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetModel: string | null;
  targetId: string | null;
  targetLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface SiteStat {
  siteId: string | null;
  siteName: string;
  totalEmployees: number;
  presentToday: number;
  late: number;
}

export interface DashboardStats {
  totalEmployees: number;
  // Employees actually expected today — total minus on-leave, weekly-off and
  // holiday. This is the correct denominator for an attendance percentage;
  // totalEmployees is not.
  expected?: number;
  presentToday: number;
  absent: number;
  onTime: number;
  late: number;
  onLeave?: number;
  weeklyOff?: number;
  holiday?: number;
  stillClockedIn?: number;
  attendanceRate?: number | null;
  bySite?: SiteStat[];
}

export interface TrendPoint {
  date: string;
  present: number;
  onTime: number;
  late: number;
}
