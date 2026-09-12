const std = @import("std");
const io_mod = @import("../shared/io.zig");

const Allocator = std.mem.Allocator;

pub const OperationKind = enum {
    write,
    edit,
    delete,
    rename,
};

pub const FileOperation = struct {
    kind: OperationKind,
    path: []u8,
    previous_content: ?[]u8,
    previous_directory: bool = false,
    source_restored: bool = false,
    new_path: ?[]u8 = null,
    timestamp_ms: i64,
};

pub const UndoResult = union(enum) {
    restored: []const u8,
    deleted: []const u8,
    failed: anyerror,
    empty,
};

pub const ChangeTracker = struct {
    stack: std.ArrayList(FileOperation) = .empty,

    const max_stack_size: usize = 100;

    pub fn deinit(self: *ChangeTracker, alloc: Allocator) void {
        for (self.stack.items) |op| freeOperation(alloc, op);
        self.stack.deinit(alloc);
    }

    pub fn clear(self: *ChangeTracker, alloc: Allocator) void {
        for (self.stack.items) |op| freeOperation(alloc, op);
        self.stack.clearRetainingCapacity();
    }

    pub fn pushOperation(self: *ChangeTracker, alloc: Allocator, op: FileOperation) !void {
        if (self.stack.items.len >= max_stack_size) {
            freeOperation(alloc, self.stack.items[0]);
            _ = self.stack.orderedRemove(0);
        }
        try self.stack.append(alloc, op);
    }

    pub fn undoLast(self: *ChangeTracker, alloc: Allocator) UndoResult {
        if (self.stack.items.len == 0) return .empty;
        const op = &self.stack.items[self.stack.items.len - 1];
        const deleted = switch (op.kind) {
            .delete => blk: {
                if (op.previous_directory) {
                    std.Io.Dir.createDirAbsolute(io_mod.getIo(), op.path, .default_dir) catch |err| return .{ .failed = err };
                    break :blk false;
                }
                const content = op.previous_content orelse {
                    freeOperation(alloc, self.stack.pop().?);
                    return .empty;
                };
                io_mod.writeFileAtomic(alloc, op.path, content) catch |err| return .{ .failed = err };
                break :blk false;
            },
            .rename => blk: {
                if (op.new_path) |new_path| {
                    if (op.previous_content) |content| {
                        io_mod.copyFileAtomic(alloc, new_path, op.path) catch |err| return .{ .failed = err };
                        io_mod.writeFileAtomic(alloc, new_path, content) catch |err| return .{ .failed = err };
                    } else {
                        if (!op.source_restored) {
                            std.Io.Dir.renameAbsolute(new_path, op.path, io_mod.getIo()) catch |err| return .{ .failed = err };
                            op.source_restored = true;
                        }
                        if (op.previous_directory) {
                            std.Io.Dir.createDirAbsolute(io_mod.getIo(), new_path, .default_dir) catch |err| return .{ .failed = err };
                        }
                    }
                }
                break :blk false;
            },
            .write, .edit => blk: {
                if (op.previous_content) |content| {
                    io_mod.writeFileAtomic(alloc, op.path, content) catch |err| return .{ .failed = err };
                    break :blk false;
                }
                std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), op.path) catch |err| switch (err) {
                    error.FileNotFound => {},
                    else => return .{ .failed = err },
                };
                break :blk true;
            },
        };
        const completed = self.stack.pop().?;
        if (completed.previous_content) |content| alloc.free(content);
        if (completed.new_path) |new_path| alloc.free(new_path);
        return if (deleted) .{ .deleted = completed.path } else .{ .restored = completed.path };
    }

    pub fn captureFileState(alloc: Allocator, absolute_path: []const u8) !?[]u8 {
        var file = std.Io.Dir.openFileAbsolute(io_mod.getIo(), absolute_path, .{}) catch |err| switch (err) {
            error.FileNotFound => return null,
            else => return err,
        };
        defer file.close(io_mod.getIo());
        return try io_mod.readFileToEnd(alloc, &file, 10 * 1024 * 1024);
    }

    fn freeOperation(alloc: Allocator, op: FileOperation) void {
        alloc.free(op.path);
        if (op.previous_content) |content| alloc.free(content);
        if (op.new_path) |new_path| alloc.free(new_path);
    }
};

fn tmpPath(alloc: Allocator, dir: std.Io.Dir, name: []const u8) ![]u8 {
    const root = try io_mod.dirRealpathAlloc(alloc, dir, "");
    defer alloc.free(root);
    return std.fs.path.join(alloc, &.{ root, name });
}

fn writeAbsolute(path: []const u8, content: []const u8) !void {
    var file = try std.Io.Dir.createFileAbsolute(io_mod.getIo(), path, .{ .truncate = true });
    defer file.close(io_mod.getIo());
    try file.writeStreamingAll(io_mod.getIo(), content);
}

fn readAbsolute(alloc: Allocator, path: []const u8) ![]u8 {
    var file = try std.Io.Dir.openFileAbsolute(io_mod.getIo(), path, .{});
    defer file.close(io_mod.getIo());
    return io_mod.readFileToEnd(alloc, &file, 1024 * 1024);
}

fn expectMissing(path: []const u8) !void {
    if (std.Io.Dir.openFileAbsolute(io_mod.getIo(), path, .{})) |file| {
        file.close(io_mod.getIo());
        return error.FileStillExists;
    } else |_| {}
}

test "undoLast returns empty on an initially empty stack" {
    const alloc = std.testing.allocator;
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try std.testing.expect(tracker.undoLast(alloc) == .empty);
}

test "clear releases operations and leaves the tracker empty" {
    const alloc = std.testing.allocator;
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try tracker.pushOperation(alloc, .{
        .kind = .rename,
        .path = try alloc.dupe(u8, "/workspace/a.txt"),
        .previous_content = try alloc.dupe(u8, "before"),
        .new_path = try alloc.dupe(u8, "/workspace/b.txt"),
        .timestamp_ms = 1,
    });

    tracker.clear(alloc);

    try std.testing.expectEqual(@as(usize, 0), tracker.stack.items.len);
    try std.testing.expect(tracker.undoLast(alloc) == .empty);

    try tracker.pushOperation(alloc, .{
        .kind = .write,
        .path = try alloc.dupe(u8, "/workspace/reused.txt"),
        .previous_content = null,
        .timestamp_ms = 2,
    });
    try std.testing.expectEqual(@as(usize, 1), tracker.stack.items.len);
    try std.testing.expectEqualStrings("/workspace/reused.txt", tracker.stack.items[0].path);
}

test "pushOperation evicts the oldest operation with stable ordering" {
    const alloc = std.testing.allocator;
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    for (0..ChangeTracker.max_stack_size + 1) |i| {
        try tracker.pushOperation(alloc, .{
            .kind = .write,
            .path = try std.fmt.allocPrint(alloc, "/tracked/file-{d}", .{i}),
            .previous_content = null,
            .timestamp_ms = @intCast(i),
        });
    }

    try std.testing.expectEqual(ChangeTracker.max_stack_size, tracker.stack.items.len);
    try std.testing.expectEqualStrings("/tracked/file-1", tracker.stack.items[0].path);
    try std.testing.expectEqualStrings("/tracked/file-100", tracker.stack.items[tracker.stack.items.len - 1].path);
}

test "undoLast restores previous content for write and edit operations" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "restore.txt");
    defer alloc.free(path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), path) catch {};

    try writeAbsolute(path, "modified");
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try tracker.pushOperation(alloc, .{
        .kind = .write,
        .path = try alloc.dupe(u8, path),
        .previous_content = try alloc.dupe(u8, "original"),
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .restored => |restored_path| {
            defer alloc.free(restored_path);
            try std.testing.expectEqualStrings(path, restored_path);
        },
        else => return error.ExpectedRestore,
    }

    const content = try readAbsolute(alloc, path);
    defer alloc.free(content);
    try std.testing.expectEqualStrings("original", content);
}

test "undoLast deletes new write and edit operations" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "new.txt");
    defer alloc.free(path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), path) catch {};

    try writeAbsolute(path, "new content");
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try tracker.pushOperation(alloc, .{
        .kind = .edit,
        .path = try alloc.dupe(u8, path),
        .previous_content = null,
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .deleted => |deleted_path| {
            defer alloc.free(deleted_path);
            try std.testing.expectEqualStrings(path, deleted_path);
        },
        else => return error.ExpectedDelete,
    }

    try expectMissing(path);
}

test "undoLast reports deleted for a new write when the file is already absent" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "already-absent.txt");
    defer alloc.free(path);

    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try tracker.pushOperation(alloc, .{
        .kind = .write,
        .path = try alloc.dupe(u8, path),
        .previous_content = null,
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .deleted => |deleted_path| {
            defer alloc.free(deleted_path);
            try std.testing.expectEqualStrings(path, deleted_path);
        },
        else => return error.ExpectedDelete,
    }

    try expectMissing(path);
}

test "undoLast restores deleted files when previous content exists" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "deleted.txt");
    defer alloc.free(path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), path) catch {};

    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);
    try tracker.pushOperation(alloc, .{
        .kind = .delete,
        .path = try alloc.dupe(u8, path),
        .previous_content = try alloc.dupe(u8, "restored"),
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .restored => |restored_path| {
            defer alloc.free(restored_path);
            try std.testing.expectEqualStrings(path, restored_path);
        },
        else => return error.ExpectedRestore,
    }

    const content = try readAbsolute(alloc, path);
    defer alloc.free(content);
    try std.testing.expectEqualStrings("restored", content);
}

test "undoLast returns empty for deleted files without previous content" {
    const alloc = std.testing.allocator;
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try tracker.pushOperation(alloc, .{
        .kind = .delete,
        .path = try alloc.dupe(u8, "/workspace/deleted.txt"),
        .previous_content = null,
        .timestamp_ms = 1,
    });

    try std.testing.expect(tracker.undoLast(alloc) == .empty);
}

test "undoLast renames new_path back to path" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const old_path = try tmpPath(alloc, tmp.dir, "old.txt");
    defer alloc.free(old_path);
    const new_path = try tmpPath(alloc, tmp.dir, "new.txt");
    defer alloc.free(new_path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), old_path) catch {};
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), new_path) catch {};

    try writeAbsolute(new_path, "moved");
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);
    try tracker.pushOperation(alloc, .{
        .kind = .rename,
        .path = try alloc.dupe(u8, old_path),
        .previous_content = null,
        .new_path = try alloc.dupe(u8, new_path),
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .restored => |restored_path| {
            defer alloc.free(restored_path);
            try std.testing.expectEqualStrings(old_path, restored_path);
        },
        else => return error.ExpectedRestore,
    }

    const content = try readAbsolute(alloc, old_path);
    defer alloc.free(content);
    try std.testing.expectEqualStrings("moved", content);
    try expectMissing(new_path);
}

test "undoLast restores destination preimage after overwrite rename" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const old_path = try tmpPath(alloc, tmp.dir, "source.txt");
    defer alloc.free(old_path);
    const new_path = try tmpPath(alloc, tmp.dir, "dest.txt");
    defer alloc.free(new_path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), old_path) catch {};
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), new_path) catch {};

    // After overwrite rename, only dest exists with the source bytes.
    try writeAbsolute(new_path, "source-bytes");
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);
    try tracker.pushOperation(alloc, .{
        .kind = .rename,
        .path = try alloc.dupe(u8, old_path),
        .previous_content = try alloc.dupe(u8, "dest-preimage"),
        .new_path = try alloc.dupe(u8, new_path),
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .restored => |restored_path| {
            defer alloc.free(restored_path);
            try std.testing.expectEqualStrings(old_path, restored_path);
        },
        else => return error.ExpectedRestore,
    }

    const source = try readAbsolute(alloc, old_path);
    defer alloc.free(source);
    try std.testing.expectEqualStrings("source-bytes", source);
    const dest = try readAbsolute(alloc, new_path);
    defer alloc.free(dest);
    try std.testing.expectEqualStrings("dest-preimage", dest);
}

test "undoLast retains rename operations when restoring the source fails" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const old_path = try tmpPath(alloc, tmp.dir, "old-missing.txt");
    defer alloc.free(old_path);
    const new_path = try tmpPath(alloc, tmp.dir, "new-missing.txt");
    defer alloc.free(new_path);

    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);
    try tracker.pushOperation(alloc, .{
        .kind = .rename,
        .path = try alloc.dupe(u8, old_path),
        .previous_content = try alloc.dupe(u8, "unused"),
        .new_path = try alloc.dupe(u8, new_path),
        .timestamp_ms = 1,
    });

    try std.testing.expect(tracker.undoLast(alloc) == .failed);
    try std.testing.expectEqual(@as(usize, 1), tracker.stack.items.len);
    try writeAbsolute(new_path, "renamed source");
    const result = tracker.undoLast(alloc);
    try std.testing.expect(result == .restored);
    alloc.free(result.restored);
    try std.testing.expectEqual(@as(usize, 0), tracker.stack.items.len);
    const old_content = try readAbsolute(alloc, old_path);
    defer alloc.free(old_content);
    try std.testing.expectEqualStrings("renamed source", old_content);
    const restored_destination = try readAbsolute(alloc, new_path);
    defer alloc.free(restored_destination);
    try std.testing.expectEqualStrings("unused", restored_destination);
}

test "undoLast returns restored for rename operations without new_path" {
    const alloc = std.testing.allocator;
    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);

    try tracker.pushOperation(alloc, .{
        .kind = .rename,
        .path = try alloc.dupe(u8, "/workspace/original.txt"),
        .previous_content = try alloc.dupe(u8, "previous"),
        .timestamp_ms = 1,
    });

    const result = tracker.undoLast(alloc);
    switch (result) {
        .restored => |restored_path| {
            defer alloc.free(restored_path);
            try std.testing.expectEqualStrings("/workspace/original.txt", restored_path);
        },
        else => return error.ExpectedRestore,
    }
}

test "undoLast retains its backup after restore failure and succeeds on retry" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "missing-parent/file.txt");
    defer alloc.free(path);

    var tracker: ChangeTracker = .{};
    defer tracker.deinit(alloc);
    try tracker.pushOperation(alloc, .{
        .kind = .write,
        .path = try alloc.dupe(u8, path),
        .previous_content = try alloc.dupe(u8, "content"),
        .timestamp_ms = 1,
    });

    try std.testing.expect(tracker.undoLast(alloc) == .failed);
    try std.testing.expectEqual(@as(usize, 1), tracker.stack.items.len);
    try expectMissing(path);
    try tmp.dir.createDir(io_mod.getIo(), "missing-parent", .default_dir);
    const result = tracker.undoLast(alloc);
    try std.testing.expect(result == .restored);
    alloc.free(result.restored);
    try std.testing.expectEqual(@as(usize, 0), tracker.stack.items.len);
    const restored = try readAbsolute(alloc, path);
    defer alloc.free(restored);
    try std.testing.expectEqualStrings("content", restored);
}

test "captureFileState captures existing files and returns null for missing files" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "capture.txt");
    defer alloc.free(path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), path) catch {};

    try writeAbsolute(path, "snapshot");

    const captured = try ChangeTracker.captureFileState(alloc, path) orelse return error.ExpectedCapture;
    defer alloc.free(captured);
    try std.testing.expectEqualStrings("snapshot", captured);

    const missing_path = try tmpPath(alloc, tmp.dir, "missing.txt");
    defer alloc.free(missing_path);
    try std.testing.expect(try ChangeTracker.captureFileState(alloc, missing_path) == null);
}

test "captureFileState reports failed capture at the size limit" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "limit.bin");
    defer alloc.free(path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), path) catch {};

    var file = try std.Io.Dir.createFileAbsolute(io_mod.getIo(), path, .{ .truncate = true });
    defer file.close(io_mod.getIo());
    try file.setLength(io_mod.getIo(), 10 * 1024 * 1024);

    try std.testing.expectError(error.StreamTooLong, ChangeTracker.captureFileState(alloc, path));
}

test "captureFileState reports failed capture over the size limit" {
    const alloc = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try tmpPath(alloc, tmp.dir, "over-limit.bin");
    defer alloc.free(path);
    defer std.Io.Dir.deleteFileAbsolute(io_mod.getIo(), path) catch {};

    var file = try std.Io.Dir.createFileAbsolute(io_mod.getIo(), path, .{ .truncate = true });
    defer file.close(io_mod.getIo());
    try file.setLength(io_mod.getIo(), 10 * 1024 * 1024 + 1);

    try std.testing.expectError(error.StreamTooLong, ChangeTracker.captureFileState(alloc, path));
}
