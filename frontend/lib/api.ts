import type {
  Site, Shift, Service, Contractor, Employee, DashboardUser,
  AttendanceLog, SpoofAttempt, RegularizationRequest, DashboardStats, TrendPoint,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// The real session lives in an httpOnly cookie the *backend* sets on login
// — the browser attaches it automatically on every API request via
// `credentials: 'include'`; client JS never reads or writes it directly,
// and the backend's own auth middleware is what actually enforces it.
//
// Separately, `SESSION_FLAG_COOKIE` below is a plain, non-sensitive
// "am I logged in" marker that this file sets on the *frontend's own*
// domain, purely so proxy.ts (which runs on the frontend's server and can
// only ever see cookies scoped to the frontend's domain) has something to
// check before rendering a page. It carries no auth power on its own —
// this exists because once the frontend and backend are deployed on two
// different domains (the normal outcome of free hosting: e.g. a Vercel
// frontend + a Render backend are NOT the same domain), the backend's
// httpOnly cookie is invisible to the frontend's own server by the
// definition of how cookies are domain-scoped — no SameSite/Secure
// setting changes that. Without this flag, proxy.ts would see "no cookie"
// on every request even immediately after a successful login, and bounce
// every page to /login. Real authorization is still 100% enforced by the
// backend on every API call regardless of this flag's state.
const SESSION_FLAG_COOKIE = 'radiance_session';

function setSessionFlag() {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${SESSION_FLAG_COOKIE}=1; expires=${expires}; path=/; SameSite=Lax`;
}

function clearSessionFlag() {
  document.cookie = `${SESSION_FLAG_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

// The httpOnly cookie the backend also sets is a third-party cookie once the
// dashboard and API are on different domains (Vercel + Render) — Safari (and
// Firefox's strict mode) block those outright regardless of SameSite/Secure,
// which silently breaks auth there while working fine in Chrome. This token
// is the real credential now: stored here, sent as an Authorization header
// on every request, which no browser blocks. localStorage (not memory) so
// the session survives a page reload/new tab, matching the cookie's old job.
const AUTH_TOKEN_KEY = 'radiance_auth_token';

function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    throw new ApiError('Authentication required.', 401);
  }

  if (!response.ok) {
    let errorMsg = `Request failed: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || errorData.msg || errorMsg;
    } catch {}
    throw new ApiError(errorMsg, response.status);
  }

  return response.json();
}

async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  clearAuthToken();
  clearSessionFlag();
  // Force a full reload so proxy.ts re-checks the (now cleared) session
  // flag and redirects to /login.
  window.location.href = '/login';
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    const result = await apiRequest<{ token: string; user: { id: string; name: string; email: string; role: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(result.token);
    setSessionFlag();
    return result;
  },
  logout,

  getMe: () => apiRequest<{ name: string; email: string; role: string; workLocation?: { _id: string; name: string } | null }>('/api/auth/me'),

  // Dashboard user management (admin only)
  getUsers: () => apiRequest<DashboardUser[]>('/api/auth/users'),
  createUser: (data: { name: string; email: string; password: string; role: string; workLocation?: string | null }) =>
    apiRequest<{ success: boolean; user: DashboardUser }>('/api/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  deactivateUser: (id: string) => apiRequest<{ success: boolean }>(`/api/auth/users/${id}`, { method: 'DELETE' }),

  // Dashboard Stats
  getStats: (workLocation?: string) =>
    apiRequest<DashboardStats>(`/api/v1/dashboard/stats${workLocation ? `?workLocation=${workLocation}` : ''}`),
  getTrend: (days = 7) => apiRequest<TrendPoint[]>(`/api/v1/dashboard/trend?days=${days}`),

  // Employees
  getEmployees: () => apiRequest<Employee[]>('/api/v1/employees'),
  getEmployee: (id: string) => apiRequest<Employee>(`/api/v1/employees/${id}`),
  updateEmployee: (id: string, data: Partial<Pick<Employee, 'name'>> & { workLocation?: string | null; shiftTemplate?: string | null; serviceTag?: string | null; contractor?: string | null }) =>
    apiRequest<{ success: boolean; employee: Employee }>(`/api/v1/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateEmployee: (id: string) =>
    apiRequest<{ success: boolean }>(`/api/v1/employees/${id}`, { method: 'DELETE' }),
  // Registration is intentionally a public endpoint (the kiosk self-registers
  // with no login) — routed through apiRequest for consistency with the rest
  // of the app, not because auth is required here.
  registerEmployee: (data: Record<string, unknown>) =>
    apiRequest<{ success: boolean; employeeId: string; name: string; message: string }>('/api/v1/register', { method: 'POST', body: JSON.stringify(data) }),

  // Sites / Work Locations
  getLocations: () => apiRequest<Site[]>('/api/v1/locations'),
  getLocation: (id: string) => apiRequest<Site>(`/api/v1/locations/${id}`),
  createLocation: (data: Omit<Site, '_id' | 'isActive'>) =>
    apiRequest<Site>('/api/v1/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: Partial<Omit<Site, '_id'>>) =>
    apiRequest<Site>(`/api/v1/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateLocation: (id: string) =>
    apiRequest<{ success: boolean }>(`/api/v1/locations/${id}`, { method: 'DELETE' }),

  // Shift Templates
  getShifts: () => apiRequest<Shift[]>('/api/v1/shifts'),
  createShift: (data: { name: string; startTime: string; endTime: string; graceMinutes: number }) =>
    apiRequest<Shift>('/api/v1/shifts', { method: 'POST', body: JSON.stringify(data) }),
  updateShift: (id: string, data: { name: string; startTime: string; endTime: string; graceMinutes: number }) =>
    apiRequest<Shift>(`/api/v1/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateShift: (id: string) =>
    apiRequest<{ success: boolean }>(`/api/v1/shifts/${id}`, { method: 'DELETE' }),
  bulkAssignShift: (data: { shiftTemplate: string; employeeIds?: string[]; workLocation?: string }) =>
    apiRequest<{ success: boolean; matched: number; updated: number }>('/api/v1/shifts/bulk-assign', {
      method: 'POST', body: JSON.stringify(data),
    }),

  // Security
  getSpoofAttempts: (limit = 50) => apiRequest<SpoofAttempt[]>(`/api/v1/security/spoof-attempts?limit=${limit}`),

  // Services (billing tags)
  getServices: () => apiRequest<Service[]>('/api/v1/services'),
  createService: (name: string) =>
    apiRequest<Service>('/api/v1/services', { method: 'POST', body: JSON.stringify({ name }) }),
  deactivateService: (id: string) => apiRequest<{ success: boolean }>(`/api/v1/services/${id}`, { method: 'DELETE' }),

  // Contractors
  getContractors: () => apiRequest<Contractor[]>('/api/v1/contractors'),
  createContractor: (data: { name: string; contactPhone?: string; workLocation?: string | null; headcountCap?: number | null }) =>
    apiRequest<Contractor>('/api/v1/contractors', { method: 'POST', body: JSON.stringify(data) }),
  updateContractor: (id: string, data: Partial<{ name: string; contactPhone: string; workLocation: string | null; headcountCap: number | null }>) =>
    apiRequest<Contractor>(`/api/v1/contractors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateContractor: (id: string) => apiRequest<{ success: boolean }>(`/api/v1/contractors/${id}`, { method: 'DELETE' }),

  // Regularization requests
  getRegularizationRequests: (status?: string) =>
    apiRequest<RegularizationRequest[]>(`/api/v1/regularization${status ? `?status=${status}` : ''}`),
  reviewRegularizationRequest: (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) =>
    apiRequest<{ success: boolean; request: RegularizationRequest }>(`/api/v1/regularization/${id}`, { method: 'PUT', body: JSON.stringify({ status, reviewNote }) }),

  // Manual attendance correction
  manualAttendanceEdit: (data: { employeeId: string; date: string; clockInTime: string; clockOutTime?: string; notes?: string }) =>
    apiRequest<{ success: boolean; log: AttendanceLog }>('/api/v1/attendance/manual', { method: 'PUT', body: JSON.stringify(data) }),

  // Attendance
  getAttendance: (params?: { date?: string; employeeId?: string; status?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.set('date', params.date);
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return apiRequest<AttendanceLog[]>(`/api/v1/attendance${query ? '?' + query : ''}`);
  },
  getTodayAttendance: () => apiRequest<AttendanceLog[]>('/api/v1/attendance/today'),

  // Export requires auth, so it's a real fetch (not a bare <a href>) carrying
  // the session cookie, then triggers the browser download itself.
  exportAttendance: async (startDate?: string, endDate?: string, filename = 'attendance.csv') => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/api/v1/attendance/export${params.toString() ? '?' + params.toString() : ''}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Export failed.');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export default api;
