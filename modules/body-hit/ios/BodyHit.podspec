Pod::Spec.new do |s|
  s.name           = 'BodyHit'
  s.version        = '1.0.0'
  s.summary        = 'Apple Vision body detection for Laser Tag hits'
  s.description    = 'Detects people and body-pose joints in a photo using Apple Vision.'
  s.author         = 'iYiYi'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoCamera'
  s.frameworks = 'Vision', 'ImageIO', 'CoreGraphics', 'CoreImage', 'AVFoundation', 'QuartzCore', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
