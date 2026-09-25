import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const sourceText = `
function branch(values: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const snapshot = values[index]!;
    if (snapshot.length > 0) { result.push(snapshot); continue; }
    result.push(snapshot);
  }
  return result;
}
function retained(value: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < 2; index++) result.push(value);
  return result;
}
function branchReturn(returnedValue: string, early: boolean): string[] {
  const result: string[] = [];
  if (early) { result.push(returnedValue); return result; }
  result.push(returnedValue);
  return result;
}
function branchBreak(values: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const breakValue = values[index]!;
    if (breakValue.length > 0) { result.push(breakValue); break; }
    result.push(breakValue);
  }
  return result;
}
let observed = "";
function cleanup(value: string): string[] {
  const result: string[] = [];
  try { result.push(value); return result; } finally { observed = value; }
}
function create(): string { return "value".slice(0); }
function stable(): string[] {
  const result: string[] = [];
  result.push(create());
  result.push(create());
  return result;
}
function mutatedAlias(): string[] {
  const values = ["first"];
  const alias = values;
  const mutate = (): string => { alias.push("second"); return "third"; };
  values.push(mutate());
  return values;
}
function replaced(): string[] {
  let values = ["old"];
  const original = values;
  const replace = (): string => { values = ["new"]; return "added"; };
  values.push(replace());
  if (values[0] !== "new") throw new Error("replaced binding");
  return original;
}
export function main(): void {
  const values = branch(["a", "", "c"]);
  if (values.join("|") !== "a||c" || retained("x").join("|") !== "x|x" ||
    cleanup("kept").join("") !== "kept" || observed !== "kept" ||
    stable().join("|") !== "value|value" || mutatedAlias().join("|") !== "first|second|third" ||
    replaced().join("|") !== "old|added" || branchReturn("early", true).join("") !== "early" ||
    branchReturn("late", false).join("") !== "late" || branchBreak(["", "b", "c"]).join("|") !== "|b") {
    throw new Error("branch ownership");
  }
}
`;

test("last-use facts move loop-local strings on terminal branches but retain repeated and cleanup uses", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": sourceText } });
  const snapshots = [];
  const retained = [];
  const terminal = [];
  const borrowed = new Map();
  const visit = node => {
    if (source.ast.is.IsIdentifier(node) && source.ast.text(node) === "snapshot" &&
      source.ast.is.IsCallExpression(source.ast.parent(node))) snapshots.push(program.valueLifetimes.canMove(node));
    if (source.ast.is.IsIdentifier(node) && source.ast.text(node) === "value" &&
      source.ast.is.IsCallExpression(source.ast.parent(node))) retained.push(program.valueLifetimes.canMove(node));
    if (source.ast.is.IsIdentifier(node) && ["returnedValue", "breakValue"].includes(source.ast.text(node)) &&
      source.ast.is.IsCallExpression(source.ast.parent(node))) terminal.push(program.valueLifetimes.canMove(node));
    const parent = source.ast.parent(node);
    if (source.ast.is.IsIdentifier(node) && source.ast.is.IsPropertyAccessExpression(parent) &&
      source.ast.as.AsPropertyAccessExpression(parent)?.Expression === node && source.ast.text(source.ast.name(parent)) === "push") {
      let owner = parent;
      while (owner !== undefined && !source.ast.is.IsFunctionDeclaration(owner)) owner = source.ast.parent(owner);
      const name = owner === undefined ? "" : source.ast.text(source.ast.name(owner));
      const decisions = borrowed.get(name) ?? [];
      decisions.push(program.valueLifetimes.canBorrowStableBinding(node));
      borrowed.set(name, decisions);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of source.sourceFiles) if (source.ast.getFileName(file).endsWith("/index.ts")) visit(file);
  assert.deepEqual(snapshots, [true, true]);
  assert.deepEqual(retained, [false, false]);
  assert.deepEqual(terminal, [true, true, true, true]);
  assert.deepEqual(borrowed.get("stable"), [true, true]);
  assert.deepEqual(borrowed.get("replaced"), [false]);
});

test("branch ownership and stable receiver borrowing compile and preserve alias replacement", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "branch_final_use" } },
    files: { "index.ts": sourceText },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  const branch = output.slice(output.indexOf("fn branch("), output.indexOf("fn retained("));
  assert.doesNotMatch(branch, /snapshot\.clone\(\)/u);
  const stable = output.slice(output.indexOf("fn stable("), output.indexOf("fn replaced("));
  assert.doesNotMatch(stable, /result\.clone\(\)/u);
  validateGeneratedProject("branch-final-use", result.artifacts, { run: true });
});
