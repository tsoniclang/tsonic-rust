import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

const cases = [
  ["then reads the incoming value", "if ((marker = step()) > 0) { use(marker); return 1; } else { return 0; }", false],
  ["else reads the incoming value", "if ((marker = step()) > 0) { return 1; } else { use(marker); return 0; }", false],
  ["an absent else reaches an after-if read", "if ((marker = step()) > 0) { use(1); } use(marker); return 0;", false],
  ["both alternatives overwrite before reading", "if ((marker = step()) > 0) { marker = 11; use(marker); return 1; } else { marker = 11; use(marker); return 0; }", true],
  ["one overwrite does not hide another path", "if ((marker = step()) > 0) { marker = 11; use(marker); return 1; } else { use(marker); return 0; }", false],
  ["a read before overwrite observes the incoming value", "if ((marker = step()) > 0) { use(marker); marker = 11; return marker; } return 0;", false],
  ["exiting alternatives never observe the assigned value", "if ((marker = step()) > 0) { return 1; } else { return 0; }", true],
  ["branch-local shadows do not hide the outer read", "if ((marker = step()) > 0) { let marker = 1; use(marker); } else { let marker = 2; use(marker); } use(marker); return 0;", false],
  ["earlier operands do not observe later writes", "if (marker + (marker = step()) > 0) { return 1; } return 0;", true],
  ["later operands observe earlier writes", "if ((marker = step()) + marker > 0) { return 1; } return 0;", false],
  ["conditional arms are alternatives with a read", "if ((marker = step()) > 0 ? marker > 0 : (marker = 11) > 0) { return 1; } return 0;", false],
  ["conditional arms overwrite before reading", "if ((marker = step()) > 0 ? (marker = 11) > 0 : (marker = 12) > 0) { return 1; } return 0;", true],
  ["match-like arm observes its write", "use(ready ? (marker = step()) : 0); use(marker); return 0;", false],
  ["match-like arm overwrite hides its write", "use(ready ? (marker = step()) : 0); marker = 11; use(marker); return 0;", true],
  ["a block-value tail reaches its branch", "if (((marker = step()), 7) > 0) { use(marker); } return 0;", false],
  ["function returns never reach a later branch", "marker = step(); return 7;", true],
  ["parameter store overwritten on each continuing path", "marker = step(); if (ready) return 1; marker = 11; use(marker); return 0;", true],
];
for (const [name, body, dead] of cases) {
  test("source write liveness: " + name, () => check(body, dead));
}
for (const [name, region] of [
  ["unlabeled loop break", "while (ready) { marker = step(); break; }"],
  ["labeled loop break", "scan: while (ready) { marker = step(); break scan; }"],
  ["for break", "for (let index = 0; index < 1; index++) { marker = step(); break; }"],
  ["switch break", "switch (ready) { case true: marker = step(); break; default: break; }"],
  ["nested labeled break", "outer: while (ready) { while (ready) { marker = step(); break outer; } break; }"],
  ["scoped break", "scope: { marker = step(); break scope; }"],
]) {
  for (const dead of [false, true]) {
    test(`source abrupt successor: ${name}, ${dead ? "overwrite" : "read"}`, () =>
      check(region + (dead ? " marker = 11;" : "") + " use(marker); return 0;", dead));
  }
}
for (const label of [false, true]) {
  for (const dead of [false, true]) {
    test(`source continue successor: ${label ? "labeled" : "unlabeled"}, ${dead ? "overwrite" : "read"}`, () =>
      check(`${label ? "scan: " : ""}while (ready) { ${dead ? "marker = 11;" : "use(marker);"}
        marker = step(); continue${label ? " scan" : ""}; } return 0;`, dead));
  }
}

function check(body, dead) {
  const { program } = analyzeRust({ files: { "index.ts": `
function step(): number { return 7; }
function use(value: number): void { void value; }
export function inspect(marker: number, ready: boolean): number { use(marker); ${body} }
` } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  const call = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "step");
  assert.equal(call !== undefined, true, "the original effectful RHS is retained once in checked source");
  const write = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.as.AsBinaryExpression(node).Right === call);
  assert.equal(write !== undefined, true, "the effect still belongs to its exact source assignment");
  const target = ast.as.AsBinaryExpression(write).Left;
  assert.equal(program.records.unobservedWrite.get(target), dead,
    "the source flow owner decides observation across the actual control-flow successors before sealing");
  assert.equal(nodes.filter(node => node === call).length, 1, "the effect is never duplicated");
}
