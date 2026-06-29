impl Buffer {
    pub fn swap16(&mut self) -> NodeResult<&mut Self> {
        self.swap_chunks(2)
    }

    pub fn swap32(&mut self) -> NodeResult<&mut Self> {
        self.swap_chunks(4)
    }

    pub fn swap64(&mut self) -> NodeResult<&mut Self> {
        self.swap_chunks(8)
    }

    pub fn reverse(&mut self) -> &mut Self {
        let mut bytes = self.to_vec();
        bytes.reverse();
        self.storage.borrow_mut()[self.offset..self.offset + self.len].copy_from_slice(&bytes);
        self
    }

    pub fn read_big_uint64_le(&self, offset: usize) -> NodeResult<u64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_big_uint64_be(&self, offset: usize) -> NodeResult<u64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(u64::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_big_int64_le(&self, offset: usize) -> NodeResult<i64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(i64::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_big_int64_be(&self, offset: usize) -> NodeResult<i64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(i64::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_uint32_le(&self, offset: usize) -> NodeResult<u32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(u32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_uint_le(&self, offset: usize, byte_length: usize) -> NodeResult<u64> {
        validate_integer_byte_length(byte_length)?;
        let bytes = self.read_exact(offset, byte_length)?;
        let mut value = 0_u64;
        for (index, byte) in bytes.into_iter().enumerate() {
            value |= u64::from(byte) << (index * 8);
        }
        Ok(value)
    }

    pub fn read_uint_be(&self, offset: usize, byte_length: usize) -> NodeResult<u64> {
        validate_integer_byte_length(byte_length)?;
        let bytes = self.read_exact(offset, byte_length)?;
        let mut value = 0_u64;
        for byte in bytes {
            value = (value << 8) | u64::from(byte);
        }
        Ok(value)
    }

    pub fn read_int_le(&self, offset: usize, byte_length: usize) -> NodeResult<i64> {
        let value = self.read_uint_le(offset, byte_length)?;
        sign_extend(value, byte_length)
    }

    pub fn read_int_be(&self, offset: usize, byte_length: usize) -> NodeResult<i64> {
        let value = self.read_uint_be(offset, byte_length)?;
        sign_extend(value, byte_length)
    }

    pub fn read_uint8(&self, offset: usize) -> NodeResult<u8> {
        Ok(self.read_exact(offset, 1)?[0])
    }

    pub fn read_int8(&self, offset: usize) -> NodeResult<i8> {
        Ok(self.read_uint8(offset)? as i8)
    }

    pub fn read_uint16_le(&self, offset: usize) -> NodeResult<u16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(u16::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_uint16_be(&self, offset: usize) -> NodeResult<u16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(u16::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int16_le(&self, offset: usize) -> NodeResult<i16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(i16::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int16_be(&self, offset: usize) -> NodeResult<i16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(i16::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int32_le(&self, offset: usize) -> NodeResult<i32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(i32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int32_be(&self, offset: usize) -> NodeResult<i32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(i32::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_float_le(&self, offset: usize) -> NodeResult<f32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(f32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_float_be(&self, offset: usize) -> NodeResult<f32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(f32::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_double_le(&self, offset: usize) -> NodeResult<f64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(f64::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_double_be(&self, offset: usize) -> NodeResult<f64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(f64::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn write_uint8(&mut self, value: u8, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &[value])
    }

    pub fn write_uint_le(
        &mut self,
        value: u64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        validate_unsigned_integer_value(value, byte_length)?;
        let bytes = (0..byte_length)
            .map(|index| ((value >> (index * 8)) & 0xff) as u8)
            .collect::<Vec<_>>();
        self.write_exact(offset, &bytes)
    }

    pub fn write_uint_be(
        &mut self,
        value: u64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        validate_unsigned_integer_value(value, byte_length)?;
        let bytes = (0..byte_length)
            .rev()
            .map(|index| ((value >> (index * 8)) & 0xff) as u8)
            .collect::<Vec<_>>();
        self.write_exact(offset, &bytes)
    }

    pub fn write_int_le(
        &mut self,
        value: i64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        let encoded = encode_signed_integer_value(value, byte_length)?;
        self.write_uint_le(encoded, offset, byte_length)
    }

    pub fn write_int_be(
        &mut self,
        value: i64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        let encoded = encode_signed_integer_value(value, byte_length)?;
        self.write_uint_be(encoded, offset, byte_length)
    }

    pub fn write_int8(&mut self, value: i8, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &[value as u8])
    }

    pub fn write_uint16_le(&mut self, value: u16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_uint16_be(&mut self, value: u16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_int16_le(&mut self, value: i16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_int16_be(&mut self, value: i16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn read_uint32_be(&self, offset: usize) -> NodeResult<u32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(u32::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn write_uint32_le(&mut self, value: u32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_uint32_be(&mut self, value: u32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_big_uint64_le(&mut self, value: u64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_big_uint64_be(&mut self, value: u64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_big_int64_le(&mut self, value: i64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_big_int64_be(&mut self, value: i64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_int32_le(&mut self, value: i32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_int32_be(&mut self, value: i32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_float_le(&mut self, value: f32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_float_be(&mut self, value: f32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_double_le(&mut self, value: f64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_double_be(&mut self, value: f64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    fn view(&self, start: isize, end: Option<isize>) -> Self {
        let (start, end) = normalize_range(self.len, start, end);
        Self {
            storage: Rc::clone(&self.storage),
            offset: self.offset + start,
            len: end.saturating_sub(start),
        }
    }

    fn to_vec(&self) -> Vec<u8> {
        self.storage.borrow()[self.offset..self.offset + self.len].to_vec()
    }

    fn read_exact(&self, offset: usize, len: usize) -> NodeResult<Vec<u8>> {
        if offset + len > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer offset out of range",
            ));
        }
        Ok(self.storage.borrow()[self.offset + offset..self.offset + offset + len].to_vec())
    }

    fn write_exact(&mut self, offset: usize, bytes: &[u8]) -> NodeResult<()> {
        if offset + bytes.len() > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer offset out of range",
            ));
        }
        self.storage.borrow_mut()[self.offset + offset..self.offset + offset + bytes.len()]
            .copy_from_slice(bytes);
        Ok(())
    }

    fn swap_chunks(&mut self, width: usize) -> NodeResult<&mut Self> {
        if !self.len.is_multiple_of(width) {
            return Err(NodeError::new(
                "ERR_INVALID_BUFFER_SIZE",
                "buffer length must be a multiple of element size",
            ));
        }
        let mut storage = self.storage.borrow_mut();
        for chunk in storage[self.offset..self.offset + self.len].chunks_exact_mut(width) {
            chunk.reverse();
        }
        drop(storage);
        Ok(self)
    }
}

