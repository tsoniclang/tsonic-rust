import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableGenericContext } from "../../../../target-model/records/native/native-generics.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustGenericRequirementEmissionRecords } from "../../../../target-model/records/native/native-generics.js";
import type { RustDeclarationGenericRequirementContract, RustGenericRequirement } from "../../../../target-model/records/types/generic-requirements.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export interface RustNativeGenericProducer {
  readonly emission: RustGenericRequirementEmissionRecords;
  requirements(declaration: Node, source: RustDeclarationGenericRequirementContract | undefined, body: RustDeclarationGenericRequirementContract | undefined): void;
  clone(carrier: TargetTypeRef, declaration: Node, body: true | undefined, value: boolean): void;
  use(declaration: Node, node: Node, carrier: TargetTypeRef, required: readonly RustGenericRequirement[], body: true | undefined): void;
  readonly records: RustRecordFamily<RustNativeCallableGenericContext>;
  declaration(subject: Node, context: RustNativeCallableGenericContext): void;
}

export function createRustNativeGenericProducer(assertOpen: () => void): RustNativeGenericProducer {
  const family = createRustRecordFamily<RustNativeCallableGenericContext>({ id: "tsonic.rust.nativeGenerics", equals: (left, right) => left === right }, assertOpen);
  const requirements = new WeakMap<Node, { readonly source: RustDeclarationGenericRequirementContract | undefined; readonly body: RustDeclarationGenericRequirementContract | undefined }>();
  const clones = new WeakMap<Node, Map<string, boolean>>();
  const uses = new WeakMap<Node, WeakMap<Node, Set<string>>>();
  const cloneKey = (carrier: TargetTypeRef, body: true | undefined): string => closedMetadataKey([carrier, body === true]);
  const useKey = (carrier: TargetTypeRef, required: readonly RustGenericRequirement[], body: true | undefined): string =>
    closedMetadataKey([carrier, [...new Set(required)].sort(), body === true]);
  return Object.freeze({ records: family.reader, emission: Object.freeze({
    declarationRequirements: Object.freeze({ get: (declaration: Node, body?: true) => body === true ? requirements.get(declaration)?.body : requirements.get(declaration)?.source }),
    carrierClone: Object.freeze({ get: (carrier: TargetTypeRef, declaration: Node, body?: true) => clones.get(declaration)?.get(cloneKey(carrier, body)) }),
    genericRequirementUse: Object.freeze({ get: (declaration: Node, node: Node, carrier: TargetTypeRef, required: readonly RustGenericRequirement[], body?: true): true | undefined =>
      uses.get(declaration)?.get(node)?.has(useKey(carrier, required, body)) === true ? true : undefined }),
  }),
    requirements(declaration: Node, source: RustDeclarationGenericRequirementContract | undefined, body: RustDeclarationGenericRequirementContract | undefined): void {
      assertOpen();
      if (requirements.has(declaration)) failTargetAnalysisInvariant("tsonic-rust", "Native declaration requirements publish exactly once.", declaration);
      requirements.set(declaration, Object.freeze({ source, body }));
    },
    clone(carrier: TargetTypeRef, declaration: Node, body: true | undefined, value: boolean): void {
      assertOpen();
      const selected = clones.get(declaration) ?? new Map<string, boolean>();
      const key = cloneKey(carrier, body);
      if (selected.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native clone guarantee publishes exactly once in its declaration context.", declaration);
      selected.set(key, value);
      clones.set(declaration, selected);
    },
    use(declaration: Node, node: Node, carrier: TargetTypeRef, required: readonly RustGenericRequirement[], body: true | undefined): void {
      assertOpen();
      const nodes = uses.get(declaration) ?? new WeakMap<Node, Set<string>>();
      const selected = nodes.get(node) ?? new Set<string>();
      const key = useKey(carrier, required, body);
      if (selected.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An admitted generic requirement use publishes exactly once.", node);
      selected.add(key);
      nodes.set(node, selected);
      uses.set(declaration, nodes);
    },
    declaration: (subject: Node, context: RustNativeCallableGenericContext): void => family.writer.set(subject, context),
  });
}
