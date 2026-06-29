impl Buffer {
    pub fn alloc(size: usize) -> Self {
        Self::from_bytes(vec![0; size])
    }

    pub fn alloc_with_fill(size: usize, fill: BufferValue) -> NodeResult<Self> {
        let mut buffer = Self::alloc(size);
        buffer.fill_value(fill, 0, None)?;
        Ok(buffer)
    }

    pub fn alloc_unsafe(size: usize) -> Self {
        Self::alloc(size)
    }

    pub fn alloc_unsafe_slow(size: usize) -> Self {
        Self::alloc(size)
    }

    pub fn of(items: &[u8]) -> Self {
        Self::from_bytes(items.to_vec())
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        let len = bytes.len();
        Self {
            storage: Rc::new(RefCell::new(bytes)),
            offset: 0,
            len,
        }
    }

    pub fn from_string(value: &str, encoding: Option<&str>) -> NodeResult<Self> {
        Ok(Self::from_bytes(encode_string(value, encoding)?))
    }

    pub fn from_array_like(values: &[u8]) -> Self {
        Self::from_bytes(values.to_vec())
    }

    pub fn copy_bytes_from(view: &[u8], offset: usize, length: Option<usize>) -> NodeResult<Self> {
        if offset > view.len() {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "copyBytesFrom offset is outside view",
            ));
        }
        let end = offset.saturating_add(length.unwrap_or(view.len() - offset));
        if end > view.len() {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "copyBytesFrom length is outside view",
            ));
        }
        Ok(Self::from_bytes(view[offset..end].to_vec()))
    }

    pub fn byte_length(value: &str, encoding: Option<&str>) -> NodeResult<usize> {
        Ok(encode_string(value, encoding)?.len())
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_bytes(&self) -> Vec<u8> {
        self.to_vec()
    }

    pub fn get(&self, index: usize) -> Option<u8> {
        if index >= self.len {
            return None;
        }
        Some(self.storage.borrow()[self.offset + index])
    }

    pub fn set(&mut self, index: usize, value: u8) -> NodeResult<()> {
        if index >= self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer index out of range",
            ));
        }
        self.storage.borrow_mut()[self.offset + index] = value;
        Ok(())
    }

    pub fn fill(&mut self, value: u8, start: usize, end: Option<usize>) -> NodeResult<&mut Self> {
        self.fill_bytes(&[value], start, end)
    }

    pub fn fill_value(
        &mut self,
        value: BufferValue,
        start: usize,
        end: Option<usize>,
    ) -> NodeResult<&mut Self> {
        let bytes = value.into_bytes()?;
        self.fill_bytes(&bytes, start, end)
    }

    pub fn fill_string(
        &mut self,
        value: &str,
        start: usize,
        end: Option<usize>,
        encoding: Option<&str>,
    ) -> NodeResult<&mut Self> {
        self.fill_value(BufferValue::text(value, encoding), start, end)
    }

    pub fn fill_bytes(
        &mut self,
        value: &[u8],
        start: usize,
        end: Option<usize>,
    ) -> NodeResult<&mut Self> {
        let end = end.unwrap_or(self.len).min(self.len);
        if start > end {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer fill start is after end",
            ));
        }
        if value.is_empty() {
            return Ok(self);
        }
        for (write_index, index) in (start..end).enumerate() {
            self.set(index, value[write_index % value.len()])?;
        }
        Ok(self)
    }

    pub fn copy(
        &self,
        target: &mut Buffer,
        target_start: usize,
        source_start: usize,
        source_end: Option<usize>,
    ) -> NodeResult<usize> {
        if target_start > target.len || source_start > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer copy range is outside buffer",
            ));
        }
        let source_end = source_end.unwrap_or(self.len).min(self.len);
        if source_start > source_end {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer copy source start is after source end",
            ));
        }
        let count = (source_end - source_start).min(target.len - target_start);
        let bytes = self.read_exact(source_start, count)?;
        target.write_exact(target_start, &bytes)?;
        Ok(count)
    }

    pub fn copy_to_slice(
        &self,
        target: &mut [u8],
        target_start: usize,
        source_start: usize,
        source_end: Option<usize>,
    ) -> NodeResult<usize> {
        if target_start > target.len() || source_start > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer copy range is outside buffer",
            ));
        }
        let source_end = source_end.unwrap_or(self.len).min(self.len);
        if source_start > source_end {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer copy source start is after source end",
            ));
        }
        let count = (source_end - source_start).min(target.len() - target_start);
        let bytes = self.read_exact(source_start, count)?;
        target[target_start..target_start + count].copy_from_slice(&bytes);
        Ok(count)
    }

    pub fn slice(&self, start: isize, end: Option<isize>) -> Self {
        self.view(start, end)
    }

    pub fn subarray(&self, start: isize, end: Option<isize>) -> Self {
        self.view(start, end)
    }

    pub fn to_string(&self, encoding: Option<&str>) -> NodeResult<String> {
        decode_bytes(&self.to_vec(), encoding)
    }

    pub fn to_json(&self) -> JsValue {
        let values = self
            .to_vec()
            .into_iter()
            .map(|byte| JsValue::Number(f64::from(byte)))
            .collect::<Vec<_>>();
        JsValue::Object(JsObject::from_pairs([
            ("type", JsValue::String("Buffer".to_string())),
            ("data", JsValue::from(values)),
        ]))
    }

    pub fn equals(&self, other: &Buffer) -> bool {
        self.to_vec() == other.to_vec()
    }

    pub fn compare(&self, other: &Buffer) -> i32 {
        match self.to_vec().cmp(&other.to_vec()) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }

    pub fn includes(&self, needle: &[u8], byte_offset: isize) -> bool {
        self.index_of(needle, byte_offset).is_some()
    }

    pub fn includes_value(&self, needle: BufferValue, byte_offset: isize) -> NodeResult<bool> {
        Ok(self.index_of_value(needle, byte_offset)?.is_some())
    }

    pub fn includes_string(
        &self,
        needle: &str,
        byte_offset: isize,
        encoding: Option<&str>,
    ) -> NodeResult<bool> {
        self.includes_value(BufferValue::text(needle, encoding), byte_offset)
    }

    pub fn index_of(&self, needle: &[u8], byte_offset: isize) -> Option<usize> {
        if needle.is_empty() {
            return Some(normalize_search_start(self.len, byte_offset));
        }
        let start = normalize_search_start(self.len, byte_offset);
        self.to_vec()[start..]
            .windows(needle.len())
            .position(|window| window == needle)
            .map(|index| index + start)
    }

    pub fn index_of_value(
        &self,
        needle: BufferValue,
        byte_offset: isize,
    ) -> NodeResult<Option<usize>> {
        Ok(self.index_of(&needle.into_bytes()?, byte_offset))
    }

    pub fn index_of_string(
        &self,
        needle: &str,
        byte_offset: isize,
        encoding: Option<&str>,
    ) -> NodeResult<Option<usize>> {
        self.index_of_value(BufferValue::text(needle, encoding), byte_offset)
    }

    pub fn last_index_of(&self, needle: &[u8], byte_offset: Option<isize>) -> Option<usize> {
        if needle.is_empty() {
            return Some(
                byte_offset.map_or(self.len, |offset| normalize_search_start(self.len, offset)),
            );
        }
        if needle.len() > self.len {
            return None;
        }
        let max_start = self.len - needle.len();
        let start = byte_offset
            .map(|offset| normalize_search_start(self.len, offset).min(max_start))
            .unwrap_or(max_start);
        let bytes = self.to_vec();
        (0..=start)
            .rev()
            .find(|index| &bytes[*index..*index + needle.len()] == needle)
    }

    pub fn last_index_of_value(
        &self,
        needle: BufferValue,
        byte_offset: Option<isize>,
    ) -> NodeResult<Option<usize>> {
        Ok(self.last_index_of(&needle.into_bytes()?, byte_offset))
    }

    pub fn last_index_of_string(
        &self,
        needle: &str,
        byte_offset: Option<isize>,
        encoding: Option<&str>,
    ) -> NodeResult<Option<usize>> {
        self.last_index_of_value(BufferValue::text(needle, encoding), byte_offset)
    }

    pub fn concat(buffers: &[Buffer]) -> Buffer {
        let mut out = Vec::new();
        for buffer in buffers {
            out.extend_from_slice(&buffer.to_vec());
        }
        Buffer::from_bytes(out)
    }

    pub fn concat_with_total_length(buffers: &[Buffer], total_length: usize) -> Buffer {
        let mut out = Vec::with_capacity(total_length);
        for buffer in buffers {
            out.extend_from_slice(&buffer.to_vec());
            if out.len() >= total_length {
                out.truncate(total_length);
                return Buffer::from_bytes(out);
            }
        }
        out.resize(total_length, 0);
        Buffer::from_bytes(out)
    }

    pub fn write(
        &mut self,
        value: &str,
        offset: usize,
        length: Option<usize>,
        encoding: Option<&str>,
    ) -> NodeResult<usize> {
        if offset > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer write offset out of range",
            ));
        }
        let bytes = encode_string(value, encoding)?;
        let count = bytes
            .len()
            .min(length.unwrap_or(bytes.len()))
            .min(self.len - offset);
        self.write_exact(offset, &bytes[..count])?;
        Ok(count)
    }
}
