import assert from "node:assert/strict";
import test from "node:test";
import { applyRustTailShape } from "../../../../dist/backend/target-ast/normalization/block-flow.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";
import { printRustSourceFile } from "../../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const path = name => ({ kind: "path", path: name });
const integer = value => ({ kind: "int-literal", text: String(value) });
const call = (name, ...args) => ({ kind: "call", path: name, args });
const method = (receiver, name, ...args) => ({ kind: "method-call", receiver, method: name, args });
const binding = (init, extra = {}) => ({ kind: "let", name: "result", mutable: false, init, ...extra });
const returned = { kind: "return", expr: path("result") };
const nativeBindings = new Set(["value", "arguments", "owner", "cell"]);
const shaped = (init, extra = {}, prefix = []) => applyRustTailShape({ statements: [...prefix, binding(init, extra), returned] }, true, nativeBindings);

test("native tail recipes eliminate only the adjacent returned immutable untyped binding", () => {
  const expressions = [path("value"), integer(7), { kind: "field", receiver: path("arguments"), name: "1" },
    call("pure"), call("consume", path("value")), method(path("value"), "unwrap_or", integer(7)),
    method(path("value"), "unwrap_or_default"), { kind: "match", expression: path("value"), arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "present" }] }, expression: path("present") },
      { pattern: { kind: "path", path: "None" }, expression: call("next") },
    ] }];
  for (const [index, expression] of [...expressions, call("consume_owned", call("make_observed"))].entries()) {
    const prefix = { kind: "expr", expr: call("effect") };
    const actual = shaped(expression, {}, [prefix]);
    assert.equal(actual.statements.length, 2, `${index}: only the returned binding disappears`);
    assert.equal(actual.statements[0] === prefix, true, `${index}: retain preceding effects and their order`);
    assert.equal(actual.statements[1].expr === expression, true, `${index}: evaluate the identical initializer once`);
    assert.equal(applyRustTailShape(actual, true, nativeBindings) === actual, true, `${index}: folding is idempotent`);
  }
});

test("native tail recipes retain attributes, mutability, coercion sites and unmatched bindings", () => {
  for (const [label, extra] of [
    ["mutable", { mutable: true }],
    ["typed coercion", { type: { kind: "reference", referent: { kind: "str" }, mutable: false } }],
    ["attributed", { attrs: [{ kind: "list", path: "cfg", arguments: [{ kind: "word", path: "test" }] }] }],
    ["different binding", { name: "other" }],
    ["uninitialized", { init: undefined }],
  ]) {
    const actual = shaped(path("value"), extra);
    assert.equal(actual.statements.length, 2, `${label}: preserve the exact native binding`);
    assert.equal(actual.statements[0].kind, "let", `${label}: no replacement coercion or attribute placement`);
  }
  const attributedTail = { kind: "tail", expr: path("result"), attrs: [{ kind: "word", path: "cold" }] };
  const attributed = { statements: [binding(path("value")), attributedTail] };
  assert.equal(applyRustTailShape(attributed, true, nativeBindings) === attributed, true, "retain attributed tail syntax unchanged");
});

test("borrowing intermediate temporaries retain their original native statement boundary", () => {
  const borrowed = method(path("cell"), "borrow");
  const temporary = { kind: "reference", expr: call("make_observed") };
  for (const [label, expression] of [
    ["RefCell borrow guard", method(borrowed, "len")],
    ["borrowed temporary argument", call("consume", temporary)],
    ["borrowed argument from a temporary receiver", call("consume", method(call("make_observed"), "borrow"))],
    ["borrowed aggregate temporary", call("consume", { kind: "reference", expr: {
      kind: "tuple-literal", elements: [path("owned")],
    } })],
    ["aggregate temporary receiver", method({ kind: "tuple-literal", elements: [path("owned")] }, "read")],
    ["borrowed constant with Drop", call("consume", { kind: "reference", expr: path("TEMPORARY") })],
    ["constant receiver", method(path("TEMPORARY"), "read")],
    ["opaque match scrutinee", { kind: "match", expression: borrowed, arms: [
      { pattern: { kind: "binding", name: "held" }, expression: method(path("held"), "len") },
    ] }],
  ]) {
    const actual = shaped(expression);
    assert.equal(actual.statements.length, 2, `${label}: keep temporary destruction at the semicolon`);
    assert.equal(actual.statements[0].init === expression, true, `${label}: retain the actual initializer unchanged`);
  }
});

test("tail recipes preserve nested completion shaping and never consume a typed return binding", () => {
  for (const kind of ["scope", "unsafe-scope"]) {
    const actual = applyRustTailShape({ statements: [{ kind, body: { statements: [binding(call("pure")), returned] } }] }, true, nativeBindings);
    assert.equal(actual.statements[0].body.statements.length, 1, `${kind}: shape the existing final scope once`);
    assert.equal(actual.statements[0].body.statements[0].expr.path, "pure", `${kind}: preserve the selected call`);
  }
  const empty = { statements: [] };
  assert.equal(applyRustTailShape(empty, true, nativeBindings) === empty, true, "retain empty native bodies");
  assert.throws(() => applyRustTailShape(empty, true), TypeError, "the superseded two-argument native scope is rejected");
});

test("only earlier native declarations and actual formals prove local places", () => {
  const borrowed = name => ({ kind: "reference", expr: path(name) });
  const local = { kind: "let", name: "held", mutable: false, init: call("make_observed") };
  const actual = shaped(call("consume", borrowed("held")), {}, [local]);
  assert.equal(actual.statements.length, 2, "an earlier native local is an existing place without temporary ownership");
  assert.equal(actual.statements[0] === local, true, "the owning local retains its exact declaration and Drop scope");
  const shadow = { statements: [binding(call("consume", borrowed("TEMPORARY")), { name: "TEMPORARY" }),
    { kind: "tail", expr: path("TEMPORARY") }] };
  assert.equal(applyRustTailShape(shadow, true, new Set()) === shadow, true,
    "the binding under initialization does not turn its same-spelled constant operand into a local place");
  const earlier = { ...local, name: "TEMPORARY" };
  const shadowedLocal = { statements: [earlier, binding(call("consume", borrowed("TEMPORARY")), { name: "TEMPORARY" }),
    { kind: "tail", expr: path("TEMPORARY") }] };
  const shadowedResult = applyRustTailShape(shadowedLocal, true, new Set());
  assert.equal(shadowedResult.statements.length, 2, "an earlier same-spelled local stays in scope when the returned shadow is removed");
  assert.equal(shadowedResult.statements[0] === earlier, true, "retain the original same-spelled native owner's Drop scope");
  assert.equal(shadowedResult.statements[1].expr === shadowedLocal.statements[1].init, true,
    "borrow the actual earlier local without introducing a temporary or changing evaluation");
});

test("adjacent native aliases fold as one whole tail chain without changing preceding declarations", () => {
  const initializer = call("make_value");
  const aliases = Array.from({ length: 256 }, (_, index) => ({
    kind: "let", name: `alias${index}`, mutable: false, init: index === 0 ? initializer : path(`alias${index - 1}`),
  }));
  const prefix = { kind: "expr", expr: call("effect") };
  const body = { statements: [prefix, ...aliases, { kind: "return", expr: path("alias255") }] };
  const actual = applyRustTailShape(body, true, new Set());
  assert.equal(actual.statements.length, 2, "eliminate the complete finite alias chain without a product depth cutoff");
  assert.equal(actual.statements[0] === prefix, true, "preceding effects retain identity and order");
  assert.equal(actual.statements[1].expr === initializer, true, "evaluate the single original native initializer exactly once");
  assert.equal(body.statements.length, 258, "the original immutable native body remains unchanged");
});

for (const edition of ["2021", "2024"]) {
  test(`native ${edition} tail recipes preserve owned results, effects and required statement scopes`, { timeout: 300_000 }, () => {
    const definitions = [
      { name: "default_value", params: [{ name: "value", type: { kind: "named", path: "Option", genericArguments: [
        { kind: "type", type: { kind: "primitive", name: "u32" } },
      ] } }], returnType: { kind: "primitive", name: "u32" }, body: shaped(method(path("value"), "unwrap_or", integer(7))) },
      { name: "owned_value", params: [], returnType: { kind: "named", path: "Observed" }, body: shaped(call("make_observed")) },
      { name: "owned_argument", params: [], returnType: { kind: "primitive", name: "u32" },
        body: shaped(call("consume_owned", call("make_observed"))) },
      ...(edition === "2021" ? [{ name: "borrowed_length", params: [], returnType: { kind: "primitive", name: "usize" }, body: shaped(
        method(method(path("cell"), "borrow"), "len"), {}, [{ kind: "let", name: "cell", mutable: false,
          init: call("std::cell::RefCell::new", { kind: "str-literal", value: "abc" }) }]) },
        { name: "constant_drop", params: [], returnType: { kind: "primitive", name: "u32" }, body: shaped(
          call("consume", { kind: "reference", expr: path("TEMPORARY") }), {}, [
            { kind: "let", name: "_local", mutable: false, init: call("Observed", { kind: "str-literal", value: "local" }) },
          ]) }] : []),
    ].map(definition => ({ kind: "function", visibility: "private", generics: emptyRustGenerics, ...definition }));
    const generated = printRustSourceFile({ headerComment: "Native tail recipe proof", items: definitions }, edition);
    if (edition === "2021") assert.equal(generated.includes("let result = cell.borrow().len();"), true,
      "2021: retain the borrowing RefCell initializer");
    if (edition === "2021") assert.equal(generated.includes("let result = consume(&TEMPORARY);"), true,
      "2021: a constant path is not an existing local place and retains its temporary Drop boundary");
    assert.equal(generated.includes("let result = value.unwrap_or(7);"), false, `${edition}: directly return the proven default recipe`);
    const project = writeGeneratedProject(`tail-recipes-${edition}`, [
      { path: "Cargo.toml", text: `[package]\nname = "tail_recipes"\nversion = "0.0.0"\nedition = "${edition}"\n` },
      { path: "src/main.rs", text: `${generated}\n
struct Observed(&'static str);
impl Drop for Observed {
    fn drop(&mut self) { println!("drop:{}", self.0); }
}
fn make_observed() -> Observed { println!("effect:once"); Observed("owned") }
fn consume_owned(_owned: Observed) -> u32 { 7 }
${edition === "2021" ? 'const TEMPORARY: Observed = Observed("constant");\nfn consume(_: &Observed) -> u32 { 7 }' : ""}
fn main() {
    assert_eq!(default_value(None), 7);
    assert_eq!(default_value(Some(9)), 9);
    ${edition === "2021" ? "assert_eq!(borrowed_length(), 3);" : ""}
    let owned = owned_value();
    println!("caller:owns");
    drop(owned);
    println!("argument:start");
    assert_eq!(owned_argument(), 7);
    println!("argument:end");
    ${edition === "2021" ? 'println!("constant:start"); assert_eq!(constant_drop(), 7); println!("constant:end");' : ""}
}
` },
    ]);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const result = runCargo(project, ["run", "--locked", "--offline"]);
    assert.equal(result.stdout, "effect:once\ncaller:owns\ndrop:owned\nargument:start\neffect:once\ndrop:owned\nargument:end\n" + (edition === "2021"
      ? "constant:start\ndrop:constant\ndrop:local\nconstant:end\n" : ""),
    `${edition}: one effect, native ownership and exact Drop order`);
  });
}
