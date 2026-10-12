import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(name, source, surfaces = []) {
  const { result } = compileRust({ surfaces,
    target: { id: "rust", options: { outputType: "bin", crateName: name } },
    files: { "index.ts": source },
  });
  assert.deepEqual(result.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message })), []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  validateGeneratedProject(name, result.artifacts, { run: true });
  return generated;
}

test("generic callback inputs retain one pure family through aliases, returns and forwarding", { timeout: 300_000 }, () => {
  const generated = compile("native_generic_forward", `
    type Identity = <Value>(value: Value) => Value;
    function make(): Identity {
      const original = <Value>(value: Value): Value => value;
      const alias: Identity = original; return alias;
    }
    function retain(callback: Identity): Identity { return callback; }
    function invoke(callback: Identity): number { return callback<number>(7); }
    function forward(callback: Identity): number { return invoke(retain(callback)); }
    export function main(): void {
      const first = make(); const alias: Identity = first;
      if (forward(alias) !== 7 || alias<string>("native") !== "native" || first !== alias) throw new Error("identity");
    }
  `);
  assert.match(generated, /impl NativeCallable_[a-f\d]+ for crate::index::GenericCallable/u);
  assert.match(generated, /type InvocationError<CallType0> = core::convert::Infallible/u);
  assert.doesNotMatch(generated, /fn call<[^}]*?-> Result/u);
  assert.doesNotMatch(generated, /Box<|dyn |Rc<[^\n]*GenericCallable/u);
});

test("native future producer families implement both quantified and ordinary native input protocols", { timeout: 300_000 }, () => {
  const generated = compile("native_generic_future", `
    type Identity = <Value>(value: Value) => Promise<Value>;
    async function invoke(callback: Identity): Promise<number> { return await callback<number>(7); }
    async function plain(callback: () => Promise<number>): Promise<number> { return await callback(); }
    export async function main(): Promise<void> {
      const identity = async <Value>(value: Value): Promise<Value> => value;
      const single = async (): Promise<number> => 8;
      if (await invoke(identity) !== 7 || await plain(single) !== 8) throw new Error("future");
    }
  `);
  assert.match(generated, /type AwaitError0<CallType0> = core::convert::Infallible/u);
  assert.match(generated, /impl core::future::Future/u);
  assert.doesNotMatch(generated, /Box<|dyn |JsPromise/u);
});
