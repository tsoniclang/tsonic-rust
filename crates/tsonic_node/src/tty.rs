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

    pub fn set_raw_mode(&mut self, mode: bool) -> &mut Self {
        self.is_raw = mode;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteStream {
    fd: i32,
    columns: u16,
    rows: u16,
    cursor_x: u16,
    cursor_y: u16,
    color_depth: u8,
}

impl WriteStream {
    pub fn new(fd: i32) -> Self {
        Self {
            fd,
            columns: 80,
            rows: 24,
            cursor_x: 0,
            cursor_y: 0,
            color_depth: 1,
        }
    }

    pub fn with_size(fd: i32, columns: u16, rows: u16) -> Self {
        Self {
            fd,
            columns,
            rows,
            cursor_x: 0,
            cursor_y: 0,
            color_depth: 1,
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

    pub fn set_window_size(&mut self, columns: u16, rows: u16) {
        self.columns = columns;
        self.rows = rows;
    }

    pub fn get_window_size(&self) -> (u16, u16) {
        (self.columns, self.rows)
    }

    pub fn cursor(&self) -> (u16, u16) {
        (self.cursor_x, self.cursor_y)
    }

    pub fn get_color_depth(&self) -> u8 {
        self.color_depth
    }

    pub fn set_color_depth(&mut self, depth: u8) {
        self.color_depth = depth.max(1);
    }

    pub fn has_colors(&self) -> bool {
        self.color_depth >= 4
    }

    pub fn clear_line(&self) -> bool {
        true
    }

    pub fn clear_line_with_callback(&self, callback: impl FnOnce()) -> bool {
        callback();
        self.clear_line()
    }

    pub fn clear_screen_down(&self) -> bool {
        true
    }

    pub fn clear_screen_down_with_callback(&self, callback: impl FnOnce()) -> bool {
        callback();
        self.clear_screen_down()
    }

    pub fn cursor_to(&mut self, x: u16, y: Option<u16>) -> bool {
        self.cursor_x = x;
        if let Some(y) = y {
            self.cursor_y = y;
        }
        true
    }

    pub fn cursor_to_with_callback(
        &mut self,
        x: u16,
        y: Option<u16>,
        callback: impl FnOnce(),
    ) -> bool {
        let moved = self.cursor_to(x, y);
        callback();
        moved
    }

    pub fn move_cursor(&mut self, dx: i16, dy: i16) -> bool {
        self.cursor_x = self.cursor_x.saturating_add_signed(dx);
        self.cursor_y = self.cursor_y.saturating_add_signed(dy);
        true
    }

    pub fn move_cursor_with_callback(&mut self, dx: i16, dy: i16, callback: impl FnOnce()) -> bool {
        let moved = self.move_cursor(dx, dy);
        callback();
        moved
    }
}
