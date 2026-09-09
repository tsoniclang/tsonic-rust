pub struct Probe {
    pub calls: i32,
}

impl Probe {
    pub fn new(calls: i32) -> Self {
        Self { calls }
    }

    pub fn is_some(&mut self) -> bool {
        self.calls += 1;
        true
    }

    pub fn is_none(&mut self) -> bool {
        self.calls += 100;
        true
    }
}

pub struct OnlySome {
    pub calls: i32,
}

impl OnlySome {
    pub fn new(calls: i32) -> Self {
        Self { calls }
    }

    pub fn is_some(&mut self) -> bool {
        self.calls += 1;
        true
    }
}
