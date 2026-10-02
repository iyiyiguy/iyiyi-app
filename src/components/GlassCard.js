import Glass from './Glass'

// Widget-style glass card. `tint="dark"` forces dark glass (used over the live camera);
// the default follows the app's light/dark setting.
export const GlassCard = ({ children, style, tint, radius = 26, padding = 16, intensity, gloss, strong = false }) => (
  <Glass style={[{ padding }, style]} radius={radius} scheme={tint === 'dark' ? 'dark' : 'auto'} strong={strong}>
    {children}
  </Glass>
)

export default GlassCard
