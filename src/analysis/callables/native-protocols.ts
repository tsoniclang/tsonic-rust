import { createHash } from "node:crypto";

import type { RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";

import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

import type { RustNativeCallableProtocol, RustNativeCallableProtocolBinding } from "../../target-model/records/native-protocols.js";

export interface RustNativeCallableProtocolRegistry {
  bind(ownerFileName: string, carrier: TargetTypeRef): RustNativeCallableProtocolBinding | undefined;
  definitions(): readonly RustNativeCallableProtocol[];
}

export function createRustNativeCallableProtocolRegistry(input: {
  readonly definitions: RustTypeDefinitions;
  readonly usedNames: Set<string>;
  readonly structuralShapes: Pick<RustStructuralShapePlanRegistry, "instantiateSourceCarrier">;
}): RustNativeCallableProtocolRegistry {
  const protocols = new Map<string, RustNativeCallableProtocol>();
  const registerSignature = (source: readonly TargetTypeRef[], selected: readonly TargetTypeRef[]): boolean => {
    if (source.length !== selected.length) return false;
    const pending = source.map((carrier, index) => ({ source: carrier, selected: selected[index]! }));
    const visited = new Map<TargetTypeRef, Set<TargetTypeRef>>();
    for (let index = 0; index < pending.length; index++) {
      if (index >= rustNativeStorageProjectionSteps) return false;
      const pair = pending[index]!;
      if (rustTargetTypeRefEquals(pair.source, pair.selected)) continue;
      const known = visited.get(pair.source) ?? new Set<TargetTypeRef>();
      if (known.has(pair.selected)) continue;
      known.add(pair.selected);
      visited.set(pair.source, known);
      if (rustStructuralObjectCarrierValue(pair.source) !== undefined &&
        input.structuralShapes.instantiateSourceCarrier(pair.source, pair.selected).kind === "unresolved") return false;
      const sources = rustTargetTypeChildren(pair.source);
      const selections = rustTargetTypeChildren(pair.selected);
      if (sources.length !== selections.length) return false;
      if (pending.length + sources.length > rustNativeStorageProjectionSteps) return false;
      pending.push(...sources.map((carrier, index) => ({ source: carrier, selected: selections[index]! })));
    }
    return true;
  };
  return Object.freeze({
    bind(ownerFileName: string, source: TargetTypeRef): RustNativeCallableProtocolBinding | undefined {
      if (ownerFileName.length === 0) return undefined;
      const binding = selectRustNativeCallableProtocolSignature(source, input.definitions);
      if (binding === undefined) return undefined;
      const { method, completion } = binding;
      if (!registerSignature([...binding.signature.parameters, binding.signature.result], [...method.parameters, method.result])) return undefined;
      const contract = { ownerFileName, signature: binding.signature, environmentParameters: binding.environmentParameters, method,
        ...(completion === undefined ? {} : { completion }) };
      const key = closedMetadataKey({ ...contract, method: binding.identityMethod });
      let protocol = protocols.get(key);
      if (protocol === undefined) {
        const identity = `${rustNativeCallableProtocolIdPrefix}${createHash("sha256").update(key).digest("hex")}`;
        const result = selectRustNativeCallableProtocolResult({ ...contract, identity }, input.definitions);
        if (result === undefined) return undefined;
        const targetName = allocateRustGeneratedName(input.usedNames, `NativeCallable_${identity.slice(-16)}`);
        const obligations = new Map<string, { readonly owner: TargetTypeRef; readonly trait: RustTargetTraitRef }>();
        for (const carrier of [...method.parameters, method.result, result]) mapRustTargetTypes(carrier, (current, original) => {
          if (original.kind === "associated-type" && original.trait !== undefined)
            obligations.set(closedMetadataKey({ owner: original.owner, trait: original.trait }), { owner: original.owner, trait: original.trait });
          return current;
        });
        protocol = snapshotClosedMetadata({ ...contract, identity, targetName, result, associatedObligations: [...obligations.values()],
          ...(method.binder.parameters.length === 0 ? {} : {
            boundProducerName: allocateRustGeneratedName(input.usedNames, `${targetName}Bound`),
          }),
          trait: { kind: "trait-ref", id: identity, path: targetName,
            sourceItem: { fileName: ownerFileName, typeName: targetName },
            genericArguments: binding.environmentParameters, associatedConstraints: [] },
        });
        protocols.set(key, protocol);
      }
      return Object.freeze({ protocol, environment: snapshotClosedMetadata(binding.environment),
        trait: snapshotClosedMetadata({ ...protocol.trait, genericArguments: binding.environment }) });
    },
    definitions: () => Object.freeze([...protocols.values()]),
  });
}

import { selectRustNativeCallableProtocolSignature, selectRustNativeCallableProtocolResult } from "../../policy/types/callables/native-protocols.js";
import { rustNativeCallableProtocolIdPrefix } from "../../target-model/records/native-protocols.js";
import type { RustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-registry.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNativeStorageProjectionSteps } from "./native-storage-generics.js";
