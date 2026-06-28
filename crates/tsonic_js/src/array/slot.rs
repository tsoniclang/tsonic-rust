#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsSlot<T> {
    Hole,
    Present(T),
}

impl<T> JsSlot<T> {
    pub fn as_ref(&self) -> Option<&T> {
        match self {
            Self::Hole => None,
            Self::Present(value) => Some(value),
        }
    }
}
