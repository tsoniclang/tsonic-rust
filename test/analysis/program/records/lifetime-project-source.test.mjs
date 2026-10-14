import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../../dist/target-model/types/carriers/optional.js";
import { rustValueCarrierBeforeCallScopedLifetimeReconciliation } from "../../../../dist/analysis/conversions/value-carrier-queries.js";
import { rustLifetimeKey } from "../../../../dist/target-model/lifetimes/index.js";
import { sourceNodeIdentity } from "@tsonic/target-api/source";

const declarations = `
  class Base { value: number = 1; }
  class Derived extends Base { extra: number = 2; }
  class Other extends Base { other: number = 3; }
`;
const cases = [
  ["projectUpcast", "new-expression", "export function inspect(): Base { return new Derived(); }"],
  ["projectUpcast", "argument", `function read(value: Base): number { return value.value; }
    export function inspect(): number { return read(new Derived()); }`],
  ["projectUpcast", "union", `export function inspect(flag: boolean): Base {
    const value: Derived | Other = flag ? new Derived() : new Other(); return value;
  }`],
  ["projectDowncast", "direct", "export function inspect(value: Base): Derived { return value as Derived; }"],
  ["projectDowncast", "optional", "export function inspect(value: Base | undefined): Derived { return value as Derived; }"],
];

for (const surfaces of [[], ["js"]]) {
  for (const [reference, mutable] of [["Ref", false], ["Mut", true]]) {
    test(`call-scoped ${reference} records preserve actual selected call and lifetime identities in ${surfaces[0] ?? "native"}`, () => {
      const { source, program } = analyzeRust({ surfaces, files: { "index.ts": `
        import type { int32 } from "@tsonic/core/types.js";
        import type { Life, ${reference} } from "@tsonic/rust/types.js";
        function identity<L extends Life>(value: ${reference}<int32, L>): ${reference}<int32, L> { return value; }
        export function inspect(value: ${reference}<int32>): ${reference}<int32> { return identity(value); }
      ` } });
      const selected = [];
      let call;
      let declaration;
      const visit = node => {
        if (source.ast.kindName(node) === "KindCallExpression") call = node;
        if (source.ast.is.IsFunctionDeclaration(node) && source.ast.text(source.ast.name(node)) === "identity") declaration = node;
        if (program.records.callScopedLifetimeReconciliation.get(node) !== undefined) selected.push(node);
        source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      program.sourceFiles.forEach(visit);
      assert.equal(selected.length, 2, "the actual call result and argument each retain their own selected reconciliation");
      const argument = source.ast.arguments(call)[0];
      assert.equal(selected.includes(call) && selected.includes(argument), true, "record keys are the exact checked subjects");
      const result = program.records.callScopedLifetimeReconciliation.get(call);
      const input = program.records.callScopedLifetimeReconciliation.get(argument);
      assert.equal(rustTargetTypeRefEquals(result.sourceCarrier, input.selectedCarrier), true);
      assert.equal(rustTargetTypeRefEquals(result.selectedCarrier, input.sourceCarrier), true);
      const nativeLifetime = input.selectedCarrier.lifetime;
      assert.equal(nativeLifetime.kind, "call-scoped-elision");
      assert.equal(nativeLifetime.callIdentity, sourceNodeIdentity(source.ast, call));
      const parameter = program.sourceLifetimes.contractFor(declaration).parameters.find(parameter => parameter.kind === "lifetime");
      assert.equal(nativeLifetime.parameterIdentity, rustLifetimeKey(parameter.lifetime));
      for (const record of [input, result]) {
        assert.equal(Object.isFrozen(record), true);
        for (const carrier of [record.sourceCarrier, record.selectedCarrier]) {
          assert.equal(carrier.kind, "reference");
          assert.equal(carrier.mutable, mutable);
          assert.equal(carrier.referent.kind, "source-primitive");
          assert.equal(carrier.referent.name, "int32");
        }
      }
      assert.equal(Object.isFrozen(program.records.callScopedLifetimeReconciliation), true);
      assert.equal(program.records.callScopedLifetimeReconciliation.set === undefined, true);
      assert.equal(program.records.callScopedLifetimeReconciliation.get({}) === undefined, true);
      assert.equal(program.records.callScopedLifetimeReconciliation.get(declaration) === undefined, true);
      assert.equal(program.records.projectUpcast.get(call) === undefined, true);
      assert.equal(program.records.projectDowncast.get(argument) === undefined, true);
    });
  }

  for (const [family, label, body] of cases) {
    test(`${family} preserves actual checked ${label} evidence in ${surfaces[0] ?? "native"} source`, () => {
      const { source, program } = analyzeRust({ surfaces, files: { "index.ts": declarations + body } });
      const nodes = [];
      const visit = node => {
        nodes.push(node);
        source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      program.sourceFiles.forEach(visit);
      const selected = nodes.filter(node => program.records[family].get(node) !== undefined);
      assert.equal(selected.length, 1, `${family}: one actual checked subject`);
      const node = selected[0];
      const fact = program.records[family].get(node);
      assert.equal(Object.isFrozen(fact), true);
      assert.equal(Object.isFrozen(program.records[family]), true);
      assert.equal(program.records[family].set === undefined, true);
      assert.equal(program.records[family].get({}) === undefined, true);
      assert.equal(program.records[family].get(undefined) === undefined, true);
      assert.equal(rustTargetTypeRefEquals(fact.sourceCarrier, fact.targetCarrier), false);
      if (family === "projectUpcast") {
        assert.equal(rustValueCarrierBeforeCallScopedLifetimeReconciliation(program.records, node) === fact.targetCarrier, true);
        if (label === "union") {
          const variants = program.typeDefinitions.sourceUnionVariants(fact.sourceCarrier);
          assert.equal(variants !== undefined, true);
          assert.equal(fact.sourceVariants === variants, true, "the exact selected ordered variant evidence is retained");
          assert.equal(fact.sourceVariants.length, 2);
        } else {
          assert.equal(fact.sourceVariants === undefined, true);
        }
        const sourceDefinition = program.projectTypes.definitionForCarrier(fact.sourceCarrier);
        if (sourceDefinition !== undefined) assert.equal(nodes.includes(sourceDefinition.declaration), true);
        const targetDefinition = program.projectTypes.definitionForCarrier(fact.targetCarrier);
        assert.equal(nodes.includes(targetDefinition.declaration), true);
      } else {
        assert.equal(source.ast.kindName(node), "KindAsExpression");
        assert.equal(fact.projection.kind, "closed");
        assert.equal(fact.projection.slot, "downcast_base_to_derived");
        assert.equal(rustTargetTypeRefEquals(fact.dispatchCarrier,
          label === "optional" ? rustOptionElementCarrier(fact.sourceCarrier) : fact.sourceCarrier), true);
        for (const carrier of [fact.dispatchCarrier, fact.targetCarrier]) {
          assert.equal(nodes.includes(program.projectTypes.definitionForCarrier(carrier).declaration), true);
        }
      }
    });
  }

  test(`a narrowed optional project payload retains its existing flow family in ${surfaces[0] ?? "native"}`, () => {
    const { source, program } = analyzeRust({ surfaces, files: { "index.ts": declarations + `
      export function inspect(value: Base | undefined): Derived | undefined {
        return value instanceof Derived ? value : undefined;
      }
    ` } });
    const selected = [];
    const visit = node => {
      const flow = program.records.flowReadProjection.get(node);
      if (flow?.kind === "project-downcast") selected.push({ node, flow });
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(selected.length, 1);
    const { node, flow } = selected[0];
    assert.equal(program.records.projectDowncast.get(node) === undefined, true,
      "the migration does not manufacture a separate cast for an existing narrowing projection");
    assert.equal(rustTargetTypeRefEquals(rustOptionElementCarrier(flow.sourceCarrier), flow.dispatchCarrier), true);
    assert.equal(flow.projection.kind, "closed");
    assert.equal(flow.projection.slot, "downcast_base_to_derived");
  });
}
