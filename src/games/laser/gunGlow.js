// One accent colour per weapon: the muzzle flash, the laser bolts it fires and its glow on the
// HUD all use it, so you can tell who's shooting what at a glance.
export const GUN_GLOW = {
  pistol: '#3df5ff',
  uzi: '#4dff9a',
  burst: '#ffd23f',
  smg: '#4d8bff',
  sniper: '#9b6bff',
  scatter: '#ff9a2e',
  assault: '#ff3b3b',
  marksman: '#7b7bff',
  minigun: '#ffd000',
  railgun: '#ffb03a',
  rocket: '#ff5a1f',
}

export const ENEMY_BOLT = '#ff3b3b'

export const glowFor = (gunId) => GUN_GLOW[gunId] || '#3df5ff'
