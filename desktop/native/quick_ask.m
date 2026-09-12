#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <assert.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum { TapDown, TapUp, TapCancel } TapEvent;
typedef struct {
    bool is_down;
    bool has_previous_release;
    bool ignore_release;
    NSTimeInterval previous_release;
} DoubleTap;

static bool handle_tap(DoubleTap *tap, TapEvent event, NSTimeInterval time) {
    switch (event) {
        case TapCancel:
            memset(tap, 0, sizeof(*tap));
            break;
        case TapDown:
            if (tap->is_down) return false;
            tap->is_down = true;
            if (tap->has_previous_release && time >= tap->previous_release && time - tap->previous_release <= 0.35) {
                tap->has_previous_release = false;
                tap->ignore_release = true;
                return true;
            }
            break;
        case TapUp:
            if (!tap->is_down) return false;
            tap->is_down = false;
            if (tap->ignore_release) {
                tap->ignore_release = false;
                tap->has_previous_release = false;
            } else {
                tap->has_previous_release = true;
                tap->previous_release = time;
            }
            break;
    }
    return false;
}

#define kMaxHolds 8
typedef struct {
    uint16_t key_code;
    double seconds;
    char id[32];
} HoldBinding;

typedef struct {
    HoldBinding items[kMaxHolds];
    size_t count;
} HoldSet;

typedef struct {
    HoldSet set;
    DoubleTap taps[kMaxHolds];
    size_t armed;
    uint64_t generation;
} HoldWatch;

static const struct { uint16_t code; NSEventModifierFlags flag; } kModifierFlags[] = {
    {54, NSEventModifierFlagCommand}, {55, NSEventModifierFlagCommand},
    {56, NSEventModifierFlagShift}, {60, NSEventModifierFlagShift},
    {58, NSEventModifierFlagOption}, {61, NSEventModifierFlagOption},
    {59, NSEventModifierFlagControl}, {62, NSEventModifierFlagControl},
    {63, NSEventModifierFlagFunction},
};

static NSEventModifierFlags modifier_flag(uint16_t key_code) {
    for (size_t index = 0; index < sizeof(kModifierFlags) / sizeof(kModifierFlags[0]); index += 1) {
        if (kModifierFlags[index].code == key_code) return kModifierFlags[index].flag;
    }
    return 0;
}

static size_t handle_hold(HoldWatch *watch, NSEventType type, uint16_t key_code, NSEventModifierFlags flags) {
    flags &= NSEventModifierFlagDeviceIndependentFlagsMask;
    if (type != NSEventTypeFlagsChanged) { watch->armed = 0; watch->generation += 1; return 0; }
    for (size_t index = 0; index < watch->set.count; index += 1) {
        NSEventModifierFlags flag = modifier_flag(watch->set.items[index].key_code);
        if (watch->set.items[index].seconds > 0 && watch->set.items[index].key_code == key_code && flag != 0 && flags == flag) {
            watch->armed = index + 1;
            watch->generation += 1;
            return watch->armed;
        }
    }
    watch->armed = 0;
    watch->generation += 1;
    return 0;
}

static bool hold_survived(const HoldWatch *watch, size_t armed, uint64_t generation) {
    return watch->armed == armed && armed != 0 && watch->generation == generation;
}

static HoldSet parse_holds(NSDictionary *object) {
    HoldSet set = {0};
    HoldBinding *out = set.items;
    NSArray *items = [object isKindOfClass:[NSDictionary class]] ? object[@"holds"] : nil;
    if (![items isKindOfClass:[NSArray class]]) return set;
    size_t count = 0;
    for (NSDictionary *item in items) {
        if (count == kMaxHolds || ![item isKindOfClass:[NSDictionary class]]) break;
        id identifier = item[@"id"];
        id key_code = item[@"keyCode"];
        id ms = item[@"ms"];
        if (![identifier isKindOfClass:[NSString class]] || ![key_code isKindOfClass:[NSNumber class]] || ![ms isKindOfClass:[NSNumber class]]) continue;
        double milliseconds = [ms doubleValue];
        int code = [key_code intValue];
        if (milliseconds != 0 && (milliseconds < 100 || milliseconds > 5000) || code < 0 || code > 0xFFFF || modifier_flag((uint16_t)code) == 0) continue;
        const char *name = [(NSString *)identifier UTF8String];
        if (!name || strlen(name) >= sizeof(out[0].id)) continue;
        out[count].key_code = (uint16_t)code;
        out[count].seconds = milliseconds / 1000.0;
        strncpy(out[count].id, name, sizeof(out[0].id) - 1);
        out[count].id[sizeof(out[0].id) - 1] = '\0';
        count += 1;
    }
    set.count = count;
    return set;
}

static TapEvent event_input(NSEventType type, uint16_t key_code, NSEventModifierFlags flags, uint16_t tap_code) {
    if (type != NSEventTypeFlagsChanged || key_code != tap_code) return TapCancel;

    flags &= NSEventModifierFlagDeviceIndependentFlagsMask;
    if (flags == modifier_flag(tap_code)) return TapDown;
    if (flags == 0) return TapUp;
    return TapCancel;
}

static size_t handle_taps(HoldWatch *watch, NSEventType type, uint16_t key_code, NSEventModifierFlags flags, NSTimeInterval time) {
    size_t fired = 0;
    for (size_t index = 0; index < watch->set.count; index += 1) {
        if (watch->set.items[index].seconds > 0) continue;
        if (handle_tap(&watch->taps[index], event_input(type, key_code, flags, watch->set.items[index].key_code), time)) fired = index + 1;
    }
    return fired;
}

static int print_screens(void) {
    NSMutableArray *items = [NSMutableArray array];
    for (NSScreen *screen in [NSScreen screens]) {
        NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
        if (![number isKindOfClass:[NSNumber class]]) continue;
        NSRect left = screen.auxiliaryTopLeftArea;
        NSRect right = screen.auxiliaryTopRightArea;
        CGFloat height = screen.safeAreaInsets.top;
        CGFloat notch_left = NSMaxX(left);
        CGFloat notch_width = NSMinX(right) - notch_left;
        if (height <= 0 || NSWidth(left) <= 0 || NSWidth(right) <= 0 || notch_width <= 0) continue;
        [items addObject:@{@"id": number, @"x": @(notch_left), @"width": @(notch_width), @"height": @(height)}];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:items options:0 error:NULL];
    if (!json) {
        fputs("Shinbo: unable to serialize display geometry.\n", stderr);
        return 1;
    }
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    return 0;
}

static NSString *attribute_string(AXUIElementRef element, CFStringRef attribute) {
    if (!element) return nil;
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return nil;
    if (CFGetTypeID(value) != CFStringGetTypeID()) {
        CFRelease(value);
        return nil;
    }
    return (__bridge_transfer NSString *)value;
}

static NSString *accessibility_selection(pid_t pid, NSString **window_title) {
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    if (!application) return nil;
    NSString *selected = nil;
    CFTypeRef focused = NULL;
    if (AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess && focused) {
        selected = attribute_string((AXUIElementRef)focused, kAXSelectedTextAttribute);
        CFRelease(focused);
    }
    CFTypeRef window = NULL;
    if (AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, &window) == kAXErrorSuccess && window) {
        *window_title = attribute_string((AXUIElementRef)window, kAXTitleAttribute);
        CFRelease(window);
    }
    CFRelease(application);
    return selected;
}

static NSString *copied_selection(void) {
    NSPasteboard *board = [NSPasteboard generalPasteboard];
    NSInteger before = board.changeCount;
    NSString *held = [board stringForType:NSPasteboardTypeString];

    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
    CGEventRef down = CGEventCreateKeyboardEvent(source, (CGKeyCode)8, true);
    CGEventRef up = CGEventCreateKeyboardEvent(source, (CGKeyCode)8, false);
    if (!down || !up) {
        if (down) CFRelease(down);
        if (up) CFRelease(up);
        if (source) CFRelease(source);
        return nil;
    }
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventSetFlags(up, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(down);
    CFRelease(up);
    if (source) CFRelease(source);

    NSString *copied = nil;
    for (int attempt = 0; attempt < 40; attempt += 1) {
        [NSThread sleepForTimeInterval:0.01];
        if (board.changeCount == before) continue;
        copied = [board stringForType:NSPasteboardTypeString];
        break;
    }
    if (copied && held) {
        [board clearContents];
        [board setString:held forType:NSPasteboardTypeString];
    }
    return copied;
}

static int print_selection(void) {
    NSMutableDictionary *item = [NSMutableDictionary dictionary];
    if (!AXIsProcessTrusted()) {
        item[@"error"] = @"accessibility";
    } else {
        NSRunningApplication *front = [NSWorkspace sharedWorkspace].frontmostApplication;
        NSString *window = nil;
        NSString *text = front ? accessibility_selection(front.processIdentifier, &window) : nil;
        if (!text.length) text = copied_selection();
        if (text.length) item[@"text"] = text;
        if (front.localizedName.length) item[@"application"] = front.localizedName;
        if (window.length) item[@"window"] = window;
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:item options:0 error:NULL];
    if (!json) {
        fputs("Shinbo: unable to serialize the selection.\n", stderr);
        return 1;
    }
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    return 0;
}

#define kMaxInputLine (64 * 1024)
#define kMaxTypedCharacters 4096

#define kMaxHoldSeconds 300.0

typedef enum {
    ActionInvalid, ActionMove, ActionClick, ActionScroll, ActionType, ActionKey,
    ActionMouseDown, ActionMouseUp, ActionDrag, ActionHoldKey,
} ActionKind;

typedef struct {
    ActionKind kind;
    CGPoint point;
    CGPoint origin;
    int clicks;
    CGMouseButton button;
    int scroll_x;
    int scroll_y;
    CGKeyCode key_code;
    CGEventFlags flags;
    double seconds;
    bool has_point;
} InputAction;

static const struct { const char *name; CGKeyCode code; } kNamedKeys[] = {
    {"a", 0}, {"b", 11}, {"c", 8}, {"d", 2}, {"e", 14}, {"f", 3}, {"g", 5},
    {"h", 4}, {"i", 34}, {"j", 38}, {"k", 40}, {"l", 37}, {"m", 46}, {"n", 45},
    {"o", 31}, {"p", 35}, {"q", 12}, {"r", 15}, {"s", 1}, {"t", 17}, {"u", 32},
    {"v", 9}, {"w", 13}, {"x", 7}, {"y", 16}, {"z", 6},
    {"0", 29}, {"1", 18}, {"2", 19}, {"3", 20}, {"4", 21},
    {"5", 23}, {"6", 22}, {"7", 26}, {"8", 28}, {"9", 25},
    {"f1", 122}, {"f2", 120}, {"f3", 99}, {"f4", 118}, {"f5", 96}, {"f6", 97},
    {"f7", 98}, {"f8", 100}, {"f9", 101}, {"f10", 109}, {"f11", 103}, {"f12", 111},
    {"return", 36}, {"enter", 36}, {"kp_enter", 76}, {"tab", 48}, {"space", 49},
    {"backspace", 51}, {"delete", 51}, {"forward_delete", 117},
    {"escape", 53}, {"esc", 53},
    {"left", 123}, {"right", 124}, {"down", 125}, {"up", 126},
    {"home", 115}, {"end", 119},
    {"page_up", 116}, {"pageup", 116}, {"prior", 116},
    {"page_down", 121}, {"pagedown", 121}, {"next", 121},
    {"minus", 27}, {"equal", 24}, {"bracketleft", 33}, {"bracketright", 30},
    {"backslash", 42}, {"semicolon", 41}, {"apostrophe", 39}, {"grave", 50},
    {"comma", 43}, {"period", 47}, {"slash", 44},
    {"shift", 56}, {"shift_l", 56}, {"control", 59}, {"ctrl", 59}, {"control_l", 59},
    {"alt", 58}, {"option", 58}, {"alt_l", 58}, {"super", 55}, {"command", 55}, {"super_l", 55},
};

static bool named_key(NSString *name, CGKeyCode *code) {
    const char *value = name.lowercaseString.UTF8String;
    if (!value) return false;
    for (size_t index = 0; index < sizeof(kNamedKeys) / sizeof(kNamedKeys[0]); index += 1) {
        if (strcmp(kNamedKeys[index].name, value) == 0) {
            *code = kNamedKeys[index].code;
            return true;
        }
    }
    return false;
}

static bool modifier_flags(NSArray *modifiers, CGEventFlags *flags) {
    *flags = 0;
    if (!modifiers) return true;
    if (![modifiers isKindOfClass:[NSArray class]] || modifiers.count > 4) return false;
    for (id item in modifiers) {
        if (![item isKindOfClass:[NSString class]]) return false;
        NSString *name = [(NSString *)item lowercaseString];
        if ([name isEqualToString:@"command"] || [name isEqualToString:@"super"] || [name isEqualToString:@"cmd"]) *flags |= kCGEventFlagMaskCommand;
        else if ([name isEqualToString:@"shift"]) *flags |= kCGEventFlagMaskShift;
        else if ([name isEqualToString:@"option"] || [name isEqualToString:@"alt"]) *flags |= kCGEventFlagMaskAlternate;
        else if ([name isEqualToString:@"control"] || [name isEqualToString:@"ctrl"]) *flags |= kCGEventFlagMaskControl;
        else return false;
    }
    return true;
}

static bool number_value(id value, double *out) {
    if (![value isKindOfClass:[NSNumber class]]) return false;
    double number = [(NSNumber *)value doubleValue];
    if (!isfinite(number)) return false;
    *out = number;
    return true;
}

static bool duration_value(id value, double *out, NSString **error) {
    double seconds = 0;
    if (value && !number_value(value, &seconds)) { *error = @"duration is invalid"; return false; }
    if (seconds < 0 || seconds > kMaxHoldSeconds) { *error = @"duration is out of range"; return false; }
    *out = seconds;
    return true;
}

static bool parse_action(NSDictionary *object, InputAction *action, NSString **text, NSString **error) {
    *text = nil;
    memset(action, 0, sizeof(*action));
    if (![object isKindOfClass:[NSDictionary class]]) { *error = @"action must be an object"; return false; }
    id kind = object[@"action"];
    if (![kind isKindOfClass:[NSString class]]) { *error = @"action name is invalid"; return false; }

    double x = 0;
    double y = 0;
    bool has_point = number_value(object[@"x"], &x) && number_value(object[@"y"], &y);
    if (has_point && (fabs(x) > 100000 || fabs(y) > 100000)) { *error = @"action coordinates are out of range"; return false; }
    action->point = CGPointMake(x, y);
    action->has_point = has_point;
    if (!modifier_flags(object[@"modifiers"], &action->flags)) { *error = @"key modifiers are invalid"; return false; }

    if ([kind isEqualToString:@"move"] || [kind isEqualToString:@"click"] || [kind isEqualToString:@"double_click"]
        || [kind isEqualToString:@"triple_click"] || [kind isEqualToString:@"mouse_down"] || [kind isEqualToString:@"mouse_up"]) {
        bool held = [kind isEqualToString:@"mouse_down"] || [kind isEqualToString:@"mouse_up"];
        if (!has_point && !held) { *error = @"action requires numeric x and y"; return false; }
        if ([kind isEqualToString:@"move"]) { action->kind = ActionMove; return true; }
        id button = object[@"button"];
        if (button && ![button isKindOfClass:[NSString class]]) { *error = @"click button is invalid"; return false; }
        if (!button || [button isEqualToString:@"left"]) action->button = kCGMouseButtonLeft;
        else if ([button isEqualToString:@"right"]) action->button = kCGMouseButtonRight;
        else if ([button isEqualToString:@"middle"]) action->button = kCGMouseButtonCenter;
        else { *error = @"click button is invalid"; return false; }
        if (held) { action->kind = [kind isEqualToString:@"mouse_down"] ? ActionMouseDown : ActionMouseUp; return true; }
        action->kind = ActionClick;
        double clicks = 1;
        if (object[@"clicks"] && !number_value(object[@"clicks"], &clicks)) { *error = @"click count is invalid"; return false; }
        if ([kind isEqualToString:@"double_click"]) clicks = 2;
        if ([kind isEqualToString:@"triple_click"]) clicks = 3;
        if (clicks < 1 || clicks > 3) { *error = @"click count must be 1, 2 or 3"; return false; }
        action->clicks = (int)clicks;
        return true;
    }
    if ([kind isEqualToString:@"drag"]) {
        double origin_x = 0;
        double origin_y = 0;
        if (!has_point || !number_value(object[@"fromX"], &origin_x) || !number_value(object[@"fromY"], &origin_y)) {
            *error = @"drag requires numeric fromX, fromY, x and y";
            return false;
        }
        if (fabs(origin_x) > 100000 || fabs(origin_y) > 100000) { *error = @"action coordinates are out of range"; return false; }
        action->kind = ActionDrag;
        action->origin = CGPointMake(origin_x, origin_y);
        action->button = kCGMouseButtonLeft;
        return true;
    }
    if ([kind isEqualToString:@"scroll"]) {
        if (!has_point) { *error = @"action requires numeric x and y"; return false; }
        double dx = 0;
        double dy = 0;
        if (!number_value(object[@"dx"] ?: @0, &dx) || !number_value(object[@"dy"] ?: @0, &dy)) { *error = @"scroll amounts are invalid"; return false; }
        if (fabs(dx) > 50 || fabs(dy) > 50) { *error = @"scroll amount must be within 50 lines"; return false; }
        action->kind = ActionScroll;
        action->scroll_x = (int)dx;
        action->scroll_y = (int)dy;
        return true;
    }
    if ([kind isEqualToString:@"hold_key"]) {
        id value = object[@"key"];
        if (![value isKindOfClass:[NSString class]] || !named_key(value, &action->key_code)) { *error = @"key name is not supported"; return false; }
        if (!duration_value(object[@"duration"], &action->seconds, error)) return false;
        action->kind = ActionHoldKey;
        return true;
    }
    if ([kind isEqualToString:@"type"]) {
        id value = object[@"text"];
        if (![value isKindOfClass:[NSString class]] || ((NSString *)value).length == 0) { *error = @"typed text is invalid"; return false; }
        if (((NSString *)value).length > kMaxTypedCharacters) { *error = @"typed text is too long"; return false; }
        action->kind = ActionType;
        *text = value;
        return true;
    }
    if ([kind isEqualToString:@"key"]) {
        id value = object[@"key"];
        if (![value isKindOfClass:[NSString class]] || !named_key(value, &action->key_code)) { *error = @"key name is not supported"; return false; }
        if (!modifier_flags(object[@"modifiers"], &action->flags)) { *error = @"key modifiers are invalid"; return false; }
        action->kind = ActionKey;
        return true;
    }
    *error = @"action name is not supported";
    return false;
}

static bool point_on_active_display(CGPoint point) {
    CGDirectDisplayID displays[16];
    uint32_t count = 0;
    if (CGGetActiveDisplayList(16, displays, &count) != kCGErrorSuccess) return false;
    for (uint32_t index = 0; index < count; index += 1) {
        if (CGRectContainsPoint(CGDisplayBounds(displays[index]), point)) return true;
    }
    return false;
}

static void post(CGEventRef event) {
    if (!event) return;
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
}

static CGPoint cursor_point(void) {
    CGEventRef probe = CGEventCreate(NULL);
    CGPoint point = probe ? CGEventGetLocation(probe) : CGPointZero;
    if (probe) CFRelease(probe);
    return point;
}

static CGEventType button_event(CGMouseButton button, bool down) {
    if (button == kCGMouseButtonRight) return down ? kCGEventRightMouseDown : kCGEventRightMouseUp;
    if (button == kCGMouseButtonCenter) return down ? kCGEventOtherMouseDown : kCGEventOtherMouseUp;
    return down ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
}

static CGEventType drag_event(CGMouseButton button) {
    if (button == kCGMouseButtonRight) return kCGEventRightMouseDragged;
    if (button == kCGMouseButtonCenter) return kCGEventOtherMouseDragged;
    return kCGEventLeftMouseDragged;
}

static void post_mouse(CGEventType type, CGPoint point, CGMouseButton button, CGEventFlags flags, int64_t clicks) {
    CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, button);
    if (!event) return;
    if (flags) CGEventSetFlags(event, flags);
    if (clicks) CGEventSetIntegerValueField(event, kCGMouseEventClickState, clicks);
    post(event);
}

static bool perform_action(InputAction action, NSString *text, NSString **error) {
    bool needs_point = action.kind != ActionType && action.kind != ActionKey && action.kind != ActionHoldKey
        && action.kind != ActionMouseDown && action.kind != ActionMouseUp;
    if (needs_point && !point_on_active_display(action.point)) {
        *error = @"action coordinates are not on an active display";
        return false;
    }
    if (action.kind == ActionDrag && !point_on_active_display(action.origin)) {
        *error = @"action coordinates are not on an active display";
        return false;
    }
    switch (action.kind) {
        case ActionMove:
            post_mouse(kCGEventMouseMoved, action.point, kCGMouseButtonLeft, action.flags, 0);
            break;
        case ActionClick: {
            post_mouse(kCGEventMouseMoved, action.point, action.button, action.flags, 0);
            for (int click = 1; click <= action.clicks; click += 1) {
                post_mouse(button_event(action.button, true), action.point, action.button, action.flags, click);
                post_mouse(button_event(action.button, false), action.point, action.button, action.flags, click);
            }
            break;
        }
        case ActionMouseDown:
        case ActionMouseUp: {
            CGPoint point = action.has_point ? action.point : cursor_point();
            post_mouse(button_event(action.button, action.kind == ActionMouseDown), point, action.button, action.flags, 1);
            break;
        }
        case ActionDrag: {
            CGPoint middle = CGPointMake((action.origin.x + action.point.x) / 2, (action.origin.y + action.point.y) / 2);
            post_mouse(kCGEventMouseMoved, action.origin, action.button, action.flags, 0);
            post_mouse(button_event(action.button, true), action.origin, action.button, action.flags, 1);
            post_mouse(drag_event(action.button), middle, action.button, action.flags, 1);
            post_mouse(drag_event(action.button), action.point, action.button, action.flags, 1);
            post_mouse(button_event(action.button, false), action.point, action.button, action.flags, 1);
            break;
        }
        case ActionScroll: {
            post_mouse(kCGEventMouseMoved, action.point, kCGMouseButtonLeft, action.flags, 0);
            CGEventRef wheel = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 2, action.scroll_y, action.scroll_x);
            if (wheel && action.flags) CGEventSetFlags(wheel, action.flags);
            post(wheel);
            break;
        }
        case ActionType: {
            NSUInteger length = text.length;
            for (NSUInteger start = 0; start < length; start += 32) {
                NSRange range = NSMakeRange(start, MIN((NSUInteger)32, length - start));
                NSString *chunk = [text substringWithRange:range];
                unichar buffer[32];
                [chunk getCharacters:buffer range:NSMakeRange(0, chunk.length)];
                CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
                CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
                if (down) CGEventKeyboardSetUnicodeString(down, chunk.length, buffer);
                if (up) CGEventKeyboardSetUnicodeString(up, chunk.length, buffer);
                post(down);
                post(up);
            }
            break;
        }
        case ActionKey: {
            CGEventRef down = CGEventCreateKeyboardEvent(NULL, action.key_code, true);
            CGEventRef up = CGEventCreateKeyboardEvent(NULL, action.key_code, false);
            if (down) CGEventSetFlags(down, action.flags);
            if (up) CGEventSetFlags(up, action.flags);
            post(down);
            post(up);
            break;
        }
        case ActionHoldKey: {
            CGEventRef down = CGEventCreateKeyboardEvent(NULL, action.key_code, true);
            if (down) CGEventSetFlags(down, action.flags);
            post(down);
            NSDate *until = [NSDate dateWithTimeIntervalSinceNow:action.seconds];
            while ([until timeIntervalSinceNow] > 0) {
                [NSThread sleepForTimeInterval:0.05];
                CGEventRef again = CGEventCreateKeyboardEvent(NULL, action.key_code, true);
                if (again) {
                    CGEventSetFlags(again, action.flags);
                    CGEventSetIntegerValueField(again, kCGKeyboardEventAutorepeat, 1);
                }
                post(again);
            }
            CGEventRef up = CGEventCreateKeyboardEvent(NULL, action.key_code, false);
            if (up) CGEventSetFlags(up, action.flags);
            post(up);
            break;
        }
        case ActionInvalid:
            *error = @"action is invalid";
            return false;
    }
    return true;
}

static void write_result(bool ok, NSString *message) {
    NSDictionary *result = ok ? @{@"ok": @YES} : @{@"ok": @NO, @"error": message ?: @"action failed"};
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
    if (json) fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static int run_input(void) {
    if (!AXIsProcessTrusted()) {
        fputs("Shinbo: Accessibility access is required to control the computer. Grant it in System Settings, then relaunch Shinbo.\n", stderr);
        write_result(false, @"Accessibility access is not granted");
        return 1;
    }
    char *line = malloc(kMaxInputLine);
    if (!line) return 1;
    while (fgets(line, kMaxInputLine, stdin)) {
        size_t length = strlen(line);
        if (length == 0) continue;
        if (line[length - 1] != '\n') {
            write_result(false, @"action line is too long");
            int discarded;
            while ((discarded = fgetc(stdin)) != '\n' && discarded != EOF) { }
            continue;
        }
        @autoreleasepool {
            NSData *data = [NSData dataWithBytes:line length:length - 1];
            NSDictionary *object = data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
            InputAction action;
            NSString *text = nil;
            NSString *error = @"action is not valid JSON";
            if (object && parse_action(object, &action, &text, &error) && perform_action(action, text, &error)) write_result(true, nil);
            else write_result(false, error);
        }
    }
    free(line);
    return 0;
}

static void self_test(void) {
    DoubleTap tap = {0};
    assert(!handle_tap(&tap, TapDown, 0));
    assert(!handle_tap(&tap, TapDown, 0.01));
    assert(!handle_tap(&tap, TapUp, 0.05));
    assert(handle_tap(&tap, TapDown, 0.2));
    assert(!handle_tap(&tap, TapUp, 0.25));
    assert(!handle_tap(&tap, TapDown, 0.3));
    assert(!handle_tap(&tap, TapUp, 0.35));
    assert(handle_tap(&tap, TapDown, 0.5));

    memset(&tap, 0, sizeof(tap));
    assert(!handle_tap(&tap, TapDown, 0));
    assert(!handle_tap(&tap, TapUp, 0.05));
    assert(!handle_tap(&tap, TapDown, 0.5));
    assert(!handle_tap(&tap, TapCancel, 0.51));
    assert(!handle_tap(&tap, TapDown, 0.6));

    assert(event_input(NSEventTypeFlagsChanged, 58, NSEventModifierFlagOption, 58) == TapDown);
    assert(event_input(NSEventTypeFlagsChanged, 58, 0, 58) == TapUp);
    assert(event_input(NSEventTypeFlagsChanged, 61, NSEventModifierFlagOption, 58) == TapCancel);
    assert(event_input(NSEventTypeFlagsChanged, 58, NSEventModifierFlagOption | NSEventModifierFlagCommand, 58) == TapCancel);
    assert(event_input(NSEventTypeFlagsChanged, 63, NSEventModifierFlagFunction, 63) == TapDown);
    assert(event_input(NSEventTypeKeyDown, 0, 0, 58) == TapCancel);

    HoldWatch watch = {0};
    watch.set = parse_holds(@{@"holds": @[@{@"id": @"voice", @"keyCode": @58, @"ms": @500}, @{@"id": @"bad", @"keyCode": @0, @"ms": @500}, @{@"id": @"toggle", @"keyCode": @63, @"ms": @0}]});
    assert(watch.set.count == 2 && watch.set.items[0].key_code == 58 && watch.set.items[0].seconds == 0.5 && watch.set.items[1].seconds == 0);
    assert(handle_taps(&watch, NSEventTypeFlagsChanged, 63, NSEventModifierFlagFunction, 0) == 0);
    assert(handle_taps(&watch, NSEventTypeFlagsChanged, 63, 0, 0.05) == 0);
    assert(handle_taps(&watch, NSEventTypeFlagsChanged, 63, NSEventModifierFlagFunction, 0.2) == 2);
    assert(handle_taps(&watch, NSEventTypeFlagsChanged, 63, 0, 0.25) == 0);
    assert(handle_hold(&watch, NSEventTypeFlagsChanged, 63, NSEventModifierFlagFunction) == 0);
    size_t armed = handle_hold(&watch, NSEventTypeFlagsChanged, 58, NSEventModifierFlagOption);
    assert(armed == 1);
    uint64_t generation = watch.generation;
    assert(hold_survived(&watch, armed, generation));
    assert(handle_hold(&watch, NSEventTypeFlagsChanged, 58, 0) == 0);
    assert(!hold_survived(&watch, armed, generation));
    armed = handle_hold(&watch, NSEventTypeFlagsChanged, 58, NSEventModifierFlagOption);
    generation = watch.generation;
    assert(armed == 1 && handle_hold(&watch, NSEventTypeFlagsChanged, 56, NSEventModifierFlagOption | NSEventModifierFlagShift) == 0);
    assert(!hold_survived(&watch, armed, generation));
    armed = handle_hold(&watch, NSEventTypeFlagsChanged, 58, NSEventModifierFlagOption);
    generation = watch.generation;
    assert(armed == 1 && handle_hold(&watch, NSEventTypeKeyDown, 0, NSEventModifierFlagOption) == 0);
    assert(!hold_survived(&watch, armed, generation));
    assert(handle_hold(&watch, NSEventTypeFlagsChanged, 61, NSEventModifierFlagOption) == 0);
    assert(handle_hold(&watch, NSEventTypeFlagsChanged, 56, NSEventModifierFlagShift) == 0);

    InputAction action;
    NSString *text = nil;
    NSString *error = nil;
    assert(parse_action(@{@"action": @"click", @"x": @10, @"y": @20}, &action, &text, &error));
    assert(action.kind == ActionClick && action.clicks == 1 && action.button == kCGMouseButtonLeft);
    assert(parse_action(@{@"action": @"double_click", @"x": @10, @"y": @20}, &action, &text, &error));
    assert(action.clicks == 2);
    assert(parse_action(@{@"action": @"key", @"key": @"c", @"modifiers": @[@"command"]}, &action, &text, &error));
    assert(action.kind == ActionKey && action.key_code == 8 && action.flags == kCGEventFlagMaskCommand);
    assert(parse_action(@{@"action": @"type", @"text": @"hello"}, &action, &text, &error));
    assert(action.kind == ActionType && [text isEqualToString:@"hello"]);
    assert(parse_action(@{@"action": @"scroll", @"x": @1, @"y": @2, @"dy": @-3}, &action, &text, &error));
    assert(action.kind == ActionScroll && action.scroll_y == -3 && action.scroll_x == 0);

    assert(parse_action(@{@"action": @"triple_click", @"x": @1, @"y": @2, @"button": @"middle"}, &action, &text, &error));
    assert(action.clicks == 3 && action.button == kCGMouseButtonCenter);
    assert(parse_action(@{@"action": @"mouse_down", @"button": @"right"}, &action, &text, &error));
    assert(action.kind == ActionMouseDown && !action.has_point && action.button == kCGMouseButtonRight);
    assert(parse_action(@{@"action": @"drag", @"fromX": @1, @"fromY": @2, @"x": @3, @"y": @4, @"modifiers": @[@"shift"]}, &action, &text, &error));
    assert(action.kind == ActionDrag && action.origin.x == 1 && action.point.y == 4 && action.flags == kCGEventFlagMaskShift);
    assert(parse_action(@{@"action": @"hold_key", @"key": @"shift", @"duration": @2}, &action, &text, &error));
    assert(action.kind == ActionHoldKey && action.seconds == 2);

    assert(!parse_action(@{@"action": @"drag", @"x": @3, @"y": @4}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"hold_key", @"key": @"a", @"duration": @400}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"hold_key", @"key": @"a", @"duration": @-1}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"click", @"x": @1, @"y": @2, @"clicks": @4}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"click"}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"click", @"x": @"10", @"y": @20}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"move", @"x": @1e9, @"y": @0}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"scroll", @"x": @1, @"y": @2, @"dy": @400}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"key", @"key": @"f13"}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"key", @"key": @"c", @"modifiers": @[@"hyper"]}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"type", @"text": @""}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"type", @"text": [@"" stringByPaddingToLength:kMaxTypedCharacters + 1 withString:@"a" startingAtIndex:0]}, &action, &text, &error));
    assert(!parse_action(@{@"action": @"launch_missiles", @"x": @1, @"y": @1}, &action, &text, &error));
    assert(!parse_action((NSDictionary *)@[], &action, &text, &error));
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
            self_test();
            return 0;
        }
        if (argc == 2 && strcmp(argv[1], "--screens") == 0) return print_screens();
        if (argc == 2 && strcmp(argv[1], "--selection") == 0) return print_selection();
        if (argc == 2 && strcmp(argv[1], "--input") == 0) return run_input();

        NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
        if (!AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options)) {
            fputs("Shinbo: Accessibility access is required for Quick Ask keybinds. Grant it in System Settings, then relaunch Shinbo.\n", stderr);
        }

        NSApplication *application = [NSApplication sharedApplication];
        [application setActivationPolicy:NSApplicationActivationPolicyProhibited];
        [application finishLaunching];

        static HoldWatch watch = {0};
        __block NSMutableData *pending = [NSMutableData data];
        NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
        input.readabilityHandler = ^(NSFileHandle *handle) {
            @autoreleasepool {
                NSData *chunk = [handle availableData];
                if (!chunk.length) { handle.readabilityHandler = nil; exit(0); }
                [pending appendData:chunk];
                if (pending.length > 8192) { pending = [NSMutableData data]; return; }
                const char *bytes = pending.bytes;
                NSUInteger start = 0;
                for (NSUInteger index = 0; index < pending.length; index += 1) {
                    if (bytes[index] != '\n') continue;
                    NSData *line = [pending subdataWithRange:NSMakeRange(start, index - start)];
                    start = index + 1;
                    NSDictionary *object = line.length ? [NSJSONSerialization JSONObjectWithData:line options:0 error:NULL] : nil;
                    HoldSet parsed = object ? parse_holds(object) : (HoldSet){0};
                    dispatch_async(dispatch_get_main_queue(), ^{
                        watch.set = parsed;
                        memset(watch.taps, 0, sizeof(watch.taps));
                        watch.armed = 0;
                        watch.generation += 1;
                    });
                }
                pending = [[pending subdataWithRange:NSMakeRange(start, pending.length - start)] mutableCopy];
            }
        };
        id monitor = [NSEvent addGlobalMonitorForEventsMatchingMask:(NSEventMaskFlagsChanged | NSEventMaskKeyDown) handler:^(NSEvent *event) {
            size_t tapped = handle_taps(&watch, event.type, event.keyCode, event.modifierFlags, event.timestamp);
            if (tapped) {
                printf("hold %s\n", watch.set.items[tapped - 1].id);
                fflush(stdout);
            }
            size_t armed = handle_hold(&watch, event.type, event.keyCode, event.modifierFlags);
            if (!armed) return;
            uint64_t generation = watch.generation;
            HoldBinding binding = watch.set.items[armed - 1];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(binding.seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                if (!hold_survived(&watch, armed, generation)) return;
                watch.armed = 0;
                printf("hold %s\n", binding.id);
                fflush(stdout);
            });
        }];
        if (!monitor) {
            fputs("Shinbo: unable to start the Quick Ask hotkey listener.\n", stderr);
            return 1;
        }
        [application run];
    }
    return 0;
}
