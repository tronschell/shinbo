

















#import <Foundation/Foundation.h>
#import <Speech/Speech.h>



static const NSTimeInterval kTimeout = 120.0;

static int fail(NSString *why) {
  fprintf(stderr, "%s\n", why.UTF8String);
  return 1;
}








static BOOL pump(BOOL *flag) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kTimeout];
  while (!*flag && [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]) {
    if ([NSDate.date compare:deadline] == NSOrderedDescending) return NO;
  }
  return *flag;
}


static SFSpeechRecognizerAuthorizationStatus authorize(void) {
  __block SFSpeechRecognizerAuthorizationStatus result = SFSpeechRecognizerAuthorizationStatusNotDetermined;
  __block BOOL answered = NO;
  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    result = status;
    answered = YES;
  }];
  pump(&answered);
  return result;
}







static BOOL dictationEnabled(void) {
  CFPropertyListRef value = CFPreferencesCopyAppValue(CFSTR("Dictation Enabled"), CFSTR("com.apple.assistant.support"));
  BOOL on = value && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value);
  if (value) CFRelease(value);
  return on;
}


static SFSpeechRecognizer *recognizer(NSString *localeID, NSString **why) {
  switch (authorize()) {
    case SFSpeechRecognizerAuthorizationStatusAuthorized: break;
    case SFSpeechRecognizerAuthorizationStatusDenied: *why = @"Speech recognition is denied for Shinbo in System Settings → Privacy & Security → Speech Recognition."; return nil;
    case SFSpeechRecognizerAuthorizationStatusRestricted: *why = @"Speech recognition is restricted on this Mac."; return nil;
    default: *why = @"Speech recognition was not authorized."; return nil;
  }
  NSLocale *locale = localeID.length ? [NSLocale localeWithLocaleIdentifier:localeID] : NSLocale.currentLocale;
  SFSpeechRecognizer *speech = [[SFSpeechRecognizer alloc] initWithLocale:locale];
  if (!speech) { *why = [NSString stringWithFormat:@"macOS has no speech recognizer for %@.", locale.localeIdentifier]; return nil; }
  if (!speech.isAvailable) { *why = @"The macOS speech recognizer is not available right now."; return nil; }


  if (!speech.supportsOnDeviceRecognition) { *why = [NSString stringWithFormat:@"%@ has no on-device speech model. Add the language under System Settings → Keyboard → Dictation.", locale.localeIdentifier]; return nil; }
  if (!dictationEnabled()) { *why = @"Dictation is off. Turn it on under System Settings → Keyboard → Dictation; macOS downloads the on-device model the first time."; return nil; }
  return speech;
}

int main(int argc, const char *argv[]) { @autoreleasepool {
  NSString *path = argc > 1 ? @(argv[1]) : nil;
  NSString *localeID = argc > 2 ? @(argv[2]) : nil;
  if (!path.length) return fail(@"usage: shinbo-transcribe <audio-file>|--check [locale]");

  __block NSString *why = nil;
  SFSpeechRecognizer *speech = recognizer(localeID, &why);
  if (!speech) return fail(why);
  if ([path isEqualToString:@"--check"]) { printf("ready\n"); return 0; }
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) return fail(@"That recording is gone.");

  SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:[NSURL fileURLWithPath:path]];
  request.requiresOnDeviceRecognition = YES;
  request.shouldReportPartialResults = NO;
  request.taskHint = SFSpeechRecognitionTaskHintDictation;
  if (@available(macOS 13.0, *)) request.addsPunctuation = YES;

  __block NSString *text = nil;
  __block BOOL done = NO;
  [speech recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {

    if (error) { why = error.localizedDescription; done = YES; return; }
    if (!result.isFinal) return;
    text = result.bestTranscription.formattedString;
    done = YES;
  }];
  if (!pump(&done)) return fail(@"The macOS recognizer did not answer in time.");
  if (!text) return fail(why ?: @"The macOS recognizer heard nothing.");
  printf("%s\n", text.UTF8String);
  return 0;
}}
