use std::sync::{Arc, Mutex};

use tsonic_js::web::{
    AbortController, AbortSignal, AddEventListenerOptions, Blob, BlobPart, Body, CustomEvent,
    DomException, Event, EventInit, EventTarget, File, FormData, FormDataValue, Headers,
    ImportMeta, Navigator, Request, Response, Storage,
};
use tsonic_js::{JsObject, JsValue};

#[test]
fn abort_controller_and_signal_record_reason() {
    let controller = AbortController::new();
    let signal = controller.signal();
    assert!(!signal.aborted());

    controller.abort(JsValue::String("stop".to_string()));
    assert!(signal.aborted());
    assert_eq!(signal.reason(), JsValue::String("stop".to_string()));
    assert!(signal.throw_if_aborted().is_err());

    let already = AbortSignal::abort(JsValue::Number(1.0));
    let combined = AbortSignal::any(&[AbortSignal::new(), already]);
    assert!(combined.aborted());
    assert_eq!(combined.reason(), JsValue::Number(1.0));
}

#[test]
fn dom_exception_exposes_legacy_codes() {
    let error = DomException::new("nope", "AbortError");
    assert_eq!(error.name(), "AbortError");
    assert_eq!(error.message(), "nope");
    assert_eq!(error.code(), DomException::ABORT_ERR);

    let custom = DomException::new("custom", "ApplicationError");
    assert_eq!(custom.code(), 0);
}

#[test]
fn event_target_dispatches_and_removes_listeners() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut target = EventTarget::new();
    let first_seen = Arc::clone(&seen);
    let first = target.add_event_listener(
        "ready",
        move |event| {
            first_seen
                .lock()
                .unwrap()
                .push(event.event_type().to_string());
        },
        AddEventListenerOptions::default(),
    );
    let second_seen = Arc::clone(&seen);
    target.add_event_listener(
        "ready",
        move |event| {
            second_seen.lock().unwrap().push("once".to_string());
            event.prevent_default();
        },
        AddEventListenerOptions {
            once: true,
            ..Default::default()
        },
    );

    let mut event = Event::new(
        "ready",
        EventInit {
            cancelable: true,
            ..Default::default()
        },
    );
    assert!(!target.dispatch_event(&mut event));
    assert!(event.default_prevented());
    assert_eq!(
        seen.lock().unwrap().as_slice(),
        &["ready".to_string(), "once".to_string()]
    );

    let mut second = Event::new("ready", EventInit::default());
    assert!(target.dispatch_event(&mut second));
    assert_eq!(
        seen.lock().unwrap().as_slice(),
        &["ready".to_string(), "once".to_string(), "ready".to_string()]
    );

    assert!(target.remove_event_listener(first));
    let mut third = Event::new("ready", EventInit::default());
    assert!(target.dispatch_event(&mut third));
    assert_eq!(seen.lock().unwrap().len(), 3);
}

#[test]
fn custom_event_carries_detail_and_init_state() {
    let detail = JsValue::Object(JsObject::from_pairs([("id", JsValue::Number(1.0))]));
    let custom = CustomEvent::new(
        "selected",
        detail.clone(),
        EventInit {
            bubbles: true,
            cancelable: true,
            composed: true,
        },
    );
    assert_eq!(custom.event().event_type(), "selected");
    assert!(custom.event().bubbles());
    assert!(custom.event().cancelable());
    assert!(custom.event().composed());
    assert_eq!(custom.detail(), &detail);
}

#[test]
fn blob_file_and_body_cover_text_and_bytes() {
    let blob = Blob::new(
        &[
            BlobPart::Text("hello".to_string()),
            BlobPart::Bytes(vec![32, 119, 111, 114, 108, 100]),
        ],
        "TEXT/PLAIN",
    );
    assert_eq!(blob.size(), 11);
    assert_eq!(blob.content_type(), "text/plain");
    assert_eq!(blob.text().unwrap(), "hello world");
    assert_eq!(blob.array_buffer().as_bytes(), b"hello world");
    assert_eq!(blob.slice(6, None, "text/plain").text().unwrap(), "world");

    let file = File::new(
        &[BlobPart::Blob(blob.clone())],
        "greeting.txt",
        "text/plain",
        123,
    );
    assert_eq!(file.name(), "greeting.txt");
    assert_eq!(file.last_modified(), 123);
    assert_eq!(file.blob().text().unwrap(), "hello world");
    assert_eq!(file.size(), 11);
    assert_eq!(file.content_type(), "text/plain");
    assert_eq!(file.text().unwrap(), "hello world");
    assert_eq!(file.array_buffer().as_bytes(), b"hello world");

    assert_eq!(Body::Blob(blob).text().unwrap(), "hello world");
}

#[test]
fn headers_are_case_insensitive_and_ordered() {
    let mut headers = Headers::new();
    headers.append("Content-Type", "text/plain");
    headers.append("content-type", "charset=utf-8");
    headers.set("X-Test", "1");

    assert!(headers.has("CONTENT-TYPE"));
    assert_eq!(
        headers.get("content-type"),
        Some("text/plain, charset=utf-8".to_string())
    );
    assert_eq!(headers.get_all("x-test"), vec!["1".to_string()]);
    assert_eq!(
        headers.entries(),
        vec![
            (
                "content-type".to_string(),
                "text/plain, charset=utf-8".to_string()
            ),
            ("x-test".to_string(), "1".to_string())
        ]
    );
    let mut visited = Vec::new();
    headers.for_each(|value, key| visited.push(format!("{key}={value}")));
    assert_eq!(
        visited,
        vec![
            "content-type=text/plain, charset=utf-8".to_string(),
            "x-test=1".to_string()
        ]
    );
    headers.delete("x-test");
    assert!(!headers.has("x-test"));
}

#[test]
fn form_data_preserves_multiple_values() {
    let mut form = FormData::new();
    form.append("tag", FormDataValue::String("a".to_string()));
    form.append("tag", FormDataValue::String("b".to_string()));
    form.set("name", FormDataValue::String("Ada".to_string()));

    assert!(form.has("tag"));
    assert_eq!(form.get_all("tag").len(), 2);
    assert_eq!(
        form.keys(),
        vec!["tag".to_string(), "tag".to_string(), "name".to_string()]
    );
    assert_eq!(form.values().len(), 3);
    let mut visited = Vec::new();
    form.for_each(|value, key| {
        visited.push(match value {
            FormDataValue::String(value) => format!("{key}={value}"),
            FormDataValue::File(file) => format!("{key}={}", file.name()),
        });
    });
    assert_eq!(
        visited,
        vec![
            "tag=a".to_string(),
            "tag=b".to_string(),
            "name=Ada".to_string()
        ]
    );
    assert_eq!(
        Body::FormData(form).text().unwrap(),
        "tag=a&tag=b&name=Ada".to_string()
    );
}

#[test]
fn request_and_response_cover_fetch_carriers() {
    let mut headers = Headers::new();
    headers.set("accept", "application/json");
    let request = Request::with_init(
        "https://example.test/api",
        "post",
        headers.clone(),
        Body::Text("{\"ok\":true}".to_string()),
        None,
    );
    assert_eq!(request.method(), "POST");
    assert_eq!(request.url(), "https://example.test/api");
    assert_eq!(
        request.headers().get("accept"),
        Some("application/json".to_string())
    );
    assert_eq!(request.body().text().unwrap(), "{\"ok\":true}");
    assert_eq!(request.text().unwrap(), "{\"ok\":true}");
    assert_eq!(request.json().unwrap().inspect(), "{ok: true}");
    assert_eq!(request.array_buffer().as_bytes(), b"{\"ok\":true}");
    assert_eq!(request.clone_request().method(), "POST");

    let response = Response::json(&JsValue::Object(JsObject::from_pairs([(
        "ok",
        JsValue::Bool(true),
    )])))
    .unwrap();
    assert_eq!(response.status(), 200);
    assert!(response.ok());
    assert_eq!(
        response.headers().get("content-type"),
        Some("application/json".to_string())
    );
    assert_eq!(response.body().text().unwrap(), "{\"ok\":true}");
    assert_eq!(response.clone_response().status(), 200);
    assert_eq!(response.json_body().unwrap().inspect(), "{ok: true}");

    let redirect = Response::redirect("https://example.test/next", 302);
    assert_eq!(redirect.status(), 302);
    assert!(!redirect.ok());
    assert_eq!(
        redirect.headers().get("location"),
        Some("https://example.test/next".to_string())
    );
}

#[test]
fn storage_and_navigator_cover_common_web_globals() {
    let mut storage = Storage::new();
    storage.set_item("a", "1");
    storage.set_item("b", "2");
    assert_eq!(storage.length(), 2);
    assert_eq!(storage.key(0), Some("a".to_string()));
    assert_eq!(storage.get_item("b"), Some("2".to_string()));
    storage.remove_item("a");
    assert_eq!(storage.length(), 1);
    storage.clear();
    assert_eq!(storage.length(), 0);

    let navigator = Navigator::new();
    assert!(!navigator.user_agent().is_empty());
    assert!(!navigator.platform().is_empty());
    assert_eq!(navigator.language(), "en-US");
    assert!(navigator.hardware_concurrency() >= 1);
}

#[test]
fn import_meta_exposes_module_identity_and_safe_resolve() {
    let meta = ImportMeta::new(
        "file:///repo/src/app.ts",
        "/repo/src",
        "/repo/src/app.ts",
        true,
    );
    assert_eq!(meta.url(), "file:///repo/src/app.ts");
    assert_eq!(meta.dirname(), "/repo/src");
    assert_eq!(meta.filename(), "/repo/src/app.ts");
    assert!(meta.main());
    assert_eq!(meta.resolve("./dep.ts"), "file:///repo/src/./dep.ts");
    assert_eq!(meta.resolve("node:fs"), "node:fs");
    assert_eq!(meta.resolve("/tmp/x.ts"), "file:///tmp/x.ts");
}
