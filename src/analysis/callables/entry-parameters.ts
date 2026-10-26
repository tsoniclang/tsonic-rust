import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustNativeCallableGenericHeader } from "../../target-model/records/native-generics.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustDeclarationEmissionProducer } from "../program/records/declaration-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";
import type { RustNativeStorageConstruction } from "./native-storage.js";
import { selectRustCallableEntryGenerics } from "./entry-generics.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closeRustRetainedCallableCarrier } from "../../policy/ownership/retained-storage.js";
import { rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustNativeGenericEntry } from "../../target-model/records/declaration-emission.js";
import type { RustGenericCallableImplementation } from "../../target-model/records/generic-callables.js";
import { rustGenericCallableStorageArguments } from "../../target-model/types/carriers/generic-callable-storage.js";
import { selectRustNativeHelperStatePassing, selectRustNativeFrameOwnerPassing } from "../../policy/ownership/generic-callables.js";
import type { RustFrameCallablePlanRegistry } from "./frame-values.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";
import type { RustFrameCallableImplementation } from "../../target-model/records/frame-callables.js";
import type { RustNativeFrameEntry } from "../../target-model/records/declaration-emission.js";

export function analyzeRustCallableEntryParameters(input: {
  readonly source: TargetSourceProgram;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly lifetimes: RustLifetimeIndex;
  readonly nativeStorage: RustNativeStorageConstruction;
  readonly native: Pick<RustNativeCallableInputPlan, "inputsFor" | "isNativeRetainedParameter">;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly generic: RustGenericCallablePlan;
  readonly frames: Pick<RustFrameCallablePlanRegistry, "nativeTypeFor" | "definitions">;
  readonly classValues: RustClassValuePlan;
  readonly producer: RustDeclarationEmissionProducer;
  readonly required: RustRequiredRecord[];
}): readonly TargetDiagnostic[] {
  const { ast } = input.source;
  const issues: TargetDiagnostic[] = [];
  const headers = new Map<Node, RustNativeCallableGenericHeader>();
  const genericEntries = new Map<Node, Map<RustGenericCallableImplementation, RustNativeGenericEntry>>();
  for (const definition of input.generic.definitions) for (const implementation of definition.implementations) {
    const entries = genericEntries.get(implementation.declaration) ?? new Map<RustGenericCallableImplementation, RustNativeGenericEntry>();
    if (entries.has(implementation)) continue;
    const environment = input.generic.physical.environmentFor(implementation);
    if (environment === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted generic native entry requires its completed physical capture environment.", implementation.declaration);
    const suspended = input.records.asyncFunction.get(implementation.declaration) !== undefined ||
      input.records.generator.get(implementation.declaration) !== undefined;
    const helper = implementation.creation === "activation";
    const captures = environment.captures.length + environment.receiverFields.length + environment.receivers.length;
    const statePassing = selectRustNativeHelperStatePassing({ suspended, storage: implementation.storage,
      hasPayload: helper && captures !== 0 });
    entries.set(implementation, Object.freeze({ implementation, environment, suspended, helper, statePassing,
      arguments: rustGenericCallableStorageArguments(definition.signature.environmentParameters, environment.parameters) }));
    genericEntries.set(implementation.declaration, entries);
  }
  const declarations = new Set(input.nodes.filter(node => ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node)));
  const sourceParameters = new Map<Node, Map<Node, TargetTypeRef>>();
  for (const declaration of genericEntries.keys()) declarations.add(declaration);
  const frameEntries = new Map<Node, Map<RustFrameCallableImplementation, RustNativeFrameEntry>>();
  for (const definition of input.frames.definitions) for (const entry of definition.entries) for (const implementation of entry.implementations) {
    if (implementation.independent) continue;
    const entries = frameEntries.get(implementation.declaration) ?? new Map<RustFrameCallableImplementation, RustNativeFrameEntry>();
    if (entries.has(implementation)) continue;
    const type = input.frames.nativeTypeFor(implementation.carrier, input.classValues);
    if (type?.definition !== definition || type.entry !== entry) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted frame helper requires its exact physical native entry and owner.", implementation.declaration);
    const suspended = input.records.asyncFunction.get(implementation.declaration) !== undefined ||
      input.records.generator.get(implementation.declaration) !== undefined;
    const captures = implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length;
    entries.set(implementation, Object.freeze({ implementation, type, suspended,
      ownerPassing: selectRustNativeFrameOwnerPassing(suspended),
      statePassing: selectRustNativeHelperStatePassing({ suspended, storage: implementation.copy ? "value" : "shared", hasPayload: captures !== 0 }),
      arguments: Object.freeze(type.environment.map(type => Object.freeze({ kind: "type" as const, type }))) }));
    frameEntries.set(implementation.declaration, entries);
    declarations.add(implementation.declaration);
  }
  for (const parameter of input.nodes) {
    if (!ast.is.IsParameterDeclaration(parameter)) continue;
    const abi = input.records.sourceParameterAbi.get(parameter);
    if (abi === undefined) continue;
    const owner = ast.parent(parameter);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native parameter requires its checked callable owner.", parameter);
    const requiresImplementation = input.native.inputsFor(owner).some(selected => selected.subject.node === parameter);
    const physical = requiresImplementation ? input.nativeStorage.parameterFor(parameter) : undefined;
    if (physical?.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust",
      "An admitted native parameter requires its finalized physical callable storage.", parameter);
    const carrier = physical?.carrier ?? (input.native.isNativeRetainedParameter(parameter)
      ? closeRustRetainedCallableCarrier(abi.parameterCarrier, rustStaticLifetime) : abi.parameterCarrier);
    const parameters = sourceParameters.get(owner) ?? new Map<Node, TargetTypeRef>();
    parameters.set(parameter, carrier);
    sourceParameters.set(owner, parameters);
    declarations.add(owner);
  }
  for (const { declaration } of input.nativeProducers.producers) {
    declarations.add(declaration);
    const selected = selectRustCallableEntryGenerics({ ...input, ast }, declaration);
    if (selected.kind === "rejected") issues.push(...selected.diagnostics);
    else headers.set(declaration, selected.value);
  }
  if (issues.length !== 0) return Object.freeze(issues);
  for (const node of declarations) {
    const operation = input.records.targetOperation.get(node);
    const leading = operation?.kind === "closure" ? operation.leadingParameters ?? [] : [];
    const selected = input.records.receiverIndependentMethod.get(node) === undefined ? leading : leading.filter(parameter => parameter.kind !== "this");
    const parameters = selected.map(parameter => {
      const reads: Node[] = [];
      const visit = (subject: Node): void => {
        const kind = ast.kindName(subject);
        if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
          if (rustTargetTypeRefEquals(input.records.runtimeCarrier.get(subject)?.carrier, parameter.carrier)) reads.push(subject);
          return;
        }
        if (subject !== node && (ast.is.IsFunctionExpression(subject) || ast.is.IsFunctionDeclaration(subject) ||
          ast.is.IsMethodDeclaration(subject) || ast.is.IsGetAccessorDeclaration(subject) || ast.is.IsSetAccessorDeclaration(subject) ||
          ast.is.IsClassDeclaration(subject) || ast.is.IsClassExpression(subject))) return;
        ast.forEachChild(subject, child => { if (child !== undefined) visit(child); });
      };
      if (parameter.kind === "this") visit(node);
      return Object.freeze({ ...parameter, reads: Object.freeze(reads) });
    });
    input.producer.leading(node, { parameters: Object.freeze(parameters), genericHeader: headers.get(node),
      genericEntries: genericEntries.get(node) ?? new Map<RustGenericCallableImplementation, RustNativeGenericEntry>(),
      frameEntries: frameEntries.get(node) ?? new Map<RustFrameCallableImplementation, RustNativeFrameEntry>(),
      sourceParameters: sourceParameters.get(node) ?? new Map<Node, TargetTypeRef>() });
    requireRustRecord(input.required, "callableLeading", node, "native callable entry parameters", "analyzeRustCallableEntryParameters");
  }
  return Object.freeze(issues);
}
