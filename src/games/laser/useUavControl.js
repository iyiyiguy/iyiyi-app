// UAV logic now lives in lib/uav.js (cooldown, per-match cap, streak reward); kept as a re-export
// so existing imports keep working.
export { useUavControl } from '../../lib/uav'
