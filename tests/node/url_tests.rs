use tsonic_node::url::{Url, UrlSearchParams};

#[test]
fn url_parses_common_absolute_and_base_forms() {
    let url = Url::parse("https://user:pass@example.com:8443/a/b?x=1#h", None).unwrap();
    assert_eq!(url.protocol(), "https:");
    assert_eq!(url.username(), "user");
    assert_eq!(url.password(), "pass");
    assert_eq!(url.host(), "example.com:8443");
    assert_eq!(url.pathname(), "/a/b");
    assert_eq!(url.search(), "?x=1");
    assert_eq!(url.hash(), "#h");

    let relative = Url::parse("child", Some("https://example.com/base/file")).unwrap();
    assert_eq!(relative.href(), "https://example.com/base/child");
}

#[test]
fn url_search_params_preserve_order() {
    let mut params = UrlSearchParams::new(Some("a=1&a=2&b=hello+world")).unwrap();
    assert_eq!(params.get("a").as_deref(), Some("1"));
    assert_eq!(params.get_all("a"), vec!["1", "2"]);
    assert_eq!(params.get("b").as_deref(), Some("hello world"));
    params.set("a", "3");
    params.append("c", "4");
    assert_eq!(params.to_string(), "b=hello+world&a=3&c=4");
}
