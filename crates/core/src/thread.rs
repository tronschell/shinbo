use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    error::Error,
    fmt,
    fs::{self, Metadata, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    str::FromStr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{ScheduledJobId, Timestamp, ValidationError, append_quoted, unquote, validate_text};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct ThreadId(String);

impl ThreadId {
    pub fn parse(value: impl Into<String>) -> Result<Self, ValidationError> {
        let value = value.into();
        if value.len() < 16
            || value.len() > 96
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(ValidationError::new("thread ID is not a safe filename"));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn generate(now: Timestamp) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let sequence = NEXT.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        Self(format!(
            "{}-{:x}-{:x}-{sequence:x}",
            now.unix_seconds(),
            std::process::id(),
            nanos
        ))
    }
}

impl fmt::Display for ThreadId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadRole {
    User,
    Assistant,
    System,
}

impl ThreadRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::System => "system",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadKind {
    Main,
    Subagent,
}

impl ThreadKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Subagent => "subagent",
        }
    }
}

impl FromStr for ThreadKind {
    type Err = ValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "main" => Ok(Self::Main),
            "subagent" => Ok(Self::Subagent),
            _ => Err(ValidationError::new("unknown thread kind")),
        }
    }
}

const THREAD_FORMAT: u64 = 15;

pub const MAX_THREAD_MESSAGES: usize = 1_024;
pub const MAX_THREAD_TRACES: usize = 64;
pub const MAX_TRACE_BYTES: usize = 1024 * 1024;

pub const MAX_GOAL_OBJECTIVE_CHARS: usize = 2_000;
pub const MAX_GOAL_EVIDENCE_CHARS: usize = 4_000;
pub const MAX_GOAL_REASON_CHARS: usize = 1_000;
pub const DEFAULT_GOAL_TOKEN_BUDGET: u64 = 200_000;
pub const GOAL_BLOCKED_TURNS: u64 = 3;
pub const MAX_GOAL_TURNS: u64 = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GoalStatus {
    Active,
    Paused,
    Complete,
    Blocked,
    BudgetLimited,
    UsageLimited,
}

impl GoalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Complete => "complete",
            Self::Blocked => "blocked",
            Self::BudgetLimited => "budgetLimited",
            Self::UsageLimited => "usageLimited",
        }
    }

    pub fn pursuing(self) -> bool {
        self == Self::Active
    }

    pub fn settled(self) -> bool {
        matches!(self, Self::Complete | Self::Blocked)
    }
}

impl FromStr for GoalStatus {
    type Err = ValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "complete" => Ok(Self::Complete),
            "blocked" => Ok(Self::Blocked),
            "budgetLimited" => Ok(Self::BudgetLimited),
            "usageLimited" => Ok(Self::UsageLimited),
            _ => Err(ValidationError::new("unknown goal status")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub objective: String,
    pub status: GoalStatus,
    pub evidence: String,
    pub blocked_reason: String,
    pub blocked_streak: u64,
    pub blocked_at_turn: u64,
    pub token_budget: u64,
    pub tokens_used: u64,
    pub time_used_seconds: u64,
    pub turns: u64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

impl Goal {
    pub fn new(
        objective: impl Into<String>,
        token_budget: u64,
        at: Timestamp,
    ) -> Result<Self, ValidationError> {
        let objective = capped(
            "goal objective",
            objective.into(),
            MAX_GOAL_OBJECTIVE_CHARS,
            true,
        )?;
        Ok(Self {
            objective,
            status: GoalStatus::Active,
            evidence: String::new(),
            blocked_reason: String::new(),
            blocked_streak: 0,
            blocked_at_turn: 0,
            token_budget: match token_budget {
                0 => DEFAULT_GOAL_TOKEN_BUDGET,
                budget => budget,
            },
            tokens_used: 0,
            time_used_seconds: 0,
            turns: 0,
            created_at: at,
            updated_at: at,
        })
    }

    pub fn tokens_left(&self) -> u64 {
        self.token_budget.saturating_sub(self.tokens_used)
    }
}

fn capped(
    name: &str,
    value: String,
    max: usize,
    required: bool,
) -> Result<String, ValidationError> {
    let value: String = value.trim().chars().take(max).collect();
    validate_text(name, &value, required)?;
    Ok(value)
}

fn same_blocker(previous: &str, reason: &str) -> bool {
    !previous.is_empty() && previous.eq_ignore_ascii_case(reason)
}

impl FromStr for ThreadRole {
    type Err = ValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            "system" => Ok(Self::System),
            _ => Err(ValidationError::new("unknown thread message role")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTelemetry {
    pub output_tokens: u64,
    pub duration_milliseconds: u64,
    pub input_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_micro_usd: Option<u64>,
    pub model: String,
}

const MAX_MODEL_NAME_CHARS: usize = 128;

impl GenerationTelemetry {
    pub fn new(output_tokens: u64, duration_milliseconds: u64) -> Result<Self, ValidationError> {
        Self::measured(output_tokens, duration_milliseconds, 0, "")
    }

    pub fn measured(
        output_tokens: u64,
        duration_milliseconds: u64,
        input_tokens: u64,
        model: impl Into<String>,
    ) -> Result<Self, ValidationError> {
        if duration_milliseconds == 0 {
            return Err(ValidationError::new("generation duration must be positive"));
        }
        let model: String = model
            .into()
            .trim()
            .chars()
            .take(MAX_MODEL_NAME_CHARS)
            .collect();
        validate_text("generation model", &model, false)?;
        Ok(Self {
            output_tokens,
            duration_milliseconds,
            input_tokens,
            cache_read_tokens: None,
            cache_input_tokens: None,
            cache_write_tokens: None,
            cost_micro_usd: None,
            model,
        })
    }

    pub fn with_cache_usage(
        self,
        cache_read_tokens: Option<u64>,
        cache_input_tokens: Option<u64>,
    ) -> Result<Self, ValidationError> {
        self.with_provider_usage(cache_read_tokens, cache_input_tokens, None, None)
    }

    pub fn with_provider_usage(
        mut self,
        cache_read_tokens: Option<u64>,
        cache_input_tokens: Option<u64>,
        cache_write_tokens: Option<u64>,
        cost_micro_usd: Option<u64>,
    ) -> Result<Self, ValidationError> {
        match (cache_read_tokens, cache_input_tokens) {
            (None, None) => {}
            (Some(read), Some(input)) if read <= input => {}
            _ => return Err(ValidationError::new("generation cache usage is invalid")),
        }
        if let Some(write) = cache_write_tokens {
            let input = cache_input_tokens.unwrap_or(self.input_tokens);
            if write > input {
                return Err(ValidationError::new("generation cache usage is invalid"));
            }
        }
        self.cache_read_tokens = cache_read_tokens;
        self.cache_input_tokens = cache_input_tokens;
        self.cache_write_tokens = cache_write_tokens;
        self.cost_micro_usd = cost_micro_usd;
        Ok(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMessage {
    pub role: ThreadRole,
    pub content: String,
    pub timestamp: Timestamp,
    pub generation: Option<GenerationTelemetry>,
}

impl ThreadMessage {
    pub fn new(
        role: ThreadRole,
        content: impl Into<String>,
        timestamp: Timestamp,
    ) -> Result<Self, ValidationError> {
        let content = content.into();
        validate_text("thread message", &content, true)?;
        Ok(Self {
            role,
            content,
            timestamp,
            generation: None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTrace {
    pub timestamp: Timestamp,
    pub text: String,
}

impl ThreadTrace {
    pub fn new(timestamp: Timestamp, text: &str) -> Result<Self, ValidationError> {
        let text = elide_middle(text, MAX_TRACE_BYTES);
        validate_text("thread trace", &text, true)?;
        Ok(Self { timestamp, text })
    }
}

pub(crate) fn elide_middle(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let lines: Vec<&str> = text.lines().collect();
    let budget = max.saturating_sub(64);
    let mut head: Vec<&str> = Vec::new();
    let mut tail: Vec<&str> = Vec::new();
    let mut used = 0;
    let mut low = 0;
    let mut high = lines.len();
    while low < high {
        let from_head = head.len() <= tail.len();
        let line = if from_head {
            lines[low]
        } else {
            lines[high - 1]
        };
        if used + line.len() + 1 > budget {
            break;
        }
        used += line.len() + 1;
        if from_head {
            head.push(line);
            low += 1;
        } else {
            tail.push(line);
            high -= 1;
        }
    }
    if head.is_empty() && tail.is_empty() {
        let half = budget / 2;
        let mut start = half.min(text.len());
        while start > 0 && !text.is_char_boundary(start) {
            start -= 1;
        }
        let mut end = text.len().saturating_sub(half).max(start);
        while end < text.len() && !text.is_char_boundary(end) {
            end += 1;
        }
        return format!(
            "{}\n  … {} bytes elided …\n{}",
            &text[..start],
            end - start,
            &text[end..]
        );
    }
    tail.reverse();
    let note = format!("  … {} lines elided …", high - low);
    head.push(&note);
    head.extend(tail);
    head.join("\n")
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: ThreadId,
    pub title: String,
    pub parent_thread_id: Option<ThreadId>,
    pub kind: ThreadKind,
    pub scheduled_job_id: Option<ScheduledJobId>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub archived_at: Option<Timestamp>,
    pub goal: Option<Goal>,
    pub messages: Vec<ThreadMessage>,
    #[serde(skip)]
    pub traces: Vec<ThreadTrace>,
}

impl Thread {
    pub fn new(title: impl Into<String>, created_at: Timestamp) -> Result<Self, ValidationError> {
        let title = title.into();
        validate_text("thread title", &title, true)?;
        Ok(Self {
            id: ThreadId::generate(created_at),
            title,
            parent_thread_id: None,
            kind: ThreadKind::Main,
            scheduled_job_id: None,
            created_at,
            updated_at: created_at,
            archived_at: None,
            goal: None,
            messages: Vec::new(),
            traces: Vec::new(),
        })
    }

    pub fn record_trace(&mut self, trace: ThreadTrace) {
        self.traces.push(trace);
        while self.traces.len() > MAX_THREAD_TRACES {
            self.traces.remove(0);
        }
    }

    pub fn set_goal(
        &mut self,
        objective: impl Into<String>,
        token_budget: u64,
        at: Timestamp,
    ) -> Result<&Goal, ValidationError> {
        if self
            .goal
            .as_ref()
            .is_some_and(|goal| !goal.status.settled())
        {
            return Err(ValidationError::new(
                "this thread already has an unfinished goal; update or clear it first",
            ));
        }
        self.goal = Some(Goal::new(objective, token_budget, at)?);
        Ok(self.goal.as_ref().expect("a goal was just set"))
    }

    pub fn clear_goal(&mut self) -> bool {
        self.goal.take().is_some()
    }

    pub fn update_goal(
        &mut self,
        status: GoalStatus,
        evidence: &str,
        reason: &str,
        at: Timestamp,
    ) -> Result<&Goal, ValidationError> {
        let evidence = capped(
            "goal evidence",
            evidence.to_owned(),
            MAX_GOAL_EVIDENCE_CHARS,
            false,
        )?;
        let reason = capped(
            "goal blocker",
            reason.to_owned(),
            MAX_GOAL_REASON_CHARS,
            false,
        )?;
        let goal = self
            .goal
            .as_mut()
            .ok_or_else(|| ValidationError::new("this thread has no goal"))?;
        if goal.status == GoalStatus::Complete
            || (goal.status.settled() && status != GoalStatus::Active)
        {
            return Err(ValidationError::new(format!(
                "this goal is already {}",
                goal.status.as_str()
            )));
        }
        match status {
            GoalStatus::Complete => {
                if evidence.is_empty() {
                    return Err(ValidationError::new(
                        "a goal is complete only with evidence: what was run, what it printed, what changed",
                    ));
                }
                goal.evidence = evidence;
                goal.status = GoalStatus::Complete;
            }
            GoalStatus::Blocked => {
                let same = same_blocker(&goal.blocked_reason, &reason);
                if !same || goal.blocked_streak == 0 || goal.blocked_at_turn != goal.turns {
                    goal.blocked_streak =
                        match same && goal.blocked_at_turn.checked_add(1) == Some(goal.turns) {
                            true => goal.blocked_streak + 1,
                            false => 1,
                        };
                    goal.blocked_at_turn = goal.turns;
                }
                goal.blocked_reason = reason;
                goal.status = match goal.blocked_streak >= GOAL_BLOCKED_TURNS {
                    true => GoalStatus::Blocked,
                    false => GoalStatus::Active,
                };
            }
            GoalStatus::Active => {
                if goal.tokens_used >= goal.token_budget || goal.turns >= MAX_GOAL_TURNS {
                    return Err(ValidationError::new(
                        "this goal's allowance is exhausted; grant more tokens to continue",
                    ));
                }
                goal.status = GoalStatus::Active;
                goal.blocked_streak = 0;
                goal.blocked_reason = String::new();
                if !evidence.is_empty() {
                    goal.evidence = evidence;
                }
            }
            status => {
                goal.status = status;
                if !evidence.is_empty() {
                    goal.evidence = evidence;
                }
                if !reason.is_empty() {
                    goal.blocked_reason = reason;
                }
            }
        }
        goal.updated_at = at;
        Ok(self.goal.as_ref().expect("a goal was just updated"))
    }

    pub fn extend_goal(
        &mut self,
        extra_tokens: u64,
        at: Timestamp,
    ) -> Result<&Goal, ValidationError> {
        let goal = self
            .goal
            .as_mut()
            .ok_or_else(|| ValidationError::new("this thread has no goal"))?;
        if goal.status == GoalStatus::Complete {
            return Err(ValidationError::new("this goal is already complete"));
        }
        goal.token_budget = goal.token_budget.saturating_add(match extra_tokens {
            0 => DEFAULT_GOAL_TOKEN_BUDGET,
            tokens => tokens,
        });
        goal.status = GoalStatus::Active;
        goal.turns = 0;
        goal.blocked_streak = 0;
        goal.blocked_reason = String::new();
        goal.updated_at = at;
        Ok(self.goal.as_ref().expect("a goal was just extended"))
    }

    pub fn note_goal_turn(&mut self, tokens: u64, duration_milliseconds: u64, at: Timestamp) {
        let Some(goal) = self.goal.as_mut() else {
            return;
        };
        if goal.status == GoalStatus::Paused {
            return;
        }
        goal.turns += 1;
        goal.tokens_used = goal.tokens_used.saturating_add(tokens);
        goal.time_used_seconds = goal
            .time_used_seconds
            .saturating_add(duration_milliseconds / 1_000);
        goal.updated_at = at;
        if goal.status.pursuing()
            && (goal.tokens_used >= goal.token_budget || goal.turns >= MAX_GOAL_TURNS)
        {
            goal.status = GoalStatus::BudgetLimited;
        }
    }

    pub fn check_turn_capacity(&self) -> Result<(), ValidationError> {
        if self.messages.len() > MAX_THREAD_MESSAGES - 3 {
            return Err(ValidationError::new(
                "this conversation is full; start a new thread before running more work",
            ));
        }
        Ok(())
    }

    pub fn push(&mut self, message: ThreadMessage) -> Result<(), ValidationError> {
        if self.messages.len() >= MAX_THREAD_MESSAGES {
            return Err(ValidationError::new(format!(
                "thread cannot have more than {MAX_THREAD_MESSAGES} messages"
            )));
        }
        if message.generation.is_some() && message.role != ThreadRole::Assistant {
            return Err(ValidationError::new(
                "generation telemetry belongs only to assistant messages",
            ));
        }
        if message.timestamp < self.updated_at {
            return Err(ValidationError::new(
                "thread messages must be chronological",
            ));
        }
        self.updated_at = message.timestamp;
        self.messages.push(message);
        Ok(())
    }

    pub fn to_markdown(&self) -> String {
        let mut output = format!("---\nshinbo-thread-format: {THREAD_FORMAT}\n");
        field(&mut output, "id", self.id.as_str());
        field(&mut output, "title", &self.title);
        field(
            &mut output,
            "parent-thread-id",
            self.parent_thread_id
                .as_ref()
                .map_or("", |parent| parent.as_str()),
        );
        field(&mut output, "kind", self.kind.as_str());
        field(
            &mut output,
            "scheduled-job-id",
            self.scheduled_job_id
                .as_ref()
                .map_or("", |job| job.as_str()),
        );
        field(&mut output, "created-at", &self.created_at.to_string());
        field(&mut output, "updated-at", &self.updated_at.to_string());
        field(
            &mut output,
            "archived-at",
            &self
                .archived_at
                .map(|at| at.to_string())
                .unwrap_or_default(),
        );
        if let Some(goal) = &self.goal {
            field(&mut output, "goal-objective", &goal.objective);
            field(&mut output, "goal-status", goal.status.as_str());
            field(&mut output, "goal-evidence", &goal.evidence);
            field(&mut output, "goal-blocked-reason", &goal.blocked_reason);
            output.push_str(&format!("goal-blocked-streak: {}\n", goal.blocked_streak));
            output.push_str(&format!("goal-blocked-at-turn: {}\n", goal.blocked_at_turn));
            output.push_str(&format!("goal-token-budget: {}\n", goal.token_budget));
            output.push_str(&format!("goal-tokens-used: {}\n", goal.tokens_used));
            output.push_str(&format!(
                "goal-time-used-seconds: {}\n",
                goal.time_used_seconds
            ));
            output.push_str(&format!("goal-turns: {}\n", goal.turns));
            field(&mut output, "goal-created-at", &goal.created_at.to_string());
            field(&mut output, "goal-updated-at", &goal.updated_at.to_string());
        }
        output.push_str(&format!("message-count: {}\n", self.messages.len()));
        output.push_str(&format!("trace-count: {}\n---\n", self.traces.len()));
        for (index, message) in self.messages.iter().enumerate() {
            output.push_str(&format!("\n## Message {}\n\n", index + 1));
            output.push_str(&format!("Role: {}\n\n", message.role.as_str()));
            output.push_str(&format!("Time: {}\n\n", message.timestamp));
            if let Some(generation) = &message.generation {
                output.push_str("Generation: present\n");
                output.push_str(&format!("Output-Tokens: {}\n", generation.output_tokens));
                output.push_str(&format!(
                    "Duration-Milliseconds: {}\n",
                    generation.duration_milliseconds
                ));
                output.push_str(&format!("Input-Tokens: {}\n", generation.input_tokens));
                field(
                    &mut output,
                    "Cache-Read-Tokens",
                    &generation
                        .cache_read_tokens
                        .map(|tokens| tokens.to_string())
                        .unwrap_or_default(),
                );
                field(
                    &mut output,
                    "Cache-Input-Tokens",
                    &generation
                        .cache_input_tokens
                        .map(|tokens| tokens.to_string())
                        .unwrap_or_default(),
                );
                field(
                    &mut output,
                    "Cache-Write-Tokens",
                    &generation
                        .cache_write_tokens
                        .map(|tokens| tokens.to_string())
                        .unwrap_or_default(),
                );
                field(
                    &mut output,
                    "Cost-Micro-Usd",
                    &generation
                        .cost_micro_usd
                        .map(|cost| cost.to_string())
                        .unwrap_or_default(),
                );
                field(&mut output, "Model", &generation.model);
            } else {
                output.push_str("Generation: none\n");
            }
            output.push('\n');
            append_quoted(&mut output, &message.content);
            output.push('\n');
        }
        for (index, trace) in self.traces.iter().enumerate() {
            output.push_str(&format!("\n## Trace {}\n\n", index + 1));
            output.push_str(&format!("Time: {}\n\n", trace.timestamp));
            append_quoted(&mut output, &trace.text);
            output.push('\n');
        }
        output
    }

    pub fn from_markdown(markdown: &str) -> Result<Self, ValidationError> {
        let mut parser = Parser::new(markdown);
        parser.exact("---")?;
        let header = Header::read(&mut parser)?;
        let format = header.number(if header.0.contains_key("shinbo-thread-format") {
            "shinbo-thread-format"
        } else {
            "emma-thread-format"
        })?;
        if format == 0 || format > THREAD_FORMAT {
            return Err(ValidationError::new("unsupported thread format"));
        }
        let id = ThreadId::parse(header.field("id")?)?;
        let title = header.field("title")?;
        validate_text("thread title", &title, true)?;
        let parent_thread_id = match header.optional("parent-thread-id")? {
            value if value.is_empty() => None,
            value => Some(ThreadId::parse(value)?),
        };
        if parent_thread_id.as_ref() == Some(&id) {
            return Err(ValidationError::new("a thread cannot be its own parent"));
        }
        let kind = match header.optional("kind")?.as_str() {
            "" => match parent_thread_id {
                Some(_) => ThreadKind::Subagent,
                None => ThreadKind::Main,
            },
            value => value.parse()?,
        };
        if kind == ThreadKind::Subagent && parent_thread_id.is_none() {
            return Err(ValidationError::new("a subagent thread must have a parent"));
        }
        let scheduled_job_id = match header.optional("scheduled-job-id")? {
            value if value.is_empty() => None,
            value => Some(ScheduledJobId::parse(value)?),
        };
        let created_at = header.field("created-at")?.parse()?;
        let updated_at = header.field("updated-at")?.parse()?;
        let archived_at = match header.optional("archived-at")? {
            value if value.is_empty() => None,
            value => Some(value.parse()?),
        };
        let objective = header.optional("goal-objective")?;
        let goal = match objective.trim().is_empty() {
            true => None,
            false => Some(Goal {
                objective: capped("goal objective", objective, MAX_GOAL_OBJECTIVE_CHARS, true)?,
                status: match header.optional("goal-status")?.as_str() {
                    "" => GoalStatus::Active,
                    value => value.parse()?,
                },
                evidence: capped(
                    "goal evidence",
                    header.optional("goal-evidence")?,
                    MAX_GOAL_EVIDENCE_CHARS,
                    false,
                )?,
                blocked_reason: capped(
                    "goal blocker",
                    header.optional("goal-blocked-reason")?,
                    MAX_GOAL_REASON_CHARS,
                    false,
                )?,
                blocked_streak: header.optional_number("goal-blocked-streak")?,
                blocked_at_turn: header.optional_number("goal-blocked-at-turn")?,
                token_budget: match header.optional_number("goal-token-budget")? {
                    0 => DEFAULT_GOAL_TOKEN_BUDGET,
                    budget => budget,
                },
                tokens_used: header.optional_number("goal-tokens-used")?,
                time_used_seconds: header.optional_number("goal-time-used-seconds")?,
                turns: header.optional_number("goal-turns")?,
                created_at: match header.optional("goal-created-at")? {
                    value if value.is_empty() => created_at,
                    value => value.parse()?,
                },
                updated_at: match header.optional("goal-updated-at")? {
                    value if value.is_empty() => updated_at,
                    value => value.parse()?,
                },
            }),
        };
        let count: usize = header
            .number("message-count")?
            .try_into()
            .map_err(|_| ValidationError::new("message count is too large"))?;
        if count > MAX_THREAD_MESSAGES {
            return Err(ValidationError::new("thread message count is too large"));
        }
        let trace_count: usize = header
            .optional_number("trace-count")?
            .try_into()
            .map_err(|_| ValidationError::new("trace count is too large"))?;
        if trace_count > MAX_THREAD_TRACES {
            return Err(ValidationError::new("thread trace count is too large"));
        }
        let mut messages = Vec::with_capacity(count);
        let mut last = created_at;
        for index in 0..count {
            parser.exact("")?;
            parser.exact(&format!("## Message {}", index + 1))?;
            parser.exact("")?;
            let role = parser.prefixed("Role: ")?.parse()?;
            parser.exact("")?;
            let timestamp: Timestamp = parser.prefixed("Time: ")?.parse()?;
            parser.exact("")?;
            let generation = if format < 4 {
                None
            } else {
                let generation = match parser.prefixed("Generation: ")? {
                    "none" => None,
                    "present" => {
                        let output_tokens = parser.number("Output-Tokens")?;
                        let duration_milliseconds = parser.number("Duration-Milliseconds")?;
                        let input_tokens = if format < 7 {
                            0
                        } else {
                            parser.number("Input-Tokens")?
                        };
                        let cache_read_tokens = if format < 14 {
                            None
                        } else {
                            parser.optional_number("Cache-Read-Tokens")?
                        };
                        let cache_input_tokens = if format < 14 {
                            None
                        } else {
                            parser.optional_number("Cache-Input-Tokens")?
                        };
                        let cache_write_tokens = if format < 15 {
                            None
                        } else {
                            parser.optional_number("Cache-Write-Tokens")?
                        };
                        let cost_micro_usd = if format < 15 {
                            None
                        } else {
                            parser.optional_number("Cost-Micro-Usd")?
                        };
                        let model = if format < 11 {
                            String::new()
                        } else {
                            parser.field("Model")?
                        };
                        Some(
                            GenerationTelemetry::measured(
                                output_tokens,
                                duration_milliseconds,
                                input_tokens,
                                model,
                            )?
                            .with_provider_usage(
                                cache_read_tokens,
                                cache_input_tokens,
                                cache_write_tokens,
                                cost_micro_usd,
                            )?,
                        )
                    }
                    _ => return Err(ValidationError::new("unknown generation telemetry state")),
                };
                parser.exact("")?;
                generation
            };
            let content = unquote(parser.next()?)?;
            validate_text("thread message", &content, true)?;
            if timestamp < last {
                return Err(ValidationError::new(
                    "thread messages must be chronological",
                ));
            }
            if generation.is_some() && role != ThreadRole::Assistant {
                return Err(ValidationError::new(
                    "generation telemetry belongs only to assistant messages",
                ));
            }
            last = timestamp;
            messages.push(ThreadMessage {
                role,
                content,
                timestamp,
                generation,
            });
        }
        let mut traces = Vec::with_capacity(trace_count);
        for index in 0..trace_count {
            parser.exact("")?;
            parser.exact(&format!("## Trace {}", index + 1))?;
            parser.exact("")?;
            let timestamp: Timestamp = parser.prefixed("Time: ")?.parse()?;
            parser.exact("")?;
            let text = unquote(parser.next()?)?;
            traces.push(ThreadTrace::new(timestamp, &text)?);
        }
        if parser.lines.next().is_some() || updated_at != last {
            return Err(ValidationError::new(
                "thread updated timestamp does not match messages",
            ));
        }
        Ok(Self {
            id,
            title,
            parent_thread_id,
            kind,
            scheduled_job_id,
            created_at,
            updated_at,
            archived_at,
            goal,
            messages,
            traces,
        })
    }
}

#[derive(Debug)]
struct ParsedSummary {
    modified: SystemTime,
    length: u64,
    summary: Arc<ThreadSummary>,
}

#[derive(Debug)]
struct ParsedThread {
    modified: SystemTime,
    length: u64,
    thread: Arc<Thread>,
}

fn file_stamp(metadata: &Metadata) -> Option<(SystemTime, u64)> {
    Some((metadata.modified().ok()?, metadata.len()))
}

#[derive(Debug)]
pub struct ThreadStore {
    root: PathBuf,
    parsed: RefCell<HashMap<ThreadId, ParsedThread>>,
    last_read: RefCell<Option<ThreadId>>,
    summaries: RefCell<HashMap<ThreadId, ParsedSummary>>,
}

impl ThreadStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            parsed: RefCell::new(HashMap::new()),
            last_read: RefCell::new(None),
            summaries: RefCell::new(HashMap::new()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(test)]
    pub(crate) fn cached_len(&self) -> usize {
        self.parsed.borrow().len()
    }

    #[cfg(test)]
    pub(crate) fn clear_cache_for_test(&self) {
        self.parsed.borrow_mut().clear();
    }

    fn take_parsed(&self, id: &ThreadId, stamp: (SystemTime, u64)) -> Option<Arc<Thread>> {
        self.parsed
            .borrow()
            .get(id)
            .filter(|entry| (entry.modified, entry.length) == stamp)
            .map(|entry| Arc::clone(&entry.thread))
    }

    fn keep_parsed(&self, stamp: (SystemTime, u64), thread: Arc<Thread>) {
        self.parsed.borrow_mut().insert(
            thread.id.clone(),
            ParsedThread {
                modified: stamp.0,
                length: stamp.1,
                thread,
            },
        );
    }

    pub fn save(&self, thread: &Thread) -> Result<PathBuf, ThreadStoreError> {
        if thread.messages.len() > MAX_THREAD_MESSAGES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("thread cannot have more than {MAX_THREAD_MESSAGES} messages"),
            )
            .into());
        }
        if thread.traces.len() > MAX_THREAD_TRACES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("thread cannot have more than {MAX_THREAD_TRACES} traces"),
            )
            .into());
        }
        fs::create_dir_all(&self.root)?;
        let destination = self.path_for(&thread.id);
        let temporary = self.root.join(format!(".{}.tmp", thread.id));
        let result = (|| {
            match fs::remove_file(&temporary) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(thread.to_markdown().as_bytes())?;
            file.sync_all()?;
            fs::rename(&temporary, &destination)?;
            Ok(destination)
        })();
        match &result {
            Ok(written) => match fs::metadata(written).ok().and_then(|it| file_stamp(&it)) {
                Some(stamp) => self.keep_parsed(stamp, Arc::new(thread.clone())),
                None => {
                    self.parsed.borrow_mut().remove(&thread.id);
                }
            },
            Err(_) => {
                let _ = fs::remove_file(&temporary);
                self.parsed.borrow_mut().remove(&thread.id);
            }
        }
        self.summaries.borrow_mut().remove(&thread.id);
        result.map_err(ThreadStoreError::Io)
    }

    pub fn load(&self, id: &ThreadId) -> Result<Thread, ThreadStoreError> {
        self.read(id).map(|thread| (*thread).clone())
    }

    pub(crate) fn read(&self, id: &ThreadId) -> Result<Arc<Thread>, ThreadStoreError> {
        let thread = self.cached(id)?;
        self.parsed.borrow_mut().retain(|cached, _| cached == id);
        *self.last_read.borrow_mut() = Some(id.clone());
        Ok(thread)
    }

    fn cached(&self, id: &ThreadId) -> Result<Arc<Thread>, ThreadStoreError> {
        let path = self.path_for(id);
        let stamp = fs::metadata(&path).ok().and_then(|it| file_stamp(&it));
        if let Some(thread) = stamp.and_then(|stamp| self.take_parsed(id, stamp)) {
            return Ok(thread);
        }
        let thread = Self::parse_file(&path, id)?;
        if let Some(stamp) = stamp {
            self.keep_parsed(stamp, Arc::clone(&thread));
        }
        Ok(thread)
    }

    fn parse_file(path: &Path, id: &ThreadId) -> Result<Arc<Thread>, ThreadStoreError> {
        let bytes = fs::read(path)?;
        let thread = std::str::from_utf8(&bytes)
            .map_err(|error| error.to_string())
            .and_then(|markdown| Thread::from_markdown(markdown).map_err(|error| error.to_string()))
            .map_err(|reason| {
                ThreadStoreError::Malformed(MalformedThread {
                    path: path.to_path_buf(),
                    reason,
                })
            })?;
        if &thread.id != id {
            return Err(ThreadStoreError::Malformed(MalformedThread {
                path: path.to_path_buf(),
                reason: "thread ID does not match filename".into(),
            }));
        }
        Ok(Arc::new(thread))
    }

    pub fn delete(&self, id: &ThreadId) -> Result<(), ThreadStoreError> {
        self.summaries.borrow_mut().remove(id);
        self.parsed.borrow_mut().remove(id);
        match fs::remove_file(self.path_for(id)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    pub fn list(&self) -> Result<ThreadListing, ThreadStoreError> {
        self.list_with_cache(true)
    }

    pub(crate) fn list_uncached(&self) -> Result<ThreadListing, ThreadStoreError> {
        self.parsed
            .borrow_mut()
            .retain(|id, _| self.last_read.borrow().as_ref() == Some(id));
        self.list_with_cache(false)
    }

    pub fn list_summaries(&self) -> Result<ThreadListing<Arc<ThreadSummary>>, ThreadStoreError> {
        self.parsed
            .borrow_mut()
            .retain(|id, _| self.last_read.borrow().as_ref() == Some(id));
        self.list_records(|path, id| {
            let stamp = fs::metadata(path)
                .ok()
                .and_then(|metadata| file_stamp(&metadata));
            if let Some(cached) = self.summaries.borrow().get(id)
                && stamp == Some((cached.modified, cached.length))
            {
                return Ok((cached.summary.updated_at, Arc::clone(&cached.summary)));
            }
            self.summaries.borrow_mut().remove(id);
            let thread = match stamp.and_then(|stamp| self.take_parsed(id, stamp)) {
                Some(thread) => thread,
                None => Self::parse_file(path, id)?,
            };
            let summary = Arc::new(ThreadSummary::from(thread.as_ref()));
            if let Some((modified, length)) = stamp {
                self.summaries.borrow_mut().insert(
                    id.clone(),
                    ParsedSummary {
                        modified,
                        length,
                        summary: Arc::clone(&summary),
                    },
                );
            }
            Ok((summary.updated_at, summary))
        })
    }

    fn list_with_cache(&self, cache_threads: bool) -> Result<ThreadListing, ThreadStoreError> {
        self.list_records(|path, id| {
            let thread = if cache_threads || self.last_read.borrow().as_ref() == Some(id) {
                self.cached(id)?
            } else {
                Self::parse_file(path, id)?
            };
            Ok((thread.updated_at, thread))
        })
    }

    fn list_records<T>(
        &self,
        mut load: impl FnMut(&Path, &ThreadId) -> Result<(Timestamp, T), ThreadStoreError>,
    ) -> Result<ThreadListing<T>, ThreadStoreError> {
        let mut listing = ThreadListing {
            threads: Vec::new(),
            malformed: Vec::new(),
        };
        let mut records = Vec::new();
        let mut present = HashSet::new();
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.parsed.borrow_mut().clear();
                self.summaries.borrow_mut().clear();
                return Ok(listing);
            }
            Err(error) => return Err(ThreadStoreError::Io(error)),
        };
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("md") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
                listing.malformed.push(MalformedThread {
                    path,
                    reason: "filename is not UTF-8".into(),
                });
                continue;
            };
            let id = match ThreadId::parse(stem) {
                Ok(id) => id,
                Err(error) => {
                    listing.malformed.push(MalformedThread {
                        path,
                        reason: error.to_string(),
                    });
                    continue;
                }
            };
            match load(&path, &id) {
                Ok((updated, record)) => {
                    present.insert(id.clone());
                    records.push((updated, id, record));
                }
                Err(ThreadStoreError::Malformed(thread)) => listing.malformed.push(thread),
                Err(ThreadStoreError::Io(error)) => return Err(ThreadStoreError::Io(error)),
            }
        }
        self.parsed
            .borrow_mut()
            .retain(|id, _| present.contains(id));
        self.summaries
            .borrow_mut()
            .retain(|id, _| present.contains(id));
        records.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.cmp(&left.1)));
        listing.threads = records.into_iter().map(|(_, _, record)| record).collect();
        listing
            .malformed
            .sort_by(|left, right| left.path.cmp(&right.path));
        Ok(listing)
    }

    fn path_for(&self, id: &ThreadId) -> PathBuf {
        self.root.join(format!("{id}.md"))
    }
}

#[derive(Debug)]
pub struct ThreadListing<T = Arc<Thread>> {
    pub threads: Vec<T>,
    pub malformed: Vec<MalformedThread>,
}

impl<T> Default for ThreadListing<T> {
    fn default() -> Self {
        Self {
            threads: Vec::new(),
            malformed: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct MalformedThread {
    pub path: PathBuf,
    pub reason: String,
}

#[derive(Debug)]
pub enum ThreadStoreError {
    Io(io::Error),
    Malformed(MalformedThread),
}

impl fmt::Display for ThreadStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => error.fmt(formatter),
            Self::Malformed(thread) => {
                write!(formatter, "{}: {}", thread.path.display(), thread.reason)
            }
        }
    }
}

impl Error for ThreadStoreError {}

impl From<io::Error> for ThreadStoreError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

fn field(output: &mut String, name: &str, value: &str) {
    output.push_str(name);
    output.push_str(": ");
    append_quoted(output, value);
    output.push('\n');
}

struct Header(HashMap<String, String>);

impl Header {
    fn read(parser: &mut Parser<'_>) -> Result<Self, ValidationError> {
        let mut fields = HashMap::new();
        loop {
            let line = parser.next()?;
            if line == "---" {
                return Ok(Self(fields));
            }
            if let Some((name, value)) = line.split_once(": ") {
                fields.insert(name.to_owned(), value.to_owned());
            }
        }
    }

    fn field(&self, name: &str) -> Result<String, ValidationError> {
        match self.0.get(name) {
            Some(value) => unquote(value),
            None => Err(ValidationError::new(format!("expected field {name}"))),
        }
    }

    fn optional(&self, name: &str) -> Result<String, ValidationError> {
        match self.0.get(name) {
            Some(value) => unquote(value),
            None => Ok(String::new()),
        }
    }

    fn number(&self, name: &str) -> Result<u64, ValidationError> {
        match self.0.get(name) {
            Some(value) => value
                .parse()
                .map_err(|_| ValidationError::new(format!("field {name} is not a number"))),
            None => Err(ValidationError::new(format!("expected field {name}"))),
        }
    }

    fn optional_number(&self, name: &str) -> Result<u64, ValidationError> {
        match self.0.contains_key(name) {
            true => self.number(name),
            false => Ok(0),
        }
    }
}

struct Parser<'a> {
    lines: std::str::Lines<'a>,
}

impl<'a> Parser<'a> {
    fn new(markdown: &'a str) -> Self {
        Self {
            lines: markdown.lines(),
        }
    }

    fn next(&mut self) -> Result<&'a str, ValidationError> {
        self.lines
            .next()
            .ok_or_else(|| ValidationError::new("thread ended unexpectedly"))
    }

    fn exact(&mut self, expected: &str) -> Result<(), ValidationError> {
        if self.next()? == expected {
            Ok(())
        } else {
            Err(ValidationError::new(format!("expected {expected:?}")))
        }
    }

    fn prefixed(&mut self, prefix: &str) -> Result<&'a str, ValidationError> {
        self.next()?
            .strip_prefix(prefix)
            .ok_or_else(|| ValidationError::new(format!("expected {prefix:?}")))
    }

    fn field(&mut self, name: &str) -> Result<String, ValidationError> {
        unquote(self.prefixed(&format!("{name}: "))?)
    }

    fn number(&mut self, name: &str) -> Result<u64, ValidationError> {
        self.prefixed(&format!("{name}: "))?
            .parse()
            .map_err(|_| ValidationError::new(format!("field {name} is not a number")))
    }

    fn optional_number(&mut self, name: &str) -> Result<Option<u64>, ValidationError> {
        let value = self.field(name)?;
        if value.is_empty() {
            return Ok(None);
        }
        value
            .parse()
            .map(Some)
            .map_err(|_| ValidationError::new(format!("field {name} is not a number")))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: ThreadId,
    pub title: String,
    pub parent_thread_id: Option<ThreadId>,
    pub kind: ThreadKind,
    pub scheduled_job_id: Option<ScheduledJobId>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub archived_at: Option<Timestamp>,
    pub goal: Option<Goal>,
    pub messages: usize,
    pub message_dates: Vec<Timestamp>,
    pub user_message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_brief: Option<String>,
}

fn sent_thread_body(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("[thread ") else {
        return content;
    };
    let Some(marker_end) = rest.find(" messaged]\n") else {
        return content;
    };
    let sender = &rest[..marker_end];
    if !(1..=96).contains(&sender.len())
        || !sender
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return content;
    }
    &rest[marker_end + " messaged]\n".len()..]
}

fn normalized_prompt(content: &str, limit: usize) -> String {
    let mut normalized = String::new();
    let mut units = 0;
    let mut whitespace = false;
    for character in sent_thread_body(content).chars() {
        if character.is_whitespace() {
            whitespace = !normalized.is_empty();
            continue;
        }
        if whitespace {
            normalized.push(' ');
            units += 1;
            if units >= limit {
                break;
            }
        }
        normalized.push(character);
        units += character.len_utf16();
        if units >= limit {
            break;
        }
        whitespace = false;
    }
    normalized
}

const SEARCHABLE_TITLE_UNITS: usize = 200;

fn display_title(content: &str) -> String {
    if content.encode_utf16().count() <= 48 {
        return content.to_owned();
    }
    let mut title = String::new();
    let mut units = 0;
    for character in content.chars() {
        let width = character.len_utf16();
        if units + width > 47 {
            break;
        }
        title.push(character);
        units += width;
    }
    title.push('…');
    title
}

fn utf16_prefix(content: &str, limit: usize) -> String {
    let mut prefix = String::new();
    let mut units = 0;
    for character in content.chars() {
        if units >= limit {
            break;
        }
        prefix.push(character);
        units += character.len_utf16();
    }
    prefix
}

impl From<&Thread> for ThreadSummary {
    fn from(thread: &Thread) -> Self {
        let default_title = thread.title.trim().is_empty() || thread.title.trim() == "New thread";
        let first_user_message = (default_title || thread.kind == ThreadKind::Subagent)
            .then(|| {
                thread
                    .messages
                    .iter()
                    .find(|message| message.role == ThreadRole::User)
            })
            .flatten()
            .map(|message| {
                normalized_prompt(
                    &message.content,
                    if thread.kind == ThreadKind::Subagent {
                        usize::MAX
                    } else {
                        SEARCHABLE_TITLE_UNITS
                    },
                )
            });
        let display_title = if default_title {
            first_user_message
                .as_deref()
                .map(display_title)
                .filter(|content| !content.is_empty())
        } else {
            None
        };
        let label_prompt = if default_title {
            first_user_message
                .as_deref()
                .filter(|content| content.encode_utf16().count() > 48)
                .map(|content| utf16_prefix(content, SEARCHABLE_TITLE_UNITS))
        } else {
            None
        };
        Self {
            id: thread.id.clone(),
            title: thread.title.clone(),
            parent_thread_id: thread.parent_thread_id.clone(),
            kind: thread.kind,
            scheduled_job_id: thread.scheduled_job_id.clone(),
            created_at: thread.created_at,
            updated_at: thread.updated_at,
            archived_at: thread.archived_at,
            goal: thread.goal.clone(),
            messages: thread.messages.len(),
            message_dates: thread
                .messages
                .iter()
                .map(|message| message.timestamp)
                .collect(),
            user_message_count: thread
                .messages
                .iter()
                .filter(|message| message.role == ThreadRole::User)
                .count(),
            display_title,
            label_prompt,
            subagent_brief: (thread.kind == ThreadKind::Subagent)
                .then_some(first_user_message)
                .flatten()
                .filter(|content| !content.is_empty()),
        }
    }
}

#[cfg(test)]
mod summary_tests {
    use super::*;

    #[test]
    fn targeted_library_reads_retain_only_the_last_full_record() {
        let root = std::env::temp_dir().join(format!(
            "shinbo-targeted-library-cache-{}",
            std::process::id()
        ));
        let now = Timestamp::now();
        let writer = ThreadStore::new(root.clone());
        for index in 0..64 {
            let mut thread = Thread::new(format!("Library {index}"), now).unwrap();
            thread
                .push(ThreadMessage::new(ThreadRole::User, "x".repeat(16 * 1024), now).unwrap())
                .unwrap();
            thread.record_trace(ThreadTrace::new(now, &"t".repeat(8 * 1024)).unwrap());
            writer.save(&thread).unwrap();
        }
        drop(writer);
        let store = ThreadStore::new(root.clone());
        let summaries = store.list_summaries().unwrap();
        assert_eq!(summaries.threads.len(), 64);
        assert!(store.parsed.borrow().is_empty());
        for summary in &summaries.threads {
            let thread = store.read(&summary.id).unwrap();
            assert_eq!(thread.messages[0].content.len(), 16 * 1024);
            assert_eq!(thread.traces[0].text.len(), 8 * 1024);
        }
        let retained = store.parsed.borrow();
        let records = retained.len();
        let bytes: usize = retained
            .values()
            .map(|entry| {
                entry
                    .thread
                    .messages
                    .iter()
                    .map(|message| message.content.len())
                    .sum::<usize>()
                    + entry
                        .thread
                        .traces
                        .iter()
                        .map(|trace| trace.text.len())
                        .sum::<usize>()
            })
            .sum();
        drop(retained);
        println!("targeted library cache: {records} records, {bytes} payload bytes");
        assert_eq!((records, bytes), (1, 24 * 1024));
        let last = store.read(&summaries.threads.last().unwrap().id).unwrap();
        store.list_summaries().unwrap();
        assert!(Arc::ptr_eq(&last, &store.read(&last.id).unwrap()));
        let first = store.read(&summaries.threads[0].id).unwrap();
        assert_eq!(last.messages[0].content.len(), 16 * 1024);
        assert_eq!(first.messages[0].content.len(), 16 * 1024);
        assert_eq!(store.parsed.borrow().len(), 1);
        assert!(
            store
                .read(&ThreadId::parse("missing-fixture-0000").unwrap())
                .is_err()
        );
        assert!(Arc::ptr_eq(&first, &store.read(&first.id).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn summary_cache_keeps_projection_and_observes_every_file_change() {
        let root =
            std::env::temp_dir().join(format!("shinbo-summary-cache-{}", std::process::id()));
        let now = Timestamp::now();
        let mut first = Thread::new("New thread", now).unwrap();
        first
            .push(ThreadMessage::new(ThreadRole::User, "hello world", now).unwrap())
            .unwrap();
        first.record_trace(ThreadTrace::new(now, &"trace".repeat(20_000)).unwrap());
        let second = Thread::new("Other", now).unwrap();
        let writer = ThreadStore::new(root.clone());
        writer.save(&first).unwrap();
        writer.save(&second).unwrap();
        drop(writer);
        let store = ThreadStore::new(root.clone());
        let summaries = store.list_summaries().unwrap();
        let projected = summaries
            .threads
            .iter()
            .find(|thread| thread.id == first.id)
            .unwrap();
        assert_eq!(**projected, ThreadSummary::from(&first));
        assert!(store.parsed.borrow().is_empty());
        let again = store.list_summaries().unwrap();
        assert!(Arc::ptr_eq(
            projected,
            again
                .threads
                .iter()
                .find(|thread| thread.id == first.id)
                .unwrap()
        ));
        assert_eq!(store.summaries.borrow().len(), 2);
        let path = store.path_for(&first.id);
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        first.messages[0].content = "HELLO WORLD".into();
        fs::write(&path, first.to_markdown()).unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(modified + std::time::Duration::from_secs(1))
            .unwrap();
        let changed = store.list_summaries().unwrap();
        assert_eq!(
            changed
                .threads
                .iter()
                .find(|thread| thread.id == first.id)
                .unwrap()
                .display_title
                .as_deref(),
            Some("HELLO WORLD")
        );
        first.title = "Saved title".into();
        store.save(&first).unwrap();
        assert_eq!(
            store
                .list_summaries()
                .unwrap()
                .threads
                .iter()
                .find(|thread| thread.id == first.id)
                .unwrap()
                .title,
            "Saved title"
        );
        fs::write(&path, "malformed").unwrap();
        let malformed = store.list_summaries().unwrap();
        assert_eq!(malformed.malformed.len(), 1);
        assert_eq!(malformed.threads.len(), 1);
        assert!(!store.summaries.borrow().contains_key(&first.id));
        fs::remove_file(store.path_for(&second.id)).unwrap();
        assert!(store.list_summaries().unwrap().threads.is_empty());
        assert!(store.summaries.borrow().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn summary_normalization_bounds_main_prompts_and_preserves_subagent_briefs() {
        assert_eq!(
            normalized_prompt("  hello\n\t🙂 world  ", 100),
            "hello 🙂 world"
        );
        assert_eq!(normalized_prompt("a  b", 2), "a ");
        assert_eq!(normalized_prompt("🙂x", 1), "🙂");
        let now = Timestamp::now();
        let prompt = "word ".repeat(12_000);
        let mut thread = Thread::new("New thread", now).unwrap();
        thread
            .push(ThreadMessage::new(ThreadRole::User, &prompt, now).unwrap())
            .unwrap();
        assert_eq!(
            ThreadSummary::from(&thread)
                .label_prompt
                .unwrap()
                .encode_utf16()
                .count(),
            SEARCHABLE_TITLE_UNITS
        );
        thread.title = "Named".into();
        let summary = ThreadSummary::from(&thread);
        assert!(
            summary.label_prompt.is_none()
                && summary.display_title.is_none()
                && summary.subagent_brief.is_none()
        );
        thread.kind = ThreadKind::Subagent;
        assert_eq!(
            ThreadSummary::from(&thread).subagent_brief.unwrap(),
            prompt.trim()
        );
    }

    #[test]
    #[ignore]
    fn benchmark_thread_summary_prompts() {
        let now = Timestamp::now();
        let mut thread = Thread::new("New thread", now).unwrap();
        thread
            .push(ThreadMessage::new(ThreadRole::User, "word ".repeat(12_000), now).unwrap())
            .unwrap();
        for title in ["New thread", "Named thread"] {
            thread.title = title.into();
            let mut samples = Vec::new();
            for _ in 0..5 {
                let start = std::time::Instant::now();
                for _ in 0..1000 {
                    std::hint::black_box(ThreadSummary::from(std::hint::black_box(&thread)));
                }
                samples.push(start.elapsed().as_micros());
            }
            samples.sort_unstable();
            println!("summary {title}: 1000 operations median {} us", samples[2]);
        }
    }

    #[test]
    fn thread_summary_keeps_renderer_label_rules() {
        fn summary(prompt: &str) -> ThreadSummary {
            let now = Timestamp::now();
            let mut thread = Thread::new("New thread", now).unwrap();
            thread
                .push(ThreadMessage::new(ThreadRole::User, prompt, now).unwrap())
                .unwrap();
            ThreadSummary::from(&thread)
        }

        let forty_eight = "a".repeat(48);
        assert_eq!(
            summary(&forty_eight).display_title.as_deref(),
            Some(forty_eight.as_str())
        );
        let forty_nine = "a".repeat(49);
        let expected = format!("{}…", "a".repeat(47));
        assert_eq!(
            summary(&forty_nine).display_title.as_deref(),
            Some(expected.as_str())
        );
        let emoji = "🙂".repeat(24);
        assert_eq!(
            summary(&emoji).display_title.as_deref(),
            Some(emoji.as_str())
        );
        let split = format!("{emoji}x");
        assert!(summary(&split).label_prompt.is_some());
        let buried = "Draft a one page memo for the pricing committee on semiconductor supply";
        let summarised = summary(buried);
        assert!(!summarised.display_title.unwrap().contains("semiconductor"));
        assert_eq!(summarised.label_prompt.as_deref(), Some(buried));
        let long = "word ".repeat(80);
        assert_eq!(
            summary(&long).label_prompt.unwrap().encode_utf16().count(),
            SEARCHABLE_TITLE_UNITS
        );
        assert_eq!(
            summary("[thread short! messaged]\nhello")
                .display_title
                .as_deref(),
            Some("[thread short! messaged] hello")
        );
        assert_eq!(
            summary("[thread short-id messaged]\nhello")
                .display_title
                .as_deref(),
            Some("hello")
        );
    }
}
