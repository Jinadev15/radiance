const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// The session lives in an httpOnly cookie the server sets on login — the
// browser attaches it automatically on every same-site request via
// `credentials: 'include'`; client JS never reads or writes it directly.
// middleware.ts only checks whether the cookie is *present* (it can, since
// Next.js middleware runs server-side) to gate page navigation.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
  // The cookie itself clears server-side; force a full reload so
  // middleware.ts re-checks cookie presence and redirects to /login.
  window.location.href = '/login';
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiRequest<{ user: { id: string; name: string; email: string; role: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout,

  getMe: () => apiRequest<{ name: string; email: string; role: string; workLocation?: { _id: string; name: string } | null }>('/api/auth/me'),

  // Dashboard user management (admin only)
  getUsers: () => apiRequest<any[]>('/api/auth/users'),
  createUser: (data: { name: string; email: string; password: string; role: string; workLocation?: string | null }) =>
    apiRequest<any>('/api/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  deactivateUser: (id: string) => apiRequest<any>(`/api/auth/users/${id}`, { method: 'DELETE' }),

  // Dashboard Stats
  getStats: (workLocation?: string) =>
    apiRequest<{ totalEmployees: number; presentToday: number; absent: number; onTime: number; late: number; bySite?: any[] }>(
      `/api/v1/dashboard/stats${workLocation ? `?workLocation=${workLocation}` : ''}`
    ),
  getTrend: (days = 7) =>
    apiRequest<{ date: string; present: number; onTime: number; late: number }[]>(`/api/v1/dashboard/trend?days=${days}`),

  // Employees
  getEmployees: () => apiRequest<any[]>('/api/v1/employees'),
  getEmployee: (id: string) => apiRequest<any>(`/api/v1/employees/${id}`),
  updateEmployee: (id: string, data: any) =>
    apiRequest<any>(`/api/v1/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateEmployee: (id: string) =>
    apiRequest<any>(`/api/v1/employees/${id}`, { method: 'DELETE' }),
  // Registration is intentionally a public endpoint (the kiosk self-registers
  // with no login) — routed through apiRequest for consistency with the rest
  // of the app, not because auth is required here.
  registerEmployee: (data: any) =>
    apiRequest<any>('/api/v1/register', { method: 'POST', body: JSON.stringify(data) }),

  // Sites / Work Locations
  getLocations: () => apiRequest<any[]>('/api/v1/locations'),
  getLocation: (id: string) => apiRequest<any>(`/api/v1/locations/${id}`),
  createLocation: (data: any) =>
    apiRequest<any>('/api/v1/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: any) =>
    apiRequest<any>(`/api/v1/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateLocation: (id: string) =>
    apiRequest<any>(`/api/v1/locations/${id}`, { method: 'DELETE' }),

  // Shift Templates
  getShifts: () => apiRequest<any[]>('/api/v1/shifts'),
  createShift: (data: any) =>
    apiRequest<any>('/api/v1/shifts', { method: 'POST', body: JSON.stringify(data) }),
  updateShift: (id: string, data: any) =>
    apiRequest<any>(`/api/v1/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateShift: (id: string) =>
    apiRequest<any>(`/api/v1/shifts/${id}`, { method: 'DELETE' }),
  bulkAssignShift: (data: { shiftTemplate: string; employeeIds?: string[]; workLocation?: string }) =>
    apiRequest<{ success: boolean; matched: number; updated: number }>('/api/v1/shifts/bulk-assign', {
      method: 'POST', body: JSON.stringify(data),
    }),

  // Security
  getSpoofAttempts: (limit = 50) => apiRequest<any[]>(`/api/v1/security/spoof-attempts?limit=${limit}`),

  // Services (billing tags)
  getServices: () => apiRequest<any[]>('/api/v1/services'),
  createService: (name: string) =>
    apiRequest<any>('/api/v1/services', { method: 'POST', body: JSON.stringify({ name }) }),
  deactivateService: (id: string) => apiRequest<any>(`/api/v1/services/${id}`, { method: 'DELETE' }),

  // Contractors
  getContractors: () => apiRequest<any[]>('/api/v1/contractors'),
  createContractor: (data: any) =>
    apiRequest<any>('/api/v1/contractors', { method: 'POST', body: JSON.stringify(data) }),
  updateContractor: (id: string, data: any) =>
    apiRequest<any>(`/api/v1/contractors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateContractor: (id: string) => apiRequest<any>(`/api/v1/contractors/${id}`, { method: 'DELETE' }),

  // Regularization requests
  getRegularizationRequests: (status?: string) =>
    apiRequest<any[]>(`/api/v1/regularization${status ? `?status=${status}` : ''}`),
  reviewRegularizationRequest: (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) =>
    apiRequest<any>(`/api/v1/regularization/${id}`, { method: 'PUT', body: JSON.stringify({ status, reviewNote }) }),

  // Manual attendance correction
  manualAttendanceEdit: (data: { employeeId: string; date: string; clockInTime: string; clockOutTime?: string; notes?: string }) =>
    apiRequest<any>('/api/v1/attendance/manual', { method: 'PUT', body: JSON.stringify(data) }),

  // Attendance
  getAttendance: (params?: { date?: string; employeeId?: string; status?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.set('date', params.date);
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return apiRequest<any[]>(`/api/v1/attendance${query ? '?' + query : ''}`);
  },
  getTodayAttendance: () => apiRequest<any[]>('/api/v1/attendance/today'),

  // Export requires auth, so it's a real fetch (not a bare <a href>) carrying
  // the session cookie, then triggers the browser download itself.
  exportAttendance: async (startDate?: string, endDate?: string, filename = 'attendance.csv') => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const res = await fetch(`${API_BASE}/api/v1/attendance/export${params.toString() ? '?' + params.toString() : ''}`, {
      credentials: 'include',
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
