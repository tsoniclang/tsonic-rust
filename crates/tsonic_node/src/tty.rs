pub fn isatty(_fd: i32) -> bool {
    false
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadStream {
    fd: i32,
    is_raw: bool,
}

impl ReadStream {
    pub fn new(fd: i32) -> Self {
        Self { fd, is_raw: false }
    }

    pub fn fd(&self) -> i32 {
        self.fd
    }

    pub fn is_tty(&self) -> bool {
        isatty(self.fd)
    }

    pub fn is_raw(&self) -> bool {
        self.is_raw
    }

    pub fn set_raw_mode(&mut self, mode: bool) {
        self.is_raw = mode;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteStream {
    fd: i32,
    columns: u16,
    rows: u16,
}

impl WriteStream {
    pub fn new(fd: i32) -> Self {
        Self {
            fd,
            columns: 80,
            rows: 24,
        }
    }

    pub fn fd(&self) -> i32 {
        self.fd
    }

    pub fn is_tty(&self) -> bool {
        isatty(self.fd)
    }

    pub fn columns(&self) -> u16 {
        self.columns
    }

    pub fn rows(&self) -> u16 {
        self.rows
    }

    pub fn get_color_depth(&self) -> u8 {
        1
    }

    pub fn has_colors(&self) -> bool {
        false
    }

    pub fn clear_line(&self) -> bool {
        false
    }

    pub fn clear_screen_down(&self) -> bool {
        false
    }

    pub fn cursor_to(&self, _x: u16, _y: Option<u16>) -> bool {
        false
    }

    pub fn move_cursor(&self, _dx: i16, _dy: i16) -> bool {
        false
    }
}
