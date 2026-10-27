import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useauthstore'

interface SignUpFormData {
  name: string
  email: string
  phone: string
  password: string
  confirmPassword: string
}

export default function SignupPage() {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SignUpFormData>()
  const signup = useAuthStore((s) => s.signup)
  const navigate = useNavigate()

  // ✅ Password match check karne ke liye
  const password = watch('password')

  const onSubmit = async (data: SignUpFormData) => {
    try {
      // Zustand store ka signup function call karein
      await signup(data.name, data.email, data.phone, data.password)
      navigate('/dashboard') // Signup success par dashboard le jayein
    } catch (e: any) {
      alert(e.message) // Agar email pehle se hai ya koi error aaye
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: '#121212' }}>
      <form onSubmit={handleSubmit(onSubmit)} style={{ background: '#1e1e1e', padding: 30, borderRadius: 12, width: 380 }}>
        <h2 style={{ color: '#4a90d9', textAlign: 'center', marginBottom: 20 }}>Sign Up — JARVIS</h2>
        
        {/* Name */}
        <input 
          {...register('name', { required: 'Naam zaroori hai' })} 
          placeholder="Aapka Naam" 
          style={inputStyle} 
        />
        {errors.name && <p style={errorStyle}>{String(errors.name.message)}</p>}

        {/* Email */}
        <input 
          {...register('email', { 
            required: 'Email zaroori hai',
            pattern: { value: /^\S+@\S+$/i, message: 'Sahi email dalein' }
          })} 
          placeholder="Email" 
          style={inputStyle} 
        />
        {errors.email && <p style={errorStyle}>{String(errors.email.message)}</p>}

        {/* Phone */}
        <input 
          {...register('phone', { required: 'Phone number zaroori hai' })} 
          placeholder="Phone Number (e.g. 03001234567)" 
          style={inputStyle} 
        />
        {errors.phone && <p style={errorStyle}>{String(errors.phone.message)}</p>}

        {/* Password */}
        <input 
          {...register('password', { 
            required: 'Password zaroori hai',
            minLength: { value: 6, message: 'Kam az kam 6 characters' }
          })} 
          type="password" 
          placeholder="Password" 
          style={inputStyle} 
        />
        {errors.password && <p style={errorStyle}>{String(errors.password.message)}</p>}

        {/* Confirm Password */}
        <input 
          {...register('confirmPassword', { 
            required: 'Confirm password zaroori hai',
            validate: (value) => value === password || 'Passwords match nahi kar rahe'
          })} 
          type="password" 
          placeholder="Confirm Password" 
          style={inputStyle} 
        />
        {errors.confirmPassword && <p style={errorStyle}>{String(errors.confirmPassword.message)}</p>}

        <button type="submit" style={buttonStyle}>Sign Up</button>
        
        <p style={{ color: '#aaa', textAlign: 'center', marginTop: 15 }}>
          Pehle se account hai? <Link to="/login" style={{ color: '#4a90d9' }}>Login</Link>
        </p>
      </form>
    </div>
  )
}

// Styles
const inputStyle = { width: '100%', padding: 10, marginBottom: 10, background: '#2a2a2a', border: '1px solid #444', color: '#fff', borderRadius: 6, boxSizing: 'border-box' as const }
const buttonStyle = { width: '100%', padding: 10, background: '#4a90d9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' as const, marginTop: 10 }
const errorStyle = { color: '#f44336', fontSize: 12, marginTop: -5, marginBottom: 10 }