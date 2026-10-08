import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { rustBindingStorageFactKey, rustSourceCallableReturnFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustFrameCallableValue } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";
import { awaitOperandCallableSource, nativeAwaitOperandCallableSource } from "../../../../tsonic/test/fixtures/await-operand-callables.mjs";
import { dispatchProviderPackage } from "../../helpers/rust-session/provider-dispatch-contexts.mjs";
import { rustAsyncFunctionFactKey, rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustLifetimesEqual } from "../../../dist/target-model/lifetimes/index.js";

const source = `
export function escaped(seed: number): (count: number) => number {
  let selected = (count: number): number => count === 0 ? seed : selected(count - 1);
  const before = selected;
  selected = (count: number): number => count === 0 ? 2 : selected(count - 1);
  return before;
}
export function ordinary(seed: number): (count: number) => number {
  return (count: number): number => count + seed;
}
`;

test("suspended functions name every captured callable input loan independently of its result", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export async function combine(first: () => int32, pending: () => int32 | Promise<void>,
  last: () => int32, consume: (first: int32, second: int32 | void, last: int32) => int32): Promise<int32> {
  return consume(first(), await pending(), last());
}
` } });
  const { ast } = program.source;
  const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
    node !== undefined && ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "combine");
  assert.equal(declaration !== undefined, true, "exact authored suspended function");
  const inputs = ast.parameters(declaration).map(node => program.facts.getFact(node, rustSourceParameterAbiFactKey));
  assert.equal(inputs.length, 4);
  for (const input of inputs) {
    assert.equal(input?.parameterCarrier.kind === "reference", true, "native borrowed callback, not an owned wrapper");
    assert.equal(input.inputLifetime !== undefined, true, "ordinary and suspended callback results both retain the input loan");
    assert.equal(rustLifetimesEqual(input.inputLifetime, inputs[0].inputLifetime), true, "one exact enclosing input region");
  }
  const selected = program.facts.getFact(declaration, rustAsyncFunctionFactKey);
  assert.equal(selected?.kind === "js-promise", true, "one exact selected async operation");
  const storage = selected.storage;
  assert.equal(storage?.kind === "lifetime", true, "suspended storage cannot invent a static capture");
  assert.equal(rustLifetimesEqual(storage.lifetime, inputs[0].inputLifetime), true, "stored frame keeps the selected loan");
});

for (const jsEnabled of [false, true]) {
  test(`${jsEnabled ? "JS" : "native"} awaited executors retain selected callback environments and exact frame bindings`, () => {
    const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [],
      files: { "index.ts": jsEnabled ? awaitOperandCallableSource : nativeAwaitOperandCallableSource },
    });
    const frames = program.callableValues.frames;
    assert.equal(frames.issues.length, 0, "all awaited callback entries and bindings close");
    assert.equal(frames.definitions.length > 0, true, "mutual callbacks require a real owning activation");
    for (const frame of frames.definitions) {
      for (const entry of frame.entries) {
        for (const implementation of entry.implementations) {
          assert.equal(rustFrameCallableValue(implementation.carrier) !== undefined, true,
            "provider contextual signatures cannot replace the physical activation");
          assert.equal(frames.entryFor(implementation.carrier) === entry, true, "one entry protocol");
        }
      }
    }
  });

  test(`${jsEnabled ? "JS" : "native"} contextual provider inputs retain the selected recursive activation`, () => {
    const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [],
      packages: jsEnabled ? [] : [dispatchProviderPackage()], files: { "index.ts": jsEnabled ? `
import type { int32 } from "@tsonic/core/types.js";
export function run(): int32 {
  let total: int32 = 0;
  const receive = (value: int32): void => { total += value; detach(); };
  const detach = (): void => { if (total < 0) receive(0); };
  const values: int32[] = [1, 2];
  values.forEach(receive);
  return total;
}
` : `
import type { int32 } from "@tsonic/core/types.js";
import { enqueue, poll } from "@acme/dispatch";
export function run(): int32 {
  let total: int32 = 0;
  const receive = (): void => { total += 3; detach(); };
  const detach = (): void => { if (total < 0) receive(); };
  enqueue(receive);
  poll();
  return total;
}
` } });
    assert.equal(program.callableValues.frames.issues.length, 0, "all selected frame entries and bindings close");
    const definitions = program.callableValues.frames.definitions;
    assert.equal(definitions.length, 1, "recursive callbacks share one activation");
    for (const binding of definitions[0].bindings.filter(binding => binding.entry !== undefined)) {
      assert.equal(rustFrameCallableValue(binding.carrier) !== undefined, true, "contextual inputs preserve physical ownership");
      assert.equal(program.callableValues.frames.entryFor(binding.carrier) === binding.entry, true,
        "selected binding and finalized entry have one exact protocol");
    }
  });
}

for (const jsEnabled of [false, true]) {
  for (const name of ["addressed-lexical-frame", "addressed-class-frame"]) {
    test(`${jsEnabled ? "JS" : "native"} ${name} preserves the addressed physical owner and declaration role`, () => {
      const source = recursiveCallbackProtocolCases.find(current => current.name === name).source;
      const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": source } });
      assert.equal(program.callableValues.frames.definitions.length, 1);
      const frame = program.callableValues.frames.definitions[0];
      const value = frame.bindings.find(binding => binding.entry === undefined &&
        program.source.ast.text(program.source.ast.name(binding.declaration)) === "seed");
      assert.equal(value !== undefined, true, "addressed seed has one frame binding");
      const lexical = name === "addressed-lexical-frame";
      assert.equal(value.storage, lexical ? "location" : "value");
      const physical = program.facts.getFact(value.declaration, rustBindingStorageFactKey);
      assert.equal(lexical ? physical?.storage === "location" : physical === undefined, true,
        "stored constructor field never promotes its formal parameter");
      assert.equal(frame.entries.every(entry => frame.bindings.filter(binding => binding.entry === entry)
        .every(binding => binding.storage !== "location")), true, "entry protocol remains owner-free inside the frame");
      assert.equal(frame.storage.kind, lexical ? "standalone" : "object");
      if (!lexical) assert.equal(frame.storage.mutable, true);
    });
  }
}

for (const jsEnabled of [false, true]) {
  for (const name of ["captured-class-field", "shared-class-frame", "shared-class-string-field", "shared-class-construction-writes"]) {
    test(`${jsEnabled ? "JS" : "native"} ${name} selects one native field mutability owner`, () => {
      const source = recursiveCallbackProtocolCases.find(current => current.name === name).source;
      const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": source } });
      const frames = program.callableValues.frames.definitions;
      assert.equal(frames.length, 1);
      const frame = frames[0];
      assert.equal(program.objectRepresentations.representations.length, 1);
      const representation = program.objectRepresentations.representations[0];
      const shared = name !== "captured-class-field";
      assert.equal(representation.kind, shared ? "shared-mutable" : "value");
      assert.equal(frame.storage.kind, shared ? "object" : "standalone");
      if (shared) assert.equal(frame.storage.mutable, true);
      assert.equal(frame.bindings.length, shared ? 3 : 2);
      for (const binding of frame.bindings) assert.equal(binding.storage, shared ? "value" : "cell");
    });
  }
}

for (const jsEnabled of [false, true]) {
  for (const generic of [false, true]) {
    test(`${jsEnabled ? "JS" : "native"} class callback return preserves ${generic ? "factory" : "concrete"} owner arguments`, () => {
      const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": `
class Value<T> {
  constructor(readonly seed: T) {}
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped${generic ? "<U>(seed: U)" : "()"}: (count: number) => number {
  const value = new Value(${generic ? "seed" : '"seed"'});
  const before = value.recurse;
  value.rebind();
  return before;
}
` } });
      const ast = program.source.ast;
      const pending = [...program.source.sourceFiles];
      let factory;
      let retained;
      while (pending.length !== 0) {
        const node = pending.pop();
        const name = ast.name(node);
        const text = name !== undefined && ast.is.IsIdentifier(name) ? ast.text(name) : "";
        if (ast.is.IsFunctionDeclaration(node) && text === "escaped") factory = node;
        if (ast.is.IsVariableDeclaration(node) && text === "before") retained = node;
        ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
      }
      assert.equal(factory !== undefined && retained !== undefined, true, "exact authored factory and retained callback");
      const returned = program.facts.getFact(factory, rustSourceCallableReturnFactKey)?.returnCarrier;
      const local = program.facts.getFact(retained, rustRuntimeCarrierKey)?.carrier;
      assert.equal(rustFrameCallableValue(returned) !== undefined, true, "physical owner remains a closed frame");
      assert.equal(rustTargetTypeRefEquals(returned, local), true, "return preserves the selected instance's owner arguments");
      const references = rustTargetGenericReferences(returned).typeParameters;
      assert.equal(references.length, generic ? 1 : 0);
      if (generic) assert.equal(references[0].name, "U", "class declaration parameter cannot leak into factory ABI");
    });
  }
}

for (const jsEnabled of [false, true]) {
  test(`${jsEnabled ? "JS" : "native"} independent recursive components share a source activation, not a dispatch family`, () => {
    const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": `
export function escaped(flag: boolean): (count: number) => number {
  let left = (count: number): number => count === 0 ? 1 : left(count - 1);
  let right = (count: number): number => count === 0 ? 2 : right(count - 1);
  left = (count: number): number => count === 0 ? 3 : left(count - 1);
  right = (count: number): number => count === 0 ? 4 : right(count - 1);
  return flag ? left : right;
}
` } });
    const definitions = program.callableValues.frames.definitions;
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].activation.components.length, 2);
    assert.equal(definitions[0].bindings.length, 2);
    assert.equal(definitions[0].entries.length, 1);
    assert.equal(definitions[0].entries[0].implementations.length, 4);
  });
}

for (const jsEnabled of [false, true]) {
  test(`${jsEnabled ? "JS" : "native"} callable ABI selects exact activation storage before signatures and captures`, () => {
    const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": source } });
    const { ast } = program.source;
    const named = new Map();
    const arrows = [];
    const returns = [];
    const pending = [...program.sourceFiles];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (ast.is.IsFunctionDeclaration(node) || ast.is.IsVariableDeclaration(node)) {
        const name = ast.name(node);
        if (name !== undefined) named.set(ast.text(name), node);
      }
      if (ast.is.IsArrowFunction(node)) arrows.push(node);
      if (ast.is.IsReturnStatement(node)) returns.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    const escaped = named.get("escaped");
    const ordinary = named.get("ordinary");
    const selected = named.get("selected");
    const before = named.get("before");
    for (const [label, node] of [["escaped", escaped], ["ordinary", ordinary], ["selected", selected], ["before", before]])
      assert.equal(node !== undefined, true, label);
    const returned = program.facts.getFact(escaped, rustSourceCallableReturnFactKey)?.returnCarrier;
    const frame = rustFrameCallableValue(returned);
    assert.equal(frame !== undefined, true, "returned callback uses its exact activation frame");
    for (const node of [selected, before]) {
      const carrier = program.facts.getFact(node, rustRuntimeCarrierKey)?.carrier;
      assert.equal(rustTargetTypeRefEquals(carrier, returned), true, "slot and alias share the finalized physical ABI");
    }
    for (const node of arrows.filter(node => {
      let parent = ast.parent(node);
      while (parent !== undefined && !ast.is.IsFunctionDeclaration(parent)) parent = ast.parent(parent);
      return parent === escaped;
    })) {
      const carrier = program.facts.getFact(node, rustTargetOperationFactKey)?.resultCarrier;
      assert.equal(rustTargetTypeRefEquals(carrier, returned), true, "every entry retains the same owning activation");
    }
    const logical = rustCallableProtocol(returned);
    assert.equal(logical?.parameters.length, 1);
    assert.equal(rustTargetTypeRefEquals(logical?.parameters[0], rustSourcePrimitiveTargetType("float64")), true);
    assert.equal(rustTargetTypeRefEquals(logical?.result, rustSourcePrimitiveTargetType("float64")), true);
    const ordinaryResult = program.facts.getFact(ordinary, rustSourceCallableReturnFactKey)?.returnCarrier;
    assert.equal(rustFrameCallableValue(ordinaryResult) === undefined, true, "ordinary callbacks acquire no frame ABI");
    assert.equal(rustCallableProtocol(ordinaryResult)?.parameters.length, 1);
    const definition = program.callableValues.frames.definitionFor(returned);
    assert.equal(definition !== undefined, true, "exact frame carrier has one sealed physical definition");
    assert.equal(definition.activation.components.includes(program.callableOwnership.componentForSlot(selected)), true);
    assert.equal(definition.entries.length, 1);
    assert.equal(definition.entries[0].implementations.length, 2);
    assert.equal(definition.bindings.length, 2, "recursive slot and same-activation captured seed share one frame");
    assert.equal(program.callableValues.frames.bindingFor(selected)?.entry === definition.entries[0], true);
    assert.equal(program.callableValues.frames.entryFor(returned) === definition.entries[0], true);
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.entries[0].implementations), true);
    const slotInput = Node_Initializer(ast, before);
    const aliasInput = returns.map(node => Node_Expression(ast, node)).find(node => node !== undefined && ast.is.IsIdentifier(node) && ast.text(node) === "before");
    assert.equal(slotInput !== undefined && program.callableValues.frames.isSameActivationInput(slotInput, definition), true,
      "an exact live slot retains the current runtime activation");
    assert.equal(aliasInput !== undefined && program.callableValues.frames.isSameActivationInput(aliasInput, definition), true,
      "an immutable same-activation alias retains its own selected entry");
    const ordinaryArrow = arrows.find(node => {
      let parent = ast.parent(node);
      while (parent !== undefined && !ast.is.IsFunctionDeclaration(parent)) parent = ast.parent(parent);
      return parent === ordinary;
    });
    assert.equal(ordinaryArrow !== undefined, true, "the unrelated ordinary callback is present");
    assert.equal(program.callableValues.frames.isSameActivationInput(ordinaryArrow, definition), false,
      "an unrelated closure cannot lose its owning activation");
    assert.equal(program.callableValues.frames.isSameActivationInput(slotInput, { ...definition }), false,
      "a forged copied definition does not authorize a physical input");
  });
}

for (const jsEnabled of [false, true]) {
  for (const [name, classSource, count] of [
    ["mutable", `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped(): (count: number) => number {
  const value = new Value();
  const before = value.recurse;
  value.rebind();
  return before;
}
`, 1],
    ["mutual", `
class Parity {
  readonly even = (count: number): boolean => count === 0 ? true : this.odd(count - 1);
  readonly odd = (count: number): boolean => count === 0 ? false : this.even(count - 1);
}
export function escaped(): (count: number) => boolean { return new Parity().even; }
`, 2],
  ]) {
    test(`${jsEnabled ? "JS" : "native"} ${name} receiver slots retain one sealed native activation definition`, () => {
      const { program } = analyzeRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": classSource } });
      const definitions = program.callableValues.frames.definitions;
      assert.equal(definitions.length, 1, "one source receiver owns one physical activation");
      const definition = definitions[0];
      assert.equal(definition.activation.kind, "class");
      assert.equal(definition.entries.length, 1, "equal native invocation protocols share one typed entry");
      assert.equal(definition.entries[0].implementations.length, 2);
      assert.equal(definition.bindings.length, count);
      for (const binding of definition.bindings) {
        assert.equal(binding.entry === definition.entries[0], true);
        assert.equal(program.callableValues.frames.definitionFor(binding.carrier) === definition, true);
      }
      for (const implementation of definition.entries[0].implementations)
        assert.equal(program.callableValues.frames.implementationFor(implementation.declaration) === implementation, true);
    });
  }
}
