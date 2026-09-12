use serde_json::{Value, json};
use shinbo_core::{ScheduledJob, ScheduledJobStore, Thread, ThreadStore, Timestamp};
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

fn seed(root: &Path, title: &str) {
    let now = Timestamp::now();
    ThreadStore::new(root.join("threads"))
        .save(&Thread::new(title, now).unwrap())
        .unwrap();
    ScheduledJobStore::new(root.join("scheduled"))
        .save(
            &ScheduledJob::new(
                title.into(),
                "manual".into(),
                "Keep working".into(),
                String::new(),
                vec![],
                "ask".into(),
                now,
            )
            .unwrap(),
        )
        .unwrap();
}

fn check_profile(state: &str) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "shinbo-root-regression-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let app_data = if cfg!(windows) {
        root.clone()
    } else {
        root.join("Library/Application Support")
    };
    let old = app_data.join("Emma");
    let current = app_data.join("Shinbo");
    if ["old", "both", "empty-new"].contains(&state) {
        seed(&old, "Legacy work");
    }
    if ["new", "both"].contains(&state) {
        seed(&current, "Current work");
    }
    if state == "empty-new" {
        fs::create_dir_all(&current).unwrap();
    }
    let explicit_old = root.join("explicit-old");
    let explicit_new = root.join("explicit-new");
    if state.starts_with("override") {
        seed(&explicit_old, "Explicit legacy work");
        seed(&explicit_new, "Explicit current work");
    }
    let binary = std::env::var_os("SHINBO_PROFILE_TEST_HOST")
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_shinbo-host").into());
    let mut command = Command::new(binary);
    command
        .env("HOME", &root)
        .env("APPDATA", &root)
        .env_remove("SHINBO_DATA_DIR")
        .env_remove("EMMA_DATA_DIR");
    if state.starts_with("override") {
        command.env("EMMA_DATA_DIR", &explicit_old);
    }
    if state == "override-both" {
        command.env("SHINBO_DATA_DIR", &explicit_new);
    }
    if state == "override-invalid" {
        command.env("SHINBO_DATA_DIR", "");
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.take().unwrap(),
        "{}",
        json!({"id":"profile", "method":"snapshot", "params":{}})
    )
    .unwrap();
    let output = child.wait_with_output().unwrap();
    let expected = match state {
        "old" | "empty-new" => "Legacy work",
        "new" | "both" => "Current work",
        "override-old" => "Explicit legacy work",
        "override-both" => "Explicit current work",
        _ => "",
    };
    let _ = fs::remove_dir_all(&root);
    if state == "override-invalid" {
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("SHINBO_DATA_DIR must be"));
        return;
    }
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], true, "{state}: {response}");
    let count = if state == "fresh" { 0 } else { 1 };
    for key in ["threads", "scheduledJobs"] {
        let entries = response["result"][key].as_array().unwrap();
        assert_eq!(entries.len(), count, "{state}/{key}");
        if count > 0 {
            assert_eq!(entries[0]["title"], expected, "{state}/{key}");
        }
    }
}

#[test]
fn audit_regression_legacy_default_root_is_discovered_without_replacing_new_work() {
    for state in ["old", "new", "both", "empty-new", "fresh"] {
        check_profile(state);
    }
}

#[test]
fn audit_regression_explicit_legacy_root_is_used_only_without_a_new_override() {
    for state in ["override-old", "override-both", "override-invalid"] {
        check_profile(state);
    }
}
