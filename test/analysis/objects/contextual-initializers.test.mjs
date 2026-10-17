import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const sourceText = `
const nativeKey = "value";
interface Holder { [nativeKey]: number; }
function direct(): number {
  const { value } = { value: 7 } as const;
  return value;
}
function choose(flag: boolean): number {
  const { value } = flag ? { value: 11 } : { value: 13 };
  return value;
}
function nonNull(): number {
  const { value } = { value: 17 }!;
  return value;
}
function tuple(): number {
  const [value] = [19] as const;
  return value;
}
function exactKey(): number {
  const { key } = { key: "value" } as const;
  const value: Holder = { [key]: 23 };
  return value[key];
}
export function run(): boolean {
  return direct() === 7 && choose(true) === 11 && choose(false) === 13 &&
    nonNull() === 17 && tuple() === 19 && exactKey() === 23;
}
if (!run()) throw new Error("contextual initializer counterpart");
`;

const nativeCounterpart = `
struct NativeValue {
    value: f64,
}

fn native_choose(flag: bool) -> f64 {
    let NativeValue { value } = if flag {
        NativeValue { value: 11.0 }
    } else {
        NativeValue { value: 13.0 }
    };
    value
}

#[test]
fn native_contextual_initializers() {
    let NativeValue { value: direct } = NativeValue { value: 7.0 };
    let NativeValue { value: non_null } = NativeValue { value: 17.0 };
    let (tuple,) = (19.0,);
    let NativeValue { value: exact_key } = NativeValue { value: 23.0 };
    assert_eq!(direct, 7.0);
    assert_eq!(native_choose(true), 11.0);
    assert_eq!(native_choose(false), 13.0);
    assert_eq!(non_null, 17.0);
    assert_eq!(tuple, 19.0);
    assert_eq!(exact_key, 23.0);
}
`;

for (const surfaces of [[], ["js"]]) {
  test(`Rust ${surfaces[0] ?? "native"} local initializers keep actual fields and match native values`, { timeout: 300_000 }, () => {
    const compiled = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": sourceText } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
    assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true,
      "actual local initializers are admitted and planned, not skipped or replaced by synthetic fields");
    assert.equal(compiled.result.artifacts.length > 0, true, "the actual source emits native artifacts");
    validateGeneratedProject(`contextual-initializers-${surfaces[0] ?? "native"}`,
      [...compiled.result.artifacts, { path: "tests/native_contextual_counterpart.rs", text: nativeCounterpart.trimStart() }],
      { run: true });
  });
  test(`Rust ${surfaces[0] ?? "native"} top-level exact-key pattern remains a precise open module obligation`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
const { key } = { key: "value" } as const;
interface Holder { [key]: number; }
export function make(): number {
  const value: Holder = { [key]: 7 };
  return value[key];
}
` } });
    assert.equal(compiled.result.diagnostics.length, 1, "C122 keeps one actual module initializer owner, not a key refusal");
    assert.equal(compiled.result.diagnostics[0]?.code, "RUST_SOURCE_PACKAGE_INITIALIZER_FACT_MISSING",
      "the unchanged K01 capability is mapped to R02, not reported accepted with P01");
    assert.equal(compiled.result.diagnostics[0]?.message, "Top-level variable declaration has no finalized Rust module-binding fact.",
      "the precise current module-root/leaf boundary is retained");
    assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true,
      "the unsupported module shape stops before sealing and planning");
    assert.equal(compiled.result.artifacts.length, 0, "no incomplete module output is emitted");
  });
}
