import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const source = `
  interface View { value: number; }
  class Accessor {
    stored = 3;
    fail = false;
    get value(): number {
      if (this.fail) throw new Error("getter failed");
      return this.stored;
    }
    set value(next: number) {
      if (next < 0) throw new Error("setter failed");
      this.stored = next;
    }
  }
  class Infallible {
    stored = 7;
    get value(): number { return this.stored; }
    set value(next: number) { this.stored = next; }
  }
  export function run(): boolean {
    const owner = new Accessor();
    const view: View = owner;
    if (view.value !== 3) return false;
    view.value = 5;
    if (owner.stored !== 5) return false;
    let setterFailed = false;
    try { view.value = -1; } catch { setterFailed = true; }
    if (!setterFailed || owner.stored !== 5) return false;
    owner.fail = true;
    let getterFailed = false;
    try { const ignored = view.value; if (ignored === 0) return false; } catch { getterFailed = true; }
    if (!getterFailed) return false;
    const other = new Infallible();
    const infallible: View = other;
    infallible.value = 9;
    return infallible.value === 9 && other.stored === 9;
  }
  export function main(): void { if (!run()) throw new Error("structural accessor result ABI"); }
`;

for (const surfaces of [[], ["js"]]) {
  test(`structural field implementations preserve getter and setter Result ABIs in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    const emitted = rustSourceText(result);
    assert.equal(/Ok(?:\s*::<[^;]*?>)?\s*\(\s*AccessorRoot::read_accessor_value\(self\)\s*\)/u.test(emitted), false,
      "the fallible native getter must not become a nested Result");
    assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(emitted), false);
    validateGeneratedProject(`structural-view-accessor-results-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
