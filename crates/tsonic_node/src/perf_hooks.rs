use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

pub fn performance_now() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}
