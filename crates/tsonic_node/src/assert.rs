use crate::error::{NodeError, NodeResult};

pub fn ok(value: bool, message: Option<&str>) -> NodeResult<()> {
    if value {
        Ok(())
    } else {
        Err(NodeError::new(
            "ERR_ASSERTION",
            message.unwrap_or("assertion failed"),
        ))
    }
}

pub fn strict_equal<T>(left: &T, right: &T, message: Option<&str>) -> NodeResult<()>
where
    T: PartialEq + std::fmt::Debug,
{
    if left == right {
        Ok(())
    } else {
        Err(NodeError::new(
            "ERR_ASSERTION",
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected {left:?} to strictly equal {right:?}")),
        ))
    }
}
