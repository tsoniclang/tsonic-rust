import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";

function analyzeTracked(text, surfaces) {
  const admissions = new Map();
  const closures = new Map();
  const context = analyzeRustErrorEffects(text, { surfaces }, original => {
    const records = original.records;
    return { ...original, records: { ...records,
      bindingStoragePlans: { ...records.bindingStoragePlans, capture(declaration, ...arguments_) {
        admissions.set(declaration, (admissions.get(declaration) ?? 0) + 1);
        return records.bindingStoragePlans.capture(declaration, ...arguments_);
      }, requireLocation(current, declaration, carrier) {
        const absent = records.bindingStorage.get(declaration) === undefined;
        const accepted = records.bindingStoragePlans.requireLocation(current, declaration, carrier);
        if (absent && accepted) admissions.set(declaration, (admissions.get(declaration) ?? 0) + 1);
        return accepted;
      } },
      closureCaptures: { ...records.closureCaptures, capture(declaration, ...arguments_) {
        closures.set(declaration, (closures.get(declaration) ?? 0) + 1);
        return records.closureCaptures.capture(declaration, ...arguments_);
      } },
    } };
  });
  return { context, admissions, closures };
}

for (const surfaces of [[], ["js"]]) for (const kind of ["plain", "deferred", "iteration"]) {
  test(`two checked addresses and closures consume one ${kind} storage decision in ${surfaces[0] ?? "native"}`, () => {
    const captures = "const first = () => seed; const second = () => seed;";
    const addresses = "const left = addressof(seed); const right = addressof(seed);";
    const body = kind === "iteration"
      ? `for (let seed = 0; seed < 2; seed++) { ${captures} ${addresses} invoke(first); invoke(second); } return 0;`
      : `${kind === "deferred" ? captures : ""} let seed: number = 3;
         ${kind === "plain" ? captures : ""} ${addresses} return invoke(first) + invoke(second);`;
    const { context, admissions, closures } = analyzeTracked(`
      import { addressof } from "@tsonic/core/lang.js";
      function invoke(callback: () => number): number { return callback(); }
      export function run(): number { ${body} }
    `, surfaces);
    const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsVariableDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "seed");
    assert.equal(declaration !== undefined, true);
    const fact = context.records.bindingStorage.get(declaration);
    assert.equal(fact?.storage, "location");
    assert.equal(fact.initialization, kind === "deferred" ? "deferred" : undefined);
    assert.equal(fact.iterationScope !== undefined, kind === "iteration");
    assert.equal(admissions.get(declaration), 1, "one complete actual admission for the declaration");
    assert.equal(context.sourceStorage.nodes.filter(node => context.records.typedLocationPlan.get(node)?.operation === "address-of").length, 2);
    const captureOwners = context.sourceStorage.nodes.filter(node => context.records.closureCapture.get(node)?.captures
      .some(capture => capture.declaration === declaration));
    assert.equal(captureOwners.length, 2);
    assert.equal(captureOwners.every(node => closures.get(node) === 1), true);
  });
}

test("observed module functions publish their final lexical environment without an empty placeholder", () => {
  const { context, closures } = analyzeTracked(`
    function selected(): number { return 7; }
    function invoke(callback: () => number): number { return callback(); }
    export function run(): number { return invoke(selected); }
  `, []);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "selected");
  assert.equal(declaration !== undefined, true);
  assert.equal(closures.get(declaration), 1);
  assert.equal(context.records.closureCapture.get(declaration)?.captures.length, 0);
});
