const std = @import("std");
test {
    std.testing.refAllDecls(@import("gateway/shinbo_openai.zig"));
}
