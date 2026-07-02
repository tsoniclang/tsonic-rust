//! Fake provider crate proving std::ops operator-trait metadata.

use std::ops::Add;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vector {
    pub x: i32,
    pub y: i32,
}

impl Vector {
    pub fn new(x: i32, y: i32) -> Vector {
        Vector { x, y }
    }
}

impl Add for Vector {
    type Output = Vector;

    fn add(self, other: Vector) -> Vector {
        Vector {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}

pub fn magnitude(v: &Vector) -> i32 {
    v.x * v.x + v.y * v.y
}

pub fn consume(v: Vector) -> i32 {
    v.x + v.y
}
