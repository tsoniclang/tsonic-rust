//! Fake provider crate proving constructor/property/indexer operations.

pub struct Store {
    pub count: i32,
    seed_len: i32,
}

impl Store {
    pub fn new(seed: String) -> Store {
        let seed_len = i32::try_from(seed.len()).unwrap_or(i32::MAX);
        Store {
            count: seed_len,
            seed_len,
        }
    }

    pub fn get(&self, index: i32) -> i32 {
        self.seed_len + index
    }
}

pub fn env_home_dir() -> String {
    String::from("/home/acme")
}
