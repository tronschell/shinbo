use shinbo_core::{
    ScheduledJob, ScheduledJobStore, Thread, ThreadMessage, ThreadRole, ThreadStore, ThreadTrace,
    Timestamp, start_live_runtime,
};
use std::{hint::black_box, sync::Arc, time::Instant};

fn median(label: &str, count: usize, mut operation: impl FnMut()) {
    let mut samples = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        for _ in 0..count {
            operation();
        }
        samples.push(start.elapsed().as_micros());
    }
    samples.sort_unstable();
    println!("{label}: {count} operations median {} us", samples[2]);
}

#[test]
#[ignore]
fn benchmark_store_hot_paths() {
    let now: Timestamp = "2025-01-02T12:34:56Z".parse().unwrap();
    median("annual cron booking", 5, || {
        black_box(
            ScheduledJob::new(
                "Annual".into(),
                "0 0 1 1 *".into(),
                "Report".into(),
                String::new(),
                vec![],
                "ask".into(),
                now,
            )
            .unwrap(),
        );
    });
    let root = std::env::temp_dir().join(format!("shinbo-perf-store-{}", std::process::id()));
    let scheduled = ScheduledJobStore::new(root.join("scheduled"));
    for index in 0..50 {
        let job = ScheduledJob::new(
            format!("Job {index}"),
            "manual".into(),
            "p".repeat(8000),
            "n".repeat(32000),
            vec![],
            "ask".into(),
            now,
        )
        .unwrap();
        scheduled.save(&job).unwrap();
    }
    black_box(scheduled.list().unwrap());
    median("list 50 unchanged scheduled jobs", 20, || {
        black_box(scheduled.list().unwrap());
    });
    let mut thread = Thread::new("Long running task", now).unwrap();
    for _ in 0..1000 {
        thread
            .push(ThreadMessage::new(ThreadRole::User, "m".repeat(60_000), now).unwrap())
            .unwrap();
    }
    for _ in 0..64 {
        thread.record_trace(ThreadTrace::new(now, &"t".repeat(100_000)).unwrap());
    }
    ThreadStore::new(root.join("threads"))
        .save(&thread)
        .unwrap();
    let id = thread.id.clone();
    drop(thread);
    let live = start_live_runtime(
        root.join("threads"),
        root.join("runtime-scheduled"),
        Arc::new(|_| {}),
    )
    .unwrap();
    black_box(live.thread(id.clone()).unwrap());
    median(
        "load cached 60 MB conversation with 6.4 MB traces",
        10,
        || {
            black_box(live.thread(id.clone()).unwrap());
        },
    );
    median("read traces alongside 60 MB conversation", 10, || {
        black_box(live.read_trace(id.clone()).unwrap());
    });
    median(
        "refresh compact snapshot with selected 66.4 MB thread",
        5,
        || {
            black_box(live.snapshot_uncached().unwrap());
        },
    );
    drop(live);
    std::fs::remove_dir_all(root).unwrap();
}
