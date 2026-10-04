import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  test(`ordinary unknown throws preserve closed payloads and original Error owners in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "lib", crateName: "closed_unknown_throws" } },
      files: { "index.ts": `
export function raise(value: unknown, shouldThrow: boolean): unknown {
  if (shouldThrow) throw value;
  return value;
}
export function relay(value: unknown): unknown {
  try { return raise(value, true); }
  catch (error) { throw error; }
}
export function caught(value: unknown): unknown {
  try { throw value; }
  catch { return value; }
}
export function finalized(value: unknown): unknown {
  try { throw value; }
  finally { return value; }
}
` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /TsonicError::from/u);
    const type = profile === "native" ? "tsonic_rust_runtime::TsValue" : "tsonic_rust_js::value::JsValue";
    const variant = profile === "native" ? "ClosedNative" : "ClosedJs";
    const integer = profile === "native" ? "ClosedValue::from(u64::MAX)" : "ClosedValue::UnsignedInteger(u64::MAX)";
    const string = profile === "native" ? "ClosedValue::from(text)" : "ClosedValue::String(text)";
    const directory = writeGeneratedProject(`closed-unknown-throws-${profile}`, result.artifacts);
    mkdirSync(join(directory, "tests"), { recursive: true });
    writeFileSync(join(directory, "tests/closed.rs"), `${nativeOwnershipCostSupport}
use closed_unknown_throws::{index, program::{ErrorTransport, SourceError, TsonicError}};
use ${type} as ClosedValue;
use tsonic_rust_runtime::{ErrorObject, JsError, MutableJsError, WritableErrorObject, WritableRetainedError};

#[test]
fn retained_error_and_closed_non_error_moves_are_allocation_free() {
    let original = MutableJsError::error("before");
    let alias = original.clone();
    let value = ClosedValue::from_error(original);
    let (thrown, cost) = measure(|| index::relay(value).unwrap_err());
    assert_eq!(cost, Cost::default());
    let ErrorTransport::Retained(error) = thrown else { panic!("original Error capability was erased"); };
    assert_eq!(error.error_identity_key(), alias.error_identity_key());
    let writable = WritableRetainedError::try_from(error).unwrap();
    writable.set_error_message(String::from("after"));
    assert_eq!(alias.error_message(), "after");
    let value = ${integer};
    let (thrown, cost) = measure(|| index::raise(value, true).unwrap_err());
    assert_eq!(cost, Cost::default());
    let ErrorTransport::${variant}(payload) = thrown else { panic!("native integer payload was replaced"); };
    assert_eq!(payload, ${integer});
    let returned = SourceError::try_from(TsonicError::from(payload)).unwrap_err();
    assert!(matches!(returned, ErrorTransport::${variant}(_)));
    let text = String::from("retained native UTF-8 buffer");
    let address = text.as_ptr();
    let value = ${string};
    let (thrown, cost) = measure(|| index::relay(value).unwrap_err());
    assert_eq!(cost, Cost::default());
    let ErrorTransport::${variant}(payload) = thrown else { panic!("native string payload was replaced"); };
    ${profile === "native" ? 'assert_eq!(payload.as_str().unwrap().as_ptr(), address);' : 'let ClosedValue::String(text) = payload else { panic!("string carrier changed"); }; assert_eq!(text.as_ptr(), address);'}
}

#[test]
fn immutable_error_and_absence_keep_exact_identity_and_classification() {
    let original = JsError::error("immutable");
    let identity = original.error_identity_key();
    let thrown = index::raise(ClosedValue::from_error(original), true).unwrap_err();
    let readonly = SourceError::try_from(thrown).unwrap();
    assert_eq!(readonly.error_identity_key(), identity);
    let absent = index::raise(ClosedValue::default(), true).unwrap_err();
    assert!(!absent.is_error());
    let ErrorTransport::${variant}(payload) = absent else { panic!("absence was classified as an Error"); };
    assert_eq!(payload, ClosedValue::default());
}

#[test]
fn retained_catch_and_finally_reads_preserve_owned_payloads() {
    let readers: [fn(ClosedValue) -> ClosedValue; 2] = [index::caught, |value| index::finalized(value).unwrap()];
    for retained in readers {
        let text = String::from("catch and finally retained buffer");
        let value = ${string};
        let returned = retained(value);
        ${profile === "native" ? 'assert_eq!(returned.as_str().unwrap(), "catch and finally retained buffer");' : 'let ClosedValue::String(text) = returned else { panic!("string carrier changed"); }; assert_eq!(text, "catch and finally retained buffer");'}
    }
}
`);
    runCargo(directory, ["test", "--offline", "--quiet", "--test", "closed"]);
  });

  test(`readonly Error return from a closed value preserves a live native owner in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "lib", crateName: "closed_error_return" } },
      files: { "index.ts": `
export function retain(value: unknown): Error | undefined {
  if (value instanceof Error) return value;
  return undefined;
}
` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
      .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
    const type = profile === "native" ? "tsonic_rust_runtime::TsValue" : "tsonic_rust_js::value::JsValue";
    const directory = writeGeneratedProject(`closed-error-return-${profile}`, result.artifacts);
    mkdirSync(join(directory, "tests"), { recursive: true });
    writeFileSync(join(directory, "tests/closed.rs"), `${nativeOwnershipCostSupport}
use closed_error_return::index;
use ${type} as ClosedValue;
use tsonic_rust_runtime::{ErrorObject, MutableJsError, WritableErrorObject};

#[test]
fn readonly_return_retains_the_original_native_owner_without_allocation() {
    let original = MutableJsError::error("before");
    let alias = original.clone();
    let value = ClosedValue::from_error(original);
    let (returned, cost) = measure(|| index::retain(value));
    assert_eq!(cost, Cost::default());
    let returned = returned.unwrap();
    assert_eq!(returned.error_identity_key(), alias.error_identity_key());
    alias.set_error_message(String::from("live after return"));
    assert_eq!(returned.error_message(), "live after return");
    assert!(index::retain(ClosedValue::default()).is_none());
}
`);
    runCargo(directory, ["test", "--offline", "--quiet", "--test", "closed"]);
  });
}
