import { createHash } from "node:crypto";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableValue, rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustNamePlan } from "../../target-model/names/model.js";

import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import { sourceCallableDefinitionIsDiscarded, sourceDeclarationIsModuleScoped, type SourceProgramNavigation } from "@tsonic/target-api/source";
import { isRustCopyCarrier } from "../../target-model/types/index.js";

import { createRustGenericCallableFlowIndex } from "./generic-callable-flow.js";
import type { RustGenericCallableConversion } from "../../target-model/conversions/generic-callable.js";

import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

import { createRustGenericCallablePhysicalPlan, type RustGenericCallablePhysicalInput,
  type RustGenericCallablePhysicalPlan } from "./generic-physical.js";

export interface RustGenericCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly sourceFileName: string;
  readonly variantName: string;
  readonly stateName: string;
  readonly functionName: string;
  readonly storage: "value" | "shared";
  readonly creation: "declaration" | "activation";
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receiverFields: readonly (RustClosureCaptureFact["receiverFields"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receivers: readonly (RustClosureCaptureFact["receivers"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly substitutions: readonly (readonly [string, TargetTypeRef])[];
}

export interface RustGenericCallableDefinition {
  readonly identity: string;
  readonly origin: RustCallableOrigin;
  readonly targetName: string;
  readonly nativeFutureDispatchName?: string;
  readonly copy: boolean;
  readonly identityObserved: boolean;
  readonly ownerFileName: string;
  readonly signature: RustCallableSignature;
  readonly implementations: readonly RustGenericCallableImplementation[];
}

export interface RustGenericCallablePlan {
  readonly definitions: readonly RustGenericCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  definitionFor(carrier: TargetTypeRef): RustGenericCallableDefinition | undefined;
  implementationFor(declaration: Node): RustGenericCallableImplementation | undefined;
  readonly physical: RustGenericCallablePhysicalPlan;
}

export interface RustGenericCallableRegistry extends RustGenericCallablePlan {
  initializePhysical(input: RustGenericCallablePhysicalInput): void;
}

export function createRustGenericCallablePlan(
  ast: AstReader, sourceFiles: readonly SourceFile[], records: RustProgramRecords, names: RustNamePlan,
  navigation: SourceProgramNavigation,
  adapterFlows: readonly { readonly subject: Node; readonly conversion: RustGenericCallableConversion }[] = [],
  closedSourceFiles: ReadonlySet<SourceFile> = new Set(),
): RustGenericCallableRegistry {
  const groups = new Map<string, { origin: RustCallableOrigin; signature: RustCallableSignature; implementations: RustGenericCallableImplementation[] }>();
  const implementations = new Map<Node, RustGenericCallableImplementation>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const usedNames = new Set<string>();
  const closures: Node[] = [];
  const flows: { subject: Node; conversion: RustGenericCallableConversion }[] = [...adapterFlows];
  const identityCarriers: TargetTypeRef[] = [];
  const closureCarrier = (node: Node): TargetTypeRef | undefined => {
    const operation = records.targetOperation.get(node);
    return operation?.kind === "closure"
      ? records.receiverIndependentMethod.get(node)?.carrier ?? operation.resultCarrier
      : ast.is.IsFunctionDeclaration(node) ? records.runtimeCarrier.get(node)?.carrier : undefined;
  };
  const visit = (node: Node): void => {
    if ((ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) &&
      sourceCallableDefinitionIsDiscarded(node, ast)) return;
    for (const name of [names.nameForDeclaration(node), names.functionNameForDeclaration(node), names.callableValueNameForDeclaration(node)]) {
      if (name !== undefined) usedNames.add(name);
    }
    const operation = records.targetOperation.get(node);
    const observedDeclaration = ast.is.IsFunctionDeclaration(node) &&
      (navigation.declarationUseSummary(node).uses.some(use => use.kind === "first-class") ||
        !closedSourceFiles.has(ast.getSourceFile(node)!) && navigation.declarationUseSummary(node).exported);
    if (operation?.kind === "closure" || observedDeclaration && ast.body(node) !== undefined &&
      rustGenericCallableValue(closureCarrier(node)) !== undefined) closures.push(node);
    if (operation?.kind === "operator-token" && (operation.operator === "==" || operation.operator === "!=")) {
      const expression = ast.as.AsBinaryExpression(node);
      for (const operand of [expression?.Left, expression?.Right]) {
        const carrier = operand === undefined ? undefined : records.runtimeCarrier.get(operand)?.carrier;
        if (carrier !== undefined) identityCarriers.push(carrier);
      }
    }
    if (operation !== undefined && "abi" in operation) {
      for (const argument of operation.abi.sourceArguments) {
        if (argument.disposition === "runtime") identityCarriers.push(argument.carrier);
      }
    }
    const conversion = records.contextualValueConversion.get(node)?.conversion;
    if (conversion?.kind === "generic-callable-flow") flows.push({ subject: node, conversion });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  const flow = createRustGenericCallableFlowIndex(flows);
  const identityFamilies = new Set<string>();
  const visitedCarriers = new Set<TargetTypeRef>();
  const retainIdentity = (carrier: TargetTypeRef): void => {
    if (visitedCarriers.has(carrier)) return;
    visitedCarriers.add(carrier);
    const family = flow.familyFor(carrier);
    if (family !== undefined) identityFamilies.add(family);
    for (const child of rustTargetTypeChildren(carrier)) retainIdentity(child);
  };
  identityCarriers.forEach(retainIdentity);
  for (const declaration of closures) {
    const selected = navigation.expressionValueFlow(declaration);
    if ((!selected.escapes || closedSourceFiles.has(ast.getSourceFile(declaration)!)) &&
      !selected.identityCompared && !selected.hasUnclassifiedUse) continue;
    const carrier = closureCarrier(declaration);
    if (carrier !== undefined) retainIdentity(carrier);
  }
  issues.push(...flow.issues);
  closures.sort((left, right) => ast.getFileName(ast.getSourceFile(left)).localeCompare(ast.getFileName(ast.getSourceFile(right)), "en") || ast.pos(left) - ast.pos(right));
  for (const node of closures) {
    const carrier = closureCarrier(node);
    const value = rustGenericCallableValue(carrier);
    if (carrier !== undefined && value !== undefined) {
      const capture = records.closureCapture.get(node);
      const signatureKey = closedMetadataKey(value.signature);
      const identity = flow.familyFor(carrier)!;
      const sourceFileName = ast.getFileName(ast.getSourceFile(node));
      const implementationIdentity = createHash("sha256").update(`${sourceFileName}:${ast.pos(node)}:${ast.end(node)}`).digest("hex");
      const substitutions = new Map<string, TargetTypeRef>();
      for (const [index, argument] of value.environment.entries()) {
        if (argument.kind === "type-parameter") substitutions.set(argument.identity,
          value.signature.environmentParameters[index]!);
      }
      const captures = capture?.captures.map(selected => Object.freeze({ ...selected,
        storageCarrier: snapshotClosedMetadata(substituteRustTargetTypeParameters(selected.carrier, substitutions)),
      }));
      const receiverFields = capture?.receiverFields.map(selected => Object.freeze({ ...selected,
        storageCarrier: snapshotClosedMetadata(substituteRustTargetTypeParameters(selected.carrier, substitutions)),
      }));
      const receivers = capture?.receivers.map(selected => Object.freeze({ ...selected,
        storageCarrier: snapshotClosedMetadata(substituteRustTargetTypeParameters(selected.carrier, substitutions)),
      }));
      if (sourceFileName.length === 0 || capture === undefined || captures === undefined || receiverFields === undefined || receivers === undefined ||
        capture.recursiveDeclaration !== undefined || [...captures, ...receiverFields, ...receivers].some(selected =>
          rustTargetTypeParameterIdentities(selected.storageCarrier).some(identity => !value.signature.environmentParameters.some(parameter => parameter.identity === identity)))) {
        issues.push({ subject: node, message: "A generic callable environment has no exact closed capture contract; recursive or hidden existential captures are not erased." });
      } else {
        const creation = ast.is.IsFunctionDeclaration(node) && sourceDeclarationIsModuleScoped(node, ast)
          ? "declaration" as const : "activation" as const;
        const functionName = creation === "declaration" ? names.functionNameForDeclaration(node)
          : allocateRustGeneratedName(usedNames, `call_generic_${implementationIdentity.slice(0, 12)}`);
        if (functionName === undefined) {
          issues.push({ subject: node, message: "A declaration-owned generic callable has no exact native implementation name." });
          continue;
        }
        const implementation = Object.freeze({ declaration: node, carrier, sourceFileName,
          variantName: allocateRustGeneratedName(usedNames, `Implementation${implementationIdentity.slice(0, 12)}`),
          stateName: allocateRustGeneratedName(usedNames, `CallableEnvironment${implementationIdentity.slice(0, 12)}`),
          functionName,
          creation,
          storage: (!identityFamilies.has(identity) || creation === "declaration") &&
            (records.asyncFunction.get(node) === undefined || rustNativeFutureCallableResult(value.signature.result) !== undefined ||
              captures.length === 0 && receiverFields.length === 0 && receivers.length === 0) &&
            records.generator.get(node) === undefined &&
            receiverFields.length === 0 && receivers.length === 0 && captures.every(selected => selected.storage === "value" && isRustCopyCarrier(selected.storageCarrier))
              ? "value" as const : "shared" as const,
          captures: Object.freeze(captures), receiverFields: Object.freeze(receiverFields), receivers: Object.freeze(receivers), substitutions: snapshotClosedMetadata([...substitutions]),
        });
        const group = groups.get(identity);
        if (group !== undefined && closedMetadataKey(group.signature) !== signatureKey) {
          issues.push({ subject: node, message: "One selected generic callable contract has conflicting native signatures; no implementation can be selected." });
        } else {
          const selected = group ?? { origin: value.origin, signature: snapshotClosedMetadata(value.signature), implementations: [] };
          selected.implementations.push(implementation);
          groups.set(identity, selected);
          implementations.set(node, implementation);
        }
      }
    }
  }
  const definitions = [...groups].sort(([left], [right]) => left.localeCompare(right, "en")).map(([identity, group]) => {
    group.implementations.sort((left, right) => left.sourceFileName.localeCompare(right.sourceFileName, "en") || ast.pos(left.declaration) - ast.pos(right.declaration));
    const nativeIdentity = createHash("sha256").update(identity).digest("hex");
    return Object.freeze({ identity, origin: group.origin, targetName: allocateRustGeneratedName(usedNames, `GenericCallable${nativeIdentity.slice(0, 12)}`),
      ...(rustNativeFutureCallableResult(group.signature.result) === undefined ? {} : {
        nativeFutureDispatchName: allocateRustGeneratedName(usedNames, `CallableFuture${nativeIdentity.slice(0, 12)}`),
      }),
      copy: group.implementations.every(implementation => implementation.storage === "value"),
      identityObserved: identityFamilies.has(identity),
      ownerFileName: group.implementations[0]!.sourceFileName, signature: group.signature,
      implementations: Object.freeze(group.implementations),
    });
  });
  const byFamily = new Map(definitions.map(definition => [definition.identity, definition]));
  const definitionFor = (carrier: TargetTypeRef): RustGenericCallableDefinition | undefined => {
      const value = rustGenericCallableValue(carrier);
      if (value === undefined) return undefined;
      const selected = byFamily.get(flow.familyFor(carrier)!);
      return selected === undefined || closedMetadataKey(selected.signature) !== closedMetadataKey(value.signature) ? undefined : selected;
  };
  let physical: RustGenericCallablePhysicalPlan | undefined;
  return Object.freeze({ definitions: Object.freeze(definitions), issues: Object.freeze(issues), definitionFor,
    initializePhysical(input: RustGenericCallablePhysicalInput): void {
      if (physical !== undefined) throw new Error("A generic callable physical environment is initialized exactly once.");
      physical = createRustGenericCallablePhysicalPlan(definitions, definitionFor, input);
    },
    get physical(): RustGenericCallablePhysicalPlan {
      if (physical === undefined) throw new Error("Generic callable physical storage requires its finalized declaration inputs.");
      return physical;
    },
    implementationFor: (declaration: Node) => implementations.get(declaration),
  });
}
