import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustLifetimeIndex, RustLifetimeRef, RustSourceGenericContract, RustSourceGenericParameterContract } from "../../../../target-model/lifetimes/index.js";

export function createRustLifetimeRecords(contracts: readonly RustSourceGenericContract[],
  parameters: ReadonlyMap<Node, RustSourceGenericParameterContract>, resolutions: ReadonlyMap<Node, RustLifetimeRef>): RustLifetimeIndex {
  const byDeclaration = new WeakMap<Node, RustSourceGenericContract>();
  for (const contract of contracts) {
    if (byDeclaration.has(contract.declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native generic declaration has one lifetime contract.", contract.declaration);
    byDeclaration.set(contract.declaration, contract);
  }
  const byParameter = new WeakMap(parameters);
  const byResolution = new WeakMap(resolutions);
  const all = Object.freeze([...contracts]);
  return Object.freeze({
    contractFor: (node: Node | undefined) => node === undefined ? undefined : byDeclaration.get(node),
    parameterFor: (node: Node | undefined) => node === undefined ? undefined : byParameter.get(node),
    resolve: (node: Node | undefined) => node === undefined ? undefined : byResolution.get(node),
    allContracts: () => all,
  });
}
