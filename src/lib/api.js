import { API_URL, supabase } from './supabase'

export async function apiFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession()
  const session = data?.session
  if (!session?.access_token) throw new Error('Please sign in again')
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers },
  })
}

// Resolves to parsed JSON, or throws an Error carrying the server's message.
export async function apiJson(path, options) {
  const res = await apiFetch(path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong')
  return data
}

export const post = (path, body) => apiJson(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
export const patch = (path, body) => apiJson(path, { method: 'PATCH', body: JSON.stringify(body) })
export const del = (path) => apiJson(path, { method: 'DELETE' })
