#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Body {
    Empty,
    Bytes(Vec<u8>),
    Text(String),
    Blob(Blob),
    FormData(FormData),
}

impl Body {
    pub fn bytes(&self) -> Vec<u8> {
        match self {
            Self::Empty => Vec::new(),
            Self::Bytes(value) => value.clone(),
            Self::Text(value) => value.as_bytes().to_vec(),
            Self::Blob(value) => value.bytes().to_vec(),
            Self::FormData(value) => value
                .entries()
                .into_iter()
                .map(|(key, value)| match value {
                    FormDataValue::String(value) => format!("{key}={value}"),
                    FormDataValue::File(file) => format!("{key}={}", file.name()),
                })
                .collect::<Vec<_>>()
                .join("&")
                .into_bytes(),
        }
    }

    pub fn text(&self) -> JsResult<String> {
        String::from_utf8(self.bytes()).map_err(|_| type_error("body is not UTF-8"))
    }

    pub fn json(&self) -> JsResult<JsValue> {
        json::parse(&self.text()?)
    }
}

#[derive(Debug, Clone)]
pub struct Request {
    url: String,
    method: String,
    headers: Headers,
    body: Body,
    signal: Option<AbortSignal>,
}

impl Request {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "GET".to_string(),
            headers: Headers::new(),
            body: Body::Empty,
            signal: None,
        }
    }

    pub fn with_init(
        url: impl Into<String>,
        method: impl Into<String>,
        headers: Headers,
        body: Body,
        signal: Option<AbortSignal>,
    ) -> Self {
        Self {
            url: url.into(),
            method: method.into().to_ascii_uppercase(),
            headers,
            body,
            signal,
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn method(&self) -> &str {
        &self.method
    }

    pub fn headers(&self) -> &Headers {
        &self.headers
    }

    pub fn body(&self) -> &Body {
        &self.body
    }

    pub fn signal(&self) -> Option<AbortSignal> {
        self.signal.clone()
    }

    pub fn text(&self) -> JsResult<String> {
        self.body.text()
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        ArrayBuffer::from_bytes(self.body.bytes())
    }

    pub fn json(&self) -> JsResult<JsValue> {
        self.body.json()
    }

    pub fn clone_request(&self) -> Self {
        self.clone()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    status: u16,
    status_text: String,
    headers: Headers,
    body: Body,
}

impl Response {
    pub fn new(body: Body) -> Self {
        Self {
            status: 200,
            status_text: "OK".to_string(),
            headers: Headers::new(),
            body,
        }
    }

    pub fn with_init(
        status: u16,
        status_text: impl Into<String>,
        headers: Headers,
        body: Body,
    ) -> Self {
        Self {
            status,
            status_text: status_text.into(),
            headers,
            body,
        }
    }

    pub fn json(value: &JsValue) -> JsResult<Self> {
        let mut headers = Headers::new();
        headers.set("content-type", "application/json");
        Ok(Self::with_init(
            200,
            "OK",
            headers,
            Body::Text(json::stringify(value)?),
        ))
    }

    pub fn redirect(url: impl Into<String>, status: u16) -> Self {
        let mut headers = Headers::new();
        headers.set("location", url.into());
        Self::with_init(status, "Found", headers, Body::Empty)
    }

    pub fn error() -> Self {
        Self::with_init(0, "", Headers::new(), Body::Empty)
    }

    pub fn status(&self) -> u16 {
        self.status
    }

    pub fn ok(&self) -> bool {
        (200..=299).contains(&self.status)
    }

    pub fn status_text(&self) -> &str {
        &self.status_text
    }

    pub fn headers(&self) -> &Headers {
        &self.headers
    }

    pub fn text(&self) -> JsResult<String> {
        self.body.text()
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        ArrayBuffer::from_bytes(self.body.bytes())
    }

    pub fn json_body(&self) -> JsResult<JsValue> {
        self.body.json()
    }

    pub fn body(&self) -> &Body {
        &self.body
    }

    pub fn clone_response(&self) -> Self {
        self.clone()
    }
}
