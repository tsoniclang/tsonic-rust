import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, artifactText } from "../../helpers/rust-session.mjs";

for (const [name, body, expected] of [
  ["definite normal outputs", 'try { selected = produce(flag); second = "second"; } catch { return "caught"; } return selected + second;', ["selected", "second"]],
  ["abrupt paths need no value", 'try { if (flag) selected = produce(flag); else return "early"; } catch { selected = "caught"; } return selected;', ["selected"]],
  ["a finally read retains its original scope", 'try { selected = produce(flag); } catch { return "caught"; } finally { observe(selected); } return selected;', []],
  ["a nested completion keeps its native owning scope", 'try { try { selected = produce(flag); } catch { return "inner"; } } catch { return "outer"; } return selected;', ["selected"]],
]) {
  test("source completion binding: " + name, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
function produce(flag: boolean): string { if (flag) throw "failure"; return "value"; }
function observe(value: string): void { void value; }
export function run(flag: boolean): string { let selected: string${name === "a finally read retains its original scope" ? ' = "initial"' : ""}; let second: string; ${body} }
` } });
    const ast = program.source.ast;
    const nodes = [];
    const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
    for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
    const regions = nodes.filter(ast.is.IsTryStatement);
    const selected = regions.flatMap(node => program.records.completionBindings.get(node) ?? []);
    assert.deepEqual([...new Set(selected.map(binding => ast.text(ast.name(binding.declaration))))].sort(), [...expected].sort(),
      "definite output ownership is decided from source before the planner");
    assert.equal(selected.every(Object.isFrozen), true, "completion payloads are immutable");
    assert.equal(selected.every(binding => binding.body !== "unused" || binding.catch !== "unused"), true,
      "each moved output belongs to an actual normal branch");
  });
}

for (const [name, body] of [
  ["pre-initialization read", 'try { observe(selected); selected = produce(flag); } catch { return "caught"; } return selected;'],
  ["an unproven branch", 'try { if (flag) selected = produce(flag); } catch { return "caught"; } return selected;'],
  ["a closure does not initialize the outer binding", 'try { const later = (): void => { selected = "later"; }; void later; } catch { return "caught"; } return selected;'],
  ["a shadow declaration does not initialize the outer binding", 'try { let selected = "shadow"; observe(selected); } catch { return "caught"; } return selected;'],
]) {
  test("source completion refuses " + name, () => {
    assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": `
function produce(flag: boolean): string { if (flag) throw "failure"; return "value"; }
function observe(value: string): void { void value; }
export function run(flag: boolean): string { let selected: string; ${body} }
` } }), /TS2454/u, "the checked source must prove every normal read initialized");
  });
}

test("native normal outputs move without manufactured default or shared storage", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
function produce(flag: boolean): string { if (flag) throw "failure"; return "value"; }
export function run(flag: boolean): string {
  let selected: string;
  try { selected = produce(flag); } catch { return "caught"; }
  return selected;
}
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /Completion::Normal/u);
  assert.doesNotMatch(text, /MaybeUninit|assume_init|unsafe|Default::default|RefCell|Box::new/u);
});

test("nested initialization crosses every completion boundary with one lexical owner", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function produce(flag: boolean): string { if (flag) throw new Error("failure"); return "value"; }
function observe(): void {}
export function run(flag: boolean): string {
  let selected: string;
  try {
    try {
      try { selected = produce(flag); } catch { return "caught"; }
    } finally { observe(); }
  } finally { observe(); }
  return selected;
}
` } });
  const { ast } = program.source;
  const regions = [];
  const visit = node => {
    if (ast.is.IsTryStatement(node)) regions.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(regions.length, 3, "all three actual native boundaries are retained");
  const declaration = program.records.completionBindings.get(regions[0])?.[0]?.declaration;
  assert.equal(declaration !== undefined, true, "the original uninitialized declaration has an admitted output");
  assert.equal(program.records.completionBindingOwner.get(declaration) === regions[0], true,
    "only the outermost owning region replaces the original lexical declaration");
  for (const region of regions) {
    const values = program.records.completionBindings.get(region);
    assert.equal(values?.length, 1, "every crossed region transports the same initialized value");
    assert.equal(values[0].declaration === declaration, true, "every native output retains the actual source declaration identity");
    assert.equal(values[0].body, region === regions[2] ? "entry" : "nested-output",
      "only the innermost write declares at entry; enclosing outputs bind at the completed child output");
    assert.equal(values[0].output, "declare", "each same-scope output establishes the next actual initialized binding");
    assert.equal(values[0].catch, "unused", "the abrupt catch never fabricates an initialized normal value");
  }
});

test("a later nested overwrite is not treated as first initialization", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function produce(flag: boolean): string { if (flag) throw new Error("failure"); return "value"; }
export function run(flag: boolean): string {
  let selected: string;
  try {
    selected = produce(flag);
    try { selected = "replacement"; } catch { return "inner"; }
  } catch { return "outer"; }
  return selected;
}
` } });
  const { ast } = program.source;
  const regions = [];
  const visit = node => {
    if (ast.is.IsTryStatement(node)) regions.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(regions.length, 2, "both original nested regions remain present");
  assert.equal(program.records.completionBindings.get(regions[0])?.length, 1,
    "the initial write still owns its normal output");
  assert.equal(program.records.completionBindings.get(regions[1]) === undefined, true,
    "an already initialized value keeps its native assignment and Drop scope");
});
