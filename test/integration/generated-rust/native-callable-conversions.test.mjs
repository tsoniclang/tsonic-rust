import assert from "node:assert/strict";
import test from "node:test";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeClosureProducerFixture, nativeClosureProducerErrorRecords } from "../../helpers/native-closure-producers.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { planRustCallableInputProducer, planRustCallableConversion }
  from "../../../dist/backend/planner/expressions/callable-conversions.js";

import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { nativeFallibleAdapterFixture } from "../../helpers/physical-callable-adapters.mjs";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workspace = dirname(realpathSync(resolve(repository, "../tsonic")));
const runtime = resolve(workspace, "rust-runtime/crates/tsonic_rust_runtime");
const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", []);
const integer = rustSourcePrimitiveTargetType("int32");

test("checked adapters retain all error sources and match handwritten native allocation costs", { timeout: 300_000 }, () => {
  const fixture = nativeFallibleAdapterFixture();
  const expression = fixture.adapt();
  assert.equal(expression !== undefined, true);
  const emitted = printRustExpr(expression);
  const file = fixture.program.source.ast.getFileName(fixture.program.source.ast.getSourceFile(fixture.node));
  const declarations = printRustSourceFile(finalizeRustSourceStyle({ items: fixture.context.input.errorRegions.itemsFor(file) }));
  assert.doesNotMatch(emitted, /ConsumerFailure|\.clone\(|::from\(/u);
  const project = writeGeneratedProject("native-checked-callable-conversions", [
    { path: "Cargo.toml", text: `[package]\nname = "native_checked_callable_conversions"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]
tsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }
` },
    { path: "src/main.rs", text: `
use tsonic_rust_runtime as rt;
use std::sync::atomic::{AtomicUsize, Ordering};
${nativeOwnershipCostSupport}
mod index { ${declarations} }
#[derive(Debug)]
struct ProducerFailure(i32);
static CALLS: AtomicUsize = AtomicUsize::new(0);
fn original(value: i32) -> Result<i64, ProducerFailure> {
    CALLS.fetch_add(1, Ordering::SeqCst);
    match value { -1 => Err(ProducerFailure(value)), 2 => Ok(i64::MAX), other => Ok(i64::from(other)) }
}
type AdapterError = index::NativeErrors3<ProducerFailure, rt::TsonicError, rt::TsonicError>;
fn classify(result: Result<i32, AdapterError>) -> (u8, i32) {
    match result {
        Ok(value) => (0, value),
        Err(index::NativeErrors3::Error0(ProducerFailure(value))) => (1, value),
        Err(index::NativeErrors3::Error1(_)) => (2, 0),
        Err(index::NativeErrors3::Error2(_)) => (3, 0),
    }
}
fn main() {
    let (compiled, actual) = measure(|| ${emitted});
    let (handwritten, expected) = measure(|| rt::Callable::new(|(value,): (i64,)| {
        let parameter = rt::conversions::checked_integer::<i32>(value).map_err(AdapterError::Error1)?;
        let result = original(parameter).map_err(AdapterError::Error0)?;
        let output = rt::conversions::checked_integer::<i32>(result).map_err(AdapterError::Error2)?;
        Ok::<_, AdapterError>(output)
    }));
    assert_eq!(actual, expected);
    assert_eq!(actual.allocations, 1);
    for (value, outcome, calls) in [(4, (0, 4), 1), (-1, (1, -1), 1), (i64::MAX, (2, 0), 0), (2, (3, 0), 1)] {
        CALLS.store(0, Ordering::SeqCst);
        let (actual, actual_cost) = measure(|| compiled.call((value,)));
        assert_eq!(CALLS.load(Ordering::SeqCst), calls);
        CALLS.store(0, Ordering::SeqCst);
        let (expected, expected_cost) = measure(|| handwritten.call((value,)));
        assert_eq!(CALLS.load(Ordering::SeqCst), calls);
        assert_eq!(classify(actual), outcome);
        assert_eq!(classify(expected), outcome);
        assert_eq!(actual_cost, expected_cost);
    }
    println!("PASS: checked adapters preserve three exact error channels with native cost parity");
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["rustc", "--locked", "--offline", "--", "-D", "warnings"]);
  assert.match(runCargo(project, ["run", "--locked", "--offline", "--quiet"]).stdout, /PASS: checked adapters/u);
});

function fixtureExpressions(throwing) {
  const fixture = nativeClosureProducerFixture(throwing ? {
    selectRecords: nativeClosureProducerErrorRecords(failure), body: context => ({
      kind: "try", expr: { kind: "call", path: "fail", args: [] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType,
    }),
  } : {});
  const source = fixture.program.records.targetOperation.get(fixture.node).resultCarrier;
  const expression = fixture.plan();
  assert.equal(expression !== undefined, true);
  const input = planRustCallableInputProducer(expression, source, fixture.context, fixture.node);
  assert.equal(input !== undefined, true);
  const adapt = target => {
    const conversion = selectRustCallableConversion(source, target, () => undefined, fixture.program.typeDefinitions);
    assert.equal(conversion !== undefined, true);
    const converted = planRustCallableConversion(conversion, expression, fixture.node, fixture.context);
    assert.equal(converted !== undefined, true);
    return printRustExpr(converted);
  };
  return { input: printRustExpr(input), borrowed: adapt(rustCallableInputTargetType([integer], integer)),
    owned: adapt(rustCallableTargetType([integer], integer)) };
}

test("physical callable adaptation retains exact E with one owning frame or zero borrowed allocations", { timeout: 300_000 }, () => {
  const pure = fixtureExpressions(false);
  const throwing = fixtureExpressions(true);
  const cases = [pure, throwing].map((selected, index) => `
    {
        let (input, cost) = measure(|| ${selected.input});
        assert_eq!(cost, Cost::default());
        let (result, cost) = measure(|| input(()));
        assert_eq!(result, ${index === 0 ? "Ok(3)" : "Err(ProducerFailure)"});
        assert_eq!(cost, Cost::default());
        let (result, cost) = measure(|| {
            let callback = ${selected.borrowed};
            callback((7,))
        });
        assert_eq!(result, ${index === 0 ? "Ok(3)" : "Err(ProducerFailure)"});
        assert_eq!(cost, Cost::default());
        let (owned, actual) = measure(|| ${selected.owned});
        let (direct, expected) = measure(|| rt::Callable::new(|(_unused,): (i32,)| ${index === 0 ? "Ok::<_, Infallible>(3i32)" : "fail()"}));
        assert_eq!(actual, expected);
        assert_eq!(actual.allocations, 1);
        let (result, cost) = measure(|| owned.call((7,)));
        assert_eq!(result, direct.call((7,)));
        assert_eq!(cost, Cost::default());
    }
`).join("\n");
  const project = writeGeneratedProject("native-callable-conversions", [
    { path: "Cargo.toml", text: `[package]\nname = "native_callable_conversions"\nversion = "0.0.0"\nedition = "2024"\n
[dependencies]
tsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }
` },
    { path: "src/main.rs", text: `
use tsonic_rust_runtime as rt;
use core::convert::Infallible;
${nativeOwnershipCostSupport}
#[derive(Debug, PartialEq, Eq)]
struct ProducerFailure;
fn fail() -> Result<i32, ProducerFailure> { Err(ProducerFailure) }
fn main() {
${cases}
    println!("PASS: physical callback adapter error identity and zero extra allocations");
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["rustc", "--offline", "--locked", "--", "-D", "warnings"]);
  assert.match(runCargo(project, ["run", "--offline", "--locked", "--quiet"]).stdout, /PASS: physical callback adapter/u);
});
