import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/index.js";
import { projectClassLineage, projectContractsForLineage } from "../../../dist/analysis/project-types/catalog/declaration-heritage.js";
import { compileRust } from "../../helpers/rust-session.mjs";

const sourceText = `export interface Label { value: number; }
export class Base<T> { constructor(public current: T) {} }
export class Child extends Base<number> { constructor() { super(1); } }
export abstract class Abstract { abstract count(): number; }`;

for (const surfaces of [[], ["js"]]) {
  test(`native declaration metadata is computed before publication on ${surfaces[0] ?? "native"}`, () => {
    let open = true;
    let program;
    const nodes = [];
    const parents = new Map();
    const guard = (owner, label) => new Proxy({ ...owner }, { get(value, key) {
      assert.equal(open, true, `sealed declaration lookup cannot read ${label}.${String(key)}`);
      const member = Reflect.get(value, key);
      return typeof member === "function" ? member.bind(value) : member;
    } });
    const { result } = compileRust({ surfaces, files: { "index.ts": sourceText }, compileTarget(request) {
      const source = request.input.source;
      const collect = node => {
        nodes.push(node);
        parents.set(node, source.ast.parent(node));
        source.ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
      };
      for (const file of source.navigation.sourceFiles) collect(file);
      const selected = analyzeRustAnalysisProgram({ ...request, input: { ...request.input, source: {
        ...source, ast: guard(source.ast, "ast"), navigation: guard(source.navigation, "navigation"),
      } } });
      if (selected.kind === "rejected") return selected;
      program = selected.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: selected.diagnostics };
    } });
    assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
    assert.equal(program !== undefined, true, "actual checked program is admitted");
    const policy = program.projectTypes;
    const definitions = new Map(policy.definitions.map(definition => [definition.declaration, definition]));
    const expectedLineages = new Map([["Label", undefined], ["Base", ["Base"]],
      ["Child", ["Base", "Child"]], ["Abstract", ["Abstract"]]]);
    const rows = policy.definitions.map(definition => ({ definition,
      carrier: policy.openCarrier(definition), polymorphic: policy.isPolymorphic(definition),
      lineage: policy.classLineage(definition), contracts: policy.contractsForClass(definition) }));
    assert.equal(rows.length, 4);
    open = false;
    for (let repeat = 0; repeat < 8; repeat += 1) {
      for (const row of rows) {
        const name = row.definition.sourceName;
        assert.equal(policy.openCarrier(row.definition) === row.carrier, true, `${name} one native carrier`);
        assert.equal(policy.isPolymorphic(row.definition), name !== "Label", `${name} selected flag`);
        assert.equal(policy.isPolymorphic(row.definition), row.polymorphic, `${name} stable flag`);
        assert.equal(policy.classLineage(row.definition) === row.lineage, true, `${name} one lineage`);
        assert.equal(policy.contractsForClass(row.definition) === row.contracts, true, `${name} one contract inventory`);
        assert.deepEqual(row.lineage?.map(owner => owner.sourceName), expectedLineages.get(name));
        assert.deepEqual(row.contracts?.map(owner => owner.sourceName), expectedLineages.get(name));
        assert.equal(Object.isFrozen(row.carrier), true, `${name} immutable carrier`);
        assert.equal(Object.isFrozen(row.carrier.value), true, `${name} immutable native descriptor`);
        assert.equal(Object.isFrozen(row.carrier.value.genericArguments), true, `${name} immutable native arguments`);
        if (row.lineage !== undefined) assert.equal(Object.isFrozen(row.lineage), true, name);
        if (row.contracts !== undefined) assert.equal(Object.isFrozen(row.contracts), true, name);
        const forged = { ...row.definition };
        assert.equal(policy.classLineage(forged) === undefined, true, `${name} forged lineage absent`);
        assert.equal(policy.contractsForClass(forged) === undefined, true, `${name} forged contracts absent`);
        assert.equal(policy.isPolymorphic(forged), false, `${name} forged flag absent`);
        assert.throws(() => policy.openCarrier(forged), /exact admitted definition/u);
      }
      for (const node of nodes) {
        let current = node;
        while (current !== undefined && !definitions.has(current)) current = parents.get(current);
        assert.equal(policy.definitionContainingDeclaration(node) === definitions.get(current), true,
          "exact inclusive declaration membership without source navigation");
      }
      assert.equal(policy.definitionContainingDeclaration(undefined) === undefined, true);
      assert.equal(policy.definitionContainingDeclaration({}) === undefined, true, "foreign source identity absent");
    }
  });
}

test("lineage and contract graph analysis preserve ordered heritage, cycles and invalid bases", () => {
  const base = { kind: "class", declaration: {}, sourceName: "Base" };
  const child = { kind: "class", declaration: {}, sourceName: "Child" };
  const contract = { kind: "interface", declaration: {}, sourceName: "Contract" };
  const inherited = { kind: "interface", declaration: {}, sourceName: "Inherited" };
  const edges = new Map([[base.declaration, [{ kind: "implements", target: contract }]],
    [child.declaration, [{ kind: "extends", target: base }, { kind: "implements", target: contract }]],
    [contract.declaration, [{ kind: "extends", target: inherited }]],
    [inherited.declaration, [{ kind: "extends", target: contract }]]]);
  let reads = 0;
  const heritage = declaration => { reads += 1; return edges.get(declaration) ?? []; };
  const lineage = projectClassLineage(child, heritage);
  assert.equal(reads, 2, "lineage reads each native class once");
  assert.equal(lineage[0] === base && lineage[1] === child, true, "base-to-derived order");
  reads = 0;
  const contracts = projectContractsForLineage(lineage, heritage);
  assert.equal(reads, 4, "contracts reuse the lineage rather than recomputing it");
  assert.equal(contracts.length, 4);
  assert.equal(contracts[0] === base && contracts[1] === contract && contracts[2] === inherited && contracts[3] === child,
    true, "original native contract traversal order");
  assert.equal(Object.isFrozen(lineage) && Object.isFrozen(contracts), true);
  assert.equal(projectClassLineage(contract, heritage) === undefined, true, "interface has no class lineage");
  assert.equal(projectContractsForLineage(undefined, heritage) === undefined, true, "invalid lineage remains invalid");
  edges.set(base.declaration, [{ kind: "extends", target: child }]);
  assert.equal(projectClassLineage(child, heritage) === undefined, true, "class cycle is rejected");
  edges.set(child.declaration, [{ kind: "extends", target: base }, { kind: "extends", target: child }]);
  assert.equal(projectClassLineage(child, heritage) === undefined, true, "multiple native class bases remain invalid");
});
