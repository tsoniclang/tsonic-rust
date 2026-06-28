use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use tsonic_js::JsValue;

use crate::error::{NodeError, NodeResult};

pub struct MessagePort {
    sender: Sender<JsValue>,
    receiver: Receiver<JsValue>,
    closed: bool,
}

impl MessagePort {
    pub fn post_message(&self, value: JsValue) -> NodeResult<()> {
        if self.closed {
            return Err(NodeError::new(
                "ERR_CLOSED_MESSAGE_PORT",
                "message port is closed",
            ));
        }
        self.sender
            .send(value)
            .map_err(|error| NodeError::new("ERR_CLOSED_MESSAGE_PORT", error.to_string()))
    }

    pub fn receive_message(&self) -> Option<JsValue> {
        self.receiver.try_recv().ok()
    }

    pub fn close(&mut self) {
        self.closed = true;
    }
}

pub struct MessageChannel {
    pub port1: MessagePort,
    pub port2: MessagePort,
}

impl MessageChannel {
    pub fn new() -> Self {
        let (sender1, receiver1) = mpsc::channel();
        let (sender2, receiver2) = mpsc::channel();
        Self {
            port1: MessagePort {
                sender: sender1,
                receiver: receiver2,
                closed: false,
            },
            port2: MessagePort {
                sender: sender2,
                receiver: receiver1,
                closed: false,
            },
        }
    }
}

impl Default for MessageChannel {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Worker<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T: Send + 'static> Worker<T> {
    pub fn spawn(task: impl FnOnce() -> T + Send + 'static) -> Self {
        Self {
            handle: Some(thread::spawn(task)),
        }
    }

    pub fn join(mut self) -> NodeResult<T> {
        let handle = self
            .handle
            .take()
            .ok_or_else(|| NodeError::new("ERR_WORKER_NOT_RUNNING", "worker already joined"))?;
        handle
            .join()
            .map_err(|_| NodeError::new("ERR_WORKER_FAILURE", "worker panicked"))
    }
}

pub fn receive_message_on_port(port: &MessagePort) -> Option<JsValue> {
    port.receive_message()
}
