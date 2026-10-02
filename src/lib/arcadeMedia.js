// Photos for Beside Them task stations. Each photo is resized, uploaded to the
// same public 'profile-media' bucket CameraScreen uses (under <userId>/arcade/),
// and also turned into a tiny base64 thumbnail that is shared over the room's
// broadcast channel — so stations still work if the upload fails.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { supabase } from './supabase'

async function resize(uri, width, opts) {
  const ctx = ImageManipulator.manipulate(uri).resize({ width })
  const img = await ctx.renderAsync()
  return img.saveAsync({ format: SaveFormat.JPEG, ...opts })
}

export async function makeThumbnail(uri) {
  const r = await resize(uri, 200, { compress: 0.45, base64: true })
  if (!r?.base64) throw new Error('Could not make a thumbnail')
  return `data:image/jpeg;base64,${r.base64}`
}

export async function uploadStationPhoto(uri) {
  const { data } = await supabase.auth.getSession()
  const userId = data?.session?.user?.id
  if (!userId) throw new Error('Not signed in')
  const small = await resize(uri, 720, { compress: 0.6 })
  const path = `${userId}/arcade/station-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const body = await fetch(small.uri).then((r) => r.arrayBuffer())
  const { error } = await supabase.storage.from('profile-media').upload(path, body, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return supabase.storage.from('profile-media').getPublicUrl(path).data.publicUrl
}
