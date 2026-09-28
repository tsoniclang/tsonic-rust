import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool } from "../../../../dist/providers/native/elaboration/tool.js";
import { nativeDefinitionKey, nativeNodeKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-flow-");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });

function check(name, text) {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, text);
  return tool.check({ arguments: ["--edition=2024", "--crate-type=lib", "-D", "warnings", path], sources: [] });
}

function bodyFor(evidence, name) {
  const definition = evidence.definitions.find(row => row.name === name && row.id.krate === 0);
  assert.ok(definition, name);
  const body = evidence.flows.find(body => nativeDefinitionKey(body.owner) === nativeDefinitionKey(definition.id));
  assert.ok(body, name);
  return body;
}

test("native flow retains exact parameter, destructuring and guard binding identities", () => {
  const text = `
pub fn inspect((left, right): (String, String), input: Option<String>) -> usize {
    let Some(present) = input else { return left.len(); };
    match (present, right) {
        (first, second) if first.len() > second.len() => first.len(),
        (first, second) => first.len() + second.len(),
    }
}
`;
  const evidence = check("patterns", text);
  const body = bodyFor(evidence, "inspect");
  assert.equal(body.argumentCount, 2);
  const canonical = evidence.occurrences.filter(row => row.kind === "pattern" && row.binding !== null &&
    nativeNodeKey(row.id) === nativeNodeKey(row.resolution.id));
  assert.ok(canonical.length >= 8);
  for (const pattern of canonical) {
    assert.ok(body.locals.some(local => local.binding !== null && nativeNodeKey(local.binding) === nativeNodeKey(pattern.id)),
      `Missing native local for ${nativeNodeKey(pattern.id)}`);
  }
  assert.ok(body.locals.some(local => local.guardTarget !== null));
  assert.ok(body.blocks.some(block => block.terminator.control.kind === "false-edge"));
});

test("native flow distinguishes calls, cleanup, returns and short-circuit paths without flattening them", () => {
  const evidence = check("control", `
pub fn decision(input: String, first: bool, second: bool) -> usize {
    if first && (second || input.is_empty()) { return input.len(); }
    let mut count = 0;
    loop {
        count += 1;
        if count == 1 { continue; }
        if count > input.len() { break; }
    }
    count
}
`);
  const body = bodyFor(evidence, "decision");
  assert.equal(body.argumentCount, 3);
  const kinds = new Set(body.blocks.map(block => block.terminator.control.kind));
  for (const kind of ["switch", "call", "goto", "return", "drop", "unwind-resume"]) assert.ok(kinds.has(kind), kind);
  const cleanupCalls = body.blocks.filter(block => block.terminator.control.kind === "call" &&
    block.terminator.control.unwind.kind === "cleanup");
  assert.ok(cleanupCalls.length > 0);
  for (const block of cleanupCalls) {
    const { target, unwind } = block.terminator.control;
    assert.notEqual(target, unwind.target);
    assert.equal(body.blocks[unwind.target].cleanup, true);
    assert.ok(block.terminator.accesses.some(access => access.kind === "call-result"));
  }
});

test("native flow retains closures, async suspension, inline constants and exact large switch values", () => {
  const evidence = check("owners", `
pub fn callback(input: String) -> impl FnOnce() -> usize { move || input.len() }
pub async fn suspended(input: String) -> usize { async { input.len() }.await }
pub fn constant() -> u64 { const { 9007199254740993 } }
pub fn selected(input: u128) -> u32 {
    match input { 340282366920938463463374607431768211455 => 1, _ => 2 }
}
`);
  const kinds = new Map(evidence.definitions.map(row => [nativeDefinitionKey(row.id), row.kind]));
  for (const kind of ["closure", "inline-constant"]) {
    assert.ok(evidence.flows.some(body => kinds.get(nativeDefinitionKey(body.owner)) === kind), kind);
  }
  assert.ok(evidence.flows.some(body => body.blocks.some(block => block.terminator.control.kind === "yield")));
  assert.ok(bodyFor(evidence, "selected").blocks.some(block => block.terminator.control.kind === "switch" &&
    block.terminator.control.branches.some(branch => branch.value === "340282366920938463463374607431768211455")));
});

test("native flow evidence cannot be published around borrow or use-after-move failures", () => {
  assert.throws(() => check("invalid_move", `
macro_rules! conditional { ($flag:expr, $value:expr) => { if $flag { drop($value); } }; }
pub fn invalid(input: String, flag: bool) -> String { conditional!(flag, input); input }
`), /use of moved value/u);
  assert.throws(() => check("invalid_borrow", `
pub fn invalid(input: &mut String) -> &str {
    let borrowed = input.as_str(); input.push('!'); borrowed
}
`), /cannot borrow/u);
});
