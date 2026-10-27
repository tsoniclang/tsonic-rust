import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustFrameEmissionProducer } from "../../program/records/callables/frame-emission.js";
import type { RustGenericRequirement } from "../../../target-model/records/types/generic-requirements.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier } from "../../../policy/constraints/native-traits.js";
import type { RustFrameCallableDefinition } from "../../../target-model/records/callables/frame-callables.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { rustPhysicalEmissionRecordCarriers } from "./emission-contexts.js";
import { rustProgramNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";

export function analyzeRustFrameEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly sourceFiles: readonly SourceFile[];
  readonly nodes: readonly Node[];
  readonly producer: RustFrameEmissionProducer;
  readonly nativeTypeFor: (carrier: TargetTypeRef) => import("../../../target-model/records/callables/frame-emission.js").RustFrameNativeType | undefined;
}): void {
  const { program } = input;
  const frames = program.callableValues.frames;
  const scopes = new Map<Node, RustFrameCallableDefinition[]>();
  const implementationDeclarations = new Set<Node>();
  const bindingDeclarations = new Set<Node>();
  for (const [subject, value] of frames.activationInputs) input.producer.input(subject, value);
  for (const [subject, owner] of frames.receiverOwners) input.producer.receiver(subject, owner);
  for (const definition of frames.definitions) {
    if (definition.activation.kind === "class") input.producer.owner(definition.activation.ownerDeclaration, definition);
    for (const binding of definition.bindings) if (!bindingDeclarations.has(binding.declaration)) {
      bindingDeclarations.add(binding.declaration);
      const selected = frames.bindingFor(binding.declaration);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted frame binding requires its canonical source declaration.", binding.declaration);
      input.producer.bindingDeclaration(binding.declaration, selected);
    }
    if (definition.activation.kind === "lexical") {
      const existing = scopes.get(definition.activation.activationScope) ?? [];
      existing.push(definition);
      scopes.set(definition.activation.activationScope, existing);
    }
    for (const binding of definition.bindings) input.producer.binding(binding, {
      copy: binding.entry?.copy === true || binding.entry === undefined && isRustCopyCarrier(binding.carrier,
        selected => program.callableValues.generic.definitionFor(selected)?.copy === true),
      checkedWrite: program.frozenDataWrites.receiverForDeclaration(binding.declaration) !== undefined,
    });
    const implementations = definition.entries.flatMap(entry => entry.implementations);
    for (const implementation of implementations) implementationDeclarations.add(implementation.declaration);
    const contracts = implementations.map(implementation => {
      const contract = program.declarationGenericRequirements.contractFor(implementation.declaration);
      if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native frame requires its complete generic requirement contracts.", implementation.declaration);
      return contract;
    });
    const parameters = definition.environmentParameters.map(parameter => {
      const requirements = new Set<RustGenericRequirement>();
      for (const contract of contracts) for (const selected of [...contract.typeParameters, ...contract.capturedTypeParameters]) {
        if (selected.identity === parameter.identity) for (const requirement of selected.requirements) requirements.add(requirement);
      }
      return Object.freeze({ identity: parameter.identity, name: parameter.name, requirements: Object.freeze([...requirements]) });
    });
    const associated = new Map(contracts.flatMap(contract => contract.associatedTypes).map(requirement => [closedMetadataKey(requirement), requirement]));
    const projections = new Map(contracts.flatMap(contract => contract.projectProjections).map(requirement => [closedMetadataKey(requirement), requirement]));
    input.producer.definition(definition, { errors: new Map(definition.entries.map(entry => [entry, frames.entryErrors(entry)])),
      counterName: frames.counterNameFor(definition), parameters: Object.freeze(parameters),
      associated: Object.freeze([...associated.values()]), projections: Object.freeze([...projections.values()]),
      payloads: new Map(implementations.map(implementation => [implementation,
        implementation.captures.length !== 0 || implementation.receiverFields.length !== 0 || implementation.receivers.length !== 0 || definition.environmentParameters.length !== 0])),
    });
  }
  for (const [scope, definitions] of scopes) input.producer.scope(scope, definitions);
  for (const declaration of implementationDeclarations) {
    const selected = frames.implementationFor(declaration);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native frame implementation requires its canonical admitted declaration.", declaration);
    input.producer.implementation(declaration, selected);
  }
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile,
    frames.definitions.filter(definition => definition.ownerFileName === program.source.ast.getFileName(sourceFile)));
  const fields = new WeakMap<Node, Set<string>>();
  const field = (declaration: Node, receiver: TargetTypeRef): void => {
    const binding = frames.bindingFor(declaration);
    const definition = program.projectTypes.definitionForCarrier(receiver);
    const frame = definition === undefined ? undefined : frames.definitionForOwner(definition.declaration);
    if (binding === undefined || frame === undefined || !frame.bindings.includes(binding)) return;
    let carriers = fields.get(declaration);
    if (carriers === undefined) { carriers = new Set(); fields.set(declaration, carriers); }
    const key = closedMetadataKey(receiver);
    if (carriers.has(key)) return;
    carriers.add(key);
    const carrier = program.projectTypes.instantiateMemberCarrier(declaration, receiver, binding.carrier);
    if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted frame field requires its exact instantiated native carrier.", declaration);
    const selected = rustTargetTypeRefEquals(carrier, binding.carrier) ? binding : Object.freeze({ ...binding, carrier });
    if (selected !== binding) input.producer.binding(selected, { copy: selected.entry?.copy === true || selected.entry === undefined &&
      isRustCopyCarrier(carrier, callable => program.callableValues.generic.definitionFor(callable)?.copy === true),
      checkedWrite: program.frozenDataWrites.receiverForDeclaration(declaration) !== undefined });
    input.producer.classField(declaration, receiver, { binding: selected, frame });
  };
  for (const node of input.nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-field" && operation.declaration !== undefined) field(operation.declaration, operation.receiverCarrier);
  }
  for (const definition of program.projectTypes.definitions) {
    const frame = frames.definitionForOwner(definition.declaration);
    if (frame === undefined) continue;
    const receiver = program.projectTypes.openCarrier(definition);
    for (const binding of frame.bindings) field(binding.declaration, receiver);
  }
  const pending = input.nodes.flatMap(node => rustPhysicalEmissionRecordCarriers(program.records, node));
  for (const context of program.physicalEmissionContexts.contexts) pending.push(...context.operands);
  for (const operand of program.physicalEmissionContexts.operands) pending.push(operand.carrier,
    ...(operand.destination === undefined ? [] : [operand.destination]));
  for (const definition of frames.definitions) pending.push(...definition.bindings.map(binding => binding.carrier),
    ...definition.entries.flatMap(entry => entry.implementations.map(implementation => implementation.carrier)));
  const seenTypes = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (seenTypes.has(key)) continue;
    seenTypes.add(key);
    pending.push(...rustTargetTypeChildren(carrier));
    const value = rustFrameCallableValue(carrier);
    if (value === undefined) continue;
    const selected = input.nativeTypeFor(carrier);
    if (selected === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted native frame requires its exact physical entry and environment correspondence.");
    const independentCarrier = frames.independentCarrierFor(carrier);
    if (selected.entry.hasIndependent && independentCarrier === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted independent frame entry requires its completed native construction carrier.");
    const error = frames.errorFor(carrier);
    if (error === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native frame requires its completed invocation error carrier.");
    input.producer.type(carrier, { ...selected, error, independentCarrier });
  }
}
