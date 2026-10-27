import { useEffect, useState } from 'react'
import { useAuthStore } from './useauthstore'

export function UseHydrated() {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated?.() ?? false)

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated?.()) {
      setHydrated(true)
      return
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true)
    })
    return unsub
  }, [])
  return hydrated
}