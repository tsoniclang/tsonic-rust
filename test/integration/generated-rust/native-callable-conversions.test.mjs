import assert from "node:assert/strict";
import test from "node:test";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeClosureProducerFixture, nativeClosureProducerErrorFacts } from "../../helpers/native-closure-producers.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { planRustCallableInputProducer, planRustCallableConversion }
  from "../../../dist/backend/planner/expressions/callable-conversions.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workspace = dirname(realpathSync(resolve(repository, "../tsonic")));
const runtime = resolve(workspace, "rust-runtime/crates/tsonic_rust_runtime");
const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure", []);
const integer = rustSourcePrimitiveTargetType("int32");

function fixtureExpressions(throwing) {
  const fixture = nativeClosureProducerFixture(throwing ? {
    selectFacts: nativeClosureProducerErrorFacts(failure), body: context => ({
      kind: "try", expr: { kind: "call", path: "fail", args: [] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType,
    }),
  } : {});
  const source = fixture.program.facts.getFact(fixture.node, rustTargetOperationFactKey).resultCarrier;
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
