import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { collectTargetSourceProfileContributions } from "../../../../tsonic/packages/host/dist/target/source-profile.js";
import { createRustErrorStorageDemandQuery } from "../../../dist/analysis/objects/error-storage-demands.js";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { rustNativeSourceProfileContributions, rustJsSurfaceSourceProfileContributions } from "../../../dist/source/profiles/declarations.js";
import { liveErrorBaseWriteSource, liveErrorStorageFiles } from "../../../../tsonic/test/fixtures/live-error-storage.mjs";
import { implicitErrorInterfaceSource } from "../../../../tsonic/test/fixtures/implicit-error-interfaces.mjs";

function analyzed(files, jsEnabled) {
  const profile = collectTargetSourceProfileContributions({ project: {}, projectRoot: "/src",
    projectDirectory: "/src", target: { id: "rust", options: {} }, targetPackId: jsEnabled ? "js" : "rust",
    selectedCapabilities: [], selectedSurfaces: [], targetContributions: jsEnabled
      ? rustJsSurfaceSourceProfileContributions() : rustNativeSourceProfileContributions() });
  assert.deepEqual(profile.diagnostics, []);
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src",
    files: new Map([...Object.entries(files).map(([name, text]) => [`/src/${name}`, text]), ...profile.files.map(file => [file.path, file.text])]),
    compilerOptions: { noLib: true, strict: true, skipLibCheck: true, module: "esnext", moduleResolution: "bundler", target: "es2022" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0,
    formatDiagnostics(checked.diagnostics.filter(diagnostic => diagnostic !== undefined), "/src"));
  const source = createTargetSourceProgram(checked);
  const projectFiles = source.sourceFiles.filter(file => Object.keys(files).some(name => source.ast.getFileName(file) === `/src/${name}`));
  const profiles = createRustSourceProfileRegistry(source.sourceFiles, source.ast, jsEnabled);
  return { source, projectFiles, demand: createRustErrorStorageDemandQuery(source, profiles, projectFiles, () => ({ kind: "ordinary" })) };
}

function declarations(source, projectFiles) {
  const result = [];
  const visit = node => {
    if (source.ast.is.IsVariableDeclaration(node) || source.ast.is.IsParameterDeclaration(node) ||
      source.ast.is.IsPropertyDeclaration(node) || source.ast.is.IsFunctionDeclaration(node)) result.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  projectFiles.forEach(visit);
  return result;
}

for (const jsEnabled of [false, true]) {
  const profile = jsEnabled ? "js" : "native";
  test(`nested generic interface Error properties retain their instantiated writable origins in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
interface SourceBox<Value> { readonly value: Value; }
interface SelectedBox<Value> { readonly value: Value; }
class Stored { readonly nested: SourceBox<Error>; constructor(nested: SourceBox<Error>) { this.nested = nested; } }
interface Selected { readonly nested: SelectedBox<Error>; }
export function run(): string {
  const original = new Error("original");
  const stored = new Stored({ value: original });
  const selected: Selected = stored;
  original.message = "changed";
  return selected.nested.value.message;
}
` }, jsEnabled);
    let selected;
    const visit = node => {
      if (source.ast.is.IsPropertySignatureDeclaration(node) && source.ast.text(source.ast.name(node)) === "value" &&
        source.ast.text(source.ast.name(source.ast.parent(node))) === "SelectedBox") selected = node;
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    projectFiles.forEach(visit);
    assert.equal(selected !== undefined, true);
    assert.equal(demand.receivesWritableNative(selected), true);
    const origins = demand.storageOriginsFor(selected);
    assert.equal(origins.kind === "resolved", true);
    assert.equal(origins.kind === "resolved" && origins.origins.includes(demand.nativeConstructors[0]), true);
  });
  test(`implicit interface Error properties retain exact writable origins in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": implicitErrorInterfaceSource(false) }, jsEnabled);
    let selected;
    const visit = node => {
      if (source.ast.is.IsPropertySignatureDeclaration(node) && source.ast.text(source.ast.name(node)) === "error") selected = node;
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    projectFiles.forEach(visit);
    assert.equal(selected !== undefined, true);
    assert.equal(demand.receivesWritableNative(selected), true);
    const origins = demand.storageOriginsFor(selected);
    assert.equal(origins.kind === "resolved", true);
    assert.equal(origins.kind === "resolved" && origins.origins.includes(demand.nativeConstructors[0]), true);
  });
  test(`ordinary native Error remains immutable despite mutable project Errors in ${profile}`, () => {
    const { demand } = analyzed(liveErrorStorageFiles, jsEnabled);
    assert.equal(demand.fieldWrites.length, 4);
    assert.equal(demand.nativeConstructors.length, 1);
    assert.equal(demand.storageFor(demand.nativeConstructors[0]).kind, "immutable");
  });

  test(`native Error aliases carry exact selected field-write demand in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      export function run(): string {
        const original = new Error("x"); const alias = original;
        alias.name = "Changed"; alias.message = "y"; alias.stack = "stack";
        return original.message;
      }` }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 1);
    assert.equal(demand.fieldWrites.length, 3);
    const selected = demand.storageFor(demand.nativeConstructors[0]);
    assert.equal(selected.kind, "writable");
    const selectedWrites = new Set(selected.writes);
    const expectedWrites = new Set(demand.fieldWrites);
    assert.equal(selectedWrites.size, expectedWrites.size);
    assert.equal([...selectedWrites].every(write => expectedWrites.has(write)), true,
      "selected writes retain every exact source node identity");
  });

  test(`native Error write demand is instance-specific rather than a blanket constructor switch in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      export function run(): string { const written = new Error("first"); const untouched: Error = new Error("second");
        const alias = written; alias.message = "changed"; return untouched.message; }` }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 2);
    assert.equal(demand.storageFor(demand.nativeConstructors[0]).kind, "writable");
    assert.equal(demand.storageFor(demand.nativeConstructors[1]).kind, "immutable");
  });

  test(`native Error demand follows exact base parameter slots rather than origin-only memberWritten in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": liveErrorBaseWriteSource }, jsEnabled);
    assert.equal(demand.fieldWrites.length, 3);
    assert.equal(demand.nativeConstructors.length, 1);
    const origin = demand.nativeConstructors[0];
    assert.equal(source.navigation.expressionValueFlow(origin).memberWritten, false);
    assert.equal(source.navigation.expressionValueFlow(origin).passedAsArgument, true);
    const parameter = declarations(source, projectFiles).find(node => source.ast.is.IsParameterDeclaration(node)
      && source.ast.text(source.ast.name(node)) === "error");
    assert.equal(parameter !== undefined, true, "selected Error parameter exists");
    assert.equal(source.navigation.declarationUseSummary(parameter).memberWritten, true);
    assert.equal(demand.storageFor(parameter).kind, "writable");
    assert.equal(demand.storageFor(origin).kind, "writable");
    assert.equal(demand.storageFor(origin).writes.length, 3);
  });

  test(`native Error demand follows selected cross-file returns and original field storage in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({
      "helpers.ts": `export function identity(value: Error): Error { return value; }
        export class Holder { constructor(public readonly error: Error) {} }
        export function write(value: Error): void { value.message = "changed"; }`,
      "index.ts": `import { Holder, identity, write } from "./helpers.js";
        export function run(): string { const original = new Error("x");
          const holder = new Holder(identity(original)); write(holder.error); return original.message; }`,
    }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 1);
    assert.equal(demand.storageFor(demand.nativeConstructors[0]).kind, "writable");
    const parameter = declarations(source, projectFiles).find(node => source.ast.is.IsParameterDeclaration(node)
      && source.ast.text(source.ast.name(node)) === "error");
    assert.equal(parameter !== undefined, true, "selected Error field parameter exists");
    assert.equal(demand.storageFor(parameter).kind, "writable");
  });

  test(`same-spelled non-Error fields and immutable provider declarations never become native constructors in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      declare function providerError(): Error;
      class RecordValue { name = ""; message = ""; stack: string | undefined = undefined; }
      function mutate(value: Error): void { value.message = "changed"; }
      export function run(): Error {
        const immutable = new Error("read only");
        const record = new RecordValue(); record.message = "record";
        mutate(providerError()); return immutable;
      }` }, jsEnabled);
    assert.equal(demand.fieldWrites.length, 1);
    assert.equal(demand.nativeConstructors.length, 1);
    assert.equal(demand.storageFor(demand.nativeConstructors[0]).kind, "immutable");
  });

  test(`native Error demands follow selected concise callable returns and field initializers in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      const create = (): Error => new Error("original");
      class Holder { readonly error: Error = create(); }
      export function run(): string { const holder = new Holder();
        holder.error.message = "changed"; return holder.error.message; }` }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 1);
    assert.equal(demand.storageFor(demand.nativeConstructors[0]).kind, "writable");
  });

  test(`native Error demands follow the exact implementation of an overloaded parameter in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      function write(value: Error): void;
      function write(value: Error): void { value.message = "changed"; }
      export function run(): string { const error = new Error("original"); write(error); return error.message; }` }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 1);
    assert.equal(demand.storageFor(demand.nativeConstructors[0]).kind, "writable");
  });

  test(`unmodeled indexed Error writes are unresolved rather than false writable-origin proof in ${profile}`, () => {
    const { source, demand } = analyzed({ "index.ts": `
      export function run(values: Error[]): void { values[0].message = "changed"; }` }, jsEnabled);
    assert.equal(demand.fieldWrites.length, 1);
    const receiver = source.ast.as.AsPropertyAccessExpression(demand.fieldWrites[0]).Expression;
    assert.equal(demand.storageFor(receiver).kind, "unresolved");
  });

  test(`unmodeled destructured Error writes are unresolved rather than guessed origin proof in ${profile}`, () => {
    const { source, demand } = analyzed({ "index.ts": `
      export function run(record: { error: Error }): void {
        const { error } = record; error.message = "changed";
      }` }, jsEnabled);
    assert.equal(demand.fieldWrites.length, 1);
    const receiver = source.ast.as.AsPropertyAccessExpression(demand.fieldWrites[0]).Expression;
    assert.equal(demand.storageFor(receiver).kind, "unresolved");
  });

  test(`native Error write demand reaches direct and selected-call throw recovery in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      function fail(value: Error): never { throw value; }
      export function run(): string {
        const first = new Error("first"); const second = new Error("second");
        try { throw first; } catch (caught) { if (caught instanceof Error) caught.message = "changed first"; }
        try { fail(second); } catch (caught) { if (caught instanceof Error) caught.name = "ChangedSecond"; }
        return first.message + second.name;
      }` }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 2);
    assert.equal(demand.fieldWrites.length, 2);
    for (const constructor of demand.nativeConstructors) assert.equal(demand.storageFor(constructor).kind, "writable");
  });

  test(`Error field invalidation follows real aliases, callee bodies and captured writes in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
      declare function opaque(value: Error): string;
      declare function invoke(callback: () => string): string;
      export function run(): string {
        const original = new Error("original"); const alias = original; const unrelated = new Error("other");
        function same(): string { alias.message = "changed"; return "same"; }
        function other(): string { unrelated.message = "changed"; return "other"; }
        function read(): string { return alias.message; }
        const writer = (): string => { original.name = "Changed"; return "writer"; };
        same(); other(); read(); writer(); opaque(original); invoke(writer);
        return original.message;
      }` }, jsEnabled);
    const owner = declarations(source, projectFiles).find(node => source.ast.text(source.ast.name(node)) === "original");
    const calls = new Map();
    let writer;
    const visit = node => {
      if (source.ast.is.IsCallExpression(node)) calls.set(source.ast.text(source.ast.as.AsCallExpression(node).Expression), node);
      if (source.ast.is.IsArrowFunction(node)) writer = node;
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    projectFiles.forEach(visit);
    assert.equal(owner !== undefined, true, "exact original Error owner exists");
    assert.equal(demand.invalidationFor(owner, calls.get("same"), new Set()).kind, "invalidated");
    assert.equal(demand.invalidationFor(owner, calls.get("other"), new Set()).kind, "preserved");
    assert.equal(demand.invalidationFor(owner, calls.get("read"), new Set()).kind, "preserved");
    assert.equal(demand.invalidationFor(owner, calls.get("writer"), new Set()).kind, "invalidated");
    assert.equal(demand.invalidationFor(owner, writer, new Set()).kind, "preserved");
    assert.equal(demand.invalidationFor(owner, calls.get("opaque"), new Set()).kind, "unresolved");
    assert.equal(demand.invalidationFor(owner, calls.get("invoke"), new Set()).kind, "invalidated");
    assert.equal(demand.invalidationFor(owner, calls.get("opaque"), new Set([calls.get("opaque")])).kind, "preserved");
  });
  test(`Error invalidation retains eager class regions and skips deferred work in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
      export function run(): void {
        const original = new Error("original");
        function write(): "value" { original.message = "changed"; return "value"; }
        class DeferredField { value = write(); }
        class DeferredMethod { value(): string { return write(); } }
        class DeferredConstructor { constructor(value = write()) {} }
        class ComputedMethod { [write()](): void {} }
        class ComputedGetter { get [write()](): string { return "unused"; } }
        class ComputedSetter { set [write()](value: string) {} }
        class StaticField { static value = write(); }
        class StaticBlock { static { write(); } }
        class Base {}
        function base(): typeof Base { write(); return Base; }
        class Derived extends base() {}
        const expression = class { [write()](): void {} };
      }` }, jsEnabled);
    const owner = declarations(source, projectFiles).find(node => source.ast.text(source.ast.name(node)) === "original");
    assert.equal(owner !== undefined, true, "exact original Error owner exists");
    const selected = new Map();
    const visit = node => {
      if (source.ast.is.IsClassDeclaration(node)) selected.set(source.ast.text(source.ast.name(node)), node);
      if (source.ast.is.IsClassExpression(node)) selected.set("expression", node);
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    projectFiles.forEach(visit);
    for (const name of ["DeferredField", "DeferredMethod", "DeferredConstructor", "Base"]) {
      assert.equal(selected.has(name), true, name);
      assert.equal(demand.invalidationFor(owner, selected.get(name), new Set()).kind, "preserved", name);
    }
    for (const name of ["ComputedMethod", "ComputedGetter", "ComputedSetter", "StaticField", "StaticBlock", "Derived", "expression"]) {
      assert.equal(selected.has(name), true, name);
      assert.equal(demand.invalidationFor(owner, selected.get(name), new Set()).kind, "invalidated", name);
    }
  });

  test(`Error invalidation follows executed defaults, accessors and instance initialization in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
      export function run(optional: string | undefined): void {
        const original = new Error("original");
        function mutate(): string { original.message = "changed"; return "changed"; }
        function defaultWrite(value: string = mutate()): string { return value; }
        class Accessors {
          get value(): string { return mutate(); }
          set value(input: string) { original.message = input; }
        }
        class Initialized { value = mutate(); }
        class Defaulted { constructor(value: string = mutate()) {} }
        class Deferred { callback = () => mutate(); }
        const accessors = new Accessors();
        const omitted = defaultWrite();
        const present = defaultWrite("provided");
        const absent = defaultWrite(undefined);
        const maybe = defaultWrite(optional);
        const fetched = accessors.value;
        const stored = (accessors.value = "provided");
        const initialized = new Initialized();
        const constructed = new Defaulted();
        const provided = new Defaulted("provided");
        const deferred = new Deferred();
      }` }, jsEnabled);
    const selected = declarations(source, projectFiles);
    const owner = selected.find(node => source.ast.text(source.ast.name(node)) === "original");
    assert.equal(owner !== undefined, true, "exact original Error owner exists");
    const expectations = [["omitted", "invalidated"], ["present", "preserved"],
      ["absent", "invalidated"], ["maybe", "invalidated"], ["fetched", "invalidated"],
      ["stored", "invalidated"], ["initialized", "invalidated"], ["constructed", "invalidated"],
      ["provided", "preserved"], ["deferred", "preserved"]];
    const actual = expectations.map(([name]) => {
      const declaration = selected.find(node => source.ast.text(source.ast.name(node)) === name);
      const expression = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
      assert.equal(expression !== undefined, true, name);
      return [name, demand.invalidationFor(owner, expression, new Set()).kind];
    });
    assert.deepEqual(actual, expectations);
  });

  test(`Error invocation footprints distinguish callable values from factory results in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
      export function run(): void {
        const original = new Error("original");
        function create(): () => string {
          original.message = "created";
          return () => "read only";
        }
        const callback = create();
        const factoryAlias = create;
        const readOnly = callback();
        const creates = factoryAlias();
        class Base { value(): string { return "read only"; } }
        class Derived extends Base { override value(): string { original.message = "changed"; return "changed"; } }
        const receiver: Base = new Derived();
        const base: Base = new Base();
        const dispatch = receiver.value();
        const stable = base.value();
      }` }, jsEnabled);
    const selected = declarations(source, projectFiles);
    const owner = selected.find(node => source.ast.text(source.ast.name(node)) === "original");
    assert.equal(owner !== undefined, true, "exact original Error owner exists");
    const expectations = [["readOnly", "preserved"], ["creates", "invalidated"],
      ["dispatch", "invalidated"], ["stable", "preserved"]];
    const actual = expectations.map(([name]) => {
      const declaration = selected.find(node => source.ast.text(source.ast.name(node)) === name);
      const expression = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
      assert.equal(expression !== undefined, true, name);
      return [name, demand.invalidationFor(owner, expression, new Set()).kind];
    });
    assert.deepEqual(actual, expectations);
  });

  test(`Error transport follows transitive executed regions without entering unused defaults in ${profile}`, () => {
    const { demand } = analyzed({ "index.ts": `
      function fail(value: Error): never { while (true) { throw value; } }
      function forward(value: Error): never { return fail(value); }
      export function run(): void {
        const direct = new Error("direct"); const getter = new Error("getter");
        const setter = new Error("setter"); const constructor = new Error("constructor");
        const defaulted = new Error("defaulted"); const initialized = new Error("initialized");
        const untouched = new Error("untouched"); const deferred = new Error("deferred");
        class Accessors {
          get value(): string { return forward(getter); }
          set value(input: Error) { forward(input); }
        }
        class Constructed { constructor(value: Error) { forward(value); } }
        class Initialized { value = forward(initialized); }
        class Deferred { get value(): string { return forward(deferred); } }
        function omitted(value: string = forward(defaulted)): string { return value; }
        function present(value: string = forward(untouched)): string { return value; }
        const accessors = new Accessors();
        try { forward(direct); } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { accessors.value; } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { accessors.value = setter; } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { new Constructed(constructor); } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { omitted(); } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { new Initialized(); } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { present("provided"); } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
        try { new Deferred(); } catch (caught) { if (caught instanceof Error) caught.message = "changed"; }
      }` }, jsEnabled);
    assert.equal(demand.nativeConstructors.length, 8);
    assert.deepEqual(demand.nativeConstructors.map(origin => demand.storageFor(origin).kind),
      ["writable", "writable", "writable", "writable", "writable", "writable", "immutable", "immutable"]);
  });

  test(`Error receiver and returned backing follow exact virtual member contracts in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
      export function run(): void {
        class Mutable extends Error {
          change(): string { while (true) { this.message = "changed"; return "changed"; } }
          defer(): () => string { return () => { this.name = "Changed"; return "changed"; }; }
        }
        const original = new Mutable("original");
        const changed = original.change();
        const callback = original.defer();
        const later = callback();
        const first = new Error("first"); const second = new Error("second");
        class Base {
          get value(): Error { return first; }
        }
        class Derived extends Base { override get value(): Error { return second; } }
        const receiver: Base = new Derived();
        receiver.value.message = "changed";
      }` }, jsEnabled);
    const selected = declarations(source, projectFiles);
    const owner = selected.find(node => source.ast.text(source.ast.name(node)) === "original");
    assert.equal(owner !== undefined, true, "exact receiver Error owner exists");
    for (const name of ["changed", "later"]) {
      const declaration = selected.find(node => source.ast.text(source.ast.name(node)) === name);
      const expression = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
      assert.equal(expression !== undefined, true, name);
      assert.equal(demand.invalidationFor(owner, expression, new Set()).kind, "invalidated", name);
    }
    assert.equal(demand.nativeConstructors.length, 3);
    assert.deepEqual(demand.nativeConstructors.map(origin => demand.storageFor(origin).kind), ["writable", "immutable", "writable"]);
  });

  test(`Error invocation bindings retain actual receiver and argument identity in ${profile}`, () => {
    const { source, projectFiles, demand } = analyzed({ "index.ts": `
      export function run(): void {
        class Mutable extends Error {
          change(): string { this.message = "changed"; return "changed"; }
        }
        const original = new Mutable("original"); const other = new Mutable("other");
        function update(value: Error): string { value.message = "changed"; return "changed"; }
        function readonly(value: Error, again: boolean): string {
          if (again) return readonly(value, false);
          return value.message;
        }
        class Base { value(): string { return "read only"; } }
        class Derived extends Base { override value(): string { original.message = "changed"; return "changed"; } }
        function invoke(value: Base): string { return value.value(); }
        const otherReceiver = other.change();
        const actualReceiver = original.change();
        const otherArgument = update(other);
        const actualArgument = update(original);
        const recursive = readonly(original, true);
        const base = invoke(new Base());
        const derived = invoke(new Derived());
      }` }, jsEnabled);
    const selected = declarations(source, projectFiles);
    const owner = selected.find(node => source.ast.text(source.ast.name(node)) === "original");
    assert.equal(owner !== undefined, true, "exact original Error owner exists");
    const expectations = [["otherReceiver", "preserved"], ["actualReceiver", "invalidated"],
      ["otherArgument", "preserved"], ["actualArgument", "invalidated"], ["recursive", "preserved"],
      ["base", "preserved"], ["derived", "invalidated"]];
    const actual = expectations.map(([name]) => {
      const declaration = selected.find(node => source.ast.text(source.ast.name(node)) === name);
      const expression = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
      assert.equal(expression !== undefined, true, name);
      return [name, demand.invalidationFor(owner, expression, new Set()).kind];
    });
    assert.deepEqual(actual, expectations);
  });
}

test("captured stack invalidation tracks only the exact receiver and never closure construction", () => {
  const { source, projectFiles, demand } = analyzed({ "index.ts": `
    export function run(): void {
      const original = new Error("original"); const unrelated = new Error("other");
      Error.captureStackTrace(original); Error.captureStackTrace(unrelated);
      const later = () => { Error.captureStackTrace(original); };
    }` }, true);
  const owner = declarations(source, projectFiles).find(node => source.ast.text(source.ast.name(node)) === "original");
  const calls = [];
  let closure;
  const visit = node => {
    if (source.ast.is.IsCallExpression(node)) calls.push(node);
    if (source.ast.is.IsArrowFunction(node)) closure = node;
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  projectFiles.forEach(visit);
  assert.equal(demand.invalidationFor(owner, calls[0], new Set()).kind, "invalidated");
  assert.equal(demand.invalidationFor(owner, calls[1], new Set()).kind, "preserved");
  assert.equal(demand.invalidationFor(owner, closure, new Set()).kind, "preserved");
});
