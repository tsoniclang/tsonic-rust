import { createHash } from "node:crypto";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../../target-model/types/carriers/callable-signatures.js";
import { rustGenericCallableValue, rustNativeFutureCallableResult } from "../../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeParameterIdentities } from "../../../target-model/types/carriers/generic-references.js";
import { mapRustTargetTypes, substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import type { RustNamePlan } from "../../../target-model/names/model.js";

import type { RustSourceCallableSpecializationIssue } from "../../../target-model/records/callables/callable-issues.js";
import { sourceDeclarationIsModuleScoped, sourceNodeIdentity, type SourceProgramNavigation } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

import { createRustGenericCallableFlowIndex } from "./generic-callable-flow.js";
import type { RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";

import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";

import { createRustGenericCallablePhysicalPlan, type RustGenericCallablePhysicalConstruction, type RustGenericCallablePhysicalInput } from "./generic-physical.js";
import type { RustGenericCallablePhysicalPlan } from "../../../target-model/records/callables/generic-callables.js";

import type { RustGenericCallableImplementation, RustGenericCallableDefinition } from "../../../target-model/records/callables/generic-callables.js";
import type { RustStructuralShapeLayoutPlan } from "../../objects/shapes/structural-shape-plan.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";

export function rustFixedStructuralMethodDeclarations(
  ast: AstReader,
  shapes: Pick<RustStructuralShapeLayoutPlan, "definitions">,
): ReadonlySet<Node> {
  const fixed = new Map<string, Node>();
  const retained = new Set<string>();
  for (const definition of shapes.definitions) for (const field of definition.fields) {
    const selected = field.methodPlan;
    if (selected === undefined) continue;
    if (selected.kind === "fixed") {
      const identity = sourceNodeIdentity(ast, selected.declaration);
      if (identity === undefined) failTargetAnalysisInvariant("tsonic-rust", "A fixed method requires its original checked source identity.", selected.declaration);
      fixed.set(identity, selected.declaration);
      continue;
    }
    if (selected.kind === "native-dispatch" && selected.implementation === "fixed") {
      const identity = sourceNodeIdentity(ast, selected.declaration);
      if (identity === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native dispatch method requires its original checked source identity.", selected.declaration);
      retained.add(identity);
    }
    for (const carrier of [definition.carrier, ...definition.sourceCarriers]) {
      for (const method of rustStructuralObjectCarrierValue(carrier)?.implementation?.methods ?? [])
        if (method.sourceName === field.sourceName) retained.add(method.identity);
    }
  }
  return new Set([...fixed].filter(([identity]) => !retained.has(identity)).map(([, declaration]) => declaration));
}

export interface RustGenericCallablePlan {
  readonly definitions: readonly RustGenericCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  definitionFor(carrier: TargetTypeRef): RustGenericCallableDefinition | undefined;
  implementationFor(declaration: Node): RustGenericCallableImplementation | undefined;
  readonly physical: RustGenericCallablePhysicalPlan;
}

export interface RustGenericCallableRegistry {
  readonly plan: RustGenericCallablePlan;
  initializePhysical(input: RustGenericCallablePhysicalInput): RustGenericCallablePhysicalConstruction;
  publishPhysical(plan: RustGenericCallablePhysicalPlan): void;
}

export function createRustGenericCallablePlan(
  ast: AstReader, sourceFiles: readonly SourceFile[], records: RustProgramRecords, names: RustNamePlan,
  navigation: SourceProgramNavigation,
  isNativeNode: (node: Node) => boolean,
  fixedMethods: ReadonlySet<Node>,
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
    if (!isNativeNode(node)) return;
    if (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) {
      const participation = records.nativeParticipation.get(node);
      if (participation === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "Native callable selection requires its original pre-seal creation participation.", node);
      if (participation === "erased") return;
    }
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
  const retainedFamilies = new Set(flows.flatMap(({ conversion }) =>
    [flow.familyFor(conversion.source), flow.familyFor(conversion.target)].filter((identity): identity is string => identity !== undefined)));
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
    if (fixedMethods.has(node) && (carrier === undefined || !retainedFamilies.has(flow.familyFor(carrier)!))) continue;
    if (carrier !== undefined && value !== undefined) {
      const capture = records.closureCapture.get(node);
      const signatureKey = rustGenericFamilySignatureKey(value.signature);
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
        const storage = selectRustGenericCallableStorage(Object.freeze({ identityObserved: identityFamilies.has(identity),
          creation, asynchronous: records.asyncFunction.get(node) !== undefined, generator: records.generator.get(node) !== undefined,
          result: value.signature.result, captures, receiverFields, receivers }));
        const implementation = Object.freeze({ declaration: node, carrier, sourceFileName,
          variantName: allocateRustGeneratedName(usedNames, `Implementation${implementationIdentity.slice(0, 12)}`),
          stateName: allocateRustGeneratedName(usedNames, `CallableEnvironment${implementationIdentity.slice(0, 12)}`),
          functionName,
          creation,
          storage,
          captures: Object.freeze(captures), receiverFields: Object.freeze(receiverFields), receivers: Object.freeze(receivers), substitutions: snapshotClosedMetadata([...substitutions]),
        });
        const group = groups.get(identity);
        if (group !== undefined && rustGenericFamilySignatureKey(group.signature) !== signatureKey) {
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
      return selected === undefined || rustGenericFamilySignatureKey(selected.signature) !== rustGenericFamilySignatureKey(value.signature) ? undefined : selected;
  };
  let physical: RustGenericCallablePhysicalPlan | undefined;
  const plan: RustGenericCallablePlan = Object.freeze({ definitions: Object.freeze(definitions), issues: Object.freeze(issues), definitionFor,
    get physical(): RustGenericCallablePhysicalPlan {
      if (physical === undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical storage requires its finalized declaration inputs.");
      return physical;
    },
    implementationFor: (declaration: Node) => implementations.get(declaration),
  });
  let published = false;
  return Object.freeze({ plan,
    initializePhysical(input: RustGenericCallablePhysicalInput): RustGenericCallablePhysicalConstruction {
      if (physical !== undefined) failTargetAnalysisInvariant("tsonic-rust", "A generic callable physical environment is initialized exactly once.");
      const construction = createRustGenericCallablePhysicalPlan(definitions, definitionFor, input);
      physical = construction.plan;
      return construction;
    },
    publishPhysical(selected: RustGenericCallablePhysicalPlan): void {
      if (physical === undefined || published) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical data publishes exactly once after construction.");
      physical = selected;
      published = true;
    },
  });
}

import { selectRustGenericCallableStorage } from "../../../policy/ownership/generic-callables.js";

// A family's contract is its declared signature: an implementation closes a returned callable's open environment with its
// own retained environment lifetime, which is not part of the contract the family's carriers name.
function rustGenericFamilySignatureKey(signature: RustCallableSignature): string {
  return closedMetadataKey(mapRustTargetTypes({ kind: "tuple", elements: [...signature.parameters, signature.result] }, current => {
    const protocol = rustCallableProtocol(current);
    return protocol?.lifetime?.kind === "parameter" && protocol.lifetime.identity.startsWith("retained-environment\0")
      ? rustCallableTargetType(protocol.parameters, protocol.result, undefined, protocol.error) : current;
  })) + closedMetadataKey({ typeParameters: signature.typeParameters, environmentParameters: signature.environmentParameters });
}
