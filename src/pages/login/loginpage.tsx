import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useauthstore'

export default function LoginPage() {
  const { register, handleSubmit, formState: { errors } } = useForm()
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const onSubmit = async (data: any) => {
    try {
      await login(data.email, data.password)
      navigate('/dashboard')
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: '#121212' }}>
      <form onSubmit={handleSubmit(onSubmit)} style={{ background: '#1e1e1e', padding: 30, borderRadius: 12, width: 350 }}>
        <h2 style={{ color: '#4a90d9', textAlign: 'center' }}>Login — JARVIS</h2>
        
        <input {...register('email', { required: 'Email zaroori hai' })} placeholder="Email" style={inputStyle} />
        {errors.email && <p style={errorStyle}>{String(errors.email.message)}</p>}

        <input {...register('password', { required: 'Password zaroori hai' })} type="password" placeholder="Password" style={inputStyle} />
        {errors.password && <p style={errorStyle}>{String(errors.password.message)}</p>}

        <button type="submit" style={buttonStyle}>Login</button>
        
        <p style={{ color: '#aaa', textAlign: 'center', marginTop: 15 }}>
          Account nahi hai? <Link to="/signup" style={{ color: '#4a90d9' }}>Sign Up</Link>
        </p>
      </form>
    </div>
  )
}

const inputStyle = { width: '100%', padding: 10, marginBottom: 10, background: '#2a2a2a', border: '1px solid #444', color: '#fff', borderRadius: 6 }
const buttonStyle = { width: '100%', padding: 10, background: '#4a90d9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' as const }
const errorStyle = { color: 'red', fontSize: 12, marginBottom: 10 }