import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("class constructor views retain identity and live static storage across files", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_constructor_values" } },
    files: {
      "classes.ts": `
export class First { static count: number = 1; static enabled: boolean = true; }
export class Second { static count: number = 1; static enabled: boolean = true; }
`,
      "index.ts": `
import { check } from "@acme/testing";
import { First as Selected, Second } from "./classes.js";
type Full = { enabled: boolean; count: number; };
type Count = { count: number; };
function first(): Full { return Selected; }
function second(): Full { return Second; }
export function main(): void {
  const value: Full = Selected;
  const repeated: Full = Selected;
  const count: Count = Selected;
  check(value === repeated && value === first() && value !== second());
  check(value === count && value.count === 1 && value.enabled);
  Selected.count = 7;
  check(value.count === 7 && count.count === 7);
  value.count = 9;
  check(Selected.count === 9 && count.count === 9 && Second.count === 1);
  count.count = 12;
  check(value.count === 12 && Selected.count === 12);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(generated, /fn object_identity_key\(&self\) -> usize/u);
  assert.match(generated, /core::ptr::from_ref\(self\)\.addr\(\)/u);
  validateGeneratedProject("class-constructor-values", result.artifacts, { run: true });
});

test("unproved class constructor method views reject before publication", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: { "index.ts": `
class Factory { static read(): number { return 1; } }
export function view(): { read: () => number } { return Factory; }
` },
  });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error" &&
    /class.*value|constructor.*view/i.test(diagnostic.message)));
  assert.equal(result.artifacts.length, 0);
});

test("type-only constructor parameters do not initialize an unused native class owner", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
class Entry { value = 3; }
export function ignored(constructor: typeof Entry): number { return 1; }
export function main(): void { const entry = new Entry(); if (entry.value !== 3) throw new Error("value"); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(generated, /fn ignored/u);
  assert.doesNotMatch(generated, /Rc::new\(EntryClass\s*\{/u);
  assert.doesNotMatch(generated, /class_environment\.initialize/u);
});

test("inferred constructor aliases retain the selected evaluation across calls and argument effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "inferred_constructor_values" } },
    files: { "index.ts": `
function factory(seed: number) {
  class Entry {
    static count = seed;
    value: number;
    constructor(value: number) { Entry.count++; this.value = seed + value; }
    read(): number { return this.value + seed; }
    static read(): number { return Entry.count; }
  }
  return Entry;
}
export function main(): void {
  const first = factory(3);
  const alias = first;
  const second = factory(8);
  if (alias !== first || first === second) throw new Error("class identity");
  let chosen = first;
  const argument = (): number => { chosen = second; return 2; };
  const value = new chosen(argument());
  if (value.read() !== 8 || first.count !== 4 || second.count !== 8) throw new Error("receiver order");
  alias.count += 2;
  if (first.read() !== 6 || chosen.read() !== 8) throw new Error("live static storage");
  const fresh = new (factory(20))(1);
  if (fresh.read() !== 41) throw new Error("fresh receiver");
  class Empty {}
  const EmptyAlias = Empty;
  const empty = new EmptyAlias();
  if (empty !== empty) throw new Error("empty alias");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("inferred-constructor-values", result.artifacts, { run: true });
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(generated, /Rc::new\([^\n]*EmptyClass\s*\{/u);
  assert.doesNotMatch(generated, /struct [^\n]*EmptyClass[^}]*OnceCell/u);
});

test("generic constructor binders are independent of captured outer class arguments", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_constructor_binders" } },
    files: { "index.ts": `
function outer<Seed>(seed: Seed) {
  return class Box<Item> {
    readonly seed = seed;
    item: Item;
    constructor(item: Item) { this.item = item; }
    read(): Item { return this.item; }
  };
}
export function main(): void {
  const TextBox = outer("native");
  const Alias = TextBox;
  const number = new Alias<number>(7);
  const text = new TextBox<string>("value");
  if (number.seed !== "native" || number.read() !== 7 || text.read() !== "value") throw new Error("binder");
  number.item = 9;
  if (number.read() !== 9 || text.seed !== "native") throw new Error("storage");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic-constructor-binders", result.artifacts, { run: true });
});

test("native constructor and static views compose across forward-only package boundaries", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "constructor_package_views" } },
    sourcePackages: {
      fingerprint: "constructor-package-views", rootPackageId: "app",
      packages: [
        { id: "model", name: "model", packageRoot: "/src/model", sourceRoot: "/src",
          sourceFiles: ["/src/model.ts"], dependencies: [], componentId: "model",
          exports: [{ specifier: "model", sourceFile: "/src/model.ts" }] },
        { id: "app", name: "app", packageRoot: "/src", sourceRoot: "/src",
          sourceFiles: ["/src/index.ts"], dependencies: ["model"], componentId: "app",
          exports: [{ specifier: "app", sourceFile: "/src/index.ts" }] },
      ],
      components: [ { id: "model", packages: ["model"], dependencies: [] },
        { id: "app", packages: ["app"], dependencies: ["model"] } ],
    },
    files: {
      "model.ts": `
export function factory(seed: number) {
  return class Entry {
    static count = seed;
    value: number;
    constructor(value: number) { this.value = value + seed; }
    static read(): number { return Entry.count; }
  };
}
`,
      "index.ts": `
import { factory } from "./model.js";
interface Constructor { new(value: number): { value: number }; count: number; read(): number; }
export function main(): void {
  const native = factory(4);
  const view: Constructor = native;
  const repeated: Constructor = native;
  if (view !== repeated || view.read() !== 4) throw new Error("identity");
  view.count = 8;
  if (native.count !== 8 || repeated.read() !== 8) throw new Error("statics");
  const value = new view(3);
  if (value.value !== 7) throw new Error("construct");
}
`,
    } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("constructor-package-views", result.artifacts, { run: true });
});
