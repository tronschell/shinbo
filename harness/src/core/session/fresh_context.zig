const std = @import("std");
const session_runtime = @import("session.zig");
const types = @import("../shared/types.zig");

const Allocator = std.mem.Allocator;
const HistoryTurn = types.HistoryTurn;

pub const window_header =
    "Context window starts here. Earlier conversation is not available in this window. Read it back with the threads or read_trace tools when needed, restore the goal, task_list and kept notes, and verify live state before continuing stateful or external work.";
pub const handoff_header = "Handoff from the previous window, written by you before the rollover:";
pub const auto_header =
    "Automatic rollover recovery record. It preserves the user's inputs, not progress; the previous window may already have finished its work.";
const inputs_header = "User inputs (chronological):";
const no_inputs = "No user inputs were found in the previous window.";
const older_checkpoint_header = "[older checkpoint; possibly stale]";
const older_auto_note = "Prior automatic recovery text is not nested here; read the thread back if needed.";
const elision = "\n… middle omitted …\n";
const max_record_chars: usize = 4_000;
const min_record_chars: usize = 200;
const record_label_overhead: usize = 24;

pub const Config = struct {
    handoff: ?[]const u8 = null,
    handoff_prefix: ?[]const HistoryTurn = null,
};

pub fn summarizer(config: *Config) session_runtime.Summarizer {
    return .{ .context = @ptrCast(config), .summarize_fn = summarize, .verbatim = true };
}

fn summarize(raw_ctx: *anyopaque, alloc: Allocator, request: session_runtime.SummaryRequest) anyerror![]u8 {
    const config: *Config = @ptrCast(@alignCast(raw_ctx));
    if (config.handoff) |handoff| {
        const applies = if (config.handoff_prefix) |prefix|
            prefix.ptr == request.removed.ptr and prefix.len == request.removed.len
        else
            true;
        if (applies) return explicitHandoff(alloc, handoff, request.max_chars);
    }
    return autoRecord(alloc, request.removed, request.previous_summary, request.max_chars);
}

pub fn explicitHandoff(alloc: Allocator, handoff: []const u8, max_chars: usize) ![]u8 {
    const trimmed = std.mem.trim(u8, handoff, " \t\r\n");
    const room = max_chars -| (window_header.len + handoff_header.len + 3);
    const body = try elide(alloc, trimmed, room);
    defer alloc.free(body);
    return std.fmt.allocPrint(alloc, "{s}\n\n{s}\n{s}", .{ window_header, handoff_header, body });
}

pub fn autoRecord(alloc: Allocator, removed: []const HistoryTurn, previous: ?[]const u8, max_chars: usize) ![]u8 {
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var inputs: std.ArrayList([]const u8) = .empty;
    for (removed) |turn| {
        const text = std.mem.trim(u8, session_runtime.userTurnText(turn) orelse continue, " \t\r\n");
        if (text.len > 0) try inputs.append(arena, text);
    }

    var out: std.Io.Writer.Allocating = .init(arena);
    try out.writer.print("{s}\n\n{s}\n\n", .{ window_header, auto_header });

    if (inputs.items.len == 0) {
        try out.writer.print("{s}\n\n", .{no_inputs});
    } else {
        try out.writer.print("{s}\n", .{inputs_header});
        const selection = try selectInputs(arena, inputs.items, max_chars -| out.writer.buffered().len);
        for (selection.records, 0..) |record, index| {
            const text = record orelse continue;
            try out.writer.print("[input {d} of {d}]\n{s}\n\n", .{ index + 1, inputs.items.len, text });
        }
        if (selection.omitted > 0) {
            try out.writer.print("Omitted {d} input(s) to stay within the handoff limit; read the thread back to recover them.\n\n", .{selection.omitted});
        }
    }

    if (previous) |text| {
        if (std.mem.indexOf(u8, text, auto_header) != null) {
            try out.writer.writeAll(older_auto_note);
        } else {
            const body = std.mem.trim(u8, if (std.mem.startsWith(u8, text, window_header)) text[window_header.len..] else text, " \t\r\n");
            const room = max_chars -| out.writer.buffered().len -| (older_checkpoint_header.len + 2);
            if (room >= min_record_chars) {
                const bounded = try elide(arena, body, room);
                try out.writer.print("{s}\n{s}", .{ older_checkpoint_header, bounded });
            } else {
                try out.writer.writeAll(older_auto_note);
            }
        }
    }

    return elide(alloc, std.mem.trimEnd(u8, out.writer.buffered(), " \t\r\n"), max_chars);
}

const Selection = struct {
    records: []?[]const u8,
    omitted: usize,
};

fn selectInputs(arena: Allocator, inputs: []const []const u8, budget: usize) !Selection {
    const records = try arena.alloc(?[]const u8, inputs.len);
    @memset(records, null);
    const last = inputs.len - 1;
    const fixed_count: usize = if (last == 0) 1 else 2;
    const per_fixed = @min(max_record_chars, (budget / 2) / fixed_count -| record_label_overhead);

    var used: usize = 0;
    records[0] = try elide(arena, inputs[0], per_fixed);
    used += records[0].?.len + record_label_overhead;
    if (last != 0) {
        records[last] = try elide(arena, inputs[last], per_fixed);
        used += records[last].?.len + record_label_overhead;
    }

    var omitted: usize = 0;
    var index = last;
    while (index > 1) {
        index -= 1;
        const candidate = try elide(arena, inputs[index], max_record_chars);
        if (used + candidate.len + record_label_overhead > budget) {
            omitted += 1;
            continue;
        }
        records[index] = candidate;
        used += candidate.len + record_label_overhead;
    }
    return .{ .records = records, .omitted = omitted };
}

pub fn elide(alloc: Allocator, text: []const u8, max_chars: usize) ![]u8 {
    if (text.len <= max_chars) return alloc.dupe(u8, text);
    if (max_chars <= elision.len + 2) return alloc.dupe(u8, text[0..charBoundary(text, max_chars)]);
    const keep = max_chars - elision.len;
    const head = charBoundary(text, keep / 2);
    const tail = charBoundary(text, text.len - (keep - keep / 2));
    return std.fmt.allocPrint(alloc, "{s}{s}{s}", .{ text[0..head], elision, text[tail..] });
}

fn charBoundary(text: []const u8, index: usize) usize {
    var at = index;
    while (at > 0 and at < text.len and (text[at] & 0xC0) == 0x80) at -= 1;
    return at;
}

fn userTurn(text: []const u8) HistoryTurn {
    return .{ .assistant = .{ .user = .{ .text = @constCast(text) }, .assistant = @constCast("assistant prose that must never be carried") } };
}

test "the automatic record keeps the first and last inputs, omits the middle under pressure, and carries no assistant prose" {
    const alloc = std.testing.allocator;
    const long = "x" ** 900;
    const removed = [_]HistoryTurn{ userTurn("build the installer"), userTurn(long), userTurn(long), userTurn("now sign it") };

    const record = try autoRecord(alloc, &removed, null, 1_200);
    defer alloc.free(record);
    try std.testing.expect(record.len <= 1_200);
    try std.testing.expect(std.mem.startsWith(u8, record, window_header));
    try std.testing.expect(std.mem.indexOf(u8, record, "[input 1 of 4]\nbuild the installer") != null);
    try std.testing.expect(std.mem.indexOf(u8, record, "[input 4 of 4]\nnow sign it") != null);
    try std.testing.expect(std.mem.indexOf(u8, record, "Omitted 2 input(s)") != null);
    try std.testing.expect(std.mem.indexOf(u8, record, "assistant prose") == null);
    try std.testing.expect(std.mem.indexOf(u8, record, "[input 1 of 4]").? < std.mem.indexOf(u8, record, "[input 4 of 4]").?);

    const roomy = try autoRecord(alloc, &removed, null, 16_000);
    defer alloc.free(roomy);
    try std.testing.expect(std.mem.indexOf(u8, roomy, "Omitted") == null);
    try std.testing.expect(std.mem.indexOf(u8, roomy, "[input 2 of 4]") != null);
}

test "a model handoff is carried once and an automatic one is never nested" {
    const alloc = std.testing.allocator;
    const removed = [_]HistoryTurn{userTurn("keep going")};

    const written = try explicitHandoff(alloc, "  Goal: ship.\nNext: run the tests.  ", 4_000);
    defer alloc.free(written);
    try std.testing.expectEqualStrings(window_header ++ "\n\n" ++ handoff_header ++ "\nGoal: ship.\nNext: run the tests.", written);

    const chained = try autoRecord(alloc, &removed, written, 4_000);
    defer alloc.free(chained);
    try std.testing.expect(std.mem.indexOf(u8, chained, older_checkpoint_header ++ "\n" ++ handoff_header ++ "\nGoal: ship.") != null);
    try std.testing.expectEqual(@as(usize, 1), std.mem.count(u8, chained, window_header));

    const twice = try autoRecord(alloc, &removed, chained, 4_000);
    defer alloc.free(twice);
    try std.testing.expect(std.mem.indexOf(u8, twice, older_auto_note) != null);
    try std.testing.expect(std.mem.indexOf(u8, twice, "Goal: ship.") == null);
}

test "elision keeps both ends and never splits a character" {
    const alloc = std.testing.allocator;
    const text = "héllo wörld, this is a long line of text that must be cut down in the middle";
    const cut = try elide(alloc, text, 40);
    defer alloc.free(cut);
    try std.testing.expect(cut.len <= 40);
    try std.testing.expect(std.unicode.utf8ValidateSlice(cut));
    try std.testing.expect(std.mem.startsWith(u8, cut, "héllo"));
    try std.testing.expect(std.mem.endsWith(u8, cut, "middle"));
    try std.testing.expect(std.mem.indexOf(u8, cut, elision) != null);
}

test "an explicit handoff applies only to its original compacted prefix" {
    const alloc = std.testing.allocator;
    const original = [_]HistoryTurn{userTurn("Original task")};
    const later = [_]HistoryTurn{userTurn("Later instructions")};
    var config = Config{ .handoff = "Completed the original work", .handoff_prefix = &original };
    const first = try summarize(&config, alloc, .{ .conversation = "original", .removed = &original });
    defer alloc.free(first);
    try std.testing.expect(std.mem.indexOf(u8, first, "Completed the original work") != null);
    const second = try summarize(&config, alloc, .{ .conversation = "later", .removed = &later });
    defer alloc.free(second);
    try std.testing.expect(std.mem.indexOf(u8, second, "Later instructions") != null);
    try std.testing.expect(std.mem.indexOf(u8, second, "Completed the original work") == null);
}
