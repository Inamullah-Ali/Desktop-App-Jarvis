import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/useauthstore'

export default function UnprotectedRoutes() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  
  // Agar login hai, to dashboard par bhej dein
  if (isLoggedIn) return <Navigate to="/dashboard" replace />
  
  return <Outlet />
}