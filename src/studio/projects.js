// Studio projects (beats in progress), saved on the device. Imported samples are copied into
// the app's documents folder so a saved beat keeps working after the original file is gone.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { KIT_BY_ID, DEFAULT_KIT } from './kits'
import { NUM_PADS } from './engine'

const INDEX_KEY = 'iyiyi_studio_projects_v1'
const projKey = (id) => `iyiyi_studio_project_v1_${id}`

export const PAD_COLORS = ['#ff4fa3', '#ffb21e', '#39d5ff', '#5cf2a0', '#b06cff', '#ff6b4a', '#7fb4ff', '#f2f4f7']

export function kitPads(kitId) {
  const kit = KIT_BY_ID[kitId] || KIT_BY_ID[DEFAULT_KIT]
  return kit.pads.map((p, i) => ({
    label: p.label,
    src: { kind: 'kit', kit: kit.id, pad: p.id },
    vol: p.id === 'hat' || p.id === 'openhat' || p.id === 'shaker' ? 0.6 : 0.85,
    pitch: 0,
    color: PAD_COLORS[i % PAD_COLORS.length],
  }))
}

export function newProject(kitId = DEFAULT_KIT) {
  const pads = kitPads(kitId)
  while (pads.length < NUM_PADS) pads.push({ label: `Sample ${pads.length - 7}`, src: null, vol: 0.85, pitch: 0, color: '#3a4152' })
  const steps = 16
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: 'Untitled beat',
    kit: kitId,
    bpm: 140,
    swing: 0,
    steps,
    metronome: false,
    pads,
    pattern: pads.map(() => new Array(steps).fill(0)),
    samples: [], // [{ id, name, uri, duration }]
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** Swaps the kit on pads 1-8, keeping their steps; sampler pads are untouched. */
export function withKit(project, kitId) {
  const kp = kitPads(kitId)
  const pads = project.pads.map((p, i) => (i < 8 ? { ...kp[i], vol: p.src?.kind === 'kit' ? p.vol : kp[i].vol, pitch: p.pitch || 0 } : p))
  return { ...project, kit: kitId, pads }
}

export function setSteps(project, steps) {
  const pattern = project.pattern.map((row) => Array.from({ length: steps }, (_, s) => row[s] ?? (steps > row.length ? row[s % row.length] : 0)))
  return { ...project, steps, pattern }
}

export async function listProjects() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY)
    const list = raw ? JSON.parse(raw) : []
    return list.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function loadProject(id) {
  try {
    const raw = await AsyncStorage.getItem(projKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function saveProject(project) {
  const p = { ...project, updatedAt: Date.now() }
  await AsyncStorage.setItem(projKey(p.id), JSON.stringify(p))
  const list = await listProjects()
  const meta = { id: p.id, name: p.name, bpm: p.bpm, kit: p.kit, updatedAt: p.updatedAt }
  const next = [meta, ...list.filter((x) => x.id !== p.id)]
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next))
  return p
}

export async function deleteProject(id) {
  await AsyncStorage.removeItem(projKey(id))
  const list = await listProjects()
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list.filter((x) => x.id !== id)))
}

/** Copies a picked audio file into permanent app storage (native). Returns a usable uri. */
export async function keepFile(uri, name) {
  if (Platform.OS === 'web') return uri // blob: urls live as long as the tab; fine for web
  try {
    const { File, Directory, Paths } = require('expo-file-system')
    const dir = new Directory(Paths.document, 'studio-samples')
    if (!dir.exists) dir.create({ intermediates: true })
    const ext = (name?.split('.').pop() || 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '') || 'm4a'
    const dest = new File(dir, `s${Date.now().toString(36)}.${ext}`)
    await new File(uri).copy(dest)
    return dest.uri
  } catch (e) {
    console.warn('Studio: could not keep sample file', e)
    return uri
  }
}
