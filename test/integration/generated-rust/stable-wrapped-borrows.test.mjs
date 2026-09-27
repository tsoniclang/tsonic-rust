import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const stableSource = `
function radix(): number { return 10; }
export function parenthesized(value: string): number { return parseInt(((value)), radix()); }
export function typed(value: string): number {
  const first = parseInt((value as string), radix());
  const second = parseInt((value satisfies string), radix());
  return first + second + parseInt(value!, radix());
}
export function literal(): number { return parseInt((("17" as string)), radix()); }
`;

const guardedSource = `
export function mutated(value: string): number {
  value = "19";
  return parseInt((value), radix());
}
export function retained(value: string): () => number {
  return () => parseInt((value), radix());
}
export function ordered(value: string): number {
  const replace = (): number => { value = "29"; return 10; };
  const first = parseInt(((value as string)), replace());
  return first * 100 + parseInt(value, 10);
}
export function produced(value: string): number { return parseInt(value + "0", radix()); }
function consume(value: unknown): number { return 1; }
export function changed(value: string): number { return consume(value as unknown); }
`;

test("stable-value queries follow exact transparent operands without admitting mutation, captures or produced values", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": stableSource + guardedSource },
  });
  const decisions = new Map();
  const parameters = new Map();
  const visit = node => {
    if (source.ast.is.IsFunctionDeclaration(node)) {
      const name = source.ast.text(source.ast.name(node));
      const parameter = source.ast.parameters(node)[0];
      if (parameter !== undefined) parameters.set(name, program.facts.getFact(parameter, rustSourceParameterAbiFactKey)?.mode);
    }
    if (source.ast.is.IsCallExpression(node) &&
      source.ast.text(source.ast.as.AsCallExpression(node)?.Expression) === "parseInt") {
      let owner = source.ast.parent(node);
      while (owner !== undefined && !source.ast.is.IsFunctionDeclaration(owner)) owner = source.ast.parent(owner);
      const name = owner === undefined ? undefined : source.ast.text(source.ast.name(owner));
      const argument = source.ast.arguments(node)[0];
      assert.ok(name !== undefined && argument !== undefined);
      const selected = decisions.get(name) ?? [];
      selected.push(program.valueLifetimes.canBorrowStableValue(argument));
      decisions.set(name, selected);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of source.sourceFiles) if (source.ast.getFileName(file).endsWith("/index.ts")) visit(file);
  assert.deepEqual(decisions.get("parenthesized"), [true]);
  assert.deepEqual(decisions.get("typed"), [true, true, true]);
  assert.deepEqual(decisions.get("literal"), [true]);
  assert.deepEqual(decisions.get("mutated"), [false]);
  assert.deepEqual(decisions.get("retained"), [false]);
  assert.deepEqual(decisions.get("ordered"), [false, false]);
  assert.deepEqual(decisions.get("produced"), [false]);
  assert.equal(parameters.get("parenthesized"), "ref");
  assert.equal(parameters.get("typed"), "ref");
  for (const name of ["mutated", "retained", "ordered", "changed"]) assert.equal(parameters.get(name), "value", name);
});

test("later effects still observe the original evaluated string through transparent source wrappers", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": stableSource + guardedSource + `
export function main(): void {
  const callback = retained("23");
  if (parenthesized("17") !== 17 || typed("17") !== 51 || literal() !== 17 ||
    mutated("17") !== 19 || ordered("17") !== 1729 || produced("17") !== 170 ||
    callback() !== 23 || callback() !== 23 || changed("owned") !== 1) throw new Error("wrapped borrow observations");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  const start = output.indexOf("pub fn parenthesized");
  const end = output.indexOf("pub fn mutated");
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(output.slice(start, end), /\.clone\(\)|\.to_owned\(\)|String::from/u);
  validateGeneratedProject("stable-wrapped-borrow-order", result.artifacts, { run: true });
});

test("wrapped immutable reads match handwritten native borrowing without snapshot allocations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "stable_wrapped_borrows" } },
    files: { "index.ts": stableSource },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /\.clone\(\)|\.to_owned\(\)|String::from/u);
  const root = writeGeneratedProject("stable-wrapped-borrow-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use stable_wrapped_borrows::index;

fn handwritten(value: &str) -> f64 { value.parse::<f64>().unwrap() }
fn handwritten_typed(value: &str) -> f64 {
    let first = handwritten(value);
    let second = handwritten(value);
    first + second + handwritten(value)
}

#[test]
fn transparent_arguments_add_no_copies_allocations_or_temporary_buffers() {
    let text = String::from("17");
    let actual = measure(|| {
        let mut total = 0.0;
        for _iteration in 0..10000 { total += index::parenthesized(std::hint::black_box(&text)); }
        total
    });
    let expected = measure(|| {
        let mut total = 0.0;
        for _iteration in 0..10000 { total += handwritten(std::hint::black_box(&text)); }
        total
    });
    assert_eq!(actual, expected);
    assert_eq!(actual.1, Cost::default());
    let actual = measure(|| index::typed(std::hint::black_box(&text)));
    let expected = measure(|| handwritten_typed(std::hint::black_box(&text)));
    assert_eq!(actual, expected);
    assert_eq!(actual.1, Cost::default());
    assert_eq!(measure(index::literal), measure(|| handwritten("17")));
    assert_eq!(measure(index::literal).1, Cost::default());
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "ownership"]);
});
