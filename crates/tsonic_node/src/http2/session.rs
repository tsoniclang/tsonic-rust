#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Session {
    id: u64,
    authority: String,
    closed: bool,
    destroyed: bool,
    goaway_code: Option<u32>,
    local_settings: Http2Settings,
    remote_settings: Http2Settings,
    timeout: Option<u64>,
    pending_streams: usize,
    connecting: bool,
    encrypted: bool,
    alpn_protocol: Option<String>,
    origin_set: Vec<String>,
    pending_settings_ack: bool,
    refed: bool,
    session_type: u32,
}

impl Http2Session {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn connecting(&self) -> bool {
        self.connecting
    }

    pub fn encrypted(&self) -> bool {
        self.encrypted
    }

    pub fn alpn_protocol(&self) -> Option<&str> {
        self.alpn_protocol.as_deref()
    }

    pub fn origin_set(&self) -> &[String] {
        &self.origin_set
    }

    pub fn pending_settings_ack(&self) -> bool {
        self.pending_settings_ack
    }

    pub fn session_type(&self) -> u32 {
        self.session_type
    }

    pub fn state(&self) -> Http2SessionState {
        Http2SessionState {
            effective_local_window_size: self.local_settings.initial_window_size,
            effective_recv_data_length: 0,
            next_stream_id: (self.pending_streams as u32).saturating_add(1),
            local_window_size: self.local_settings.initial_window_size,
            last_proc_stream_id: 0,
            remote_window_size: self.remote_settings.initial_window_size,
            outbound_queue_size: self.pending_streams,
            deflate_dynamic_table_size: self.local_settings.header_table_size,
            inflate_dynamic_table_size: self.remote_settings.header_table_size,
        }
    }

    pub fn local_settings(&self) -> &Http2Settings {
        &self.local_settings
    }

    pub fn remote_settings(&self) -> &Http2Settings {
        &self.remote_settings
    }

    pub fn settings(&mut self, settings: Http2Settings) {
        self.local_settings = settings;
        self.pending_settings_ack = true;
    }

    pub fn acknowledge_settings(&mut self) {
        self.pending_settings_ack = false;
    }

    pub fn set_local_window_size(&mut self, window_size: u32) {
        self.local_settings.initial_window_size = window_size;
    }

    pub fn set_timeout(&mut self, timeout_millis: u64, callback: Option<impl FnOnce()>) {
        self.timeout = Some(timeout_millis);
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn ping(&self, payload: &[u8]) -> NodeResult<Vec<u8>> {
        if payload.len() > 8 {
            return Err(NodeError::new(
                "ERR_HTTP2_PING_LENGTH",
                "ping payload too large",
            ));
        }
        let mut result = vec![0; 8];
        result[..payload.len()].copy_from_slice(payload);
        Ok(result)
    }

    pub fn goaway(&mut self, code: u32) {
        self.goaway_code = Some(code);
        self.closed = true;
    }

    pub fn goaway_code(&self) -> Option<u32> {
        self.goaway_code
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn close_with_callback(&mut self, callback: Option<impl FnOnce()>) {
        self.close();
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
        self.closed = true;
    }

    pub fn destroy_with_code(&mut self, code: u32) {
        self.goaway_code = Some(code);
        self.destroy();
    }

    pub fn ref_(&mut self) {
        self.refed = true;
    }

    pub fn unref(&mut self) {
        self.refed = false;
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }
}
