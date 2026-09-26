pub struct DomainIndex(usize);

impl DomainIndex {
    pub fn new(value: usize) -> Self {
        Self(value)
    }

    pub fn get(&self) -> usize {
        self.0
    }
}

pub struct BorrowedBuffer<'a> {
    values: &'a mut [i32],
}

impl<'a> BorrowedBuffer<'a> {
    pub fn new(values: &'a mut [i32]) -> Self {
        Self { values }
    }

    pub fn get_mut(&mut self, index: DomainIndex) -> Option<&mut i32> {
        self.values.get_mut(index.0)
    }
}
