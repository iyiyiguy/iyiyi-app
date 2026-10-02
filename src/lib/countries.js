// Static ISO 3166-1 country list (alpha-2 code + English name), shared by the Feed's and
// the Map's country pickers. Flags are emoji built from the code (regional indicators).
//
//   COUNTRIES            [{ code: 'US', name: 'United States', flag: '🇺🇸' }, ...] sorted by name
//   countryByCode(code)  -> entry | null
//   findCountry(text)    -> entry | null; matches a code ('us'), a name ('united states'),
//                           or a common alias ('USA', 'UK', 'America') case-insensitively
//   countryMatches(value, country)  true when a free-text profile country (as typed on Edit
//                           Profile) refers to `country` (entry or code)
//   searchCountries(q)   -> entries whose name/code/alias contains q
//   flagFor(code)        -> emoji flag ('' for bad input)

const RAW = `
  AF|Afghanistan
  AX|Åland Islands
  AL|Albania
  DZ|Algeria
  AS|American Samoa
  AD|Andorra
  AO|Angola
  AI|Anguilla
  AQ|Antarctica
  AG|Antigua & Barbuda
  AR|Argentina
  AM|Armenia
  AW|Aruba
  AU|Australia
  AT|Austria
  AZ|Azerbaijan
  BS|Bahamas
  BH|Bahrain
  BD|Bangladesh
  BB|Barbados
  BY|Belarus
  BE|Belgium
  BZ|Belize
  BJ|Benin
  BM|Bermuda
  BT|Bhutan
  BO|Bolivia
  BA|Bosnia & Herzegovina
  BW|Botswana
  BV|Bouvet Island
  BR|Brazil
  IO|British Indian Ocean Territory
  VG|British Virgin Islands
  BN|Brunei
  BG|Bulgaria
  BF|Burkina Faso
  BI|Burundi
  KH|Cambodia
  CM|Cameroon
  CA|Canada
  CV|Cape Verde
  BQ|Caribbean Netherlands
  KY|Cayman Islands
  CF|Central African Republic
  TD|Chad
  CL|Chile
  CN|China
  CX|Christmas Island
  CC|Cocos (Keeling) Islands
  CO|Colombia
  KM|Comoros
  CG|Congo - Brazzaville
  CD|Congo - Kinshasa
  CK|Cook Islands
  CR|Costa Rica
  CI|Côte d'Ivoire
  HR|Croatia
  CU|Cuba
  CW|Curaçao
  CY|Cyprus
  CZ|Czechia
  DK|Denmark
  DJ|Djibouti
  DM|Dominica
  DO|Dominican Republic
  EC|Ecuador
  EG|Egypt
  SV|El Salvador
  GQ|Equatorial Guinea
  ER|Eritrea
  EE|Estonia
  SZ|Eswatini
  ET|Ethiopia
  FK|Falkland Islands
  FO|Faroe Islands
  FJ|Fiji
  FI|Finland
  FR|France
  GF|French Guiana
  PF|French Polynesia
  TF|French Southern Territories
  GA|Gabon
  GM|Gambia
  GE|Georgia
  DE|Germany
  GH|Ghana
  GI|Gibraltar
  GR|Greece
  GL|Greenland
  GD|Grenada
  GP|Guadeloupe
  GU|Guam
  GT|Guatemala
  GG|Guernsey
  GN|Guinea
  GW|Guinea-Bissau
  GY|Guyana
  HT|Haiti
  HM|Heard & McDonald Islands
  HN|Honduras
  HK|Hong Kong SAR China
  HU|Hungary
  IS|Iceland
  IN|India
  ID|Indonesia
  IR|Iran
  IQ|Iraq
  IE|Ireland
  IM|Isle of Man
  IL|Israel
  IT|Italy
  JM|Jamaica
  JP|Japan
  JE|Jersey
  JO|Jordan
  KZ|Kazakhstan
  KE|Kenya
  KI|Kiribati
  XK|Kosovo
  KW|Kuwait
  KG|Kyrgyzstan
  LA|Laos
  LV|Latvia
  LB|Lebanon
  LS|Lesotho
  LR|Liberia
  LY|Libya
  LI|Liechtenstein
  LT|Lithuania
  LU|Luxembourg
  MO|Macao SAR China
  MG|Madagascar
  MW|Malawi
  MY|Malaysia
  MV|Maldives
  ML|Mali
  MT|Malta
  MH|Marshall Islands
  MQ|Martinique
  MR|Mauritania
  MU|Mauritius
  YT|Mayotte
  MX|Mexico
  FM|Micronesia
  MD|Moldova
  MC|Monaco
  MN|Mongolia
  ME|Montenegro
  MS|Montserrat
  MA|Morocco
  MZ|Mozambique
  MM|Myanmar (Burma)
  NA|Namibia
  NR|Nauru
  NP|Nepal
  NL|Netherlands
  NC|New Caledonia
  NZ|New Zealand
  NI|Nicaragua
  NE|Niger
  NG|Nigeria
  NU|Niue
  NF|Norfolk Island
  KP|North Korea
  MK|North Macedonia
  MP|Northern Mariana Islands
  NO|Norway
  OM|Oman
  PK|Pakistan
  PW|Palau
  PS|Palestinian Territories
  PA|Panama
  PG|Papua New Guinea
  PY|Paraguay
  PE|Peru
  PH|Philippines
  PN|Pitcairn Islands
  PL|Poland
  PT|Portugal
  PR|Puerto Rico
  QA|Qatar
  RE|Réunion
  RO|Romania
  RU|Russia
  RW|Rwanda
  WS|Samoa
  SM|San Marino
  ST|São Tomé & Príncipe
  SA|Saudi Arabia
  SN|Senegal
  RS|Serbia
  SC|Seychelles
  SL|Sierra Leone
  SG|Singapore
  SX|Sint Maarten
  SK|Slovakia
  SI|Slovenia
  SB|Solomon Islands
  SO|Somalia
  ZA|South Africa
  GS|South Georgia & South Sandwich Islands
  KR|South Korea
  SS|South Sudan
  ES|Spain
  LK|Sri Lanka
  BL|St. Barthélemy
  SH|St. Helena
  KN|St. Kitts & Nevis
  LC|St. Lucia
  MF|St. Martin
  PM|St. Pierre & Miquelon
  VC|St. Vincent & Grenadines
  SD|Sudan
  SR|Suriname
  SJ|Svalbard & Jan Mayen
  SE|Sweden
  CH|Switzerland
  SY|Syria
  TW|Taiwan
  TJ|Tajikistan
  TZ|Tanzania
  TH|Thailand
  TL|Timor-Leste
  TG|Togo
  TK|Tokelau
  TO|Tonga
  TT|Trinidad & Tobago
  TN|Tunisia
  TR|Türkiye
  TM|Turkmenistan
  TC|Turks & Caicos Islands
  TV|Tuvalu
  UM|U.S. Outlying Islands
  VI|U.S. Virgin Islands
  UG|Uganda
  UA|Ukraine
  AE|United Arab Emirates
  GB|United Kingdom
  US|United States
  UY|Uruguay
  UZ|Uzbekistan
  VU|Vanuatu
  VA|Vatican City
  VE|Venezuela
  VN|Vietnam
  WF|Wallis & Futuna
  EH|Western Sahara
  YE|Yemen
  ZM|Zambia
  ZW|Zimbabwe
`

export function flagFor(code) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!/^[A-Z]{2}$/.test(c)) return ''
  try {
    return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
  } catch {
    return ''
  }
}

export const COUNTRIES = RAW.split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [code, name] = l.split('|')
    return { code, name, flag: flagFor(code) }
  })

// Common ways people type a country that aren't the ISO English name.
const ALIASES = {
  US: ['usa', 'u.s.', 'u.s.a.', 'united states of america', 'america', 'us of a'],
  GB: ['uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'united kingdom of great britain and northern ireland'],
  AE: ['uae', 'u.a.e.', 'emirates'],
  KR: ['korea', 'republic of korea', 's. korea', 'south korea'],
  KP: ['north korea', 'dprk'],
  RU: ['russian federation'],
  CZ: ['czech republic'],
  NL: ['holland', 'the netherlands'],
  CI: ["cote d'ivoire", 'ivory coast'],
  MM: ['burma'],
  TR: ['turkey', 'türkiye', 'turkiye'],
  VN: ['viet nam'],
  IR: ['iran, islamic republic of'],
  SY: ['syrian arab republic'],
  LA: ['lao pdr'],
  BO: ['bolivia, plurinational state of'],
  VE: ['venezuela, bolivarian republic of'],
  TZ: ['tanzania, united republic of'],
  MK: ['macedonia'],
  SZ: ['swaziland'],
  CV: ['cape verde'],
  CD: ['drc', 'dr congo', 'democratic republic of the congo', 'congo-kinshasa'],
  CG: ['republic of the congo', 'congo-brazzaville'],
  PS: ['palestine'],
  TW: ['republic of china'],
  CN: ['prc', "people's republic of china"],
  VA: ['vatican', 'holy see'],
}

const stripAccents = (s) => {
  try {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  } catch {
    return s
  }
}
const norm = (s) => stripAccents(typeof s === 'string' ? s : '')
  .replace(/[’`]/g, "'")
  .replace(/^the\s+/i, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))
const BY_KEY = new Map()
for (const c of COUNTRIES) {
  BY_KEY.set(norm(c.name), c)
  BY_KEY.set(c.code.toLowerCase(), c)
  for (const a of ALIASES[c.code] ?? []) BY_KEY.set(norm(a), c)
}

export function countryByCode(code) {
  if (typeof code !== 'string') return null
  return BY_CODE.get(code.trim().toUpperCase()) ?? null
}

export function findCountry(text) {
  const k = norm(text)
  if (!k) return null
  return BY_KEY.get(k) ?? BY_KEY.get(k.replace(/\./g, '')) ?? null
}

export function countryMatches(value, country) {
  const target = typeof country === 'string' ? countryByCode(country) : country
  if (!target || value == null) return false
  const found = findCountry(String(value))
  return !!found && found.code === target.code
}

export function searchCountries(q) {
  const k = norm(q)
  if (!k) return COUNTRIES
  return COUNTRIES.filter((c) =>
    norm(c.name).includes(k)
    || c.code.toLowerCase() === k
    || (ALIASES[c.code] ?? []).some((a) => norm(a).includes(k))
  )
}

// Strings a profile might store for this country: name, code and aliases (original case).
export function countryVariants(country) {
  const c = typeof country === 'string' ? countryByCode(country) : country
  if (!c) return []
  return Array.from(new Set([c.name, c.code, ...(ALIASES[c.code] ?? [])]))
}
