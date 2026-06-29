pub struct Socket {
    stream: Option<TcpStream>,
    bytes_read: u64,
    bytes_written: u64,
    timeout: Option<u64>,
    encoding: Option<String>,
    refed: bool,
    destroyed: bool,
    paused: bool,
    allow_half_open: bool,
    keep_alive: bool,
    keep_alive_initial_delay: Option<u64>,
    type_of_service: Option<u32>,
}

impl Socket {
    pub fn connect(host: &str, port: u16) -> NodeResult<Self> {
        let stream = TcpStream::connect((host, port)).map_err(map_net_error)?;
        Ok(Self::from_stream(stream))
    }

    pub fn from_stream(stream: TcpStream) -> Self {
        Self {
            stream: Some(stream),
            bytes_read: 0,
            bytes_written: 0,
            timeout: None,
            encoding: None,
            refed: true,
            destroyed: false,
            paused: false,
            allow_half_open: false,
            keep_alive: false,
            keep_alive_initial_delay: None,
            type_of_service: None,
        }
    }

    pub fn new_with_options(options: SocketConstructorOpts) -> NodeResult<Self> {
        if options.fd.is_some() {
            return Err(NodeError::new(
                "ERR_UNSUPPORTED_FD_SOCKET",
                "fd-backed socket construction is not supported by the closed Rust runtime",
            ));
        }
        Ok(Self {
            stream: None,
            bytes_read: 0,
            bytes_written: 0,
            timeout: None,
            encoding: None,
            refed: true,
            destroyed: false,
            paused: false,
            allow_half_open: options.allow_half_open,
            keep_alive: false,
            keep_alive_initial_delay: None,
            type_of_service: None,
        })
    }

    pub fn write_all(&mut self, data: &[u8]) -> NodeResult<()> {
        self.stream_mut()?.write_all(data).map_err(map_net_error)?;
        self.bytes_written += data.len() as u64;
        Ok(())
    }

    pub fn write(&mut self, data: &[u8]) -> NodeResult<bool> {
        self.write_all(data)?;
        Ok(true)
    }

    pub fn read_to_end(&mut self) -> NodeResult<Vec<u8>> {
        let mut data = Vec::new();
        self.stream_mut()?
            .read_to_end(&mut data)
            .map_err(map_net_error)?;
        self.bytes_read += data.len() as u64;
        Ok(data)
    }

    pub fn end(&mut self, data: Option<&[u8]>) -> NodeResult<()> {
        if let Some(data) = data {
            self.write_all(data)?;
        }
        self.stream()?
            .shutdown(Shutdown::Write)
            .map_err(map_net_error)
    }

    pub fn shutdown(&self) -> NodeResult<()> {
        self.stream()?
            .shutdown(Shutdown::Both)
            .map_err(map_net_error)
    }

    pub fn destroy(&mut self) -> NodeResult<()> {
        self.destroyed = true;
        self.shutdown()
    }

    pub fn destroy_soon(&mut self) -> NodeResult<()> {
        self.destroy()
    }

    pub fn reset_and_destroy(&mut self) -> NodeResult<()> {
        self.destroy()
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn address(&self) -> NodeResult<AddressInfo> {
        self.stream()?
            .local_addr()
            .map(address_info)
            .map_err(map_net_error)
    }

    pub fn local_address(&self) -> NodeResult<String> {
        self.stream()?
            .local_addr()
            .map(|addr| addr.ip().to_string())
            .map_err(map_net_error)
    }

    pub fn local_port(&self) -> NodeResult<u16> {
        self.stream()?
            .local_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn local_family(&self) -> NodeResult<String> {
        self.stream()?
            .local_addr()
            .map(|addr| family_string(addr.ip()))
            .map_err(map_net_error)
    }

    pub fn remote_address(&self) -> NodeResult<String> {
        self.stream()?
            .peer_addr()
            .map(|addr| addr.ip().to_string())
            .map_err(map_net_error)
    }

    pub fn remote_port(&self) -> NodeResult<u16> {
        self.stream()?
            .peer_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn remote_family(&self) -> NodeResult<String> {
        self.stream()?
            .peer_addr()
            .map(|addr| family_string(addr.ip()))
            .map_err(map_net_error)
    }

    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    pub fn buffer_size(&self) -> usize {
        0
    }

    pub fn pending(&self) -> bool {
        self.stream.is_none() && !self.destroyed
    }

    pub fn connecting(&self) -> bool {
        false
    }

    pub fn ready_state(&self) -> &'static str {
        if self.destroyed {
            "closed"
        } else if self.paused {
            "readOnly"
        } else {
            "open"
        }
    }

    pub fn set_no_delay(&self, no_delay: bool) -> NodeResult<()> {
        self.stream()?.set_nodelay(no_delay).map_err(map_net_error)
    }

    pub fn set_keep_alive(
        &mut self,
        keep_alive: bool,
        initial_delay_millis: Option<u64>,
    ) -> NodeResult<()> {
        self.keep_alive = keep_alive;
        self.keep_alive_initial_delay = initial_delay_millis;
        Ok(())
    }

    pub fn keep_alive(&self) -> bool {
        self.keep_alive
    }

    pub fn keep_alive_initial_delay(&self) -> Option<u64> {
        self.keep_alive_initial_delay
    }

    pub fn set_type_of_service(&mut self, value: u32) -> NodeResult<()> {
        self.type_of_service = Some(value);
        Ok(())
    }

    pub fn type_of_service(&self) -> Option<u32> {
        self.type_of_service
    }

    pub fn set_timeout(&mut self, timeout_millis: u64) -> NodeResult<()> {
        self.timeout = Some(timeout_millis);
        let duration = Some(Duration::from_millis(timeout_millis));
        self.stream()?
            .set_read_timeout(duration)
            .map_err(map_net_error)?;
        self.stream()?
            .set_write_timeout(duration)
            .map_err(map_net_error)
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn set_encoding(&mut self, encoding: &str) {
        self.encoding = Some(encoding.to_ascii_lowercase());
    }

    pub fn encoding(&self) -> Option<&str> {
        self.encoding.as_deref()
    }

    pub fn r#ref(&mut self) {
        self.refed = true;
    }

    pub fn unref(&mut self) {
        self.refed = false;
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.paused = false;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn allow_half_open(&self) -> bool {
        self.allow_half_open
    }

    fn stream(&self) -> NodeResult<&TcpStream> {
        self.stream
            .as_ref()
            .ok_or_else(|| NodeError::new("ENOTCONN", "socket is not connected"))
    }

    fn stream_mut(&mut self) -> NodeResult<&mut TcpStream> {
        self.stream
            .as_mut()
            .ok_or_else(|| NodeError::new("ENOTCONN", "socket is not connected"))
    }
}

