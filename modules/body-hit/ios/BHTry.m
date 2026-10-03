#import "BHTry.h"

@implementation BHTry
+ (nullable NSString *)run:(void (NS_NOESCAPE ^)(void))block {
  @try {
    block();
    return nil;
  } @catch (NSException *exception) {
    return exception.reason ?: exception.name;
  }
}
@end
