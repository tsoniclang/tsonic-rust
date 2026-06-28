use std::cell::Cell;
use std::collections::BTreeMap;

use tsonic_js::JsValue;
use tsonic_node::{process, readline, worker_threads};

#[test]
fn readline_interface_uses_explicit_input_and_output_buffers() {
    let mut interface = readline::create_interface(vec!["answer".to_string(), "line2".to_string()]);
    assert_eq!(interface.question("name?").as_deref(), Some("answer"));
    interface.write("done");
    assert_eq!(
        interface.output(),
        &["name?".to_string(), "done".to_string()]
    );
    assert_eq!(interface.line(), "done");
    assert_eq!(interface.cursor(), 4);
    assert_eq!(interface.get_cursor_pos().cols, 4);
    interface.set_prompt("next> ");
    assert_eq!(interface.get_prompt(), "next> ");
    interface.prompt(false);
    assert_eq!(interface.output().last().unwrap(), "next> ");
    interface.write_key(
        None,
        Some(readline::Key {
            sequence: Some("!".to_string()),
            name: Some("bang".to_string()),
            ctrl: false,
            meta: false,
            shift: true,
        }),
    );
    assert_eq!(interface.line(), "done!");
    interface.set_terminal(true);
    assert!(interface.terminal());
    assert_eq!(interface.next_line().as_deref(), Some("line2"));
    interface.pause();
    assert!(interface.paused());
    interface.write("ignored");
    assert_eq!(interface.next_line(), None);
    interface.resume();
    assert!(!interface.paused());
    assert!(interface.remaining_lines().is_empty());
    interface.close();
    assert!(interface.closed());
    assert_eq!(interface.question("again?"), None);

    let mut terminal = readline::promises::create_readline(false);
    terminal
        .clear_line(0)
        .cursor_to(2, Some(1))
        .move_cursor(-1, 0);
    assert_eq!(terminal.stream().len(), 0);
    assert_eq!(terminal.pending().len(), 3);
    terminal.rollback();
    assert_eq!(terminal.pending().len(), 0);
    terminal.clear_screen_down().commit();
    assert_eq!(terminal.stream(), &["clearScreenDown".to_string()]);

    let mut auto = readline::Readline::new(true);
    assert!(auto.auto_commit());
    auto.cursor_to(1, None);
    assert_eq!(auto.stream(), &["cursorTo:1:0".to_string()]);

    let configured = readline::Readline::with_options(readline::ReadlineOptions {
        input: Some("stdin".to_string()),
        output: Some("stdout".to_string()),
        terminal: true,
        completer: Some("word-completer".to_string()),
        auto_commit: true,
    });
    assert_eq!(configured.options().input.as_deref(), Some("stdin"));
    assert_eq!(configured.options().output.as_deref(), Some("stdout"));
    assert!(configured.options().terminal);
    assert_eq!(
        configured.options().completer.as_deref(),
        Some("word-completer")
    );
}

#[test]
fn process_next_tick_executes_without_event_loop_guessing() {
    let called = Cell::new(false);
    process::next_tick(|| called.set(true));
    assert!(called.get());
}

#[test]
fn worker_message_channel_moves_closed_js_values() {
    let channel = worker_threads::MessageChannel::new();
    channel.port1.start();
    assert!(channel.port1.has_ref());
    channel.port1.unref();
    assert!(!channel.port1.has_ref());
    channel.port1.r#ref();
    assert!(channel.port1.has_ref());
    channel
        .port1
        .post_message(JsValue::String("hello".to_string()))
        .unwrap();
    assert_eq!(
        worker_threads::receive_message_on_port(&channel.port2),
        Some(JsValue::String("hello".to_string()))
    );
    assert!(worker_threads::is_main_thread());
    assert!(worker_threads::parent_port().is_none());
    assert_eq!(worker_threads::worker_data(), JsValue::Undefined);
}

#[test]
fn worker_broadcast_channel_is_closed_in_process_state() {
    let left = worker_threads::BroadcastChannel::new("updates");
    let right = worker_threads::BroadcastChannel::new("updates");
    assert_eq!(left.name(), "updates");
    left.post_message(JsValue::String("payload".to_string()));
    assert_eq!(
        right.receive_message(),
        Some(JsValue::String("payload".to_string()))
    );
    assert_eq!(right.receive_message(), None);
    left.close();
}

#[test]
fn worker_runs_rust_closure_and_reports_join_result() {
    let worker = worker_threads::Worker::spawn(|| 21 * 2);
    assert_eq!(worker.join().unwrap(), 42);
}

#[test]
fn worker_options_environment_and_transfer_markers_are_closed_state() {
    let mut env = BTreeMap::new();
    env.insert("MODE".to_string(), "test".to_string());
    let mut worker = worker_threads::Worker::spawn_with_options(
        || "done".to_string(),
        worker_threads::WorkerOptions {
            name: Some("compiler-worker".to_string()),
            argv: vec!["--job".to_string()],
            env,
            worker_data: JsValue::String("payload".to_string()),
            resource_limits: worker_threads::ResourceLimits {
                max_old_generation_size_mb: Some(256),
                max_young_generation_size_mb: Some(64),
                code_range_size_mb: Some(32),
                stack_size_mb: Some(8),
            },
        },
    );
    assert!(worker.thread_id() > 0);
    assert_eq!(worker.name(), Some("compiler-worker"));
    assert_eq!(
        worker.resource_limits().max_old_generation_size_mb,
        Some(256)
    );
    assert!(worker.has_ref());
    worker.unref();
    assert!(!worker.has_ref());
    worker.r#ref();
    assert!(worker.has_ref());
    assert_eq!(worker.join().unwrap(), "done");

    worker_threads::set_environment_data("runtime", JsValue::String("rust".to_string()));
    assert_eq!(
        worker_threads::get_environment_data("runtime"),
        Some(JsValue::String("rust".to_string()))
    );
    worker_threads::mark_as_untransferable_token("buffer-1");
    assert!(worker_threads::is_marked_as_untransferable_token(
        "buffer-1"
    ));

    let channel = worker_threads::MessageChannel::new();
    let moved = worker_threads::move_message_port_to_context(channel.port1);
    moved.post_message(JsValue::Number(1.0)).unwrap();
    assert_eq!(channel.port2.receive_message(), Some(JsValue::Number(1.0)));
}
