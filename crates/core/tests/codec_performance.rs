use shinbo_core::{Thread, ThreadMessage, ThreadRole, ThreadStore, Timestamp};
use std::{hint::black_box, time::Instant};

fn median(label: &str, mut operation: impl FnMut()) {
    let mut samples = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        operation();
        samples.push(start.elapsed().as_micros());
    }
    samples.sort_unstable();
    println!("{label}: median {} us", samples[2]);
}

#[test]
#[ignore]
fn benchmark_persisted_transcript_codec() {
    let now = Timestamp::now();
    let line = format!(
        "{}\n",
        "A saved explanation about the repository and its behavior. ".repeat(10)
    );
    let body = line.repeat(100);
    assert!(body.len() < 60_000);
    let mut thread = Thread::new("Long persisted conversation", now).unwrap();
    for index in 0..1000 {
        let role = if index % 2 == 0 {
            ThreadRole::User
        } else {
            ThreadRole::Assistant
        };
        thread
            .push(ThreadMessage::new(role, body.clone(), now).unwrap())
            .unwrap();
    }
    let markdown = thread.to_markdown();
    assert_eq!(Thread::from_markdown(&markdown).unwrap(), thread);
    println!(
        "fixture: {} content bytes, {} Markdown bytes, 1000 messages",
        body.len() * 1000,
        markdown.len()
    );
    median("encode full transcript", || {
        black_box(thread.to_markdown());
    });
    median("decode full transcript", || {
        black_box(Thread::from_markdown(&markdown).unwrap());
    });
    let root = std::env::temp_dir().join(format!("shinbo-codec-perf-{}", std::process::id()));
    let store = ThreadStore::new(root.clone());
    store.save(&thread).unwrap();
    median("atomic transcript save including sync and cache", || {
        black_box(store.save(&thread).unwrap());
    });
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}
