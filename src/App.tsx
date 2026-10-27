// src/App.tsx
import { useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/login/loginpage'
import SignupPage from './pages/login/signuppage'
import Dashboard from './pages/dashboard'
import ProtectedRoutes from './components/login/protectedroute'
import UnprotectedRoutes from './components/login/unprotectedroutes'
import { UseHydrated } from './store/usehydratestore'
import { useAuthStore } from './store/useauthstore'
import { addDoc, collection, doc, getDoc, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../electron/core/firebase'
import './App.css'

const APP_START_TIME = Date.now()

function App() {
  const hydrated = UseHydrated()
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const user = useAuthStore((s) => s.user)
  
  const screenPreviewRef = useRef<HTMLVideoElement>(null)
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null)
  const [screenShareStatus, setScreenShareStatus] = useState({
    state: 'waiting',
    message: 'Waiting for mobile request',
  })

  useEffect(() => {
    void window.jarvis?.userLoggedIn?.(isLoggedIn && user?.uid ? user.uid : '').catch((error: unknown) => {
      console.error('[Desktop] Could not sync login status:', error)
    })
  }, [isLoggedIn, user?.uid])

  useEffect(() => {
    if (!isLoggedIn || !user?.uid) {
      setScreenShareStream(null)
      setScreenShareStatus({ state: 'waiting', message: 'Waiting for mobile request' })
      return
    }

    let active = true
    let offerGeneration = 0
    let pc: RTCPeerConnection | null = null
    let stream: MediaStream | null = null
    let statsInterval: ReturnType<typeof setInterval> | null = null
    let pendingCandidates: RTCIceCandidateInit[] = []
    let activeSessionId: string | null = null
    let unsubscribeSession: (() => void) | null = null
    let unsubscribeMobileCandidates: (() => void) | null = null

    const closeActiveConnection = () => {
      if (statsInterval) clearInterval(statsInterval)
      statsInterval = null
      unsubscribeSession?.()
      unsubscribeSession = null
      unsubscribeMobileCandidates?.()
      unsubscribeMobileCandidates = null
      pc?.close()
      pc = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      pendingCandidates = []
      setScreenShareStream(null)
    }

    const handleOffer = async (sessionId: string, offer: RTCSessionDescriptionInit) => {
      console.log('[WebRTC] Offer received from mobile')
      const generation = ++offerGeneration
      const isCurrentOffer = () => active && generation === offerGeneration
      activeSessionId = sessionId
      closeActiveConnection()
      activeSessionId = sessionId
      setScreenShareStatus({ state: 'preparing', message: 'Preparing desktop capture' })
      const sessionRef = doc(db, 'screen_mirror_sessions', sessionId)

      try {
        await updateDoc(sessionRef, { status: 'preparing' })
        if (!isCurrentOffer()) return
        const currentSession = await getDoc(sessionRef)
        if (
          !currentSession.exists()
          || currentSession.data().status !== 'preparing'
        ) {
          activeSessionId = null
          return
        }
      } catch (error) {
        if (!isCurrentOffer()) return
        console.error('[WebRTC] Could not claim the mobile screen-mirroring request:', error)
        activeSessionId = null
        setScreenShareStatus({
          state: 'error',
          message: `Could not accept the screen-sharing request: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }

      unsubscribeSession = onSnapshot(
        sessionRef,
        (snapshot) => {
          if (activeSessionId !== sessionId) return
          const status = snapshot.data()?.status
          if (!snapshot.exists() || status === 'stopped' || status === 'failed') {
            const errorMessage = snapshot.data()?.error
            offerGeneration += 1
            activeSessionId = null
            closeActiveConnection()
            setScreenShareStatus(status === 'failed'
              ? { state: 'error', message: errorMessage || 'Screen sharing could not be started' }
              : { state: 'waiting', message: 'Mobile stopped screen sharing' })
          }
        },
        (error) => {
          if (!isCurrentOffer()) return
          console.error('[WebRTC] Could not monitor the mobile screen-mirroring request:', error)
          setScreenShareStatus({ state: 'error', message: `Firebase signaling failed: ${error.message}` })
        },
      )

      let capturedStream: MediaStream
      try {
        // @ts-ignore
        const sourceId = await window.jarvis.getScreenSource()
        console.log('[WebRTC] Screen Source ID:', sourceId)
        if (!isCurrentOffer()) return

        if (!sourceId) throw new Error('No desktop screen source was found')

        const desktopVideoConstraints: MediaTrackConstraints & {
          mandatory: {
            chromeMediaSource: string
            chromeMediaSourceId: string
            maxWidth: number
            maxHeight: number
            maxFrameRate: number
          }
        } = {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: 1280,
            maxHeight: 720,
            maxFrameRate: 30
          }
        }
        
        capturedStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: desktopVideoConstraints
        })

        if (!isCurrentOffer()) {
          capturedStream.getTracks().forEach((track) => track.stop())
          return
        }
      } catch (error) {
        if (!isCurrentOffer()) return
        console.error('[Screen capture] Desktop capture failed:', error)
        pendingCandidates = []
        setScreenShareStream(null)
        const message = error instanceof Error ? error.message : String(error)
        setScreenShareStatus({ state: 'error', message: `Desktop screen capture failed: ${message}` })
        void updateDoc(sessionRef, { status: 'failed', error: message }).catch((updateError: unknown) => {
          console.error('[WebRTC] Could not report the desktop capture error:', updateError)
        })
        return
      }

      stream = capturedStream
      setScreenShareStream(capturedStream)
      setScreenShareStatus({ state: 'connecting', message: 'Screen captured; connecting to mobile' })

      try {
        const turnUrls = String(import.meta.env.VITE_TURN_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean)
        const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
        if (turnUrls.length > 0) {
          const username = import.meta.env.VITE_TURN_USERNAME
          const credential = import.meta.env.VITE_TURN_CREDENTIAL
          if (!username || !credential) {
            throw new Error('TURN server URLs are set, but TURN username or credential is missing.')
          }
          iceServers.push({ urls: turnUrls, username, credential })
        }

        const connection = new RTCPeerConnection({
          iceServers,
        })
        pc = connection

        const videoSenders = capturedStream.getVideoTracks().map((track) => connection.addTrack(track, capturedStream))

        connection.onicecandidate = (event) => {
          if (event.candidate && isCurrentOffer()) {
            void addDoc(collection(sessionRef, 'desktopCandidates'), event.candidate.toJSON()).catch((error: unknown) => {
              console.error('[WebRTC] Failed to send ICE candidate through Firebase:', error)
              setScreenShareStatus({ state: 'error', message: `Firebase ICE signaling failed: ${String(error)}` })
            })
          }
        }

        const updateConnectionStatus = () => {
          const iceState = connection.iceConnectionState
          const peerState = connection.connectionState
          console.log(`[WebRTC] ICE state: ${iceState}; peer connection state: ${peerState}`)

          if (iceState === 'failed' || peerState === 'failed') {
            setScreenShareStatus({
              state: 'error',
              message: `WebRTC connection failed (ICE: ${iceState}; peer: ${peerState}). Check both apps' ICE configuration, TURN availability, and firewall/NAT restrictions.`,
            })
          } else if (iceState === 'disconnected' || peerState === 'disconnected') {
            setScreenShareStatus({
              state: 'connecting',
              message: `WebRTC connection interrupted (ICE: ${iceState}; peer: ${peerState}). Waiting for recovery.`,
            })
          } else if (iceState === 'closed' || peerState === 'closed') {
            setScreenShareStatus({
              state: 'waiting',
              message: `WebRTC connection closed (ICE: ${iceState}; peer: ${peerState}).`,
            })
          } else if (iceState === 'connected' || iceState === 'completed') {
            setScreenShareStatus({ state: 'connecting', message: 'WebRTC connected; checking outgoing video' })
          } else if (iceState === 'checking' || peerState === 'connecting') {
            setScreenShareStatus({
              state: 'connecting',
              message: `Establishing WebRTC connection (ICE: ${iceState}; peer: ${peerState})`,
            })
          } else {
            setScreenShareStatus({
              state: 'connecting',
              message: `Waiting for WebRTC connection (ICE: ${iceState}; peer: ${peerState})`,
            })
          }
        }

        connection.oniceconnectionstatechange = () => {
          if (!isCurrentOffer()) return
          updateConnectionStatus()
        }
        connection.onconnectionstatechange = () => {
          if (!isCurrentOffer()) return
          updateConnectionStatus()
        }

        const checkOutgoingVideo = async () => {
          if (
            !isCurrentOffer()
            || connection.connectionState !== 'connected'
            || (connection.iceConnectionState !== 'connected' && connection.iceConnectionState !== 'completed')
          ) return
          try {
            const reports = await Promise.all(videoSenders.map((sender) => sender.getStats()))
            if (!isCurrentOffer()) return

            let bytesSent = 0
            let framesEncoded = 0
            reports.forEach((report) => {
              report.forEach((stat) => {
                if (stat.type === 'outbound-rtp' && (stat.kind === 'video' || (stat as any).mediaType === 'video')) {
                  bytesSent += stat.bytesSent ?? 0
                  framesEncoded += stat.framesEncoded ?? 0
                }
              })
            })

            if (bytesSent > 0 && framesEncoded > 0) {
              const sentSize = bytesSent < 1024 * 1024
                ? `${(bytesSent / 1024).toFixed(0)} KB`
                : `${(bytesSent / (1024 * 1024)).toFixed(1)} MB`
              setScreenShareStatus({
                state: 'sharing',
                message: `Sending to mobile: ${framesEncoded} frames, ${sentSize} transmitted`
              })
            } else {
              setScreenShareStatus({ state: 'connecting', message: 'Connected; waiting for video frames to transmit' })
            }
          } catch (error) {
            console.error('[WebRTC] Could not read outgoing video stats:', error)
          }
        }

        statsInterval = setInterval(() => { void checkOutgoingVideo() }, 1000)

        capturedStream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            if (isCurrentOffer()) setScreenShareStatus({ state: 'error', message: 'Desktop capture stopped' })
          }
        })

        await connection.setRemoteDescription(new RTCSessionDescription(offer))
        if (!isCurrentOffer()) return

        unsubscribeMobileCandidates = onSnapshot(
          collection(sessionRef, 'mobileCandidates'),
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type !== 'added' || !isCurrentOffer()) return
              const candidate = change.doc.data() as RTCIceCandidateInit
              if (!connection.remoteDescription) {
                pendingCandidates.push(candidate)
              } else {
                void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch((error: unknown) => {
                  console.error('[WebRTC] Mobile ICE candidate could not be added:', error)
                })
              }
            })
          },
          (error) => {
            if (!isCurrentOffer()) return
            console.error('[WebRTC] Could not receive mobile ICE candidates:', error)
            setScreenShareStatus({ state: 'error', message: `Firebase ICE signaling failed: ${error.message}` })
          },
        )

        const candidatesToAdd = pendingCandidates
        pendingCandidates = []
        for (const candidate of candidatesToAdd) {
          try {
            await connection.addIceCandidate(new RTCIceCandidate(candidate))
          } catch (error) {
            console.error('[WebRTC] Buffered ICE candidate could not be added:', error)
          }
        }

        const answer = await connection.createAnswer()
        await connection.setLocalDescription(answer)
        if (!isCurrentOffer()) return

        await updateDoc(sessionRef, {
          answer: connection.localDescription?.toJSON(),
          status: 'answered',
        })
        console.log('[WebRTC] Answer sent to mobile')

      } catch (error) {
        if (!isCurrentOffer()) return
        console.error('[WebRTC] Negotiation or signaling setup failed:', error)
        if (statsInterval) clearInterval(statsInterval)
        statsInterval = null
        pc?.close()
        pc = null
        stream?.getTracks().forEach((track) => track.stop())
        stream = null
        pendingCandidates = []
        setScreenShareStream(null)
        const message = error instanceof Error ? error.message : String(error)
        setScreenShareStatus({ state: 'error', message: `WebRTC or signaling setup failed: ${message}` })
        void updateDoc(sessionRef, { status: 'failed', error: message }).catch((updateError: unknown) => {
          console.error('[WebRTC] Could not report the signaling failure:', updateError)
        })
      }
    }

    const sessionsQuery = query(
      collection(db, 'screen_mirror_sessions'),
      where('userId', '==', user.uid),
    )
    const unsubscribeRequests = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
        if (activeSessionId) return
        const sessionData = change.doc.data()
        if (sessionData.status !== 'waiting') return
        const createdAt = Number(sessionData.createdAt)
        if (
          !Number.isFinite(createdAt)
          || createdAt <= APP_START_TIME
          || Date.now() - createdAt > 2 * 60 * 1000
        ) {
          void updateDoc(change.doc.ref, {
            status: 'failed',
            error: 'Screen-sharing request expired because the desktop was unavailable when requested.',
          }).catch((error: unknown) => {
            console.error('[WebRTC] Could not expire an old screen-sharing request:', error)
          })
          return
        }
        const offer = sessionData.offer as RTCSessionDescriptionInit | undefined
        if (offer) void handleOffer(change.doc.id, offer)
        })
      },
      (error) => {
        console.error('[WebRTC] Could not listen for mobile screen-mirroring requests:', error)
        setScreenShareStatus({ state: 'error', message: `Firebase signaling failed: ${error.message}` })
      },
    )

    return () => {
      active = false
      const sessionId = activeSessionId
      unsubscribeRequests()
      closeActiveConnection()
      if (sessionId) {
        void updateDoc(doc(db, 'screen_mirror_sessions', sessionId), {
          status: 'failed',
          error: 'The desktop screen-sharing app was closed.',
        }).catch((error: unknown) => {
          console.error('[WebRTC] Could not notify the phone that the desktop disconnected:', error)
        })
      }
    }
  }, [isLoggedIn, user?.uid])

  useEffect(() => {
    const preview = screenPreviewRef.current
    if (!preview) return

    preview.srcObject = screenShareStream
    if (screenShareStream) {
      preview.play().catch((error: unknown) => {
        console.error('[WebRTC] Screen preview could not be played:', error)
      })
    }
  }, [screenShareStream])

  if (!hydrated) return <div style={{ color: '#fff', textAlign: 'center', marginTop: 50 }}>Loading...</div>

  return (
    <>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route element={<UnprotectedRoutes />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>
          <Route element={<ProtectedRoutes />}>
            <Route path="/dashboard" element={<Dashboard />} />
          </Route>
        </Routes>
      </Router>
      {isLoggedIn && (
        <aside className={`screen-share-status screen-share-status--${screenShareStatus.state}`} role="status" aria-live="polite">
          <div className="screen-share-status__heading">
            <span className="screen-share-status__indicator" />
            <strong>
              {screenShareStatus.state === 'sharing'
                ? 'Screen sharing'
                : screenShareStatus.state === 'error'
                  ? 'Share issue'
                  : screenShareStatus.state === 'preparing'
                    ? 'Starting share'
                    : screenShareStatus.state === 'connecting'
                      ? 'Connecting'
                      : 'Screen share'}
            </strong>
          </div>
          {screenShareStream ? (
            <video ref={screenPreviewRef} className="screen-share-status__preview" muted autoPlay playsInline />
          ) : (
            <div className="screen-share-status__placeholder">Desktop preview appears when a request arrives</div>
          )}
          <span className="screen-share-status__message">{screenShareStatus.message}</span>
        </aside>
      )}
    </>
  )
}

export default App