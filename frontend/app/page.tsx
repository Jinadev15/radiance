import { redirect } from 'next/navigation';

export default function RootPage() {
  // Middleware handles auth-based redirect.
  // If middleware allows this page, redirect to dashboard.
  redirect('/dashboard');
}