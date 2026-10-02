import { Platform } from 'react-native'
import { colors } from '../theme'

// The embed host (iyiyi-site's /iyiyi-app page) is a fullscreen fixed
// viewport with no scroll of its own — so this just needs to fill it
// edge-to-edge and keep its own scroll contained to #root, not the body.
export function installWebPhoneFrame() {
  if (Platform.OS !== 'web') return
  if (typeof document === 'undefined') return
  if (document.getElementById('iyiyi-web-phone-frame')) return

  const style = document.createElement('style')
  style.id = 'iyiyi-web-phone-frame'
  style.textContent = `
    html, body { background: ${colors.ink}; height: 100%; }
    body { overflow: hidden; }
    #root {
      width: 100%;
      height: 100vh;
      overflow: hidden;
    }
  `
  document.head.appendChild(style)
}
