use std::cell::Cell;

use tsonic_js::JsValue;
use tsonic_node::{process, readline, worker_threads};

#[test]
fn readline_interface_uses_explicit_input_and_output_buffers() {
    let mut interface = readline::create_interface(vec!["answer".to_string()]);
    assert_eq!(interface.question("name?").as_deref(), Some("answer"));
    interface.write("done");
    assert_eq!(
        interface.output(),
        &["name?".to_string(), "done".to_string()]
    );
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
    channel
        .port1
        .post_message(JsValue::String("hello".to_string()))
        .unwrap();
    assert_eq!(
        worker_threads::receive_message_on_port(&channel.port2),
        Some(JsValue::String("hello".to_string()))
    );
}

#[test]
fn worker_runs_rust_closure_and_reports_join_result() {
    let worker = worker_threads::Worker::spawn(|| 21 * 2);
    assert_eq!(worker.join().unwrap(), 42);
}
