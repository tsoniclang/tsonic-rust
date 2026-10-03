import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { printRustSourceFile } from "../../../dist/print/source/index.js";
import { planRustErrorTransport, planRustSourceErrorTransport } from "../../../dist/backend/planner/program/error-transport.js";
import { rustRuntimeCratePath } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native Error-only specialization has handwritten physical size and allocation cost", { timeout: 300_000 }, () => {
  const plan = planRustErrorTransport([{ name: "Huge", type: { kind: "named", path: "Huge" }, source: "thrown" }]);
  assert.ok(plan);
  const generated = printRustSourceFile({ headerComment: "Generated native Error transport cost proof.", items: [
    plan.declaration, ...plan.aliases, ...planRustSourceErrorTransport(plan), ...planRustSourceErrorTransport(plan, true),
  ] });
  const source = `${generated}
#[derive(Clone)]
pub struct Huge(pub [u8; 4096]);

#[derive(Clone)]
pub enum HandwrittenErrorOnly {
    Runtime(tsonic_rust_runtime::TsonicError),
    SourceCreated(tsonic_rust_runtime::MutableJsError),
    Suppressed(Box<TsonicError>, Box<TsonicError>, tsonic_rust_runtime::JsError),
}

impl From<tsonic_rust_runtime::JsError> for TsonicError {
    fn from(value: tsonic_rust_runtime::JsError) -> Self {
        Self::Runtime(tsonic_rust_runtime::TsonicError::from(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    use tsonic_rust_runtime::{ErrorObject, JsError, MutableJsError, WritableErrorObject};

    struct Allocator;
    thread_local! { static COUNT: Cell<Option<usize>> = const { Cell::new(None) }; }
    unsafe impl GlobalAlloc for Allocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            COUNT.with(|count| { if let Some(value) = count.get() { count.set(Some(value + 1)); } });
            unsafe { System.alloc(layout) }
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) { unsafe { System.dealloc(pointer, layout) } }
    }
    #[global_allocator]
    static ALLOCATOR: Allocator = Allocator;

    #[test]
    fn exact_physical_size_and_no_projection_allocation() {
        assert_eq!(std::mem::size_of::<SourceError>(), std::mem::size_of::<HandwrittenErrorOnly>());
        assert_eq!(std::mem::align_of::<SourceError>(), std::mem::align_of::<HandwrittenErrorOnly>());
        assert_eq!(std::mem::size_of::<WritableSourceError>(), std::mem::size_of::<MutableJsError>());
        assert!(std::mem::size_of::<TsonicError>() > 4096);
        assert!(std::mem::size_of::<SourceError>() < 4096);
        let immutable = JsError::error("original");
        let identity = immutable.error_identity_key();
        COUNT.with(|count| count.set(Some(0)));
        let readonly = SourceError::from(immutable);
        let transported = readonly.into_transport();
        let restored = transported.try_into_source_error().ok().unwrap();
        assert_eq!(COUNT.with(|count| count.replace(None).unwrap()), 0);
        match restored.as_transport() {
            ErrorTransport::Runtime(value) => assert_eq!(value.source_error().error_identity_key(), identity),
            _ => panic!("original native owner was replaced"),
        }
        let rejected = TsonicError::Huge(Huge([7; 4096])).try_into_source_error();
        match rejected { Err(ErrorTransport::Huge(value)) => assert_eq!(value.0, [7; 4096]), _ => panic!("non-Error admitted") }
    }

    #[test]
    fn writable_admission_retains_original_handle_and_rejects_immutable_runtime() {
        let immutable = JsError::error("immutable");
        let identity = immutable.error_identity_key();
        match TsonicError::from(immutable).try_into_writable_source_error() {
            Err(ErrorTransport::Runtime(value)) => assert_eq!(value.source_error().error_identity_key(), identity),
            _ => panic!("immutable provider received a fabricated setter"),
        }
        let original = MutableJsError::error("before");
        let identity = original.error_identity_key();
        let alias = original.clone();
        COUNT.with(|count| count.set(Some(0)));
        let writable = WritableSourceError::from(original);
        let readonly = SourceError::from(writable);
        let transported = readonly.into_transport();
        let recovered = transported.try_into_writable_source_error().ok().unwrap();
        assert_eq!(COUNT.with(|count| count.replace(None).unwrap()), 0);
        match recovered.as_transport() {
            ErrorTransport::SourceCreated(value) => {
                value.set_error_message(String::from("after"));
                assert_eq!(value.error_identity_key(), identity);
                assert_eq!(alias.error_message(), "after");
            }
            _ => panic!("original mutable owner was replaced"),
        }
    }
}
`;
  const formatted = spawnSync("rustfmt", ["--emit", "stdout", "--edition", "2024"], { input: source, encoding: "utf8", timeout: 30_000 });
  assert.equal(formatted.status, 0, formatted.stderr);
  validateGeneratedProject("error-transport-cost", [
    { path: "Cargo.toml", text: `[package]\nname = "irene_error_transport_cost"\nversion = "0.1.0"\nedition = "2024"\n[dependencies]\ntsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)} }\n` },
    { path: "src/lib.rs", text: formatted.stdout },
  ]);
});
