use tsonic_node::http2;

#[test]
fn http2_exposes_documented_string_constants() {
    for (name, actual, expected) in [
        (
            "HTTP2_HEADER_CONTENT_LENGTH",
            http2::HTTP2_HEADER_CONTENT_LENGTH,
            "content-length",
        ),
        (
            "HTTP2_HEADER_REFERER",
            http2::HTTP2_HEADER_REFERER,
            "referer",
        ),
        ("HTTP2_HEADER_LINK", http2::HTTP2_HEADER_LINK, "link"),
        (
            "HTTP2_HEADER_ACCEPT_CHARSET",
            http2::HTTP2_HEADER_ACCEPT_CHARSET,
            "accept-charset",
        ),
        ("HTTP2_HEADER_FROM", http2::HTTP2_HEADER_FROM, "from"),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS",
            http2::HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS,
            "access-control-allow-credentials",
        ),
        (
            "HTTP2_HEADER_CACHE_CONTROL",
            http2::HTTP2_HEADER_CACHE_CONTROL,
            "cache-control",
        ),
        ("HTTP2_METHOD_SEARCH", http2::HTTP2_METHOD_SEARCH, "SEARCH"),
        (
            "HTTP2_METHOD_PROPPATCH",
            http2::HTTP2_METHOD_PROPPATCH,
            "PROPPATCH",
        ),
        ("HTTP2_HEADER_ACCEPT", http2::HTTP2_HEADER_ACCEPT, "accept"),
        ("HTTP2_METHOD_UNLOCK", http2::HTTP2_METHOD_UNLOCK, "UNLOCK"),
        (
            "HTTP2_HEADER_CONTENT_LANGUAGE",
            http2::HTTP2_HEADER_CONTENT_LANGUAGE,
            "content-language",
        ),
        (
            "HTTP2_HEADER_EXPIRES",
            http2::HTTP2_HEADER_EXPIRES,
            "expires",
        ),
        (
            "HTTP2_HEADER_ACCEPT_RANGES",
            http2::HTTP2_HEADER_ACCEPT_RANGES,
            "accept-ranges",
        ),
        ("HTTP2_HEADER_VIA", http2::HTTP2_HEADER_VIA, "via"),
        ("HTTP2_METHOD_UPDATE", http2::HTTP2_METHOD_UPDATE, "UPDATE"),
        (
            "HTTP2_METHOD_UPDATEREDIRECTREF",
            http2::HTTP2_METHOD_UPDATEREDIRECTREF,
            "UPDATEREDIRECTREF",
        ),
        ("HTTP2_METHOD_POST", http2::HTTP2_METHOD_POST, "POST"),
        ("HTTP2_HEADER_TE", http2::HTTP2_HEADER_TE, "te"),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS",
            http2::HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS,
            "access-control-allow-headers",
        ),
        (
            "HTTP2_HEADER_IF_UNMODIFIED_SINCE",
            http2::HTTP2_HEADER_IF_UNMODIFIED_SINCE,
            "if-unmodified-since",
        ),
        (
            "HTTP2_HEADER_STRICT_TRANSPORT_SECURITY",
            http2::HTTP2_HEADER_STRICT_TRANSPORT_SECURITY,
            "strict-transport-security",
        ),
        (
            "HTTP2_HEADER_IF_RANGE",
            http2::HTTP2_HEADER_IF_RANGE,
            "if-range",
        ),
        (
            "HTTP2_METHOD_CHECKIN",
            http2::HTTP2_METHOD_CHECKIN,
            "CHECKIN",
        ),
        (
            "HTTP2_METHOD_BASELINE_CONTROL",
            http2::HTTP2_METHOD_BASELINE_CONTROL,
            "BASELINE-CONTROL",
        ),
        (
            "HTTP2_METHOD_MKACTIVITY",
            http2::HTTP2_METHOD_MKACTIVITY,
            "MKACTIVITY",
        ),
        ("HTTP2_METHOD_GET", http2::HTTP2_METHOD_GET, "GET"),
        (
            "HTTP2_HEADER_IF_MATCH",
            http2::HTTP2_HEADER_IF_MATCH,
            "if-match",
        ),
        ("HTTP2_METHOD_MOVE", http2::HTTP2_METHOD_MOVE, "MOVE"),
        (
            "HTTP2_METHOD_PROPFIND",
            http2::HTTP2_METHOD_PROPFIND,
            "PROPFIND",
        ),
        ("HTTP2_METHOD_MKCOL", http2::HTTP2_METHOD_MKCOL, "MKCOL"),
        ("HTTP2_HEADER_RANGE", http2::HTTP2_HEADER_RANGE, "range"),
        ("HTTP2_METHOD_BIND", http2::HTTP2_METHOD_BIND, "BIND"),
        (
            "HTTP2_METHOD_ORDERPATCH",
            http2::HTTP2_METHOD_ORDERPATCH,
            "ORDERPATCH",
        ),
        ("HTTP2_METHOD_ACL", http2::HTTP2_METHOD_ACL, "ACL"),
        (
            "HTTP2_HEADER_ACCEPT_LANGUAGE",
            http2::HTTP2_HEADER_ACCEPT_LANGUAGE,
            "accept-language",
        ),
        (
            "HTTP2_HEADER_HTTP2_SETTINGS",
            http2::HTTP2_HEADER_HTTP2_SETTINGS,
            "http2-settings",
        ),
        ("HTTP2_HEADER_ALLOW", http2::HTTP2_HEADER_ALLOW, "allow"),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS",
            http2::HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS,
            "access-control-expose-headers",
        ),
        (
            "HTTP2_HEADER_LAST_MODIFIED",
            http2::HTTP2_HEADER_LAST_MODIFIED,
            "last-modified",
        ),
        (
            "HTTP2_HEADER_USER_AGENT",
            http2::HTTP2_HEADER_USER_AGENT,
            "user-agent",
        ),
        (
            "HTTP2_HEADER_IF_NONE_MATCH",
            http2::HTTP2_HEADER_IF_NONE_MATCH,
            "if-none-match",
        ),
        ("HTTP2_METHOD_LABEL", http2::HTTP2_METHOD_LABEL, "LABEL"),
        ("HTTP2_HEADER_SCHEME", http2::HTTP2_HEADER_SCHEME, ":scheme"),
        (
            "HTTP2_HEADER_CONTENT_DISPOSITION",
            http2::HTTP2_HEADER_CONTENT_DISPOSITION,
            "content-disposition",
        ),
        ("HTTP2_HEADER_VARY", http2::HTTP2_HEADER_VARY, "vary"),
        ("HTTP2_METHOD_DELETE", http2::HTTP2_METHOD_DELETE, "DELETE"),
        ("HTTP2_METHOD_HEAD", http2::HTTP2_METHOD_HEAD, "HEAD"),
        ("HTTP2_HEADER_STATUS", http2::HTTP2_HEADER_STATUS, ":status"),
        (
            "HTTP2_HEADER_AUTHORITY",
            http2::HTTP2_HEADER_AUTHORITY,
            ":authority",
        ),
        ("HTTP2_METHOD_UNLINK", http2::HTTP2_METHOD_UNLINK, "UNLINK"),
        ("HTTP2_HEADER_DATE", http2::HTTP2_HEADER_DATE, "date"),
        ("HTTP2_METHOD_MERGE", http2::HTTP2_METHOD_MERGE, "MERGE"),
        ("HTTP2_METHOD_REBIND", http2::HTTP2_METHOD_REBIND, "REBIND"),
        (
            "HTTP2_METHOD_MKCALENDAR",
            http2::HTTP2_METHOD_MKCALENDAR,
            "MKCALENDAR",
        ),
        ("HTTP2_HEADER_PATH", http2::HTTP2_HEADER_PATH, ":path"),
        ("HTTP2_HEADER_ETAG", http2::HTTP2_HEADER_ETAG, "etag"),
        (
            "HTTP2_HEADER_TRANSFER_ENCODING",
            http2::HTTP2_HEADER_TRANSFER_ENCODING,
            "transfer-encoding",
        ),
        (
            "HTTP2_METHOD_CHECKOUT",
            http2::HTTP2_METHOD_CHECKOUT,
            "CHECKOUT",
        ),
        (
            "HTTP2_METHOD_OPTIONS",
            http2::HTTP2_METHOD_OPTIONS,
            "OPTIONS",
        ),
        (
            "HTTP2_HEADER_KEEP_ALIVE",
            http2::HTTP2_HEADER_KEEP_ALIVE,
            "keep-alive",
        ),
        ("HTTP2_METHOD_PRI", http2::HTTP2_METHOD_PRI, "PRI"),
        ("HTTP2_HEADER_EXPECT", http2::HTTP2_HEADER_EXPECT, "expect"),
        ("HTTP2_METHOD_PUT", http2::HTTP2_METHOD_PUT, "PUT"),
        ("HTTP2_HEADER_SERVER", http2::HTTP2_HEADER_SERVER, "server"),
        ("HTTP2_HEADER_METHOD", http2::HTTP2_HEADER_METHOD, ":method"),
        ("HTTP2_HEADER_PREFER", http2::HTTP2_HEADER_PREFER, "prefer"),
        (
            "HTTP2_HEADER_REFRESH",
            http2::HTTP2_HEADER_REFRESH,
            "refresh",
        ),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN",
            http2::HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN,
            "access-control-allow-origin",
        ),
        (
            "HTTP2_HEADER_CONTENT_MD5",
            http2::HTTP2_HEADER_CONTENT_MD5,
            "content-md5",
        ),
        (
            "HTTP2_HEADER_UPGRADE",
            http2::HTTP2_HEADER_UPGRADE,
            "upgrade",
        ),
        (
            "HTTP2_HEADER_SET_COOKIE",
            http2::HTTP2_HEADER_SET_COOKIE,
            "set-cookie",
        ),
        ("HTTP2_METHOD_UNBIND", http2::HTTP2_METHOD_UNBIND, "UNBIND"),
        (
            "HTTP2_HEADER_MAX_FORWARDS",
            http2::HTTP2_HEADER_MAX_FORWARDS,
            "max-forwards",
        ),
        (
            "HTTP2_HEADER_CONNECTION",
            http2::HTTP2_HEADER_CONNECTION,
            "connection",
        ),
        (
            "HTTP2_HEADER_WWW_AUTHENTICATE",
            http2::HTTP2_HEADER_WWW_AUTHENTICATE,
            "www-authenticate",
        ),
        ("HTTP2_HEADER_AGE", http2::HTTP2_HEADER_AGE, "age"),
        (
            "HTTP2_HEADER_RETRY_AFTER",
            http2::HTTP2_HEADER_RETRY_AFTER,
            "retry-after",
        ),
        (
            "HTTP2_HEADER_CONTENT_TYPE",
            http2::HTTP2_HEADER_CONTENT_TYPE,
            "content-type",
        ),
        (
            "HTTP2_METHOD_UNCHECKOUT",
            http2::HTTP2_METHOD_UNCHECKOUT,
            "UNCHECKOUT",
        ),
        (
            "HTTP2_HEADER_ACCEPT_ENCODING",
            http2::HTTP2_HEADER_ACCEPT_ENCODING,
            "accept-encoding",
        ),
        (
            "HTTP2_HEADER_CONTENT_RANGE",
            http2::HTTP2_HEADER_CONTENT_RANGE,
            "content-range",
        ),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD",
            http2::HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD,
            "access-control-request-method",
        ),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS",
            http2::HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS,
            "access-control-allow-methods",
        ),
        (
            "HTTP2_METHOD_VERSION_CONTROL",
            http2::HTTP2_METHOD_VERSION_CONTROL,
            "VERSION-CONTROL",
        ),
        ("HTTP2_METHOD_PATCH", http2::HTTP2_METHOD_PATCH, "PATCH"),
        (
            "HTTP2_HEADER_LOCATION",
            http2::HTTP2_HEADER_LOCATION,
            "location",
        ),
        ("HTTP2_METHOD_LOCK", http2::HTTP2_METHOD_LOCK, "LOCK"),
        (
            "HTTP2_HEADER_IF_MODIFIED_SINCE",
            http2::HTTP2_HEADER_IF_MODIFIED_SINCE,
            "if-modified-since",
        ),
        (
            "HTTP2_METHOD_CONNECT",
            http2::HTTP2_METHOD_CONNECT,
            "CONNECT",
        ),
        (
            "HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS",
            http2::HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS,
            "access-control-request-headers",
        ),
        ("HTTP2_METHOD_COPY", http2::HTTP2_METHOD_COPY, "COPY"),
        (
            "HTTP2_METHOD_MKWORKSPACE",
            http2::HTTP2_METHOD_MKWORKSPACE,
            "MKWORKSPACE",
        ),
        ("HTTP2_METHOD_LINK", http2::HTTP2_METHOD_LINK, "LINK"),
        (
            "HTTP2_HEADER_PROXY_AUTHORIZATION",
            http2::HTTP2_HEADER_PROXY_AUTHORIZATION,
            "proxy-authorization",
        ),
        (
            "HTTP2_HEADER_PROXY_CONNECTION",
            http2::HTTP2_HEADER_PROXY_CONNECTION,
            "proxy-connection",
        ),
        (
            "HTTP2_HEADER_CONTENT_LOCATION",
            http2::HTTP2_HEADER_CONTENT_LOCATION,
            "content-location",
        ),
        ("HTTP2_HEADER_COOKIE", http2::HTTP2_HEADER_COOKIE, "cookie"),
        (
            "HTTP2_HEADER_CONTENT_ENCODING",
            http2::HTTP2_HEADER_CONTENT_ENCODING,
            "content-encoding",
        ),
        (
            "HTTP2_HEADER_PROXY_AUTHENTICATE",
            http2::HTTP2_HEADER_PROXY_AUTHENTICATE,
            "proxy-authenticate",
        ),
        (
            "HTTP2_HEADER_AUTHORIZATION",
            http2::HTTP2_HEADER_AUTHORIZATION,
            "authorization",
        ),
        ("HTTP2_METHOD_TRACE", http2::HTTP2_METHOD_TRACE, "TRACE"),
        ("HTTP2_HEADER_HOST", http2::HTTP2_HEADER_HOST, "host"),
        (
            "HTTP2_METHOD_MKREDIRECTREF",
            http2::HTTP2_METHOD_MKREDIRECTREF,
            "MKREDIRECTREF",
        ),
        ("HTTP2_METHOD_REPORT", http2::HTTP2_METHOD_REPORT, "REPORT"),
    ] {
        assert_eq!(actual, expected, "{name}");
    }
}

#[test]
fn http2_exposes_documented_status_constants() {
    for (name, actual, expected) in [
        (
            "HTTP_STATUS_NOT_EXTENDED",
            http2::HTTP_STATUS_NOT_EXTENDED,
            510u16,
        ),
        (
            "HTTP_STATUS_ALREADY_REPORTED",
            http2::HTTP_STATUS_ALREADY_REPORTED,
            208u16,
        ),
        (
            "HTTP_STATUS_SWITCHING_PROTOCOLS",
            http2::HTTP_STATUS_SWITCHING_PROTOCOLS,
            101u16,
        ),
        (
            "HTTP_STATUS_BAD_REQUEST",
            http2::HTTP_STATUS_BAD_REQUEST,
            400u16,
        ),
        (
            "HTTP_STATUS_PROCESSING",
            http2::HTTP_STATUS_PROCESSING,
            102u16,
        ),
        (
            "HTTP_STATUS_PAYMENT_REQUIRED",
            http2::HTTP_STATUS_PAYMENT_REQUIRED,
            402u16,
        ),
        (
            "HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE",
            http2::HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE,
            431u16,
        ),
        ("HTTP_STATUS_TEAPOT", http2::HTTP_STATUS_TEAPOT, 418u16),
        (
            "HTTP_STATUS_GATEWAY_TIMEOUT",
            http2::HTTP_STATUS_GATEWAY_TIMEOUT,
            504u16,
        ),
        (
            "HTTP_STATUS_NOT_ACCEPTABLE",
            http2::HTTP_STATUS_NOT_ACCEPTABLE,
            406u16,
        ),
        (
            "HTTP_STATUS_NO_CONTENT",
            http2::HTTP_STATUS_NO_CONTENT,
            204u16,
        ),
        ("HTTP_STATUS_FOUND", http2::HTTP_STATUS_FOUND, 302u16),
        (
            "HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED",
            http2::HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED,
            511u16,
        ),
        (
            "HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS",
            http2::HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS,
            451u16,
        ),
        (
            "HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED",
            http2::HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED,
            509u16,
        ),
        (
            "HTTP_STATUS_UNAUTHORIZED",
            http2::HTTP_STATUS_UNAUTHORIZED,
            401u16,
        ),
        (
            "HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE",
            http2::HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
            415u16,
        ),
        (
            "HTTP_STATUS_TOO_MANY_REQUESTS",
            http2::HTTP_STATUS_TOO_MANY_REQUESTS,
            429u16,
        ),
        (
            "HTTP_STATUS_BAD_GATEWAY",
            http2::HTTP_STATUS_BAD_GATEWAY,
            502u16,
        ),
        (
            "HTTP_STATUS_PERMANENT_REDIRECT",
            http2::HTTP_STATUS_PERMANENT_REDIRECT,
            308u16,
        ),
        ("HTTP_STATUS_OK", http2::HTTP_STATUS_OK, 200u16),
        ("HTTP_STATUS_CREATED", http2::HTTP_STATUS_CREATED, 201u16),
        ("HTTP_STATUS_IM_USED", http2::HTTP_STATUS_IM_USED, 226u16),
        (
            "HTTP_STATUS_METHOD_NOT_ALLOWED",
            http2::HTTP_STATUS_METHOD_NOT_ALLOWED,
            405u16,
        ),
        (
            "HTTP_STATUS_RESET_CONTENT",
            http2::HTTP_STATUS_RESET_CONTENT,
            205u16,
        ),
        ("HTTP_STATUS_CONFLICT", http2::HTTP_STATUS_CONFLICT, 409u16),
        ("HTTP_STATUS_CONTINUE", http2::HTTP_STATUS_CONTINUE, 100u16),
        (
            "HTTP_STATUS_FORBIDDEN",
            http2::HTTP_STATUS_FORBIDDEN,
            403u16,
        ),
        (
            "HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED",
            http2::HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED,
            505u16,
        ),
        (
            "HTTP_STATUS_EXPECTATION_FAILED",
            http2::HTTP_STATUS_EXPECTATION_FAILED,
            417u16,
        ),
        (
            "HTTP_STATUS_URI_TOO_LONG",
            http2::HTTP_STATUS_URI_TOO_LONG,
            414u16,
        ),
        ("HTTP_STATUS_LOCKED", http2::HTTP_STATUS_LOCKED, 423u16),
        (
            "HTTP_STATUS_NOT_FOUND",
            http2::HTTP_STATUS_NOT_FOUND,
            404u16,
        ),
        (
            "HTTP_STATUS_INSUFFICIENT_STORAGE",
            http2::HTTP_STATUS_INSUFFICIENT_STORAGE,
            507u16,
        ),
        (
            "HTTP_STATUS_VARIANT_ALSO_NEGOTIATES",
            http2::HTTP_STATUS_VARIANT_ALSO_NEGOTIATES,
            506u16,
        ),
        (
            "HTTP_STATUS_MULTI_STATUS",
            http2::HTTP_STATUS_MULTI_STATUS,
            207u16,
        ),
        (
            "HTTP_STATUS_UNORDERED_COLLECTION",
            http2::HTTP_STATUS_UNORDERED_COLLECTION,
            425u16,
        ),
        (
            "HTTP_STATUS_NOT_IMPLEMENTED",
            http2::HTTP_STATUS_NOT_IMPLEMENTED,
            501u16,
        ),
        (
            "HTTP_STATUS_SEE_OTHER",
            http2::HTTP_STATUS_SEE_OTHER,
            303u16,
        ),
        (
            "HTTP_STATUS_RANGE_NOT_SATISFIABLE",
            http2::HTTP_STATUS_RANGE_NOT_SATISFIABLE,
            416u16,
        ),
        (
            "HTTP_STATUS_PARTIAL_CONTENT",
            http2::HTTP_STATUS_PARTIAL_CONTENT,
            206u16,
        ),
        (
            "HTTP_STATUS_USE_PROXY",
            http2::HTTP_STATUS_USE_PROXY,
            305u16,
        ),
        (
            "HTTP_STATUS_MOVED_PERMANENTLY",
            http2::HTTP_STATUS_MOVED_PERMANENTLY,
            301u16,
        ),
        (
            "HTTP_STATUS_SERVICE_UNAVAILABLE",
            http2::HTTP_STATUS_SERVICE_UNAVAILABLE,
            503u16,
        ),
        (
            "HTTP_STATUS_FAILED_DEPENDENCY",
            http2::HTTP_STATUS_FAILED_DEPENDENCY,
            424u16,
        ),
        (
            "HTTP_STATUS_PAYLOAD_TOO_LARGE",
            http2::HTTP_STATUS_PAYLOAD_TOO_LARGE,
            413u16,
        ),
        ("HTTP_STATUS_GONE", http2::HTTP_STATUS_GONE, 410u16),
        (
            "HTTP_STATUS_LENGTH_REQUIRED",
            http2::HTTP_STATUS_LENGTH_REQUIRED,
            411u16,
        ),
        (
            "HTTP_STATUS_PRECONDITION_FAILED",
            http2::HTTP_STATUS_PRECONDITION_FAILED,
            412u16,
        ),
        (
            "HTTP_STATUS_LOOP_DETECTED",
            http2::HTTP_STATUS_LOOP_DETECTED,
            508u16,
        ),
        (
            "HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED",
            http2::HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED,
            407u16,
        ),
        (
            "HTTP_STATUS_TEMPORARY_REDIRECT",
            http2::HTTP_STATUS_TEMPORARY_REDIRECT,
            307u16,
        ),
        (
            "HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION",
            http2::HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION,
            203u16,
        ),
        (
            "HTTP_STATUS_UNPROCESSABLE_ENTITY",
            http2::HTTP_STATUS_UNPROCESSABLE_ENTITY,
            422u16,
        ),
        (
            "HTTP_STATUS_REQUEST_TIMEOUT",
            http2::HTTP_STATUS_REQUEST_TIMEOUT,
            408u16,
        ),
        (
            "HTTP_STATUS_PRECONDITION_REQUIRED",
            http2::HTTP_STATUS_PRECONDITION_REQUIRED,
            428u16,
        ),
        (
            "HTTP_STATUS_MULTIPLE_CHOICES",
            http2::HTTP_STATUS_MULTIPLE_CHOICES,
            300u16,
        ),
        (
            "HTTP_STATUS_NOT_MODIFIED",
            http2::HTTP_STATUS_NOT_MODIFIED,
            304u16,
        ),
        (
            "HTTP_STATUS_UPGRADE_REQUIRED",
            http2::HTTP_STATUS_UPGRADE_REQUIRED,
            426u16,
        ),
        (
            "HTTP_STATUS_INTERNAL_SERVER_ERROR",
            http2::HTTP_STATUS_INTERNAL_SERVER_ERROR,
            500u16,
        ),
        (
            "HTTP_STATUS_MISDIRECTED_REQUEST",
            http2::HTTP_STATUS_MISDIRECTED_REQUEST,
            421u16,
        ),
        ("HTTP_STATUS_ACCEPTED", http2::HTTP_STATUS_ACCEPTED, 202u16),
    ] {
        assert_eq!(actual, expected, "{name}");
    }
}

#[test]
fn http2_exposes_documented_unsigned_numeric_constants() {
    for (name, actual, expected) in [
        (
            "NGHTTP2_REFUSED_STREAM",
            http2::NGHTTP2_REFUSED_STREAM,
            7u32,
        ),
        (
            "NGHTTP2_PROTOCOL_ERROR",
            http2::NGHTTP2_PROTOCOL_ERROR,
            1u32,
        ),
        ("NGHTTP2_FLAG_PRIORITY", http2::NGHTTP2_FLAG_PRIORITY, 32u32),
        (
            "NGHTTP2_STREAM_STATE_OPEN",
            http2::NGHTTP2_STREAM_STATE_OPEN,
            2u32,
        ),
        ("NGHTTP2_NO_ERROR", http2::NGHTTP2_NO_ERROR, 0u32),
        (
            "NGHTTP2_FLOW_CONTROL_ERROR",
            http2::NGHTTP2_FLOW_CONTROL_ERROR,
            3u32,
        ),
        (
            "NGHTTP2_STREAM_STATE_RESERVED_REMOTE",
            http2::NGHTTP2_STREAM_STATE_RESERVED_REMOTE,
            4u32,
        ),
        (
            "NGHTTP2_STREAM_STATE_IDLE",
            http2::NGHTTP2_STREAM_STATE_IDLE,
            1u32,
        ),
        (
            "NGHTTP2_SETTINGS_MAX_FRAME_SIZE",
            http2::NGHTTP2_SETTINGS_MAX_FRAME_SIZE,
            5u32,
        ),
        (
            "NGHTTP2_FLAG_END_HEADERS",
            http2::NGHTTP2_FLAG_END_HEADERS,
            4u32,
        ),
        (
            "NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE",
            http2::NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE,
            6u32,
        ),
        ("PADDING_STRATEGY_MAX", http2::PADDING_STRATEGY_MAX, 2u32),
        ("NGHTTP2_CONNECT_ERROR", http2::NGHTTP2_CONNECT_ERROR, 10u32),
        (
            "NGHTTP2_SESSION_CLIENT",
            http2::NGHTTP2_SESSION_CLIENT,
            1u32,
        ),
        ("NGHTTP2_FLAG_ACK", http2::NGHTTP2_FLAG_ACK, 1u32),
        (
            "NGHTTP2_SETTINGS_ENABLE_PUSH",
            http2::NGHTTP2_SETTINGS_ENABLE_PUSH,
            2u32,
        ),
        (
            "DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE",
            http2::DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE,
            65535u32,
        ),
        (
            "NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS",
            http2::NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS,
            3u32,
        ),
        (
            "NGHTTP2_STREAM_STATE_RESERVED_LOCAL",
            http2::NGHTTP2_STREAM_STATE_RESERVED_LOCAL,
            3u32,
        ),
        (
            "NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL",
            http2::NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL,
            5u32,
        ),
        (
            "NGHTTP2_FLAG_END_STREAM",
            http2::NGHTTP2_FLAG_END_STREAM,
            1u32,
        ),
        (
            "NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE",
            http2::NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE,
            4u32,
        ),
        (
            "NGHTTP2_HTTP_1_1_REQUIRED",
            http2::NGHTTP2_HTTP_1_1_REQUIRED,
            13u32,
        ),
        (
            "NGHTTP2_SETTINGS_HEADER_TABLE_SIZE",
            http2::NGHTTP2_SETTINGS_HEADER_TABLE_SIZE,
            1u32,
        ),
        (
            "DEFAULT_SETTINGS_ENABLE_PUSH",
            http2::DEFAULT_SETTINGS_ENABLE_PUSH,
            1u32,
        ),
        (
            "DEFAULT_SETTINGS_HEADER_TABLE_SIZE",
            http2::DEFAULT_SETTINGS_HEADER_TABLE_SIZE,
            4096u32,
        ),
        (
            "NGHTTP2_FRAME_SIZE_ERROR",
            http2::NGHTTP2_FRAME_SIZE_ERROR,
            6u32,
        ),
        (
            "NGHTTP2_INADEQUATE_SECURITY",
            http2::NGHTTP2_INADEQUATE_SECURITY,
            12u32,
        ),
        (
            "NGHTTP2_COMPRESSION_ERROR",
            http2::NGHTTP2_COMPRESSION_ERROR,
            9u32,
        ),
        ("MIN_MAX_FRAME_SIZE", http2::MIN_MAX_FRAME_SIZE, 16384u32),
        (
            "MAX_INITIAL_WINDOW_SIZE",
            http2::MAX_INITIAL_WINDOW_SIZE,
            2147483647u32,
        ),
        (
            "NGHTTP2_INTERNAL_ERROR",
            http2::NGHTTP2_INTERNAL_ERROR,
            2u32,
        ),
        (
            "NGHTTP2_SESSION_SERVER",
            http2::NGHTTP2_SESSION_SERVER,
            0u32,
        ),
        ("MAX_MAX_FRAME_SIZE", http2::MAX_MAX_FRAME_SIZE, 16777215u32),
        ("NGHTTP2_STREAM_CLOSED", http2::NGHTTP2_STREAM_CLOSED, 5u32),
        ("NGHTTP2_FLAG_PADDED", http2::NGHTTP2_FLAG_PADDED, 8u32),
        (
            "PADDING_STRATEGY_CALLBACK",
            http2::PADDING_STRATEGY_CALLBACK,
            1u32,
        ),
        (
            "NGHTTP2_DEFAULT_WEIGHT",
            http2::NGHTTP2_DEFAULT_WEIGHT,
            16u32,
        ),
        ("NGHTTP2_FLAG_NONE", http2::NGHTTP2_FLAG_NONE, 0u32),
        (
            "NGHTTP2_STREAM_STATE_CLOSED",
            http2::NGHTTP2_STREAM_STATE_CLOSED,
            7u32,
        ),
        (
            "NGHTTP2_SETTINGS_TIMEOUT",
            http2::NGHTTP2_SETTINGS_TIMEOUT,
            4u32,
        ),
        (
            "NGHTTP2_ENHANCE_YOUR_CALM",
            http2::NGHTTP2_ENHANCE_YOUR_CALM,
            11u32,
        ),
        (
            "NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE",
            http2::NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE,
            6u32,
        ),
        ("PADDING_STRATEGY_NONE", http2::PADDING_STRATEGY_NONE, 0u32),
        (
            "DEFAULT_SETTINGS_MAX_FRAME_SIZE",
            http2::DEFAULT_SETTINGS_MAX_FRAME_SIZE,
            16384u32,
        ),
        ("NGHTTP2_CANCEL", http2::NGHTTP2_CANCEL, 8u32),
    ] {
        assert_eq!(actual, expected, "{name}");
    }
}

#[test]
fn http2_exposes_documented_signed_numeric_constants() {
    assert_eq!(http2::NGHTTP2_ERR_FRAME_SIZE_ERROR, -522i32);
}
