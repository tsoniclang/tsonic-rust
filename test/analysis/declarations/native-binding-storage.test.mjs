import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function programFor(source) {
  const { program } = analyzeRust({ files: { "index.ts": source } });
  assert.equal(program !== undefined, true, "the real checked pipeline publishes its complete native forms");
  return program;
}

test("native binding storage retains its original declaration, selected use and complete immutable native slot", () => {
  const program = programFor("export function next(start: number): number { let value = start; value++; return value; }");
  const rows = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeBindings);
  assert.equal(rows.length > 0, true, "the actual emitted local bindings have final storage");
  for (const context of program.physicalEmissionContexts.contexts) {
    const declarations = new Set();
    for (const row of context.nativeBindings) {
      assert.equal(row.contextUse === context.use, true, "publication retains the exact selecting physical context");
      assert.equal(declarations.has(row.declaration), false, "one source declaration has one physical storage per context");
      declarations.add(row.declaration);
      assert.equal(program.source.ast.getSourceFile(row.declaration) !== undefined, true, "the owner is an actual checked declaration");
      assert.equal(Object.isFrozen(row) && Object.isFrozen(row.storage), true, "a consumer cannot mutate the final native choice");
      assert.equal(row.readCarrier !== undefined, true, "a native read has an explicit carrier, not a storage spelling guess");
      assert.equal("preparation" in row, false, "private ABI preparation does not leak into sealed native holder records");
      assert.equal(program.physicalEmissionContexts.contextFor(row.contextUse) === context, true,
        "the published native holder uses the original context index");
      assert.equal(row.sourceBindings === context.bindings, true, "original correlated source substitutions are retained");
    }
  }
});

test("captured values keep their actual read representation rather than becoming a declaration's frame entry", () => {
  const program = programFor(`
export function observed(start: number): number {
  let value = start;
  const next = () => ++value;
  return next();
}`);
  const captures = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeBindings)
    .filter(row => row.source.kind === "capture");
  assert.equal(captures.length > 0, true, "the actual capture inventories supply the storage request");
  for (const row of captures) {
    assert.equal(row.owner.kind, "binding", "a captured read is not silently replaced by a stored frame entry");
    assert.equal(program.source.ast.getSourceFile(row.source.reference) !== undefined, true,
      "the exact original captured reference is preserved");
    assert.equal(row.storage.kind, row.source.storage, "the original capture mode owns the native slot");
    assert.equal(rustTargetTypeRefEquals(row.readCarrier, row.storage.payloadCarrier), true,
      "the captured payload's native read is distinct from any enclosing slot wrappers");
  }
});

test("native module cells retain their module destruction owner and actual empty TLS constructor", () => {
  const program = programFor("export let total = 1; export function next(): number { total += 1; return total; }");
  const rows = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeBindings)
    .filter(row => row.owner.kind === "module");
  assert.equal(rows.length > 0, true, "the actual mutable module binding has a native holder");
  for (const row of rows) {
    assert.equal(row.storage.kind, "module-cell", "the native module slot is not initializer-local storage");
    assert.equal(row.owner.sourceFile === program.source.ast.getSourceFile(row.declaration), true,
      "cleanup belongs to the original module, not the initializer lexical scope");
    assert.equal(row.storage.deferredConstructor, "rt::ModuleCell::new", "the real TLS declaration starts empty");
    assert.deepEqual(row.storage.requirements, ["clone", "static"], "the actual runtime construction bounds are preserved");
  }
});

test("class fields publish final payload and slot through the same one completed native declaration", () => {
  const program = programFor("export class Box { constructor(public value: number) {} read(): number { return this.value; } }");
  const definition = program.projectTypes.definitions.find(definition => definition.kind === "class");
  assert.equal(definition !== undefined, true, "the real authored class has a checked declaration");
  const form = program.nativeDeclarations.get(definition.declaration);
  assert.equal(form?.kind, "class", "the original declaration owns its final physical fields");
  assert.equal(program.nativeDeclarations.get(definition.declaration) === form, true, "the native declaration is a sealed lookup");
  assert.equal(form.fields.length, 1, "the exact original parameter-property remains present");
  const field = form.fields[0];
  assert.equal(field.nativePayloadCarrier === field.nativeStorage.payloadCarrier, true, "the selected payload is published by identity");
  assert.equal(field.nativeCarrier === field.nativeStorage.slotCarrier, true, "the renderer receives the complete actual slot");
  assert.equal(Object.isFrozen(field.nativeStorage), true, "field publication contains no computing storage service");
});

test("inherited construction fields retain their actual consuming plan and original declaring owner", () => {
  const program = programFor(`
export class Base { constructor(public value: number) {} }
export class Derived extends Base { constructor(value: number) { super(value); } }
`);
  const definition = program.projectTypes.definitions.find(definition => definition.sourceName === "Derived");
  assert.equal(definition !== undefined, true, "the actual derived class has its own construction plan");
  const plan = program.projectConstructions.forDefinition(definition);
  assert.equal(plan !== undefined, true, "the canonical construction owner publishes the derived plan");
  const inherited = plan.fields.find(field => field.owner !== definition);
  assert.equal(inherited !== undefined, true, "the real plan contains its inherited physical field");
  const context = program.physicalEmissionContexts.contextForOwner(plan, "constructor");
  assert.equal(context !== undefined, true, "the exact consuming constructor owns a physical context");
  const row = context.nativeBindings.find(row => row.declaration === inherited.declaration);
  assert.equal(row?.source.kind, "field", "an inherited row is not checked against a different class's plan object");
  assert.equal(row.source.definingOwner === inherited.owner.declaration, true, "the original native field owner is retained");
  assert.equal(row.contextUse === context.use, true, "the actual derived-constructor occurrence remains the selecting use");
});
