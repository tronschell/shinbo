const builtin = @import("builtin");
const tool_dispatch = @import("../../core/tooling/tool_dispatch.zig");
const bridge = @import("../../tools/shinbo/bridge.zig");

const ToolSpec = tool_dispatch.Tool;

const host_platform = switch (builtin.os.tag) {
    .windows => "Windows",
    .macos => "macOS",
    .linux => "Linux",
    else => "this computer",
};

const secret_command_examples = if (builtin.os.tag == .windows)
    "Get-ChildItem Env:, Get-Content .env, op read op://vault/item/field, vault kv get secret/app."
else
    "printenv, cat .env, op read op://vault/item/field, vault kv get secret/app.";

const cli_description =
    "Run another coding CLI on " ++ host_platform ++ " — Claude Code, Codex, Pi, OpenCode, Gemini CLI, Cursor, Antigravity CLI — inside a connected folder, and take turns with it. Its terminal appears pinned at the top of this thread and in its own tab, so the user watches it work.\n" ++
    "action \"run\" starts a conversation with a CLI and returns its run id once the first turn finishes; \"send\" gives an existing run the next prompt, continuing the same session with everything it already knows.\n" ++
    "Check first with cli_runs {} which CLIs are installed — running one that is not there is the common failure.\n" ++
    "Say everything the CLI needs in prompt: it does not see this conversation, only the folder. Prefer it over doing the work yourself when the user names a CLI, when they want a second agent's answer on the same code, or when that CLI is set up for this project and Shinbo is not.\n" ++
    "unattended passes that CLI's own skip-approvals flag, so it edits and runs commands without stopping. It is the user's computer, so leave it off unless they asked for a hands-off run.";

pub const cli = ToolSpec{
    .name = "cli",
    .description = cli_description,
    .gateway_schema = .{
        .name = "cli",
        .description = cli_description,
        .input_schema = .{
            .properties = &.{
                .{
                    .name = "action",
                    .json_type = .string,
                    .description = "Start a conversation, or send the next turn of one. Defaults to run.",
                    .shape = &.{ .enum_values = &.{ "run", "send" } },
                },
                .{
                    .name = "cli",
                    .json_type = .string,
                    .description = "Which CLI to run: claude, codex, pi, opencode, gemini, cursor or antigravity. Required for run.",
                },
                .{
                    .name = "id",
                    .json_type = .string,
                    .description = "The run to send to, as cli returned it. Required for send.",
                },
                .{
                    .name = "prompt",
                    .json_type = .string,
                    .description = "What to ask it. The whole instruction — it cannot see this conversation.",
                },
                .{
                    .name = "model",
                    .json_type = .string,
                    .description = "Exact model id or native alias. Read cli_runs with cli first to discover ids; resolve the user's named model without substituting a different one. Empty resets to the harness default; omitted preserves an existing run.",
                },
                .{
                    .name = "effort",
                    .json_type = .string,
                    .description = "Native reasoning effort, Pi thinking level, or OpenCode variant. Read cli_runs with cli for supported values. Pass explicitly, never just in the prompt; do not downgrade unsupported choices. Empty resets to the harness default; omitted preserves an existing run.",
                },
                .{
                    .name = "fromRuns",
                    .json_type = .array,
                    .description = "Completed run ids from this thread whose latest successful outputs feed this step. Supports chains and combining multiple results. Wait for sources to finish; oversized outputs must be saved to files.",
                    .max_items = 8,
                    .shape = &.{ .array_values = .{ .json_type = .string } },
                },
                .{
                    .name = "unattended",
                    .json_type = .boolean,
                    .description = "Pass that CLI's skip-approvals flag so it never stops to ask. Off by default.",
                },
                .{
                    .name = "folder",
                    .json_type = .string,
                    .description = "Name of this thread's connected folder. A thread works in exactly one, so omit this.",
                },
            },
        },
    },
    .advertisement = .on_select,
    .executor_kind = .shinbo,
    .activity_kind = .command,
    .requires_approval = false,
    .action_label = "Running CLI",
    .completed_action_label = "Ran CLI",
    .permission_target_kind = .none,
    .decode = bridge.decode,
    .validate = bridge.validate,
    .call = bridge.call,
    .reads_only_fn = bridge.readsAndWrites,
    .irreversible_fn = bridge.isIrreversible,
};

const cli_runs_description =
    "Look after the CLI runs started with cli: call it with no arguments to see which CLIs are installed on this computer and list every run and its state, with an id to read that run's terminal output, or with stop to kill the turn it is working on. A run stays readable between turns — that is how you check whether one has finished before sending it more.";

pub const cli_runs = ToolSpec{
    .name = "cli_runs",
    .description = cli_runs_description,
    .gateway_schema = .{
        .name = "cli_runs",
        .description = cli_runs_description,
        .input_schema = .{
            .properties = &.{
                .{
                    .name = "id",
                    .json_type = .string,
                    .description = "Run id, as cli returned it. Omit to list the installed CLIs and every run.",
                },
                .{
                    .name = "stop",
                    .json_type = .boolean,
                    .description = "Kill the turn that run is working on instead of reading it.",
                },
                .{
                    .name = "cli",
                    .json_type = .string,
                    .description = "Read this harness's model ids and effort options before selecting a model. Cannot be combined with id or stop.",
                },
                .{
                    .name = "refresh",
                    .json_type = .boolean,
                    .description = "Reread the harness model catalog.",
                },
            },
        },
    },
    .advertisement = .on_select,
    .executor_kind = .shinbo,
    .activity_kind = .read,
    .requires_approval = false,
    .action_label = "Checking CLI runs",
    .completed_action_label = "Checked CLI runs",
    .permission_target_kind = .none,
    .decode = bridge.decode,
    .validate = bridge.validate,
    .call = bridge.call,
    .reads_only_fn = bridge.readsAndWrites,
    .irreversible_fn = bridge.isReversible,
};

const advisor_description =
    "Consult a stronger reviewer that sees your whole conversation: the task, every tool call you have made, every result you have read. You do not pass any of that — it is forwarded for you.\n" ++
    "Call it BEFORE substantive work: before writing, before committing to an interpretation, before building on an assumption. Finding files and reading them is orientation, not substantive work — do that first, then ask.\n" ++
    "Also call it when you believe the task is done (write the file or commit the change first, so a result survives even if this call does not), when you are stuck, and when you are considering a change of approach.\n" ++
    "Give the advice serious weight. If a step fails in practice, or you have evidence in front of you that contradicts it, adapt — but do not silently switch: ask once more with the conflict named.";

pub const advisor = ToolSpec{
    .name = "advisor",
    .description = advisor_description,
    .gateway_schema = .{
        .name = "advisor",
        .description = advisor_description,
        .input_schema = .{
            .properties = &.{
                .{
                    .name = "question",
                    .json_type = .string,
                    .description = "Optional. One line naming what you want decided, when the transcript alone would not make it obvious.",
                },
            },
        },
    },
    .advertisement = .on_select,
    .executor_kind = .shinbo,
    .activity_kind = .read,
    .requires_approval = false,
    .action_label = "Consulting advisor",
    .completed_action_label = "Consulted advisor",
    .permission_target_kind = .none,
    .decode = bridge.decode,
    .validate = bridge.validate,
    .call = bridge.call,
    .reads_only_fn = bridge.readsOnly,
    .irreversible_fn = bridge.isReversible,
};

const install_mcp_description =
    "Install an MCP server into Shinbo's own configuration. The harness connects it when the next turn starts, and its tools are found from then on with mcp_search_tools — not in the turn that installs it. Take the stdio command straight from the server's own README (npx, uvx, or a binary on this computer). Installing a name that already exists replaces it, which is how a wrong command gets fixed. Prefer this over telling the user to edit a config file by hand.";

pub const install_mcp = ToolSpec{
    .name = "install_mcp",
    .description = install_mcp_description,
    .gateway_schema = .{
        .name = "install_mcp",
        .description = install_mcp_description,
        .input_schema = .{
            .properties = &.{
                .{
                    .name = "name",
                    .json_type = .string,
                    .description = "Short name for the server: letters, digits, dot, dash or underscore.",
                },
                .{
                    .name = "command",
                    .json_type = .string,
                    .description = "The executable to run, e.g. npx.",
                },
                .{
                    .name = "args",
                    .json_type = .array,
                    .description = "Its arguments, e.g. [\"-y\", \"@modelcontextprotocol/server-filesystem\", \"notes\"].",
                    .shape = &.{ .array_values = .{ .json_type = .string } },
                },
                .{
                    .name = "env",
                    .json_type = .object,
                    .description = "Environment variables the server needs. Values are stored on this computer and appear in this transcript, so ask the user before putting a secret here.",
                },
            },
            .required = &.{ "name", "command" },
        },
    },
    .advertisement = .on_select,
    .executor_kind = .shinbo,
    .activity_kind = .write,
    .requires_approval = false,
    .action_label = "Installing MCP server",
    .completed_action_label = "Installed MCP server",
    .permission_target_kind = .none,
    .decode = bridge.decode,
    .validate = bridge.validate,
    .call = bridge.call,
    .reads_only_fn = bridge.readsAndWrites,
    .irreversible_fn = bridge.isReversible,
};

const computer_description =
    "Use a desktop app in the background through app-scoped accessibility controls. Prefer dedicated tools for files, code and structured integrations.\n" ++
    "list_apps returns running apps with their app IDs and process IDs. get_app_state reads an app's accessibility text and returns a snapshot token with element_index values. Supply app as an app ID from list_apps; supply pid to distinguish multiple running instances.\n" ++
    "launch_app opens an installed app by name — Notepad, Calculator, Google Chrome — and grants control of it for this turn, so use it whenever the app you need is not in list_apps instead of asking the user to open it. Never start a graphical app from the terminal tool: every command there runs in a job that is killed when the command returns, so the app dies with it.\n" ++
    "Shinbo asks the user before opening, reading or controlling the exact app. Approval lasts only for the current parent turn; full and auto modes never bypass it. Child agents cannot use computer and must ask the parent to perform app actions. A denial means do not use that app again this turn. A prompt nobody answered before it expired is not a denial: ask for that app once more, and give up if the second request also goes unanswered.\n" ++
    "App approval is not consent to purchases, deletions, sending private data or other consequential actions; ask separately for those. Never use this to approve Shinbo's own dialogs.\n" ++
    "Every mutation requires snapshot and element_index from the latest get_app_state for that app. A snapshot is single-use: perform one action, then get_app_state again before the next action.\n" ++
    "type_text supports only plain AXTextField or AXComboBox controls, not rich text. key dispatch does not prove the app handled it; verify the result with get_app_state.\n" ++
    "Only click, set_value, type_text, key and scroll change an app. Apart from launch_app, which brings the app it starts forward, there is no screenshot, coordinate, global shortcut, app activation or clipboard fallback. If an accessibility operation is unavailable, stop and explain the limitation.";

pub const computer = ToolSpec{
    .name = "computer",
    .description = computer_description,
    .gateway_schema = .{
        .name = "computer",
        .description = computer_description,
        .input_schema = .{
            .properties = &.{
                .{
                    .name = "action",
                    .json_type = .string,
                    .shape = &.{ .enum_values = &.{
                        "list_apps",
                        "launch_app",
                        "get_app_state",
                        "click",
                        "set_value",
                        "type_text",
                        "key",
                        "scroll",
                    } },
                },
                .{
                    .name = "app",
                    .json_type = .string,
                    .description = "Running app's ID from list_apps. Required except for list_apps and launch_app.",
                    .min_length = 1,
                },
                .{
                    .name = "name",
                    .json_type = .string,
                    .description = "Installed app to open, as the user would name it: Notepad, Calculator, Google Chrome. Required for launch_app, and never a file path.",
                    .min_length = 1,
                },
                .{
                    .name = "pid",
                    .json_type = .integer,
                    .description = "Optional running process ID from list_apps, to distinguish instances of the same app.",
                    .minimum = 1,
                },
                .{
                    .name = "snapshot",
                    .json_type = .string,
                    .description = "Single-use token from the latest get_app_state. Required for every mutation.",
                    .min_length = 1,
                    .max_length = 64,
                },
                .{
                    .name = "element_index",
                    .json_type = .integer,
                    .description = "Target element from that snapshot's accessibility text. Required for every mutation.",
                    .minimum = 0,
                    .maximum = 399,
                },
                .{
                    .name = "value",
                    .json_type = .string,
                    .description = "Replacement value for set_value. Required for set_value; an empty string clears the value.",
                },
                .{
                    .name = "text",
                    .json_type = .string,
                    .description = "Text to insert in a plain AXTextField or AXComboBox, not rich text. Required for type_text.",
                },
                .{
                    .name = "key",
                    .json_type = .string,
                    .description = "Named nonmodifier key. Required for key; modifier combinations and global shortcuts are unsupported.",
                },
                .{
                    .name = "direction",
                    .json_type = .string,
                    .description = "Required direction for scroll.",
                    .shape = &.{ .enum_values = &.{ "up", "down", "left", "right" } },
                },
                .{
                    .name = "amount",
                    .json_type = .integer,
                    .description = "Scroll amount from 1 to 10. Defaults to 1.",
                    .minimum = 1,
                    .maximum = 10,
                },
            },
            .required = &.{"action"},
            .additional_properties = false,
        },
    },
    .advertisement = .on_select,
    .executor_kind = .shinbo,
    .activity_kind = .write,
    .requires_approval = false,
    .action_label = "Using computer",
    .completed_action_label = "Used computer",
    .permission_target_kind = .none,
    .decode = bridge.decode,
    .validate = bridge.validate,
    .call = bridge.call,
    .reads_only_fn = bridge.readsAndWrites,
    .irreversible_fn = bridge.isIrreversible,
};

test "computer schema exposes only app-scoped background controls" {
    const std = @import("std");
    const gateway_schema = @import("../../core/tooling/gateway_schema.zig");
    const alloc = std.testing.allocator;
    const json = try gateway_schema.builtinFunctionSchemaJsonAlloc(alloc, computer.gateway_schema);
    defer alloc.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, alloc, json, .{});
    defer parsed.deinit();
    const description = parsed.value.object.get("description").?.string;
    try std.testing.expectEqualStrings(computer_description, description);
    for ([_][]const u8{
        "current parent turn",
        "launch_app opens an installed app by name",
        "not in list_apps instead of asking the user to open it",
        "Never start a graphical app from the terminal tool",
        "is not a denial: ask for that app once more",
        "Child agents cannot use computer",
        "purchases, deletions, sending private data",
        "ask separately for those",
        "plain AXTextField or AXComboBox controls, not rich text",
        "key dispatch does not prove the app handled it",
        "verify the result with get_app_state",
    }) |required_text| try std.testing.expect(std.mem.find(u8, description, required_text) != null);
    const schema = parsed.value.object.get("inputSchema").?.object;
    const properties = schema.get("properties").?.object;
    const actions = properties.get("action").?.object.get("enum").?.array.items;
    const expected_actions = [_][]const u8{ "list_apps", "launch_app", "get_app_state", "click", "set_value", "type_text", "key", "scroll" };
    try std.testing.expectEqual(expected_actions.len, actions.len);
    for (expected_actions, actions) |expected, actual| try std.testing.expectEqualStrings(expected, actual.string);
    const expected_properties = [_][2][]const u8{
        .{ "action", "string" },
        .{ "app", "string" },
        .{ "name", "string" },
        .{ "pid", "integer" },
        .{ "snapshot", "string" },
        .{ "element_index", "integer" },
        .{ "value", "string" },
        .{ "text", "string" },
        .{ "key", "string" },
        .{ "direction", "string" },
        .{ "amount", "integer" },
    };
    try std.testing.expectEqual(expected_properties.len, properties.count());
    for (expected_properties) |expected| {
        try std.testing.expectEqualStrings(expected[1], properties.get(expected[0]).?.object.get("type").?.string);
    }
    try std.testing.expectEqual(@as(i64, 64), properties.get("snapshot").?.object.get("maxLength").?.integer);
    try std.testing.expectEqual(@as(i64, 399), properties.get("element_index").?.object.get("maximum").?.integer);
    try std.testing.expectEqual(@as(i64, 1), properties.get("amount").?.object.get("minimum").?.integer);
    try std.testing.expectEqual(@as(i64, 10), properties.get("amount").?.object.get("maximum").?.integer);
    try std.testing.expect(properties.get("value").?.object.get("minLength") == null);
    try std.testing.expect(!schema.get("additionalProperties").?.bool);
    try std.testing.expectEqual(@as(usize, 1), schema.get("required").?.array.items.len);
    try std.testing.expectEqualStrings("action", schema.get("required").?.array.items[0].string);
    try std.testing.expectEqual(tool_dispatch.ExecutorKind.shinbo, computer.executor_kind);
    try std.testing.expect(!computer.requires_approval);
}

const secret_description =
    "Read something secret through the model the user picked for their secrets, without any of it entering this conversation. Keys, tokens, passwords, .env files, vault entries, whatever the user keeps private.\n" ++
    "command runs on this computer in the thread's folder, and its output goes only to that model, with your question. You get the answer back and never the output: " ++ secret_command_examples ++ "\n" ++
    "Use it whenever the work touches a secret — which keys are set, why a request comes back unauthorised, whether two tokens differ, what is in a credentials file. Do it here rather than reading the file yourself: whatever you read has been sent to the model running you and stays in this thread, and that model is not the one the user chose for this.\n" ++
    "Ask one specific question: \"which of these are empty\" beats \"what is in here\". Never ask for a value in full — ask only what you need to know to carry on.";

pub const secret = ToolSpec{
    .name = "secret",
    .description = secret_description,
    .gateway_schema = .{
        .name = "secret",
        .description = secret_description,
        .input_schema = .{
            .properties = &.{
                .{
                    .name = "question",
                    .json_type = .string,
                    .description = "What you need to know about the output. One specific question, never a request to repeat a secret in full.",
                },
                .{
                    .name = "command",
                    .json_type = .string,
                    .description = "The command whose output holds the secret. It runs in this thread's folder, and its output reaches nothing but the secrets model.",
                },
            },
            .required = &.{ "question", "command" },
        },
    },
    .advertisement = .on_select,
    .executor_kind = .shinbo,
    .activity_kind = .command,
    .requires_approval = false,
    .action_label = "Reading a secret",
    .completed_action_label = "Read a secret",
    .permission_target_kind = .none,
    .decode = bridge.decode,
    .validate = bridge.validate,
    .call = bridge.call,
    .reads_only_fn = bridge.readsAndWrites,
    .irreversible_fn = bridge.isIrreversible,
};

test "cli and cli_runs schemas offer every CLI and option Shinbo accepts" {
    const std = @import("std");
    const gateway_schema = @import("../../core/tooling/gateway_schema.zig");
    const alloc = std.testing.allocator;
    const expected = [_]struct { tool: ToolSpec, properties: []const []const u8 }{
        .{ .tool = cli, .properties = &.{ "action", "cli", "id", "prompt", "model", "effort", "fromRuns", "unattended", "folder" } },
        .{ .tool = cli_runs, .properties = &.{ "id", "stop", "cli", "refresh" } },
    };
    for (expected) |case| {
        const json = try gateway_schema.builtinFunctionSchemaJsonAlloc(alloc, case.tool.gateway_schema);
        defer alloc.free(json);
        const parsed = try std.json.parseFromSlice(std.json.Value, alloc, json, .{});
        defer parsed.deinit();
        const properties = parsed.value.object.get("inputSchema").?.object.get("properties").?.object;
        try std.testing.expectEqual(case.properties.len, properties.count());
        for (case.properties) |name| try std.testing.expect(properties.get(name) != null);
    }
    for ([_][]const u8{ "Gemini CLI", "Antigravity CLI" }) |name| try std.testing.expect(std.mem.find(u8, cli_description, name) != null);
    for ([_][]const u8{ "claude", "codex", "pi", "opencode", "gemini", "cursor", "antigravity" }) |id| {
        try std.testing.expect(std.mem.find(u8, cli.gateway_schema.input_schema.properties[1].description, id) != null);
    }
}

pub const all = [_]ToolSpec{ cli, cli_runs, computer, advisor, install_mcp, secret };
