// true / false once known (null while checking): lets screens that guests can also open
// (Music, The Lab on the website) hide or redirect the parts that need an account.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useSignedIn() {
  const [signedIn, setSignedIn] = useState(null)
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setSignedIn(!!data?.session) }).catch(() => alive && setSignedIn(false))
    const { data } = supabase.auth.onAuthStateChange((_e, session) => { if (alive) setSignedIn(!!session) })
    return () => { alive = false; data?.subscription?.unsubscribe?.() }
  }, [])
  return signedIn
}
