import { createHash } from "node:crypto";
import type { AstReader, Node } from "@tsonic/tsts";
import { sourceBindingScope } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../target-model/types/carriers/callable-signatures.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableOrigin } from "../../policy/types/callable-origins.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustClosureCaptureFactKey, rustTargetOperationFactKey, type RustClosureCaptureFact } from "../facts/keys.js";
import type { RustCallableActivation, RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";

export interface RustFrameCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly capture: RustClosureCaptureFact;
  readonly variantName: string;
  readonly functionName: string;
}

export interface RustFrameCallableEntryDefinition {
  readonly key: string;
  readonly targetName: string;
  readonly signature: RustCallableSignature;
  readonly implementations: readonly RustFrameCallableImplementation[];
}

export interface RustFrameCallableBinding {
  readonly declaration: Node;
  readonly fieldName: string;
  readonly carrier: TargetTypeRef;
  readonly entry: RustFrameCallableEntryDefinition | undefined;
}

export interface RustFrameCallableDefinition {
  readonly activation: RustCallableActivation;
  readonly owner: RustCallableOrigin;
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly entries: readonly RustFrameCallableEntryDefinition[];
  readonly bindings: readonly RustFrameCallableBinding[];
}

export interface RustFrameCallablePlan {
  readonly definitions: readonly RustFrameCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  definitionFor(carrier: TargetTypeRef): RustFrameCallableDefinition | undefined;
  entryFor(carrier: TargetTypeRef): RustFrameCallableEntryDefinition | undefined;
  implementationFor(declaration: Node): RustFrameCallableImplementation | undefined;
  bindingFor(declaration: Node): RustFrameCallableBinding | undefined;
}

export function createRustFrameCallablePlan(input: {
  readonly ast: AstReader;
  readonly facts: RustPlanQueries;
  readonly ownership: RustCallableOwnershipPlan;
  readonly usedNames: ReadonlySet<string>;
}): RustFrameCallablePlan {
  const definitions: RustFrameCallableDefinition[] = [];
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const byOwner = new Map<string, RustFrameCallableDefinition>();
  const implementations = new Map<Node, RustFrameCallableImplementation>();
  const bindings = new Map<Node, RustFrameCallableBinding>();
  const usedNames = new Set(input.usedNames);
  const ownerKey = (owner: RustCallableOrigin): string => closedMetadataKey(owner);
  const signatureKey = (carrier: TargetTypeRef): string | undefined => {
    const value = rustFrameCallableValue(carrier);
    return value === undefined ? undefined : closedMetadataKey(value.signature);
  };
  const issue = (subject: Node, message: string): void => {
    issues.push(Object.freeze({ subject, message }));
  };
  for (const activation of input.ownership.activations) {
    const owner = rustCallableOrigin(input.ast, activation.activationScope);
    if (owner === undefined) {
      issue(activation.activationScope, "A native callable frame requires its exact authored activation identity.");
      continue;
    }
    const groups = new Map<string, { signature: RustCallableSignature; implementations: RustFrameCallableImplementation[] }>();
    const prefix = createHash("sha256").update(ownerKey(owner)).digest("hex").slice(0, 16);
    for (const declaration of activation.callableDeclarations) {
      const operation = input.facts.getFact(declaration, rustTargetOperationFactKey);
      const capture = input.facts.getFact(declaration, rustClosureCaptureFactKey);
      const carrier = operation?.kind === "closure" ? operation.resultCarrier : undefined;
      const value = rustFrameCallableValue(carrier);
      if (carrier === undefined || capture === undefined || value === undefined ||
        ownerKey(value.owner) !== ownerKey(owner)) {
        issue(declaration, "A native frame entry requires its finalized closure, exact activation carrier and capture evidence.");
        continue;
      }
      const key = signatureKey(carrier)!;
      let group = groups.get(key);
      if (group === undefined) {
        group = { signature: value.signature, implementations: [] };
        groups.set(key, group);
      }
      const identity = createHash("sha256").update(`${owner.fileName}:${input.ast.pos(declaration)}:${input.ast.end(declaration)}`).digest("hex").slice(0, 16);
      const implementation = Object.freeze({ declaration, carrier, capture,
        variantName: `Entry_${identity}`,
        functionName: allocateRustGeneratedName(usedNames, `tsonic_frame_entry_${prefix}_${identity}`) });
      implementations.set(declaration, implementation);
      group.implementations.push(implementation);
    }
    const entries = Object.freeze([...groups].map(([key, group], index) => Object.freeze({
      key, targetName: allocateRustGeneratedName(usedNames, `TsonicFrameEntry_${prefix}_${index}`),
      signature: group.signature, implementations: Object.freeze(group.implementations),
    })));
    const frameBindings: RustFrameCallableBinding[] = [];
    const declarations = new Set(activation.slotDeclarations);
    if (activation.kind === "lexical") for (const capture of activation.externalCaptures) {
      if (capture.kind === "lexical" && sourceBindingScope(capture.declaration, input.ast) === activation.activationScope)
        declarations.add(capture.declaration);
    }
    for (const declaration of declarations) {
      const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
      const key = carrier === undefined ? undefined : signatureKey(carrier);
      const entry = key === undefined ? undefined : entries.find(candidate => candidate.key === key);
      if (carrier === undefined || activation.slotDeclarations.includes(declaration) && entry === undefined) {
        issue(declaration, "A native frame binding requires its exact selected carrier and closed entry protocol.");
        continue;
      }
      const binding = Object.freeze({ declaration, carrier, entry, fieldName: `binding_${frameBindings.length}` });
      bindings.set(declaration, binding);
      frameBindings.push(binding);
    }
    for (const implementation of entries.flatMap(entry => entry.implementations)) {
      for (const capture of implementation.capture.captures) {
        const binding = bindings.get(capture.declaration);
        if (binding !== undefined && !rustTargetTypeRefEquals(binding.carrier, capture.carrier))
          issue(capture.reference, "A native frame capture differs from its selected activation binding carrier.");
      }
    }
    const definition = Object.freeze({ activation, owner, ownerFileName: owner.fileName,
      targetName: allocateRustGeneratedName(usedNames, `TsonicCallableFrame_${prefix}`),
      entries, bindings: Object.freeze(frameBindings) });
    definitions.push(definition);
    byOwner.set(ownerKey(owner), definition);
  }
  const definitionFor = (carrier: TargetTypeRef): RustFrameCallableDefinition | undefined => {
    const value = rustFrameCallableValue(carrier);
    return value === undefined ? undefined : byOwner.get(ownerKey(value.owner));
  };
  return Object.freeze({ definitions: Object.freeze(definitions), issues: Object.freeze(issues),
    definitionFor,
    entryFor(carrier: TargetTypeRef) {
      const key = signatureKey(carrier);
      return key === undefined ? undefined : definitionFor(carrier)?.entries.find(entry => entry.key === key);
    },
    implementationFor: (declaration: Node) => implementations.get(declaration),
    bindingFor: (declaration: Node) => bindings.get(declaration),
  });
}
