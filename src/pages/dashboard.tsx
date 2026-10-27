import ChatPanel from '../components/ChatPanel'
import AudioTestPanel from '../components/AudioTestPanel'
import TestGemini from '../components/TestGemini'
import MemoryPanel from '../components/MemoryPanel'
import { useAuthStore } from '../store/useauthstore'
import { useState } from 'react'

export default function Dashboard() {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const [pushTestState, setPushTestState] = useState<{ message: string; error: boolean } | null>(null)
  const [testingPush, setTestingPush] = useState(false)

  const testPushNotification = async () => {
    setTestingPush(true)
    setPushTestState(null)
    try {
      const message = await window.jarvis.testPushNotification()
      setPushTestState({ message, error: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPushTestState({ message, error: true })
    } finally {
      setTestingPush(false)
    }
  }

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: 15, background: '#1a1a1a' }}>
        <h2 style={{ color: '#4a90d9', margin: 0 }}>🤖 JARVIS</h2>
        <div>
          <span style={{ color: '#aaa', marginRight: 15 }}>{user?.email}</span>
          <button
            onClick={testPushNotification}
            disabled={testingPush}
            style={{
              background: '#2768a8',
              color: '#fff',
              padding: '8px 16px',
              border: 'none',
              borderRadius: 6,
              cursor: testingPush ? 'wait' : 'pointer',
              marginRight: 10,
            }}
          >
            {testingPush ? 'Sending...' : 'Test push'}
          </button>
          <button onClick={logout} style={{ background: '#c62828', color: '#fff', padding: '8px 16px', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Logout</button>
        </div>
      </header>
      {pushTestState && (
        <div
          role="status"
          style={{
            margin: '12px 20px 0',
            padding: '10px 14px',
            borderRadius: 6,
            color: pushTestState.error ? '#ffcdd2' : '#c8e6c9',
            background: pushTestState.error ? '#4e2529' : '#1f3d2a',
          }}
        >
          {pushTestState.message}
        </div>
      )}
      
      <main style={{ padding: 20 }}>
        <ChatPanel />
        <hr style={{ margin: '40px 0', borderColor: '#333' }} />
        <AudioTestPanel />
        <hr style={{ margin: '40px 0', borderColor: '#333' }} />
        <TestGemini />
        <hr style={{ margin: '40px 0', borderColor: '#333' }} />
        <MemoryPanel />
      </main>
    </div>
  )
}