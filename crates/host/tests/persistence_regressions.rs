use serde_json::{Value, json};
use shinbo_core::{
    MAX_THREAD_MESSAGES, ScheduledJob, ScheduledJobStore, Thread, ThreadMessage, ThreadRole,
    ThreadStore, Timestamp,
};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

struct Host {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    root: PathBuf,
    events: Vec<Value>,
}

impl Host {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "shinbo-persistence-regression-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let mut child = Command::new(env!("CARGO_BIN_EXE_shinbo-host"))
            .env("SHINBO_DATA_DIR", &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            root,
            events: Vec::new(),
        }
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        writeln!(
            self.input,
            "{}",
            json!({"id":"regression", "method":method, "params":params})
        )
        .unwrap();
        self.input.flush().unwrap();
        let mut assembled = String::new();
        loop {
            let mut line = String::new();
            assert!(self.output.read_line(&mut line).unwrap() > 0);
            let frame: Value = serde_json::from_str(&line).unwrap();
            if let Some(event) = frame.get("dueJob") {
                self.events.push(event.clone());
                continue;
            }
            if let Some(chunk) = frame["chunk"].as_str() {
                assembled.push_str(chunk);
                if frame["end"] == true {
                    return serde_json::from_str(&assembled).unwrap();
                }
            } else {
                return frame;
            }
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn round_six_resume_requires_an_unspent_goal_allowance() {
    let mut host = Host::new();
    for (turns, budget, tokens) in [(3, "1000", "400"), (40, "100000", "0")] {
        let created = host.request("createThread", json!({"title":"Resume fixture"}));
        let id = &created["result"]["id"];
        host.request(
            "setGoal",
            json!({"threadId":id,"objective":"Finish fixture","tokenBudget":budget}),
        );
        for step in 0..turns {
            if step >= turns - 3 {
                host.request(
                    "updateGoal",
                    json!({"threadId":id,"status":"blocked","reason":"Fixture unavailable"}),
                );
            }
            host.request("recordTurn", json!({"threadId":id,"prompt":"Try fixture","response":"Unavailable","inputTokens":tokens}));
        }
        let before = host.request("thread", json!({"threadId":id}));
        assert_eq!(before["result"]["goal"]["status"], "blocked");
        let resumed = host.request("updateGoal", json!({"threadId":id,"status":"active"}));
        assert_eq!(resumed["ok"], false, "{resumed}");
        let after = host.request("thread", json!({"threadId":id}));
        assert_eq!(after["result"]["goal"], before["result"]["goal"]);
        let extended = host.request("updateGoal", json!({"threadId":id,"extraTokens":"1000"}));
        assert_eq!(extended["result"]["goal"]["status"], "active");
        assert_eq!(extended["result"]["goal"]["turns"], 0);
    }
}

#[test]
fn round_six_goal_ledger_preserves_all_model_steps() {
    let mut host = Host::new();
    let created = host.request("createThread", json!({"title":"Several model steps"}));
    let id = &created["result"]["id"];
    host.request(
        "setGoal",
        json!({"threadId":id,"objective":"Finish fixture","tokenBudget":"40000"}),
    );
    let recorded = host.request("recordTurn", json!({"threadId":id,"prompt":"Work","response":"Made progress","inputTokens":"5000","outputTokens":"600","durationMilliseconds":"1000","goalTokens":"35600"}));
    assert_eq!(recorded["ok"], true, "{recorded}");
    assert_eq!(recorded["result"]["goal"]["tokensUsed"], 35600);
    assert_eq!(
        recorded["result"]["messages"][1]["generation"]["inputTokens"],
        5000
    );
    let saved = host.request("thread", json!({"threadId":id}));
    assert_eq!(saved["result"]["goal"]["tokensUsed"], 35600);
    let stopped = host.request("recordTurn", json!({"threadId":id,"prompt":"Next step","response":"","notice":"Stopped at allowance","inputTokens":"5000","outputTokens":"100","goalTokens":"5100"}));
    assert_eq!(stopped["result"]["goal"]["tokensUsed"], 40700);
    assert_eq!(stopped["result"]["goal"]["status"], "budgetLimited");
}

#[test]
fn round_six_completed_goal_excludes_later_unrelated_conversation() {
    let mut host = Host::new();
    let created = host.request("createThread", json!({"title":"Completed fixture"}));
    let id = &created["result"]["id"];
    host.request(
        "setGoal",
        json!({"threadId":id,"objective":"Finish fixture","tokenBudget":"1000"}),
    );
    host.request(
        "updateGoal",
        json!({"threadId":id,"status":"complete","evidence":"Fixture completed successfully"}),
    );
    let completed = host.request("recordTurn", json!({"threadId":id,"prompt":"Complete fixture","response":"Done","inputTokens":"100","durationMilliseconds":"1000","goalTurn":"true"}));
    assert_eq!(completed["ok"], true, "{completed}");
    assert_eq!(completed["result"]["goal"]["tokensUsed"], 100);
    assert_eq!(completed["result"]["goal"]["turns"], 1);
    let unrelated = host.request("recordTurn", json!({"threadId":id,"prompt":"Explain another topic","response":"Unrelated answer","inputTokens":"500","durationMilliseconds":"2000","goalTurn":"false"}));
    assert_eq!(unrelated["ok"], true, "{unrelated}");
    assert_eq!(unrelated["result"]["goal"], completed["result"]["goal"]);
    assert_eq!(unrelated["result"]["messages"].as_array().unwrap().len(), 4);
    let saved = host.request("thread", json!({"threadId":id}));
    assert_eq!(saved["result"]["goal"], completed["result"]["goal"]);
}

#[test]
fn audit_regression_legacy_records_preserve_history_and_jobs() {
    let mut host = Host::new();
    let now = Timestamp::now();
    let mut thread = Thread::new("Legacy conversation", now).unwrap();
    thread
        .push(ThreadMessage::new(ThreadRole::User, "emma-thread-format is my text", now).unwrap())
        .unwrap();
    let path = ThreadStore::new(host.root.join("threads"))
        .save(&thread)
        .unwrap();
    fs::write(
        path,
        thread
            .to_markdown()
            .replacen("shinbo-thread-format:", "emma-thread-format:", 1),
    )
    .unwrap();
    let job = ScheduledJob::new(
        "Legacy automation".into(),
        "manual".into(),
        "Keep my work".into(),
        String::new(),
        vec![],
        "ask".into(),
        now,
    )
    .unwrap();
    ScheduledJobStore::new(host.root.join("scheduled"))
        .save(&job)
        .unwrap();
    fs::write(
        host.root.join("scheduled").join(format!("{}.md", job.id)),
        job.to_markdown().replacen(
            "shinbo-scheduled-job-format:",
            "emma-scheduled-job-format:",
            1,
        ),
    )
    .unwrap();
    let snapshot = host.request("snapshot", json!({}));
    assert_eq!(snapshot["ok"], true);
    assert_eq!(snapshot["result"]["warnings"], json!([]));
    assert_eq!(snapshot["result"]["threads"], json!([thread]));
    assert_eq!(snapshot["result"]["scheduledJobs"], json!([job]));
}

#[test]
fn audit_regression_damaged_record_does_not_hide_healthy_library() {
    for folder in ["threads", "scheduled"] {
        let mut host = Host::new();
        let created = host.request("createThread", json!({"title":"Healthy conversation"}));
        assert_eq!(created["ok"], true);
        fs::create_dir_all(host.root.join(folder)).unwrap();
        fs::write(
            host.root.join(folder).join("1700000000-damaged-record.md"),
            [0xff],
        )
        .unwrap();
        for method in ["snapshot", "threadSummaries"] {
            let snapshot = host.request(method, json!({}));
            assert_eq!(snapshot["ok"], true, "{folder}: {snapshot}");
            assert_eq!(snapshot["result"]["threads"].as_array().unwrap().len(), 1);
            assert_eq!(snapshot["result"]["warnings"].as_array().unwrap().len(), 1);
        }
    }
}

#[test]
fn audit_regression_capacity_is_checked_before_starting_paid_work() {
    let mut host = Host::new();
    let now = Timestamp::now();
    let store = ThreadStore::new(host.root.join("threads"));
    let mut thread = Thread::new("Nearly full conversation", now).unwrap();
    for _ in 0..MAX_THREAD_MESSAGES - 3 {
        thread
            .push(ThreadMessage::new(ThreadRole::User, "Kept history", now).unwrap())
            .unwrap();
    }
    store.save(&thread).unwrap();
    assert_eq!(
        host.request("checkTurnCapacity", json!({"threadId":thread.id}))["ok"],
        true
    );
    for count in MAX_THREAD_MESSAGES - 2..=MAX_THREAD_MESSAGES {
        thread
            .push(ThreadMessage::new(ThreadRole::User, "Kept history", now).unwrap())
            .unwrap();
        store.save(&thread).unwrap();
        let response = host.request("checkTurnCapacity", json!({"threadId":thread.id}));
        assert_eq!(response["ok"], false, "{count}: {response}");
        assert!(response["error"].as_str().unwrap().contains("new thread"));
        assert_eq!(store.load(&thread.id).unwrap().messages.len(), count);
    }
}

#[test]
fn audit_regression_control_characters_do_not_lose_completed_turns() {
    let mut host = Host::new();
    let created = host.request("createThread", json!({"title":"Terminal output"}));
    let id = &created["result"]["id"];
    let response = host.request(
        "recordTurn",
        json!({
            "threadId":id,
            "prompt":"Explain \u{1b}[31mred\u{1b}[0m",
            "response":"Result: \u{0}red 🙂\n\t正常",
            "notice":"Stopped after \u{7}bell"
        }),
    );
    assert_eq!(response["ok"], true, "{response}");
    let messages = response["result"]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 3);
    assert!(messages[0]["content"].as_str().unwrap().contains("red"));
    assert!(
        messages[1]["content"]
            .as_str()
            .unwrap()
            .contains("🙂\n\t正常")
    );
    let reloaded = host.request("thread", json!({"threadId":id}));
    assert_eq!(
        reloaded["result"]["messages"],
        response["result"]["messages"]
    );
}

#[test]
fn audit_regression_cron_restricted_days_use_or() {
    let now = "2026-09-12T05:32:39Z".parse().unwrap();
    for (schedule, expected) in [
        ("0 0 1 * 1", "2026-09-14T00:00:00Z"),
        ("0 0 * * 1", "2026-09-14T00:00:00Z"),
        ("0 0 1 * *", "2026-10-01T00:00:00Z"),
        ("0 0 */2 * 1", "2026-09-21T00:00:00Z"),
        ("0 0 * * 7", "2026-09-13T00:00:00Z"),
    ] {
        let job = ScheduledJob::new(
            "Cron contract".into(),
            schedule.into(),
            "Run the task".into(),
            String::new(),
            vec![],
            "ask".into(),
            now,
        )
        .unwrap();
        assert_eq!(
            job.next_run_at,
            Some(expected.parse().unwrap()),
            "{schedule}"
        );
    }
}

#[test]
fn audit_regression_reset_cannot_grant_an_exhausted_goal_more_budget() {
    let mut host = Host::new();
    let created = host.request("createThread", json!({"title":"Budgeted work"}));
    let id = &created["result"]["id"];
    host.request(
        "setGoal",
        json!({"threadId":id,"objective":"Keep working","tokenBudget":"1000"}),
    );
    let spent = host.request(
        "recordTurn",
        json!({"threadId":id,"prompt":"Work","response":"A step","inputTokens":"1200"}),
    );
    assert_eq!(spent["result"]["goal"]["status"], "budgetLimited");
    for budget in [None, Some("200000")] {
        let mut params = json!({"threadId":id,"objective":"Keep working"});
        if let Some(budget) = budget {
            params["tokenBudget"] = budget.into();
        }
        host.request("setGoal", params);
        let current = host.request("thread", json!({"threadId":id}));
        assert_eq!(current["result"]["goal"], spent["result"]["goal"]);
    }
    let extended = host.request("updateGoal", json!({"threadId":id,"extraTokens":"1000"}));
    assert_eq!(extended["result"]["goal"]["tokenBudget"], 2000);
    assert_eq!(extended["result"]["goal"]["status"], "active");
}

#[test]
fn audit_regression_delayed_automatic_name_preserves_user_title_atomically() {
    let mut host = Host::new();
    let created = host.request("createThread", json!({}));
    let id = &created["result"]["id"];
    let original = &created["result"]["title"];
    let generated = host.request(
        "renameThread",
        json!({"threadId":id,"title":"Generated title","expectedTitle":original}),
    );
    assert_eq!(generated["ok"], true, "{generated}");
    assert_eq!(generated["result"]["title"], "Generated title");
    let manual = host.request(
        "renameThread",
        json!({"threadId":id,"title":"My chosen title"}),
    );
    assert_eq!(manual["ok"], true);
    let late = host.request(
        "renameThread",
        json!({"threadId":id,"title":"Late automatic title","expectedTitle":original}),
    );
    assert_eq!(late["ok"], true, "{late}");
    assert_eq!(late["result"]["title"], "My chosen title");
    let saved = host.request("thread", json!({"threadId":id}));
    assert_eq!(saved["result"]["title"], "My chosen title");
}

#[test]
fn round_five_large_trace_survives_the_host_envelope() {
    let mut host = Host::new();
    let created = host.request("createThread", json!({"title":"Long tool run"}));
    let id = &created["result"]["id"];
    for line in ["tool completed\n", "{\"output\":\"🙂漢字\\\"\"}\n"] {
        let trace = line.repeat(shinbo_core::MAX_TRACE_BYTES / line.len());
        let written = host.request("recordTrace", json!({"threadId":id,"trace":trace}));
        assert_eq!(written["ok"], true, "{written}");
        let saved = host.request("readTrace", json!({"threadId":id}));
        assert_eq!(
            saved["result"].as_array().unwrap().last().unwrap()["text"],
            trace
        );
    }
    let excessive = host.request(
        "renameThread",
        json!({"threadId":id,"title":"x".repeat(140 * 1024)}),
    );
    assert_eq!(excessive["ok"], false);
    assert_eq!(excessive["error"], "request is too large");
    assert_eq!(host.request("thread", json!({"threadId":id}))["ok"], true);
}

#[test]
fn round_five_numeric_cron_steps_extend_from_start_to_field_end() {
    let now = "2026-09-12T05:32:39Z".parse().unwrap();
    for (schedule, expected) in [
        ("5/10 * * * *", "2026-09-12T05:35:00Z"),
        ("5 * * * *", "2026-09-12T06:05:00Z"),
        ("0 1/3 * * *", "2026-09-12T07:00:00Z"),
        ("0 0 15/5 * *", "2026-09-15T00:00:00Z"),
        ("0 0 1 2/3 *", "2026-11-01T00:00:00Z"),
        ("0 0 * * 1/2", "2026-09-13T00:00:00Z"),
    ] {
        let job = ScheduledJob::new(
            "Stepped schedule".into(),
            schedule.into(),
            "A harmless reminder".into(),
            String::new(),
            vec![],
            "ask".into(),
            now,
        )
        .unwrap();
        assert_eq!(
            job.next_run_at,
            Some(expected.parse().unwrap()),
            "{schedule}"
        );
    }
}

#[test]
fn round_five_leap_day_jobs_book_and_advance_beyond_one_year() {
    for (start, expected, following) in [
        (
            "2026-09-12T05:32:39Z",
            "2028-02-29T00:00:00Z",
            "2032-02-29T00:00:00Z",
        ),
        (
            "2096-03-01T00:00:00Z",
            "2104-02-29T00:00:00Z",
            "2108-02-29T00:00:00Z",
        ),
    ] {
        let mut job = ScheduledJob::new(
            "Leap-day reminder".into(),
            "0 0 29 2 *".into(),
            "A harmless reminder".into(),
            String::new(),
            vec![],
            "ask".into(),
            start.parse().unwrap(),
        )
        .unwrap();
        assert_eq!(job.next_run_at, Some(expected.parse().unwrap()));
        assert!(job.claim_run(expected.parse().unwrap()).unwrap());
        assert_eq!(job.next_run_at, Some(following.parse().unwrap()));
    }
    let rare = ScheduledJob::new(
        "Leap Sunday".into(),
        "0 0 29 2 */7".into(),
        "A harmless reminder".into(),
        String::new(),
        vec![],
        "ask".into(),
        "2088-03-01T00:00:00Z".parse().unwrap(),
    )
    .unwrap();
    assert_eq!(
        rare.next_run_at,
        Some("2128-02-29T00:00:00Z".parse().unwrap())
    );
    assert!(
        ScheduledJob::new(
            "Impossible reminder".into(),
            "0 0 30 2 *".into(),
            "A harmless reminder".into(),
            String::new(),
            vec![],
            "ask".into(),
            Timestamp::now()
        )
        .is_err()
    );
    let weekday = ScheduledJob::new(
        "February Mondays".into(),
        "0 0 30 2 1".into(),
        "A harmless reminder".into(),
        String::new(),
        vec![],
        "ask".into(),
        "2026-09-12T00:00:00Z".parse().unwrap(),
    )
    .unwrap();
    assert_eq!(
        weekday.next_run_at,
        Some("2027-02-01T00:00:00Z".parse().unwrap())
    );
    let mut host = Host::new();
    let saved = host.request("saveScheduledJob", json!({"title":"Leap-day reminder","schedule":"0 0 29 2 *","prompt":"A harmless reminder","sourceDomains":"[]","permissionMode":"ask"}));
    assert_eq!(saved["ok"], true, "{saved}");
    assert!(
        saved["result"]["nextRunAt"]
            .as_str()
            .unwrap()
            .contains("-02-29T00:00:00Z")
    );
}

#[test]
fn round_five_whitespace_triggers_fire_for_new_and_existing_jobs() {
    let mut host = Host::new();
    let save = |schedule: String| json!({"title":"A harmless reminder","schedule":schedule,"prompt":"Keep a marker","sourceDomains":"[]","permissionMode":"ask"});
    let parent = host.request("saveScheduledJob", save("manual".into()));
    let parent_id = parent["result"]["id"].as_str().unwrap();
    let event = host.request("saveScheduledJob", save("on  startup  ".into()));
    let dependent = host.request("saveScheduledJob", save(format!("after  {parent_id}  ")));
    assert_eq!(event["ok"], true);
    assert_eq!(dependent["ok"], true);
    let store = ScheduledJobStore::new(host.root.join("scheduled"));
    for (created, schedule) in [
        (&event, "on \u{2003}startup\u{2003}".to_owned()),
        (&dependent, format!("after \t{parent_id}  ")),
    ] {
        let id =
            shinbo_core::ScheduledJobId::parse(created["result"]["id"].as_str().unwrap()).unwrap();
        let mut job = store.load(&id).unwrap();
        job.schedule = schedule;
        store.save(&job).unwrap();
    }
    let fired = host.request(
        "fireScheduledEvent",
        json!({"event":"startup","variables":""}),
    );
    host.request(
        "finishScheduledJob",
        json!({"jobId":parent_id,"outputs":"","depth":"0"}),
    );
    assert_eq!(host.events.len(), 2);
    assert_eq!(fired["result"].as_array().unwrap().len(), 1);
    let snapshot = host.request("snapshot", json!({}));
    let schedules: Vec<&str> = snapshot["result"]["scheduledJobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|job| job["schedule"].as_str().unwrap())
        .collect();
    assert!(schedules.contains(&"on startup"));
    assert!(schedules.contains(&format!("after {parent_id}").as_str()));
}
