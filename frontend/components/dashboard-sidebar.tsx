'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  BarChart3,
  MapPin,
  Clock,
  Tag,
  ClipboardEdit,
  ShieldCheck,
} from 'lucide-react';

const PRODUCT_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true, roles: ['admin', 'hr', 'supervisor'] },
  { href: '/dashboard/employees', label: 'Employees', icon: Users, roles: ['admin', 'hr', 'supervisor'] },
  { href: '/dashboard/sites', label: 'Sites', icon: MapPin, roles: ['admin', 'hr'] },
  { href: '/dashboard/shifts', label: 'Shifts', icon: Clock, roles: ['admin', 'hr'] },
  { href: '/dashboard/billing', label: 'Services & Contractors', icon: Tag, roles: ['admin', 'hr'] },
  { href: '/dashboard/attendance', label: 'Attendance', icon: ClipboardList, roles: ['admin', 'hr', 'supervisor'] },
  { href: '/dashboard/regularization', label: 'Regularization', icon: ClipboardEdit, roles: ['admin', 'hr'] },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'hr', 'supervisor'] },
  { href: '/dashboard/users', label: 'Users', icon: ShieldCheck, roles: ['admin'] },
];

export function DashboardSidebar({ isOpen, setIsOpen, role }: { isOpen: boolean, setIsOpen: (val: boolean) => void, role?: string }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  // Default to showing everything until the role loads, rather than flashing
  // an empty sidebar — the backend still enforces the real permission either way.
  const visibleNav = PRODUCT_NAV.filter(item => !role || item.roles.includes(role));

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm cursor-default"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-border text-text-secondary flex flex-col transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-3 text-text-primary">
            <img src="/logo.png" alt="Radiance" className="w-8 h-8 rounded-lg object-cover border border-accent-border shadow-sm" />
            <span className="font-semibold text-lg tracking-tight text-display">Radiance</span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-8 scrollbar-hide">
          {/* Product Section */}
          <div>
            <p className="px-2 text-xs font-medium text-text-tertiary mb-2 tracking-wider">PRODUCT</p>
            <nav className="space-y-1">
              {visibleNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium transition-all ${
                    isActive(item.href, item.exact)
                      ? 'bg-surface-elevated text-text-primary shadow-sm'
                      : 'hover:bg-surface-elevated/50 hover:text-text-primary'
                  }`}
                >
                  <item.icon size={16} className={isActive(item.href, item.exact) ? 'text-accent' : 'text-text-tertiary'} />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <p className="text-xs text-text-tertiary px-2">Radiance Attendance v2.0</p>
        </div>
      </aside>
    </>
  );
}
