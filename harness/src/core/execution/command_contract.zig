const std = @import("std");
const process_supervisor = @import("../background/process_supervisor.zig");
const types = @import("../shared/types.zig");
const command_output_content = @import("../tooling/command_output_content.zig");
const text_utils = @import("../shared/text_utils.zig");

pub const CommandOutputStream = command_output_content.Stream;
pub const CommandOutputCallback = command_output_content.Callback;

pub const BackgroundCommand = struct {
    pid: []const u8,
    process_token: ?process_supervisor.ProcessInstanceToken = null,
    background_record_id: ?types.StableBackgroundRecordId = null,
    command: []const u8,
    cwd: []const u8,
    log_path: []const u8,
    url: ?[]const u8 = null,
    expect_url: bool = false,
};

pub const ForegroundCommandResult = struct {
    command: []const u8,
    cwd: []const u8,
    exit_code: ?i64 = null,
    signal: ?u32 = null,
    timed_out: bool = false,
    output_incomplete: bool = false,
    retry_guidance: ?[]const u8 = null,
    duration_ms: ?u64 = null,
    stdout_bytes: usize = 0,
    stderr_bytes: usize = 0,
    truncated: bool = false,
    output_file: ?[]const u8 = null,
    stdout_file: ?[]const u8 = null,
    stderr_file: ?[]const u8 = null,
    sandbox_denied: bool = false,
};

pub const BackgroundCommandResult = struct {
    command: []const u8,
    cwd: []const u8,
    background_id: ?u64 = null,
    pid: []const u8,
    log_path: []const u8,
    state: []const u8 = "running",
    server_url: ?[]const u8 = null,
};

pub const CommandResult = union(enum) {
    foreground: ForegroundCommandResult,
    background: BackgroundCommandResult,

    pub fn writeJson(self: CommandResult, writer: *std.Io.Writer) !void {
        switch (self) {
            .foreground => |result| try writeForegroundJson(result, writer),
            .background => |result| try writeBackgroundJson(result, writer),
        }
    }

    pub fn toJson(self: CommandResult, alloc: std.mem.Allocator) ![]u8 {
        var out: std.Io.Writer.Allocating = .init(alloc);
        defer out.deinit();
        try self.writeJson(&out.writer);
        return try out.toOwnedSlice();
    }
};

pub const RunCommandResult = struct {
    output: []const u8,
    background: ?BackgroundCommand = null,
    command_result: ?CommandResult = null,
    cancelled: bool = false,
};

pub const ForegroundCommandStatus = union(enum) {
    exit_code: i64,
    signal: u32,
    finished,
};

pub const ForegroundCommandResultSnapshot = struct {
    command: []const u8,
    cwd: []const u8,
    status: ForegroundCommandStatus,
    stdout_display: []const u8,
    stderr_display: []const u8,
    stdout_bytes: usize,
    stderr_bytes: usize,
    output_incomplete: bool = false,
    duration_ms: ?u64 = null,
};

pub fn formatForegroundCommandResult(
    alloc: std.mem.Allocator,
    snapshot: ForegroundCommandResultSnapshot,
) !RunCommandResult {
    const stdout_text = std.mem.trim(u8, snapshot.stdout_display, " \r\n\t");
    const stderr_text = std.mem.trim(u8, snapshot.stderr_display, " \r\n\t");

    var out: std.Io.Writer.Allocating = .init(alloc);
    defer out.deinit();

    try writeForegroundStatusLine(&out.writer, snapshot.status);
    try writeForegroundOutputEnvelopes(&out.writer, stdout_text, stderr_text);

    return .{
        .output = try out.toOwnedSlice(),
        .command_result = .{ .foreground = .{
            .command = snapshot.command,
            .cwd = snapshot.cwd,
            .exit_code = foregroundExitCode(snapshot.status),
            .signal = foregroundSignal(snapshot.status),
            .output_incomplete = snapshot.output_incomplete,
            .retry_guidance = if (snapshot.output_incomplete)
                output_incomplete_retry_guidance
            else
                failureRetryGuidance(
                    snapshot.status,
                    snapshot.stdout_display,
                    snapshot.stderr_display,
                ),
            .duration_ms = snapshot.duration_ms,
            .stdout_bytes = snapshot.stdout_bytes,
            .stderr_bytes = snapshot.stderr_bytes,
        } },
    };
}

fn writeForegroundStatusLine(writer: *std.Io.Writer, status: ForegroundCommandStatus) !void {
    switch (status) {
        .exit_code => |code| try writer.print("exit_code={d}\n", .{code}),
        .signal => |signal| try writer.print("signal={d}\n", .{signal}),
        .finished => try writer.writeAll("process finished\n"),
    }
}

fn writeForegroundOutputEnvelopes(writer: *std.Io.Writer, stdout_text: []const u8, stderr_text: []const u8) !void {
    if (stdout_text.len > 0) {
        try writer.writeAll("<stdout>\n");
        try writer.writeAll(stdout_text);
        try writer.writeAll("\n</stdout>\n");
    }
    if (stderr_text.len > 0) {
        try writer.writeAll("<stderr>\n");
        try writer.writeAll(stderr_text);
        try writer.writeAll("\n</stderr>\n");
    }
    if (stdout_text.len == 0 and stderr_text.len == 0) {
        try writer.writeAll("(no output)\n");
    }
}

pub const output_incomplete_retry_guidance = "Command output is incomplete. Inspect external state and available output before retrying; do not blindly rerun a command that may have changed state.";
pub const shell_parse_retry_guidance = "The shell could not parse this command (unmatched quote or syntax error), so nothing executed. Rewrite the command with corrected quoting or escaping and submit the full corrected command instead of rerunning the same text.";
pub const usage_error_retry_guidance = "The command exited with a usage error (missing or invalid arguments). Rebuild the command with the required arguments explicitly set, then submit the corrected command instead of rerunning it unchanged.";

fn failureRetryGuidance(
    status: ForegroundCommandStatus,
    stdout_raw: []const u8,
    stderr_raw: []const u8,
) ?[]const u8 {
    const code = switch (status) {
        .exit_code => |code| code,
        else => return null,
    };
    if (code == 0) return null;
    const streams = [_][]const u8{ stderr_raw, stdout_raw };
    for (streams) |output| {
        if (isShellParseErrorOutput(output)) return shell_parse_retry_guidance;
    }
    for (streams) |output| {
        if (hasUsageBannerOutput(output)) return usage_error_retry_guidance;
    }
    return null;
}

fn isShellParseErrorOutput(output: []const u8) bool {
    var lines = std.mem.splitScalar(u8, output, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, " \t\r");
        if (!hasShellErrorPrefix(trimmed)) continue;
        if (text_utils.containsIgnoreCase(trimmed, "unmatched") or
            text_utils.containsIgnoreCase(trimmed, "syntax error") or
            text_utils.containsIgnoreCase(trimmed, "parse error") or
            text_utils.containsIgnoreCase(trimmed, "unterminated quoted string")) return true;
    }
    return false;
}

fn hasShellErrorPrefix(line: []const u8) bool {
    const colon = std.mem.findScalar(u8, line, ':') orelse return false;
    const token = line[0..colon];
    if (token.len == 0 or std.mem.findScalar(u8, token, ' ') != null) return false;
    const base = if (std.mem.findLast(u8, token, "/")) |slash| token[slash + 1 ..] else token;
    const names = [_][]const u8{ "zsh", "bash", "sh", "dash" };
    for (names) |name| {
        if (std.mem.eql(u8, base, name)) return true;
    }
    return false;
}

fn hasUsageBannerOutput(output: []const u8) bool {
    var lines = std.mem.splitScalar(u8, output, '\n');
    var scanned: usize = 0;
    while (lines.next()) |line| {
        const trimmed = std.mem.trimStart(u8, line, " \t\r");
        if (trimmed.len == 0) continue;
        if (scanned >= 4) return false;
        scanned += 1;
        if (std.ascii.startsWithIgnoreCase(trimmed, "usage:")) return true;
    }
    return false;
}

fn foregroundExitCode(status: ForegroundCommandStatus) ?i64 {
    return switch (status) {
        .exit_code => |code| code,
        else => null,
    };
}

fn foregroundSignal(status: ForegroundCommandStatus) ?u32 {
    return switch (status) {
        .signal => |signal| signal,
        else => null,
    };
}

fn writeForegroundJson(result: ForegroundCommandResult, writer: *std.Io.Writer) !void {
    try writer.writeAll("{\"kind\":\"foreground\"");
    try writeStringField(writer, "command", result.command);
    try writeStringField(writer, "cwd", result.cwd);
    try writeOptionalIntField(writer, "exit_code", result.exit_code);
    try writeOptionalIntField(writer, "signal", result.signal);
    try writeBoolField(writer, "timed_out", result.timed_out);
    if (result.output_incomplete) {
        try writeBoolField(writer, "output_incomplete", true);
    }
    if (result.retry_guidance) |guidance| {
        try writeStringField(writer, "retry_guidance", guidance);
    }
    try writeOptionalIntField(writer, "duration_ms", result.duration_ms);
    try writeIntField(writer, "stdout_bytes", result.stdout_bytes);
    try writeIntField(writer, "stderr_bytes", result.stderr_bytes);
    try writeBoolField(writer, "truncated", result.truncated);
    try writeOptionalStringField(writer, "output_file", result.output_file);
    try writeOptionalStringField(writer, "stdout_file", result.stdout_file);
    try writeOptionalStringField(writer, "stderr_file", result.stderr_file);
    try writeBoolField(writer, "sandbox_denied", result.sandbox_denied);
    try writer.writeByte('}');
}

fn writeBackgroundJson(result: BackgroundCommandResult, writer: *std.Io.Writer) !void {
    try writer.writeAll("{\"kind\":\"background\"");
    try writeStringField(writer, "command", result.command);
    try writeStringField(writer, "cwd", result.cwd);
    try writeOptionalIntField(writer, "background_id", result.background_id);
    try writeStringField(writer, "pid", result.pid);
    try writeStringField(writer, "log_path", result.log_path);
    try writeStringField(writer, "state", result.state);
    try writeOptionalStringField(writer, "server_url", result.server_url);
    try writer.writeByte('}');
}

fn writeStringField(writer: *std.Io.Writer, comptime name: []const u8, value: []const u8) !void {
    try writer.writeAll(",\"" ++ name ++ "\":");
    try std.json.Stringify.value(value, .{}, writer);
}

fn writeOptionalStringField(writer: *std.Io.Writer, comptime name: []const u8, value: ?[]const u8) !void {
    try writer.writeAll(",\"" ++ name ++ "\":");
    if (value) |text| {
        try std.json.Stringify.value(text, .{}, writer);
    } else {
        try writer.writeAll("null");
    }
}

fn writeBoolField(writer: *std.Io.Writer, comptime name: []const u8, value: bool) !void {
    try writer.writeAll(",\"" ++ name ++ "\":");
    try writer.writeAll(if (value) "true" else "false");
}

fn writeIntField(writer: *std.Io.Writer, comptime name: []const u8, value: anytype) !void {
    try writer.writeAll(",\"" ++ name ++ "\":");
    try writer.print("{d}", .{value});
}

fn writeOptionalIntField(writer: *std.Io.Writer, comptime name: []const u8, value: anytype) !void {
    try writer.writeAll(",\"" ++ name ++ "\":");
    if (value) |number| {
        try writer.print("{d}", .{number});
    } else {
        try writer.writeAll("null");
    }
}

test "foreground result preserves envelopes metadata and json" {
    const result = try formatForegroundCommandResult(std.testing.allocator, .{
        .command = "printf hello",
        .cwd = "/tmp",
        .status = .{ .exit_code = 7 },
        .stdout_display = " hello\n",
        .stderr_display = " warn\n",
        .stdout_bytes = 7,
        .stderr_bytes = 6,
        .duration_ms = 12,
    });
    defer std.testing.allocator.free(result.output);

    try std.testing.expectEqualStrings(
        "exit_code=7\n<stdout>\nhello\n</stdout>\n<stderr>\nwarn\n</stderr>\n",
        result.output,
    );
    const foreground = result.command_result.?.foreground;
    try std.testing.expectEqualStrings("printf hello", foreground.command);
    try std.testing.expectEqualStrings("/tmp", foreground.cwd);
    try std.testing.expectEqual(@as(?i64, 7), foreground.exit_code);
    try std.testing.expectEqual(@as(?u32, null), foreground.signal);
    try std.testing.expectEqual(@as(?u64, 12), foreground.duration_ms);
    try std.testing.expectEqual(@as(usize, 7), foreground.stdout_bytes);
    try std.testing.expectEqual(@as(usize, 6), foreground.stderr_bytes);

    const json = try result.command_result.?.toJson(std.testing.allocator);
    defer std.testing.allocator.free(json);
    try std.testing.expectEqualStrings(
        "{\"kind\":\"foreground\",\"command\":\"printf hello\",\"cwd\":\"/tmp\",\"exit_code\":7,\"signal\":null,\"timed_out\":false,\"duration_ms\":12,\"stdout_bytes\":7,\"stderr_bytes\":6,\"truncated\":false,\"output_file\":null,\"stdout_file\":null,\"stderr_file\":null,\"sandbox_denied\":false}",
        json,
    );
}

test "foreground result preserves empty finished output" {
    const result = try formatForegroundCommandResult(std.testing.allocator, .{
        .command = "cmd",
        .cwd = "/tmp",
        .status = .finished,
        .stdout_display = "",
        .stderr_display = "",
        .stdout_bytes = 0,
        .stderr_bytes = 0,
    });
    defer std.testing.allocator.free(result.output);
    try std.testing.expectEqualStrings("process finished\n(no output)\n", result.output);
}

test "foreground result preserves observed status when output is incomplete" {
    const result = try formatForegroundCommandResult(std.testing.allocator, .{
        .command = "printf effect > marker",
        .cwd = "/tmp",
        .status = .{ .exit_code = 0 },
        .stdout_display = "partial output",
        .stderr_display = "",
        .stdout_bytes = 14,
        .stderr_bytes = 0,
        .output_incomplete = true,
    });
    defer std.testing.allocator.free(result.output);

    const foreground = result.command_result.?.foreground;
    try std.testing.expectEqual(@as(?i64, 0), foreground.exit_code);
    try std.testing.expect(foreground.output_incomplete);

    const json = try result.command_result.?.toJson(std.testing.allocator);
    defer std.testing.allocator.free(json);
    try std.testing.expect(std.mem.find(u8, json, "\"output_incomplete\":true") != null);
    try std.testing.expect(std.mem.find(u8, json, "\"retry_guidance\":\"Command output is incomplete.") != null);
}

test "foreground result carries rewrite guidance for shell parse and usage failures" {
    const parse = try formatForegroundCommandResult(std.testing.allocator, .{
        .command = "grep -rn '",
        .cwd = "/tmp",
        .status = .{ .exit_code = 1 },
        .stdout_display = "",
        .stderr_display = "zsh:1: unmatched '\n",
        .stdout_bytes = 0,
        .stderr_bytes = 19,
    });
    defer std.testing.allocator.free(parse.output);
    const parse_json = try parse.command_result.?.toJson(std.testing.allocator);
    defer std.testing.allocator.free(parse_json);
    try std.testing.expect(std.mem.find(u8, parse_json, "\"retry_guidance\":\"The shell could not parse") != null);

    const usage = try formatForegroundCommandResult(std.testing.allocator, .{
        .command = "grep -n",
        .cwd = "/tmp",
        .status = .{ .exit_code = 2 },
        .stdout_display = "",
        .stderr_display = "usage: grep [-abcdDEFGHhIiJLlMmnOopqRSsUVvwXxZz]\n",
        .stdout_bytes = 0,
        .stderr_bytes = 48,
    });
    defer std.testing.allocator.free(usage.output);
    const usage_json = try usage.command_result.?.toJson(std.testing.allocator);
    defer std.testing.allocator.free(usage_json);
    try std.testing.expect(std.mem.find(u8, usage_json, "\"retry_guidance\":\"The command exited with a usage error") != null);

    const ordinary = try formatForegroundCommandResult(std.testing.allocator, .{
        .command = "grep needle /nonexistent",
        .cwd = "/tmp",
        .status = .{ .exit_code = 2 },
        .stdout_display = "",
        .stderr_display = "grep: /nonexistent: No such file or directory\n",
        .stdout_bytes = 0,
        .stderr_bytes = 45,
    });
    defer std.testing.allocator.free(ordinary.output);
    const ordinary_json = try ordinary.command_result.?.toJson(std.testing.allocator);
    defer std.testing.allocator.free(ordinary_json);
    try std.testing.expect(std.mem.find(u8, ordinary_json, "retry_guidance") == null);
}

test "failure guidance detectors match only their signatures" {
    try std.testing.expectEqual(
        shell_parse_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 1 }, "", "zsh:1: unmatched '\n"),
    );
    try std.testing.expectEqual(
        shell_parse_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 2 }, "", "/bin/bash: -c: line 1: syntax error: unexpected end of file\n"),
    );
    try std.testing.expectEqual(
        shell_parse_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 2 }, "", "bash: -c: line 1: syntax error near unexpected token `)'\n"),
    );
    try std.testing.expectEqual(
        shell_parse_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 2 }, "", "/bin/dash: 1: Syntax error: Unterminated quoted string\n"),
    );
    try std.testing.expectEqual(
        shell_parse_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 1 }, "", "zsh: parse error near '\\n'\n"),
    );
    try std.testing.expectEqual(
        usage_error_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 64 }, "Usage: ls [-ABCFGHabcdfghiklmnopqrstuvwx1] [file ...]\n", ""),
    );
    try std.testing.expectEqual(
        usage_error_retry_guidance,
        failureRetryGuidance(.{ .exit_code = 2 }, "", "grep: unknown option\nusage: grep [-abcdDEFGHhIiJLlMmnOopqRSsUVvwXxZz]\n"),
    );

    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .exit_code = 0 }, "usage: grep\n", ""));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.finished, "", "zsh:1: unmatched '\n"));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .signal = 15 }, "", "zsh:1: unmatched '\n"));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .exit_code = 1 }, "", "main.c:4:5: error: expected ';' after expression (syntax error)\n"));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .exit_code = 1 }, "", "error: bash: syntax error\n"));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .exit_code = 2 }, "", "grep: /nonexistent: No such file or directory\n"));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .exit_code = 1 }, "", ""));
    try std.testing.expectEqual(@as(?[]const u8, null), failureRetryGuidance(.{ .exit_code = 1 }, "line one\nline two\nline three\nline four\nusage: not a banner\n", ""));
}
