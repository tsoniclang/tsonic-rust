import assert from "node:assert/strict";
import test from "node:test";
import { planRustFlowReadProjection } from "../../../dist/backend/planner/expressions/flow-reads.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const edition of ["2021", "2024"]) {
  test(`owned flow matches retain native ${edition} temporary destruction order`, { timeout: 300_000 }, () => {
    const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
    const sourceFile = fakeSourceFile({ text: "value", statements: [node] });
    const selectedCarrier = rustSourcePrimitiveTargetType("uint32");
    const sourceCarrier = rustOptionTargetType(selectedCarrier);
    const context = {
      input: { program: {
        source: { ast: fakeAstReader([sourceFile]) },
        facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }), getFact: () => undefined },
        valueLifetimes: { canMove: () => true },
        configuration: { edition },
      } },
      diagnostics: [], sourceFile,
    };
    const trace = { kind: "path", path: "trace" };
    const probe = digit => ({ kind: "call", path: "probe", args: [trace, { kind: "int-literal", text: String(digit) }] });
    const projection = planRustFlowReadProjection(node, {
      kind: "block", bindings: [{ name: "_guard", value: probe(1) }],
      value: { kind: "method-call", receiver: probe(2), method: "value", args: [] },
    }, { kind: "option-value", sourceCarrier, selectedCarrier }, context);
    assert.ok(projection);
    assert.deepEqual(context.diagnostics, []);
    const generated = printRustSourceFile({
      headerComment: "Native temporary destruction proof.",
      items: [{ kind: "function", generics: emptyRustGenerics, visibility: "private", name: "project",
        params: [{ name: "trace", type: { kind: "reference", mutable: false,
          referent: { kind: "named", path: "std::cell::Cell", genericArguments: [
            { kind: "type", type: { kind: "primitive", name: "u32" } },
          ] } } }],
        body: { statements: [{ kind: "expr", expr: { kind: "call", path: "observe", args: [projection, trace] } }] },
      }],
    }, edition);
    const project = writeGeneratedProject(`flow-temporaries-${edition}`, [
      { path: "Cargo.toml", text: `[package]\nname = "flow_temporaries"\nversion = "0.0.0"\nedition = "${edition}"\n[workspace]\n` },
      { path: "src/main.rs", text: `${generated}
use std::cell::Cell;
struct Probe<'scope> { trace: &'scope Cell<u32>, digit: u32 }
impl Probe<'_> { fn value(&self) -> Option<u32> { Some(7) } }
impl Drop for Probe<'_> {
    fn drop(&mut self) { self.trace.set(self.trace.get() * 10 + self.digit); }
}
fn probe(trace: &Cell<u32>, digit: u32) -> Probe<'_> { Probe { trace, digit } }
fn observe(value: u32, trace: &Cell<u32>) {
    assert_eq!(value, 7);
    trace.set(trace.get() * 10 + 3);
}
fn main() {
    let trace = Cell::new(0);
    project(&trace);
    assert_eq!(trace.get(), ${edition === "2021" ? 132 : 213});
}
` },
    ]);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt", "--all"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(project, ["run", "--locked", "--offline"]);
  });
}
