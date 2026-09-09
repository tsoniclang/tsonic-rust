mod implementation {
    use tsonic_rust_runtime::TsonicResult;

    pub struct NativeRecord {
        pub value: i32,
    }

    impl NativeRecord {
        pub fn new(value: i32) -> Self {
            Self { value }
        }

        pub fn next(&self) -> TsonicResult<NamedRecord> {
            Ok(NamedRecord {
                value: self.value + 1,
            })
        }
    }

    pub struct NamedRecord {
        pub value: i32,
    }

    pub fn make_record(value: i32) -> TsonicResult<NativeRecord> {
        Ok(NativeRecord::new(value))
    }

    pub fn named(value: i32) -> NamedRecord {
        NamedRecord { value }
    }
}

pub use implementation::{
    make_record as create_record, named, NamedRecord, NativeRecord as PublicRecord,
};
