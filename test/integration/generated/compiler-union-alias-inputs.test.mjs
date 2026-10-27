import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustTargetOperationResultCarrier } from "../../../dist/target-model/records/operations/operations.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustOptionNestingDepth, rustOptionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";

test("nested optional native receivers preserve their full selected result before the next guard", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function nested(values: { value: string | undefined }[] | undefined): void {
  const size = values?.[0]?.value?.length;
}
export function element(values: (string | undefined)[]): void {
  const size = values[0]?.length;
}
` } });
  const ast = program.source.ast;
  const chains = [];
  const visit = node => {
    const chain = program.records.optionalChain.get(node);
    if (chain !== undefined) chains.push(chain);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(chains.length >= 4, true, "all nested member and element guards are selected");
  let chainedReceivers = 0;
  let indexedReceivers = 0;
  for (const chain of chains) {
    const previous = program.records.selectedOperation.get(chain.guard);
    if (previous !== undefined) {
      assert.equal(rustTargetTypeRefEquals(chain.sourceGuardCarrier, previous.resultType), true,
        "a selected guard starts at the complete native expression, not an inner optional operation");
    } else {
      assert.equal(rustTargetTypeRefEquals(chain.sourceGuardCarrier, program.records.runtimeCarrier.get(chain.guard)?.carrier), true,
        "a source-only binding guard preserves its complete checked native storage carrier");
    }
    assert.equal(rustOptionNestingDepth(chain.sourceGuardCarrier, chain.selectedGuardCarrier), chain.guardDepth,
      "all physical absence layers remain in the sealed guard depth");
    if (program.records.optionalChain.get(chain.guard) !== undefined) chainedReceivers++;
    if (ast.is.IsElementAccessExpression(chain.guard)) indexedReceivers++;
    assert.equal(program.records.optionalChainEmission.get(chain.expression)?.fact === chain, true,
      "the sole admission owner validates and publishes the identical full-depth guard");
  }
  assert.equal(chainedReceivers >= 2, true, "a member whose receiver is another optional operation is covered");
  assert.equal(indexedReceivers >= 2, true, "both nested and ordinary native element guards are covered");
});

test("a native indexer retains both physical Option layers before a selected string member", () => {
  const text = rustStringTargetType();
  const nested = rustOptionTargetType(rustOptionTargetType(text));
  const owner = { kind: "target-named", id: "test.native.Slots" };
  const provider = createRustProviderPackage({ id: "native-optional-slots", displayName: "Native optional slots", version: "1",
    modules: [{ moduleSpecifier: "test:slots", providerModuleId: "test.slots", exports: [{
      id: "Slots", name: "Slots", kind: "interface", members: [{
        id: "Slots.index", name: "index", kind: "indexer", signatures: [{ id: "Slots.index.at",
          parameters: [{ name: "position", type: { kind: "source-primitive", name: "int32" } }],
          returnType: { kind: "union", types: [{ kind: "string" }, { kind: "undefined" }] },
        }],
      }],
    }] }],
    types: [{ exportId: "Slots", targetCarrier: owner }], carrierPaths: { [owner.id]: "native_slots::Slots" },
    operations: [{ exportId: "Slots", memberId: "Slots.index", signatureId: "Slots.index.at", operationKind: "indexer",
      target: { form: "method", name: "get" }, receiverCarrier: owner,
      parameterCarriers: [{ kind: "source-primitive", name: "int32" }], resultCarrier: nested }], crates: [],
  });
  const { program } = analyzeRust({ surfaces: ["js"], packages: [provider], files: { "index.ts": `
import type { Slots } from "test:slots";
export function read(values: Slots): void { const size = values[0]?.length; }
` } });
  const ast = program.source.ast;
  const chains = [];
  const visit = node => {
    const fact = program.records.optionalChain.get(node);
    if (fact !== undefined) chains.push(fact);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(chains.length, 1, "one actual checked indexer-to-member guard");
  const fact = chains[0];
  assert.equal(ast.is.IsElementAccessExpression(fact.guard), true, "the guard is the native indexer result");
  assert.equal(rustTargetTypeRefEquals(program.records.selectedOperation.get(fact.guard)?.resultType, nested), true,
    "the completed native indexer publishes Option<Option<String>> without logical normalization");
  assert.equal(rustTargetTypeRefEquals(fact.sourceGuardCarrier, nested), true, "the full physical expression owns the guard input");
  assert.equal(rustTargetTypeRefEquals(fact.selectedGuardCarrier, text), true, "the selected member uses the innermost native string");
  assert.equal(fact.guardDepth, 2, "neither native Option layer is discarded before the guard");
  assert.equal(program.records.optionalChainEmission.get(fact.expression)?.fact === fact, true,
    "the sole pre-seal admission retains the identical complete guard contract");
});

test("narrowed class fields project from the selected physical union receiver", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
type Region = { readonly kind: "dense"; readonly value: number } |
  { readonly kind: "remote"; readonly offset: number };
export class Backing {
  constructor(readonly region: Region) {}
  read(): number {
    return this.region.kind === "dense" ? this.region.value : this.region.offset;
  }
}
` } });
  const ast = program.source.ast;
  const accesses = [];
  const visit = node => {
    if (ast.is.IsPropertyAccessExpression(node)) {
      const access = ast.as.AsPropertyAccessExpression(node);
      const label = ast.text(ast.name(node));
      if (["value", "offset"].includes(label)) accesses.push({ node, receiver: access.Expression, label });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(accesses.length, 2, "both checked discriminant branches retain their exact field receiver");
  for (const { node, receiver, label } of accesses) {
    const physical = program.records.targetOperation.get(receiver);
    const flow = program.records.flowReadProjection.get(receiver);
    assert.equal(physical !== undefined, true, `${label}: native field storage has a selected operation`);
    const carrier = rustTargetOperationResultCarrier(physical);
    assert.equal(carrier !== undefined && flow !== undefined, true, `${label}: narrowing is an explicit admitted projection`);
    assert.equal(rustTargetTypeRefEquals(carrier, flow.sourceCarrier), true,
      `${label}: the projection starts at actual physical storage, not the checker's logical narrowed type`);
    assert.equal(rustTargetTypeRefEquals(flow.sourceCarrier, flow.selectedCarrier), false,
      `${label}: the native union is projected before its selected payload member is accessed`);
  }
});

test("compiler union aliases retain their selected carrier across an undefined guard", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "union_alias_inputs" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
type Region = { readonly kind: "dense"; readonly value: number } |
  { readonly kind: "remote"; readonly offset: number };
class Backing {
  constructor(readonly region: Region) {}
  read(): number {
    return this.region.kind === "dense" ? this.region.value : this.region.offset;
  }
}
function read(region: Region | undefined): number {
  if (region === undefined) return -1;
  return new Backing(region).read();
}
export function main(): void {
  check(read(undefined) === -1);
  check(read({ kind: "dense", value: 7 }) === 7);
  check(read({ kind: "remote", offset: 9 }) === 9);
}
main();
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-union-alias-inputs", result.artifacts, { run: true });
});
