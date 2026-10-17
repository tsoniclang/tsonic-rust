import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

import { moduleBindingPatternFiles, moduleBindingPublicationPrograms } from "../../../../tsonic/test/fixtures/module-binding-patterns.mjs";

const nativeCounterpart = `
#[derive(Clone)]
struct Payload {
    count: i32,
}

#[test]
fn native_module_pattern_order() {
    let mut trace = 0;
    let mut record = |value| {
        trace = trace * 10 + value;
        value
    };
    record(1);
    let (mut first, second, absent, present) = (2, 3, None::<i32>, 4);
    let missing = absent.unwrap_or_else(|| record(first));
    fn choose(value: Option<i32>, fallback: impl FnOnce() -> i32) -> i32 {
        value.unwrap_or_else(fallback)
    }
    let kept = choose(Some(present), || record(9));
    record(3);
    let values: Vec<i32> = Vec::new();
    let head = values.first().copied().unwrap_or_else(|| record(4));
    let next = values.get(1).copied().unwrap_or_else(|| record(head + 1));
    let [_, skipped, rest @ ..] = [6, 7, 8, 9];
    record(6);
    assert_eq!(
        (trace, first, second, missing, kept, head, next, skipped),
        (123456, 2, 3, 2, 4, 4, 5, 7)
    );
    assert_eq!(rest, [8, 9]);
    let mut payload = std::rc::Rc::new(std::cell::RefCell::new(Payload { count: 5 }));
    let alias = payload.clone();
    alias.borrow_mut().count = 7;
    assert_eq!(payload.borrow().count, 7);
    first = 8;
    payload = std::rc::Rc::new(std::cell::RefCell::new(Payload { count: 9 }));
    assert_eq!(
        (first, alias.borrow().count, payload.borrow().count),
        (8, 7, 9)
    );
    assert!(!std::rc::Rc::ptr_eq(&payload, &alias));
}
`;

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`module patterns preserve roots, leaves, defaults, exports and live aliases on ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, files: moduleBindingPatternFiles, target: { id: "rust", options: { outputType: "bin" } } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 4096));
    assert.equal(result.program !== undefined && result.plan !== undefined, true, "the full semantic module class seals and plans");
    const state = artifactText(result, "src/state.rs");
    assert.equal((state.match(/= root\(\)/gu) ?? []).length, 1, "evaluate the root exactly once");
    assert.doesNotMatch(state, /ModuleCell<[^\n]*(?:Source|Nested)/u, "the aggregate remains an initializer-local value");
    const native = validateGeneratedProject(`module-binding-patterns-${surface}`,
      [...result.artifacts, { path: "tests/native_module_patterns.rs", text: nativeCounterpart.trimStart() }], { run: true });
    assert.equal(native.status, 0, "actual generated Rust and the handwritten native counterpart execute");
  });

  test(`invalid module projection is refused before sealing on ${surface}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
let key = "value" as const;
const { [key]: value } = { value: 1 };
export function run(): number { return value; }
` } });
    assert.equal(result.diagnostics.length > 0, true, "invalid source retains its native checked rejection");
    assert.equal(result.diagnostics.some(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN"), true,
      "a nonconstant module projection retains its precise source-key refusal");
    assert.equal(result.program === undefined && result.plan === undefined, true, "invalid projection cannot be sealed");
    assert.equal(result.artifacts.length, 0, "no partial native artifact is emitted");
  });

  for (const [index, program] of moduleBindingPublicationPrograms.entries()) {
    test(`module publication preserves ${program.name} on ${surface}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, files: program.files,
        target: { id: "rust", options: { outputType: "bin" } } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 4096));
      assert.equal(result.program !== undefined && result.plan !== undefined, true,
        "every valid source root has one complete native publication before the seal");
      assert.equal(validateGeneratedProject(`module-binding-publication-${index}-${surface}`,
        result.artifacts, { run: true }).status, 0, "actual generated Rust preserves native module evaluation");
    });
  }
}
