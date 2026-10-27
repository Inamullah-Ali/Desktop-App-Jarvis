import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/useauthstore'

export default function ProtectedRoutes() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  
  // Agar login nahi hai, to login page par bhej dein
  if (!isLoggedIn) return <Navigate to="/login" replace />
  
  return <Outlet />
}