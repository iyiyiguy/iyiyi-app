#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Runs a block and turns an Objective-C exception (e.g. from AVCaptureSession) into a string
// instead of crashing the app. Swift cannot catch NSExceptions on its own.
@interface BHTry : NSObject
+ (nullable NSString *)run:(void (NS_NOESCAPE ^)(void))block;
@end

NS_ASSUME_NONNULL_END
