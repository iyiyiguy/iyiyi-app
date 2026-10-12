Pod::Spec.new do |s|
  s.name           = 'DualCamera'
  s.version        = '1.0.0'
  s.summary        = 'Back + front camera at once for Laser Tag'
  s.description    = 'AVCaptureMultiCamSession view: full-screen back camera with a front-camera bubble, plus back-camera photos for hit detection.'
  s.author         = 'iYiYi'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'UIKit', 'QuartzCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
