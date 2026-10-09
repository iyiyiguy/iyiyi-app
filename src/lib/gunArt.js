// Illustrations for every Laser Tag gun (assets/guns/<id>.png, side view facing right).
const ART = {
  pistol: require('../../assets/guns/pistol.png'),
  uzi: require('../../assets/guns/uzi.png'),
  burst: require('../../assets/guns/burst.png'),
  smg: require('../../assets/guns/smg.png'),
  sniper: require('../../assets/guns/sniper.png'),
  scatter: require('../../assets/guns/scatter.png'),
  assault: require('../../assets/guns/assault.png'),
  marksman: require('../../assets/guns/marksman.png'),
  minigun: require('../../assets/guns/minigun.png'),
  railgun: require('../../assets/guns/railgun.png'),
  rocket: require('../../assets/guns/rocket.png'),
}

export const gunArt = (gunOrId) => ART[typeof gunOrId === 'string' ? gunOrId : gunOrId?.id] || ART.pistol
