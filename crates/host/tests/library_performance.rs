use serde_json::{Value, json};
use shinbo_core::{Thread, ThreadMessage, ThreadRole, ThreadStore, ThreadTrace, Timestamp};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    time::Instant,
};

fn response(output: &mut impl BufRead) -> Value {
    let mut assembled = String::new();
    loop {
        let mut line = String::new();
        assert!(output.read_line(&mut line).unwrap() > 0);
        let frame: Value = serde_json::from_str(&line).unwrap();
        let Some(chunk) = frame["chunk"].as_str() else {
            return frame;
        };
        assembled.push_str(chunk);
        if frame["end"] == true {
            return serde_json::from_str(&assembled).unwrap();
        }
    }
}

#[test]
#[ignore]
fn benchmark_library_summaries() {
    let root = std::env::temp_dir().join(format!("shinbo-library-perf-{}", std::process::id()));
    let now = Timestamp::now();
    let mut disk_bytes = 0;
    for index in 0..32 {
        let mut thread = Thread::new(format!("Conversation {index}"), now).unwrap();
        for message in 0..512 {
            let role = if message % 2 == 0 {
                ThreadRole::User
            } else {
                ThreadRole::Assistant
            };
            thread
                .push(ThreadMessage::new(role, "m".repeat(60_000), now).unwrap())
                .unwrap();
        }
        for _ in 0..4 {
            thread.record_trace(ThreadTrace::new(now, &"t".repeat(100_000)).unwrap());
        }
        let path = ThreadStore::new(root.join("threads"))
            .save(&thread)
            .unwrap();
        disk_bytes += std::fs::metadata(path).unwrap().len();
    }
    let mut child = Command::new(env!("CARGO_BIN_EXE_shinbo-host"))
        .env("SHINBO_DATA_DIR", &root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let mut samples = Vec::new();
    let mut summary_bytes = 0;
    for index in 0..6 {
        let start = Instant::now();
        writeln!(
            input,
            "{}",
            json!({"id":"summary", "method":"threadSummaries", "params":{}})
        )
        .unwrap();
        input.flush().unwrap();
        let result = response(&mut output);
        let elapsed = start.elapsed().as_micros();
        assert_eq!(result["ok"], true);
        let threads = result["result"]["threads"].as_array().unwrap();
        assert_eq!(threads.len(), 32);
        assert!(
            threads
                .iter()
                .all(|thread| thread["messages"] == 512 && thread["userMessageCount"] == 256)
        );
        summary_bytes = serde_json::to_vec(&result).unwrap().len();
        if index == 0 {
            println!("library summary first request: {elapsed} us");
        } else {
            samples.push(elapsed);
        }
    }
    drop(input);
    assert!(child.wait().unwrap().success());
    samples.sort_unstable();
    println!(
        "library {disk_bytes} disk bytes, {summary_bytes} response bytes: warm request median {} us",
        samples[2]
    );
    std::fs::remove_dir_all(root).unwrap();
}
