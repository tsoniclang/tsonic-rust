use std::cell::Cell;

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
    channel.port1.unref();
    channel.port1.r#ref();
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
