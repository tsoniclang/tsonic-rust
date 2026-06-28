use tsonic_node::url::{
    can_parse, domain_to_ascii, domain_to_unicode, file_url_to_path, format, parse,
    path_to_file_url, resolve, url_to_http_options, LegacyUrlObject, Url, UrlSearchParams,
};

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
    assert_eq!(params.size(), 3);
    assert_eq!(params.keys(), vec!["b", "a", "c"]);
    assert_eq!(params.values(), vec!["hello world", "3", "4"]);
    assert_eq!(
        params.entries(),
        vec![
            ("b".to_string(), "hello world".to_string()),
            ("a".to_string(), "3".to_string()),
            ("c".to_string(), "4".to_string())
        ]
    );
    let mut visited = Vec::new();
    params.for_each(|value, key| visited.push((key.to_string(), value.to_string())));
    assert_eq!(visited[0], ("b".to_string(), "hello world".to_string()));
    assert_eq!(params.to_string(), "b=hello+world&a=3&c=4");
    params.sort();
    assert_eq!(params.keys(), vec!["a", "b", "c"]);
    assert_eq!(params.to_string(), "a=3&b=hello+world&c=4");
}

#[test]
fn url_setters_and_file_url_helpers() {
    let mut url = Url::parse("https://example.com/a?x=1#h", None).unwrap();
    url.set_pathname("b");
    url.set_search("q=1");
    url.set_hash("z");
    assert_eq!(url.href(), "https://example.com/b?q=1#z");

    let file = path_to_file_url("/tmp/a.txt");
    assert_eq!(file.protocol(), "file:");
    assert_eq!(file_url_to_path(&file).unwrap(), "/tmp/a.txt");
}

#[test]
fn url_static_and_legacy_helpers_cover_common_node_shapes() {
    assert!(can_parse("https://example.com/a", None));
    assert!(can_parse("/a", Some("https://example.com/base")));
    assert!(!can_parse("/a", None));

    let legacy = parse("https://u:p@example.com:8443/a?x=1#h", false, false).unwrap();
    assert_eq!(legacy.protocol, "https:");
    assert_eq!(legacy.auth, "u:p");
    assert_eq!(legacy.host, "example.com:8443");
    assert_eq!(legacy.path, "/a?x=1");
    assert_eq!(format(&legacy), "https://u:p@example.com:8443/a?x=1#h");

    let built = format(&LegacyUrlObject {
        href: String::new(),
        protocol: "https:".to_string(),
        slashes: true,
        auth: String::new(),
        host: "example.com".to_string(),
        port: String::new(),
        hostname: "example.com".to_string(),
        hash: "#top".to_string(),
        search: "?q=1".to_string(),
        query: "q=1".to_string(),
        pathname: "/docs".to_string(),
        path: "/docs?q=1".to_string(),
    });
    assert_eq!(built, "https://example.com/docs?q=1#top");

    assert_eq!(
        resolve("https://example.com/base/file", "child").unwrap(),
        "https://example.com/base/child"
    );
}

#[test]
fn url_domain_and_http_options_helpers_are_closed_runtime_apis() {
    assert_eq!(domain_to_ascii("mañana.com"), "xn--maana-pta.com");
    assert_eq!(domain_to_unicode("xn--maana-pta.com"), "mañana.com");

    let url = Url::parse("https://user:pass@example.com:443/a?x=1", None).unwrap();
    let options = url_to_http_options(&url);
    assert_eq!(options.protocol, "https:");
    assert_eq!(options.hostname, "example.com");
    assert_eq!(options.port, Some(443));
    assert_eq!(options.path, "/a?x=1");
    assert_eq!(options.auth, "user:pass");
}
