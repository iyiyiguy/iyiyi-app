// Map framing per country: approximate centre + latitudeDelta (the "zoomDelta") that shows the
// whole (main) territory. Kept separate from lib/countries.js (owned by the country list /
// picker). Countries not listed are geocoded by name, then framed with a default delta.
import * as Location from 'expo-location'
import { countryByCode } from './countries'

// code: [lat, lng, latitudeDelta]
const R = {
  US: [39.5, -98.5, 25], CA: [56, -96, 35], MX: [23.6, -102.5, 18], BR: [-14.2, -51.9, 38], AR: [-38.4, -63.6, 34],
  CL: [-35.7, -71.5, 38], CO: [4.6, -74.3, 14], PE: [-9.2, -75, 16], VE: [6.4, -66.6, 12], EC: [-1.8, -78.2, 7],
  BO: [-16.3, -63.6, 14], PY: [-23.4, -58.4, 10], UY: [-32.5, -55.8, 5], CU: [21.5, -79.5, 6], DO: [18.7, -70.2, 3],
  PR: [18.2, -66.5, 1.2], JM: [18.1, -77.3, 1.5], GT: [15.8, -90.2, 4], HN: [15.2, -86.2, 4], SV: [13.8, -88.9, 2],
  NI: [12.9, -85.2, 5], CR: [9.7, -84, 3.5], PA: [8.5, -80.8, 3.5], BS: [24.5, -77.5, 6], TT: [10.7, -61.2, 1.2], HT: [19, -72.3, 2.5],
  GB: [54.5, -3, 11], IE: [53.4, -8.2, 4.5], FR: [46.6, 2.4, 10], DE: [51.2, 10.4, 9], ES: [40, -3.7, 10], PT: [39.6, -8, 7],
  IT: [42.5, 12.5, 11], NL: [52.2, 5.3, 3], BE: [50.6, 4.5, 2.5], LU: [49.8, 6.1, 0.8], CH: [46.8, 8.2, 2.5], AT: [47.6, 14.1, 3.5],
  PL: [52, 19.1, 6.5], CZ: [49.8, 15.5, 3], SK: [48.7, 19.7, 2.5], HU: [47.2, 19.5, 3], RO: [45.9, 25, 5.5], BG: [42.7, 25.5, 3.5],
  GR: [39, 22, 7], SE: [62, 15, 15], NO: [64.5, 13, 15], FI: [64, 26, 12], DK: [56, 10, 3.5], IS: [64.9, -19, 5],
  UA: [48.4, 31.2, 10], BY: [53.7, 28, 6], RU: [61.5, 100, 45], TR: [39, 35.2, 8], RS: [44, 21, 4.5], HR: [44.5, 16.5, 5],
  SI: [46.1, 14.8, 1.6], BA: [44, 17.8, 3], AL: [41.2, 20, 3], MK: [41.6, 21.7, 1.5], ME: [42.7, 19.4, 1.3], LT: [55.2, 23.9, 3],
  LV: [56.9, 24.6, 2.5], EE: [58.6, 25, 2.5], MD: [47.4, 28.4, 3], CY: [35, 33.2, 1.3], MT: [35.9, 14.4, 0.4],
  IL: [31.4, 35, 4.5], PS: [31.9, 35.2, 1.5], JO: [31.2, 36.5, 4], LB: [33.9, 35.9, 1.5], SY: [35, 38.5, 5], IQ: [33.2, 43.7, 8],
  IR: [32.4, 53.7, 16], SA: [23.9, 45.1, 18], AE: [24.2, 54.3, 4], QA: [25.3, 51.2, 1.5], KW: [29.3, 47.5, 1.8], BH: [26, 50.55, 0.5],
  OM: [21, 57, 11], YE: [15.6, 48, 9], AF: [33.9, 67.7, 10], PK: [30.4, 69.3, 15], IN: [22, 79, 28], BD: [23.7, 90.4, 6],
  LK: [7.9, 80.8, 4], NP: [28.4, 84.1, 5], BT: [27.5, 90.4, 2], MV: [3.2, 73.2, 8], CN: [35.9, 104.2, 35], JP: [37.5, 138, 20],
  KR: [36.3, 127.8, 5], KP: [40.3, 127.5, 5], TW: [23.7, 121, 4], HK: [22.35, 114.15, 0.5], MO: [22.17, 113.55, 0.15],
  MN: [46.9, 103.8, 13], KZ: [48, 67, 20], UZ: [41.4, 64.6, 9], KG: [41.2, 74.8, 6], TJ: [38.9, 71.3, 5], TM: [38.97, 59.6, 8],
  GE: [42.3, 43.4, 3.5], AM: [40.1, 45, 2.5], AZ: [40.1, 47.6, 4],
  TH: [15.9, 101, 16], VN: [16, 106, 16], MY: [4.2, 108, 12], SG: [1.35, 103.82, 0.35], ID: [-2.5, 118, 24], PH: [12.9, 121.8, 16],
  MM: [19.8, 96.5, 18], KH: [12.6, 104.9, 5], LA: [18.2, 103.8, 9], BN: [4.5, 114.7, 1.2],
  AU: [-25.3, 134, 36], NZ: [-41.5, 172.5, 14], FJ: [-17.7, 178, 3], PG: [-6.3, 145, 10],
  EG: [26.8, 30.8, 12], MA: [31.8, -7.1, 10], DZ: [28, 2.6, 20], TN: [34, 9.5, 8], LY: [26.3, 17.2, 16], NG: [9.1, 8.7, 12],
  GH: [7.9, -1, 7], KE: [0.2, 37.9, 11], ET: [9.1, 40.5, 14], ZA: [-29, 25, 16], TZ: [-6.4, 34.9, 12], UG: [1.4, 32.3, 6],
  SN: [14.5, -14.5, 5], CI: [7.5, -5.5, 7], CM: [6, 12.4, 12], AO: [-11.2, 17.9, 15], ZW: [-19, 29.2, 8], ZM: [-13.1, 27.8, 11],
  RW: [-1.9, 29.9, 1.8], SD: [15.6, 30.2, 18], CD: [-2.9, 23.7, 20], MZ: [-18.7, 35.5, 18], MG: [-19, 46.9, 14], BW: [-22.3, 24.7, 10],
  NA: [-22.9, 18.5, 14], ML: [17.6, -4, 17], NE: [17.6, 8.1, 17], SO: [5.2, 46.2, 17], CG: [-0.7, 15.8, 9], GA: [-0.8, 11.6, 6],
  BJ: [9.3, 2.3, 7], TG: [8.6, 0.8, 6], BF: [12.2, -1.6, 7], GN: [10, -11, 6], SL: [8.5, -11.8, 3], LR: [6.4, -9.4, 4],
  MW: [-13.2, 34.3, 8], MU: [-20.3, 57.6, 0.8],
}

const DEFAULT_DELTA = 6

// -> { latitude, longitude, zoomDelta } or null (sync, bundled data only)
export function bundledCountryRegion(code) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : ''
  const r = R[c]
  return r ? { latitude: r[0], longitude: r[1], zoomDelta: r[2] } : null
}

// Bundled data, else geocode the country name. Never throws; null if nothing works.
export async function countryRegion(code) {
  const bundled = bundledCountryRegion(code)
  if (bundled) return bundled
  const entry = countryByCode(code)
  if (!entry) return null
  try {
    const [g] = await Location.geocodeAsync(entry.name)
    if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
      return { latitude: g.latitude, longitude: g.longitude, zoomDelta: DEFAULT_DELTA }
    }
  } catch { /* fall through */ }
  return null
}

// ISO code of the country at a point (reverse geocode). Never throws.
export async function countryCodeAt(coords) {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude })
    const code = typeof a?.isoCountryCode === 'string' ? a.isoCountryCode.toUpperCase() : null
    return code && /^[A-Z]{2}$/.test(code) ? code : null
  } catch {
    return null
  }
}
