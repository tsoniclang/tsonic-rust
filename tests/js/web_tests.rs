use tsonic_js::web::{
    AbortController, AbortSignal, Blob, BlobPart, Body, DomException, File, FormData,
    FormDataValue, Headers, Navigator, Request, Response, Storage,
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
