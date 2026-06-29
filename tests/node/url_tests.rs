use tsonic_node::url::{
    can_parse, domain_to_ascii, domain_to_unicode, file_url_to_path, format, parse,
    path_to_file_url, resolve, url_pattern_can_parse, url_to_http_options, LegacyUrlObject, Url,
    UrlFormatOptions, UrlPattern, UrlPatternInit, UrlPatternInput, UrlPatternOptions,
    UrlSearchParams,
};

#[test]
fn url_parses_common_absolute_and_base_forms() {
    let url = Url::parse("https://user:pass@example.com:8443/a/b?x=1#h", None).unwrap();
    assert_eq!(url.protocol(), "https:");
    assert_eq!(url.username(), "user");
    assert_eq!(url.password(), "pass");
    assert_eq!(url.host(), "example.com:8443");
    assert_eq!(url.hostname(), "example.com");
    assert_eq!(url.port(), "8443");
    assert_eq!(url.pathname(), "/a/b");
    assert_eq!(url.search(), "?x=1");
    assert_eq!(url.hash(), "#h");
    assert_eq!(url.origin(), "https://example.com:8443");
    assert_eq!(url.search_params().unwrap().get("x").as_deref(), Some("1"));
    assert_eq!(url.to_json(), url.href());
    assert_eq!(url.to_string(), url.href());

    let relative = Url::parse("child", Some("https://example.com/base/file")).unwrap();
    assert_eq!(relative.href(), "https://example.com/base/child");
}

#[test]
fn url_search_params_preserve_order() {
    let mut params = UrlSearchParams::new(Some("a=1&a=2&b=hello+world")).unwrap();
    assert_eq!(params.get("a").as_deref(), Some("1"));
    assert_eq!(params.get_all("a"), vec!["1", "2"]);
    assert_eq!(params.get("b").as_deref(), Some("hello world"));
    assert!(params.has("a"));
    assert!(params.has_value("a", "1"));
    assert!(!params.has_value("a", "missing"));
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
    params.delete("b");
    assert!(!params.has("b"));
    assert_eq!(params.to_string(), "a=3&c=4");
    params.append("c", "5");
    params.delete_value("c", "4");
    assert_eq!(params.get_all("c"), vec!["5"]);

    let from_records = UrlSearchParams::from_records(&std::collections::BTreeMap::from([
        ("x".to_string(), "1".to_string()),
        ("y".to_string(), "2".to_string()),
    ]));
    assert_eq!(from_records.to_string(), "x=1&y=2");
}

#[test]
fn url_pattern_matches_exact_wildcard_and_named_segments() {
    let pattern = UrlPattern::new(
        UrlPatternInput::Init(UrlPatternInit {
            protocol: Some("https".to_string()),
            hostname: Some("*.example.com".to_string()),
            pathname: Some("/users/:id".to_string()),
            search: Some("q=*".to_string()),
            ..UrlPatternInit::default()
        }),
        UrlPatternOptions { ignore_case: true },
    )
    .unwrap();
    assert_eq!(pattern.protocol(), "https");
    assert_eq!(pattern.hostname(), "*.example.com");
    assert_eq!(pattern.pathname(), "/users/:id");
    assert!(!pattern.has_regexp_groups());
    assert!(pattern.test("https://API.example.com/users/42?q=yes#top", None));
    let result = pattern
        .exec("https://api.example.com/users/42?q=yes#top", None)
        .unwrap();
    assert_eq!(
        result
            .pathname
            .groups
            .get("id")
            .cloned()
            .flatten()
            .as_deref(),
        Some("42")
    );
    assert_eq!(result.hostname.input, "api.example.com");
    assert_eq!(result.search.input, "q=yes");
    assert_eq!(result.hash.input, "top");

    let path_pattern = UrlPattern::new_with_base(
        UrlPatternInput::Pattern("/assets/*".to_string()),
        Some("https://example.com"),
        UrlPatternOptions::default(),
    )
    .unwrap();
    assert!(path_pattern.test("https://example.com/assets/app.js", None));
    assert!(!path_pattern.test("https://example.com/api/app.js", None));
    assert!(url_pattern_can_parse(
        "/assets/*",
        Some("https://example.com")
    ));
    assert!(!url_pattern_can_parse("assets/*", None));

    let blob_url = tsonic_node::url::create_object_url(&tsonic_node::buffer::Blob::from_text("x"));
    assert_eq!(blob_url, "blob:tsonic-runtime");
    tsonic_node::url::revoke_object_url(&blob_url);
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

    let file_options = tsonic_node::url::FileUrlToPathOptions {
        windows: Some(false),
    };
    let path_options = tsonic_node::url::PathToFileUrlOptions {
        windows: Some(true),
    };
    assert_eq!(file_options.windows, Some(false));
    assert_eq!(path_options.windows, Some(true));
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
    let format_options = UrlFormatOptions {
        auth: Some(true),
        fragment: Some(true),
        search: Some(true),
        unicode: Some(false),
    };
    assert_eq!(format_options.auth, Some(true));
    assert_eq!(format_options.fragment, Some(true));
    assert_eq!(format_options.search, Some(true));
    assert_eq!(format_options.unicode, Some(false));

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
