require 'digest'
require 'fileutils'
require 'tmpdir'

# Surface scanner model (Laser Tag cover), SHIPPED INSIDE THE APP.
#
# Apple's Core ML release of Depth Anything V2 Small (Float16 .mlpackage, ~50 MB of weights) is
# not kept in git. It is fetched when CocoaPods evaluates this podspec during `pod install`
# (the podspec is plain Ruby, read before any file globs are collected). `prepare_command` is not
# used: the CocoaPods DSL docs say it is not executed for pods installed with `:path` (how Expo
# autolinks local modules; only CocoaPods 1.17+ started running it for local pods), and a
# `script_phase` runs too late (in xcodebuild, after the resource lists are fixed). Every file is checked against its pinned byte size and SHA-256
# (a mismatch stops `pod install` with an error), then compiled once with
# `xcrun coremlcompiler compile` into DepthAnythingV2SmallF16.mlmodelc. That folder is declared
# as a pod resource below, so CocoaPods' "[CP] Copy Pods Resources" build phase of the app target
# rsyncs it into the root of the .app (static libraries / static frameworks; with dynamic
# frameworks it is copied into BodyHit.framework instead). DepthEstimator.swift loads it from
# there, with no network.
#
# Network failure / no Xcode: a warning, and the app builds without the model (DepthEstimator
# then falls back to its silent runtime download). Files are cached in ios/DepthModel/
# (git-ignored), so later `pod install`s are instant. BODYHIT_SKIP_DEPTH_MODEL=1 skips it all.
bodyhit_depth_model = lambda do
  name = 'DepthAnythingV2SmallF16'
  revision = 'cfef6f6f2a70783dedc0bfae40cecbc2052285d3'
  base_url = "https://huggingface.co/apple/coreml-depth-anything-v2-small/resolve/#{revision}/#{name}.mlpackage/"
  files = [
    ['Manifest.json', 617, '2883ae290c48fe916dc5ececac03a7d847fa277165a49ef5652fa1d2b9cb55f7'],
    ['Data/com.apple.CoreML/model.mlmodel', 399_433, '44ac97a3efcfd52113183fb2862ff59cd0368e9ec2e30a90a54980dd11407042'],
    ['Data/com.apple.CoreML/weights/weight.bin', 49_419_072, 'fa60d9b6a155734f59029ebb882fd54e549bfaee3539c1a9cbd2cbbab64a0fed'],
  ]
  tag = "#{name}@#{revision}"
  say = lambda { |msg| defined?(Pod::UI) ? Pod::UI.puts("[BodyHit] #{msg}") : puts("[BodyHit] #{msg}") }
  warn = lambda { |msg| defined?(Pod::UI) ? Pod::UI.warn("[BodyHit] #{msg}") : Kernel.warn("[BodyHit] warning: #{msg}") }

  next nil if ENV['BODYHIT_SKIP_DEPTH_MODEL'] == '1'
  dir = File.join(__dir__, 'DepthModel')
  compiled = File.join(dir, "#{name}.mlmodelc")
  stamp = File.join(dir, 'compiled.txt')
  # Already fetched, verified and compiled (podspecs are evaluated several times per install).
  if File.directory?(compiled) && File.exist?(stamp) && File.read(stamp).strip == tag
    next "DepthModel/#{name}.mlmodelc"
  end
  unless RUBY_PLATFORM.include?('darwin') || ENV['BODYHIT_DEPTH_MODEL_ANY_OS'] == '1'
    next nil # Core ML compiling needs Xcode (macOS)
  end

  pkg = File.join(dir, 'download', "#{name}.mlpackage")
  fetched = true
  files.each do |rel, size, sha|
    dest = File.join(pkg, rel)
    next if File.size?(dest) == size && Digest::SHA256.file(dest).hexdigest == sha
    FileUtils.mkdir_p(File.dirname(dest))
    part = "#{dest}.part"
    FileUtils.rm_f([dest, part])
    say.call("downloading surface scanner model: #{rel} (#{size} bytes)")
    ok = system('curl', '-fL', '-sS', '--retry', '3', '--retry-delay', '5', '--connect-timeout', '30',
                '--max-time', '900', '-o', part, base_url + rel)
    unless ok && File.exist?(part)
      FileUtils.rm_f(part)
      warn.call("could not download #{base_url + rel}: building WITHOUT the bundled surface scanner model (the app will download it at runtime instead)")
      fetched = false
      break
    end
    got_size = File.size(part)
    got_sha = Digest::SHA256.file(part).hexdigest
    if got_size != size || got_sha != sha
      FileUtils.rm_f(part)
      raise "[BodyHit] surface scanner model file #{rel} FAILED VERIFICATION: expected #{size} bytes, sha256 #{sha}; " \
            "got #{got_size} bytes, sha256 #{got_sha} (from #{base_url + rel}). Refusing to bundle it."
    end
    File.rename(part, dest)
  end
  next nil unless fetched

  out = Dir.mktmpdir('bodyhit-depth-')
  begin
    say.call("compiling #{name}.mlpackage with coremlcompiler")
    ok = system('xcrun', 'coremlcompiler', 'compile', pkg, out, out: File::NULL)
    produced = File.join(out, "#{name}.mlmodelc")
    unless ok && File.directory?(produced) && !Dir.empty?(produced)
      warn.call("xcrun coremlcompiler failed: building WITHOUT the bundled surface scanner model")
      next nil
    end
    FileUtils.rm_rf(compiled)
    FileUtils.mv(produced, compiled)
    File.write(stamp, tag)
    say.call("surface scanner model bundled: #{compiled}")
    "DepthModel/#{name}.mlmodelc"
  ensure
    FileUtils.rm_rf(out)
  end
end
bodyhit_depth_resource = bodyhit_depth_model.call

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
  s.frameworks = 'Vision', 'ImageIO', 'CoreGraphics', 'CoreImage', 'AVFoundation', 'QuartzCore', 'UIKit', 'CoreML', 'CoreVideo', 'CryptoKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
  # The compiled surface scanner model (see above); lands in the root of the .app.
  s.resources = [bodyhit_depth_resource] if bodyhit_depth_resource
end
