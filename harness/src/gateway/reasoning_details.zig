const std = @import("std");
const Allocator = std.mem.Allocator;

const Field = struct {
    json: std.ArrayList(u8),
    kind: std.meta.Tag(std.json.Value),
    integer: i64 = 0,
};

const Entry = struct {
    fields: std.StringArrayHashMapUnmanaged(Field) = .empty,
    size: usize = 2,

    fn deinit(self: *@This(), alloc: Allocator) void {
        for (self.fields.keys(), self.fields.values()) |key, *field| {
            alloc.free(key);
            field.json.deinit(alloc);
        }
        self.fields.deinit(alloc);
    }

    fn put(self: *@This(), alloc: Allocator, key: []const u8, value: std.json.Value, merge: bool) !void {
        const raw = try std.json.Stringify.valueAlloc(alloc, value, .{});
        var owned = true;
        defer if (owned) alloc.free(raw);
        if (self.fields.getPtr(key)) |field| {
            if (merge and field.kind == .string and value == .string and
                (std.mem.eql(u8, key, "text") or std.mem.eql(u8, key, "summary") or std.mem.eql(u8, key, "signature")))
            {
                try field.json.ensureUnusedCapacity(alloc, raw.len - 2);
                field.json.items.len -= 1;
                field.json.appendSliceAssumeCapacity(raw[1..]);
                self.size += raw.len - 2;
                return;
            }
            self.size = self.size - field.json.items.len + raw.len;
            field.json.deinit(alloc);
            field.* = .{ .json = .fromOwnedSlice(raw), .kind = value, .integer = if (value == .integer) value.integer else 0 };
            owned = false;
        } else {
            const owned_key = try alloc.dupe(u8, key);
            errdefer alloc.free(owned_key);
            const key_json = try std.json.Stringify.valueAlloc(alloc, key, .{});
            defer alloc.free(key_json);
            try self.fields.put(alloc, owned_key, .{ .json = .fromOwnedSlice(raw), .kind = value, .integer = if (value == .integer) value.integer else 0 });
            owned = false;
            self.size += key_json.len + 1 + raw.len + @intFromBool(self.fields.count() > 1);
        }
    }

    fn matches(self: *const @This(), value: std.json.ObjectMap, kind: []const u8, id_json: ?[]const u8, last: bool) bool {
        const previous_kind = self.fields.get("type") orelse return false;
        const expected = if (std.mem.eql(u8, kind, "reasoning.text")) "\"reasoning.text\"" else "\"reasoning.summary\"";
        if (!std.mem.eql(u8, previous_kind.json.items, expected)) return false;
        if (value.get("index")) |index| {
            const previous = self.fields.get("index") orelse return false;
            if (index != .integer or previous.kind != .integer or index.integer != previous.integer) return false;
        } else if (!last) return false;
        if (id_json) |id| {
            const previous = self.fields.get("id") orelse return false;
            if (!std.mem.eql(u8, id, previous.json.items)) return false;
        }
        return true;
    }
};

pub const ReasoningDetails = struct {
    entries: std.ArrayList(Entry) = .empty,
    size: usize = 2,
    present: bool = false,

    pub fn deinit(self: *@This(), alloc: Allocator) void {
        for (self.entries.items) |*entry| entry.deinit(alloc);
        self.entries.deinit(alloc);
    }

    pub fn append(self: *@This(), alloc: Allocator, value: std.json.Value, limit: usize) !void {
        if (value == .null) return;
        if (value != .array) return error.InvalidProviderResponse;
        self.present = true;
        for (value.array.items) |incoming| {
            if (incoming != .object) return error.InvalidProviderResponse;
            const kind = incoming.object.get("type") orelse return error.InvalidProviderResponse;
            if (kind != .string) return error.InvalidProviderResponse;
            const id = incoming.object.get("id");
            const id_json = if (id != null and id.? == .string) try std.json.Stringify.valueAlloc(alloc, id.?, .{}) else null;
            defer if (id_json) |raw| alloc.free(raw);
            var previous: ?*Entry = null;
            if (std.mem.eql(u8, kind.string, "reasoning.text") or std.mem.eql(u8, kind.string, "reasoning.summary")) {
                var index = self.entries.items.len;
                while (index > 0) {
                    index -= 1;
                    const candidate = &self.entries.items[index];
                    if (candidate.matches(incoming.object, kind.string, id_json, index + 1 == self.entries.items.len)) {
                        previous = candidate;
                        break;
                    }
                }
            }
            if (previous) |entry| {
                const old_size = entry.size;
                var fields = incoming.object.iterator();
                while (fields.next()) |field| try entry.put(alloc, field.key_ptr.*, field.value_ptr.*, true);
                self.size = self.size - old_size + entry.size;
            } else {
                var entry: Entry = .{};
                errdefer entry.deinit(alloc);
                var fields = incoming.object.iterator();
                while (fields.next()) |field| try entry.put(alloc, field.key_ptr.*, field.value_ptr.*, false);
                try self.entries.append(alloc, entry);
                self.size += entry.size + @intFromBool(self.entries.items.len > 1);
            }
        }
        if (self.size > limit) return error.ResponseTooLarge;
    }

    pub fn finish(self: *const @This(), alloc: Allocator) !?[]u8 {
        if (!self.present) return null;
        const buffer = try alloc.alloc(u8, self.size);
        errdefer alloc.free(buffer);
        var out = std.Io.Writer.fixed(buffer);
        try out.writeByte('[');
        for (self.entries.items, 0..) |entry, index| {
            if (index > 0) try out.writeByte(',');
            try out.writeByte('{');
            for (entry.fields.keys(), entry.fields.values(), 0..) |key, field, field_index| {
                if (field_index > 0) try out.writeByte(',');
                try std.json.Stringify.value(key, .{}, &out);
                try out.writeByte(':');
                try out.writeAll(field.json.items);
            }
            try out.writeByte('}');
        }
        try out.writeByte(']');
        std.debug.assert(out.buffered().len == self.size);
        return buffer;
    }
};

fn exerciseMerges(alloc: Allocator) !void {
    var details: ReasoningDetails = .{};
    defer details.deinit(alloc);
    const deltas = [_][]const u8{
        "[{\"type\":\"reasoning.text\",\"text\":\"a\\n\",\"signature\":\"s\",\"index\":0,\"id\":\"r0\",\"metadata\":{\"old\":true}}]",
        "[{\"type\":\"reasoning.encrypted\",\"data\":\"opaque\"}]",
        "[{\"type\":\"reasoning.text\",\"text\":\"𝄞\\\"\\\\\",\"signature\":\"ig\",\"index\":0,\"id\":\"r0\",\"metadata\":[1,null]}]",
        "[{\"type\":\"reasoning.text\",\"text\":\"other\",\"index\":0,\"id\":\"r1\"}]",
        "[{\"type\":\"reasoning.text\",\"text\":null,\"index\":0,\"id\":\"r1\"}]",
        "[{\"type\":\"reasoning.text\",\"text\":\"last\"}]",
        "[{\"type\":\"reasoning.text\",\"text\":\"!\"}]",
    };
    for (deltas) |delta| {
        const parsed = try std.json.parseFromSlice(std.json.Value, alloc, delta, .{});
        defer parsed.deinit();
        try details.append(alloc, parsed.value, 4096);
    }
    const output = (try details.finish(alloc)).?;
    defer alloc.free(output);
    try std.testing.expectEqualStrings(
        "[{\"type\":\"reasoning.text\",\"text\":\"a\\n𝄞\\\"\\\\\",\"signature\":\"sig\",\"index\":0,\"id\":\"r0\",\"metadata\":[1,null]},{\"type\":\"reasoning.encrypted\",\"data\":\"opaque\"},{\"type\":\"reasoning.text\",\"text\":\"last!\",\"index\":0,\"id\":\"r1\"}]",
        output,
    );
    try std.testing.expectEqual(output.len, details.size);
}

test "reasoning details retain ordered fields and exact fragmented JSON through allocation failures" {
    try exerciseMerges(std.testing.allocator);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, exerciseMerges, .{});
}

test "reasoning details retain null and empty arrays and enforce exact escaped output limits" {
    const alloc = std.testing.allocator;
    var details: ReasoningDetails = .{};
    defer details.deinit(alloc);
    try details.append(alloc, .null, 2);
    try std.testing.expectEqual(@as(?[]u8, null), try details.finish(alloc));
    const empty = try std.json.parseFromSlice(std.json.Value, alloc, "[]", .{});
    defer empty.deinit();
    try details.append(alloc, empty.value, 2);
    const empty_output = (try details.finish(alloc)).?;
    defer alloc.free(empty_output);
    try std.testing.expectEqualStrings("[]", empty_output);
    const raw = "[{\"type\":\"reasoning.text\",\"text\":\"\\n\\\"\"}]";
    const parsed = try std.json.parseFromSlice(std.json.Value, alloc, raw, .{});
    defer parsed.deinit();
    try details.append(alloc, parsed.value, raw.len);
    try std.testing.expectEqual(raw.len, details.size);
    try std.testing.expectError(error.ResponseTooLarge, details.append(alloc, parsed.value, raw.len + 3));
    try std.testing.expectEqual(raw.len + 4, details.size);
}

test "reasoning details reject invalid entries and do not merge noninteger block indices" {
    const alloc = std.testing.allocator;
    for ([_][]const u8{ "{}", "[null]", "[{}]", "[{\"type\":0}]" }) |raw| {
        var details: ReasoningDetails = .{};
        defer details.deinit(alloc);
        const parsed = try std.json.parseFromSlice(std.json.Value, alloc, raw, .{});
        defer parsed.deinit();
        try std.testing.expectError(error.InvalidProviderResponse, details.append(alloc, parsed.value, 4096));
    }
    var details: ReasoningDetails = .{};
    defer details.deinit(alloc);
    const raw = "[{\"type\":\"reasoning.summary\",\"summary\":\"a\",\"index\":\"0\"}]";
    const parsed = try std.json.parseFromSlice(std.json.Value, alloc, raw, .{});
    defer parsed.deinit();
    try details.append(alloc, parsed.value, 4096);
    try details.append(alloc, parsed.value, 4096);
    try std.testing.expectEqual(@as(usize, 2), details.entries.items.len);
}

test "reasoning detail append allocation stays proportional to incoming bytes" {
    var counting = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const alloc = counting.allocator();
    const delta = "[{\"type\":\"reasoning.text\",\"text\":\"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?\",\"index\":0}]";
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, delta, .{});
    defer parsed.deinit();
    var details: ReasoningDetails = .{};
    defer details.deinit(alloc);
    for (0..4096) |_| try details.append(alloc, parsed.value, 4 * 1024 * 1024);
    const output = (try details.finish(alloc)).?;
    defer alloc.free(output);
    try std.testing.expectEqual(@as(usize, 262191), output.len);
    try std.testing.expect(counting.allocated_bytes < 8 * 1024 * 1024);
    if (@import("builtin").mode == .ReleaseFast) std.debug.print("reasoning allocation input_bytes=262144 output_bytes={d} cumulative_allocated_bytes={d}\n", .{ output.len, counting.allocated_bytes });
}
