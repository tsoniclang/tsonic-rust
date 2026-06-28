use super::slot::JsSlot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsArray<T> {
    length: usize,
    slots: Vec<JsSlot<T>>,
}

impl<T> JsArray<T> {
    pub fn new() -> Self {
        Self {
            length: 0,
            slots: Vec::new(),
        }
    }

    pub fn with_length(length: usize) -> Self {
        let mut slots = Vec::new();
        slots.resize_with(length, || JsSlot::Hole);
        Self { length, slots }
    }

    pub fn from_dense(values: Vec<T>) -> Self {
        let length = values.len();
        Self {
            length,
            slots: values.into_iter().map(JsSlot::Present).collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.length
    }

    pub fn is_empty(&self) -> bool {
        self.length == 0
    }

    pub fn set_len(&mut self, len: usize) {
        self.length = len;
        self.slots.truncate(len);
        if self.slots.len() < len {
            self.slots.resize_with(len, || JsSlot::Hole);
        }
    }

    pub fn has_index(&self, index: usize) -> bool {
        index < self.length && matches!(self.slots.get(index), Some(JsSlot::Present(_)))
    }

    pub fn delete_at(&mut self, index: usize) -> bool {
        if index >= self.length {
            return true;
        }
        if self.slots.len() <= index {
            self.slots.resize_with(index + 1, || JsSlot::Hole);
        }
        let existed = matches!(self.slots[index], JsSlot::Present(_));
        self.slots[index] = JsSlot::Hole;
        existed
    }

    pub fn get(&self, index: usize) -> Option<&T> {
        if index >= self.length {
            return None;
        }
        self.slots.get(index).and_then(JsSlot::as_ref)
    }

    pub fn set(&mut self, index: usize, value: T) {
        if index >= self.length {
            self.length = index + 1;
        }
        if self.slots.len() <= index {
            self.slots.resize_with(index + 1, || JsSlot::Hole);
        }
        self.slots[index] = JsSlot::Present(value);
    }

    pub fn push(&mut self, value: T) -> usize {
        self.set(self.length, value);
        self.length
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.length == 0 {
            return None;
        }
        self.length -= 1;
        match self.slots.pop() {
            Some(JsSlot::Present(value)) => Some(value),
            _ => None,
        }
    }

    pub fn shift(&mut self) -> Option<T> {
        if self.length == 0 {
            return None;
        }
        self.length -= 1;
        match if self.slots.is_empty() {
            JsSlot::Hole
        } else {
            self.slots.remove(0)
        } {
            JsSlot::Present(value) => Some(value),
            JsSlot::Hole => None,
        }
    }

    pub fn unshift(&mut self, value: T) -> usize {
        self.slots.insert(0, JsSlot::Present(value));
        self.length += 1;
        self.length
    }

    pub fn fill(&mut self, value: T, start: isize, end: Option<isize>)
    where
        T: Clone,
    {
        let (start, end) = normalize_range(self.length, start, end);
        for index in start..end {
            self.set(index, value.clone());
        }
    }

    pub fn copy_within(&mut self, target: isize, start: isize, end: Option<isize>)
    where
        T: Clone,
    {
        let to = normalize_index(self.length, target);
        let (from, end) = normalize_range(self.length, start, end);
        let count = end.saturating_sub(from).min(self.length.saturating_sub(to));
        let copied = (0..count)
            .map(|offset| {
                self.slots
                    .get(from + offset)
                    .cloned()
                    .unwrap_or(JsSlot::Hole)
            })
            .collect::<Vec<_>>();
        for (offset, slot) in copied.into_iter().enumerate() {
            if to + offset >= self.slots.len() {
                self.slots.resize_with(to + offset + 1, || JsSlot::Hole);
            }
            self.slots[to + offset] = slot;
        }
    }

    pub fn reverse(&mut self) {
        self.slots.resize_with(self.length, || JsSlot::Hole);
        self.slots.reverse();
    }

    pub fn splice(&mut self, start: isize, delete_count: usize, items: Vec<T>) -> Vec<Option<T>> {
        let start = normalize_index(self.length, start);
        let delete_count = delete_count.min(self.length.saturating_sub(start));
        self.slots.resize_with(self.length, || JsSlot::Hole);
        let removed_slots = self
            .slots
            .splice(
                start..start + delete_count,
                items.into_iter().map(JsSlot::Present),
            )
            .collect::<Vec<_>>();
        self.length = self.slots.len();
        removed_slots
            .into_iter()
            .map(|slot| match slot {
                JsSlot::Present(value) => Some(value),
                JsSlot::Hole => None,
            })
            .collect()
    }

    pub fn keys(&self) -> Vec<usize> {
        (0..self.length).collect()
    }

    pub fn values(&self) -> Vec<Option<&T>> {
        (0..self.length).map(|index| self.get(index)).collect()
    }

    pub fn entries(&self) -> Vec<(usize, Option<&T>)> {
        (0..self.length)
            .map(|index| (index, self.get(index)))
            .collect()
    }

    pub fn sort_by_js_string(&mut self)
    where
        T: Clone + crate::string::JsToString,
    {
        let mut present = self
            .slots
            .iter()
            .filter_map(|slot| slot.as_ref().cloned())
            .collect::<Vec<_>>();
        present.sort_by_key(|item| item.to_js_string());
        let present_len = present.len();
        self.slots = present.into_iter().map(JsSlot::Present).collect();
        self.slots
            .resize_with(self.length.max(present_len), || JsSlot::Hole);
    }

    pub fn map<U, F>(&self, mut mapper: F) -> JsArray<U>
    where
        F: FnMut(&T) -> U,
    {
        let mut out = JsArray::with_length(self.length);
        for (index, value) in self.values().into_iter().enumerate() {
            if let Some(value) = value {
                out.set(index, mapper(value));
            }
        }
        out
    }

    pub fn filter<F>(&self, mut predicate: F) -> JsArray<T>
    where
        T: Clone,
        F: FnMut(&T) -> bool,
    {
        JsArray::from_dense(
            self.values()
                .into_iter()
                .flatten()
                .filter(|value| predicate(value))
                .cloned()
                .collect(),
        )
    }

    pub fn reduce<U, F>(&self, initial: U, mut reducer: F) -> U
    where
        F: FnMut(U, &T) -> U,
    {
        let mut acc = initial;
        for value in self.values().into_iter().flatten() {
            acc = reducer(acc, value);
        }
        acc
    }

    pub fn to_reversed(&self) -> Self
    where
        T: Clone,
    {
        let mut out = self.clone();
        out.reverse();
        out
    }
}

impl<T> Default for JsArray<T> {
    fn default() -> Self {
        Self::new()
    }
}

fn normalize_range(len: usize, start: isize, end: Option<isize>) -> (usize, usize) {
    let start = normalize_index(len, start);
    let end = normalize_index(len, end.unwrap_or(len as isize));
    if end < start {
        (start, start)
    } else {
        (start, end)
    }
}

fn normalize_index(len: usize, index: isize) -> usize {
    let len = len as isize;
    let normalized = if index < 0 { len + index } else { index };
    normalized.clamp(0, len) as usize
}
