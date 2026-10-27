import { auth, db } from '../../electron/core/firebase' // Apna path check karein
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface User {
  uid: string
  name: string
  email: string
  phone?: string
}

interface AuthState {
  isLoggedIn: boolean
  user: User | null
  login: (email: string, password: string) => Promise<void>
  signup: (name: string, email: string, phone: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      user: null,

      login: async (email, password) => {
        try {
          const result = await signInWithEmailAndPassword(auth, email, password)
          const userDoc = await getDoc(doc(db, 'users', result.user.uid))
          const userData = userDoc.exists() ? (userDoc.data() as User) : null
          
          set({ 
            isLoggedIn: true, 
            user: userData ? { ...userData, uid: result.user.uid } : null 
          })
        } catch (error) {
          set({ isLoggedIn: false, user: null })
          throw error
        }
      },

      signup: async (name, email, phone, password) => {
        try {
          const result = await createUserWithEmailAndPassword(auth, email, password)
          const newUser = {
            uid: result.user.uid,
            name,
            email,
            phone,
            createdAt: Date.now()
          }
          
          // Firestore mein save karein
          await setDoc(doc(db, 'users', result.user.uid), newUser)
          set({ isLoggedIn: true, user: newUser })
        } catch (error) {
          set({ isLoggedIn: false, user: null })
          throw error
        }
      },

      logout: async () => {
        await signOut(auth)
        set({ isLoggedIn: false, user: null })
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)