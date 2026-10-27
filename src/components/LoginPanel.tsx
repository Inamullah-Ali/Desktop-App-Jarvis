import { useState } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'// Make sure path is correct
import { auth, db } from '../../electron/core/firebase'

export default function LoginPanel({ onLogin }: { onLogin: (user: any) => void }) {
  const [isLogin, setIsLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        // ✅ LOGIN
        const userCredential = await signInWithEmailAndPassword(auth, email, password)
        onLogin(userCredential.user)
      } else {
        // ✅ SIGNUP
        if (password !== confirmPassword) {
          throw new Error('Passwords match nahi kar rahe')
        }
        if (!name || !phone) {
          throw new Error('Naam aur phone number lazmi hai')
        }

        // 1. Firebase Auth mein account banayein
        const userCredential = await createUserWithEmailAndPassword(auth, email, password)
        const user = userCredential.user

        // 2. Firestore mein user ka data save karein
        await setDoc(doc(db, 'users', user.uid), {
          name: name,
          email: email,
          phone: phone,
          uid: user.uid,
          createdAt: Date.now()
        })

        // 3. User ka personal collection banayein (Optional: Future ke liye)
        // Firestore mein collection automatically ban jati hai jab document create hota hai
        
        onLogin(user)
      }
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Kuch masla ho gaya')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.box}>
        <h2 style={styles.title}>{isLogin ? 'Login' : 'Sign Up'} — JARVIS</h2>
        
        <form onSubmit={handleSubmit} style={styles.form}>
          {!isLogin && (
            <>
              <input
                type="text"
                placeholder="Aapka Naam"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={styles.input}
                required
              />
              <input
                type="tel"
                placeholder="Phone Number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={styles.input}
                required
              />
            </>
          )}
          
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
          />

          {!isLogin && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={styles.input}
              required
            />
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Processing...' : (isLogin ? 'Login' : 'Sign Up')}
          </button>
        </form>

        <p style={styles.toggleText}>
          {isLogin ? "Account nahi hai? " : "Pehle se account hai? "}
          <span onClick={() => setIsLogin(!isLogin)} style={styles.toggleLink}>
            {isLogin ? 'Sign Up karein' : 'Login karein'}
          </span>
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#121212', color: '#fff' },
  box: { background: '#1e1e1e', padding: 30, borderRadius: 12, width: '100%', maxWidth: 400, border: '1px solid #333' },
  title: { textAlign: 'center', marginBottom: 20, color: '#4a90d9' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: 12, borderRadius: 6, border: '1px solid #444', background: '#2a2a2a', color: '#fff', fontSize: 14 },
  button: { padding: 12, borderRadius: 6, border: 'none', background: '#4a90d9', color: '#fff', fontSize: 16, cursor: 'pointer', fontWeight: 'bold' },
  error: { color: '#f44336', fontSize: 13, textAlign: 'center' },
  toggleText: { textAlign: 'center', marginTop: 20, fontSize: 14, color: '#aaa' },
  toggleLink: { color: '#4a90d9', cursor: 'pointer', fontWeight: 'bold' }
}