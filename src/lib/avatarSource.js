// The picture everyone gets until they upload their own profile photo.
export const DEFAULT_AVATAR = require('../../assets/default-avatar.jpg')

// Image source for a profile photo: the photo when there is one, otherwise the default picture.
export function avatarSource(uri) {
  return typeof uri === 'string' && uri.trim() ? { uri } : DEFAULT_AVATAR
}
