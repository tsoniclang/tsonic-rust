import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Initializer, Node_Type, sourceParameterIsProperty, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectClassProducer } from "../program/records/objects/project-classes.js";
import type { RustProjectFieldEmission, RustProjectMethodPropertyEmission, RustProjectClassStateEmission } from "../../target-model/records/objects/project-classes.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustNeverCarrier } from "../../target-model/types/index.js";
import { selectRustProjectForwarder } from "../../policy/types/objects/project-dispatch-callables.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustProjectInstanceContracts } from "./instance-contracts.js";
import type { RustProjectCallableAdapter } from "../../target-model/records/callables/project-callable-adapters.js";
import type { RustReachability } from "../../target-model/records/program/reachability.js";
import { instantiateRustProjectMethodDispatchArguments } from "./method-dispatch.js";
import { analyzeRustProjectRootEmission } from "./root-emission.js";
import { analyzeRustProjectDispatchEmission } from "./dispatch-emission.js";
import { analyzeRustProjectPolymorphicEmission } from "./polymorphism-emission.js";
import { closeRustProjectCallableContracts } from "./callable-contracts.js";
import type { RustClassImplementationContextConstruction } from "../objects/class-implementation-contexts.js";

export function analyzeRustProjectClassLayouts(program: Omit<RustAnalysisProgram, "reachability">, source: TargetSourceProgram,
  nodes: readonly Node[], producer: RustProjectClassProducer, reachability: RustReachability,
  classContexts: Pick<RustClassImplementationContextConstruction, "forInstance">,
  rootHeader: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => void): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const members = new Map<RustProjectTypeDefinition, readonly Node[]>();
  for (const [method, references] of reachability.projectThisReferences) producer.thisReferences(method, references);
  const instanceCache = new WeakMap<RustProjectTypeDefinition, Map<string, { readonly fields: readonly RustProjectFieldEmission[]; readonly properties: readonly RustProjectMethodPropertyEmission[] }>>();
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind !== "class" && definition.kind !== "interface") continue;
    const values = ast.members(definition.declaration);
    if (values.some(member => member === undefined)) failTargetAnalysisInvariant("tsonic-rust", "An admitted project type requires its dense checked member inventory.", definition.declaration);
    const selected = values as readonly Node[];
    members.set(definition, selected);
    const accessors = selected.flatMap<{ readonly declaration: Node; readonly role: "read" | "write" }>(member => ast.hasModifierKind(member, "static") ? []
      : ast.kindName(member) === "KindGetAccessor" ? [{ declaration: member, role: "read" as const }]
        : ast.kindName(member) === "KindSetAccessor" ? [{ declaration: member, role: "write" as const }] : []);
    producer.members(definition, Object.freeze([...selected]), Object.freeze(accessors));
  }
  issues.push(...closeRustProjectCallableContracts(program, source, members, producer));
  // A field whose declared type has no native storage carrier (e.g. `never`) is refused here, as the checkpoint
  // planner refused it; it cannot become a stored slot.
  for (const definition of program.projectTypes.definitions) for (const field of program.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []) {
    const declared = program.callableValues.projectFieldStorage.get(field.declaration) ??
      program.records.runtimeCarrier.get(field.declaration)?.carrier ?? program.records.runtimeCarrier.get(Node_Type(ast, field.declaration))?.carrier;
    if (declared !== undefined && isRustNeverCarrier(declared)) issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust",
      sourceNode: field.declaration, message: `Class field '${field.sourceName}' has no supported Rust storage identity or carrier fact. Node kind: ${ast.kindName(field.declaration)}.`,
      evidence: ["target.capability=rust.backend.class-field-storage"] });
  }
  if (issues.length !== 0) return Object.freeze(issues);
  for (const definition of program.projectTypes.definitions) {
    const index = new Map<Node, Map<Node, Map<string, RustProjectCallableAdapter>>>();
    for (const adapter of program.records.projectCallableAdapters.get(definition.declaration) ?? []) {
      let implementations = index.get(adapter.contract);
      if (implementations === undefined) { implementations = new Map(); index.set(adapter.contract, implementations); }
      let slots = implementations.get(adapter.implementation);
      if (slots === undefined) { slots = new Map(); implementations.set(adapter.implementation, slots); }
      if (slots.has(adapter.slot)) failTargetAnalysisInvariant("tsonic-rust", "An admitted native callable adapter requires one exact contract, implementation and slot.", adapter.contract);
      slots.set(adapter.slot, adapter);
    }
    producer.adapters(definition.declaration, index);
  }
  const instance = (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => {
    let contexts = instanceCache.get(definition);
    if (contexts === undefined) { contexts = new Map(); instanceCache.set(definition, contexts); }
    const key = closedMetadataKey(carrier);
    const existing = contexts.get(key);
    if (existing !== undefined) return existing;
    const layout = program.projectTypes.objectLayoutForDefinition(definition);
    if (layout === undefined || layout.kind !== definition.kind) failTargetAnalysisInvariant("tsonic-rust", "An admitted project instance requires its exact native object layout.", definition.declaration);
    const fields: RustProjectFieldEmission[] = [];
    for (const field of program.projectTypes.externalBaseForDefinition(definition)?.fields ?? []) {
      const targetName = program.projectTypes.fieldStorageName(definition, field.declaration);
      if (targetName === undefined) failTargetAnalysisInvariant("tsonic-rust", "An external project field requires its exact native slot.", field.declaration);
      fields.push(Object.freeze({ ...field, storage: "stored", targetName, origin: "external", readonly: false, initializer: undefined }));
    }
    const offset = fields.length;
    for (const field of layout.fields) {
      const declared = program.callableValues.projectFieldStorage.get(field.declaration) ??
        program.records.runtimeCarrier.get(field.declaration)?.carrier ?? program.records.runtimeCarrier.get(Node_Type(ast, field.declaration))?.carrier;
      const selected = declared === undefined ? undefined : program.projectTypes.instantiateMemberCarrier(field.declaration, carrier, declared);
      const targetName = program.projectTypes.fieldStorageName(definition, field.declaration);
      if (selected === undefined || isRustNeverCarrier(selected) || targetName === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted project field requires its exact instantiated native carrier and slot.", field.declaration);
      const initializer = sourceParameterIsProperty(ast, field.declaration) ? ast.name(field.declaration) : Node_Initializer(ast, field.declaration);
      fields.push(Object.freeze({ ...field, storage: program.objectRepresentations.aliasFor(field.declaration) === undefined ? "stored" : "receiver-alias",
        targetName, storageIndex: offset + field.storageIndex, carrier: selected, origin: "project",
        readonly: ast.hasModifierKind(field.declaration, "readonly"), initializer }));
    }
    const properties: RustProjectMethodPropertyEmission[] = [];
    const seen = new Set<Node>();
    for (const member of program.records.classMethods.get(definition.declaration) ?? []) {
      if (ast.hasModifierKind(member, "static")) continue;
      const implementation = program.sourceNavigation.callableImplementation(member);
      const declaration = implementation.kind === "resolved" ? implementation.implementation.declaration : member;
      if (seen.has(declaration)) continue;
      const usage = program.projectMethodProperties.usageFor(member) ?? program.projectMethodProperties.usageFor(declaration);
      if (usage?.writable !== true) continue;
      seen.add(declaration);
      const owner = program.projectTypes.definitionContainingDeclaration(declaration);
      const relation = owner === undefined ? undefined : program.projectTypes.relationship(carrier, owner);
      const name = owner === undefined ? undefined : program.projectTypes.fieldStorageName(owner, declaration);
      const signature = producer.records.projectCallableSignature.get(declaration);
      if (owner === undefined || relation?.kind !== "related" || name === undefined || signature === undefined ||
        signature.typeParameters.length !== 0 || signature.safety.declaration || !signature.fallible)
        failTargetAnalysisInvariant("tsonic-rust", "A writable native method property requires its exact object-safe fallible contract and slot.", declaration);
      properties.push(Object.freeze({ declaration, owner, ownerCarrier: relation.targetType, targetName: name }));
    }
    const result = Object.freeze({ fields: Object.freeze(fields), properties: Object.freeze(properties) });
    contexts.set(key, result);
    producer.instance(definition, carrier, result.fields, result.properties);
    return result;
  };
  // An interface without an object layout (members keyed only by an ambient unique symbol, a type-level storage family
  // marker) has a native instance only where a value of that type exists, which the value carriers below reach.
  const layoutless = (definition: RustProjectTypeDefinition | undefined): boolean => definition?.kind === "interface" &&
    program.projectTypes.objectLayoutForDefinition(definition) === undefined;
  const pending = [...program.projectTypes.definitions.filter(definition => members.has(definition) && !layoutless(definition))
    .map(definition => program.projectTypes.openCarrier(definition))];
  for (const context of program.physicalEmissionContexts.contexts) pending.push(...context.operands,
    ...(context.returnDestination.kind === "value" ? [context.returnDestination.carrier] : []));
  for (const operand of program.physicalEmissionContexts.operands) pending.push(operand.carrier,
    ...(operand.destination === undefined ? [] : [operand.destination]));
  for (const node of nodes) {
    if (ast.is.IsInterfaceDeclaration(node) && layoutless(program.projectTypes.definitionForDeclaration(node))) continue;
    const carrier = program.records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) pending.push(carrier);
  }
  const seen = new Set<string>();
  const aliases = new Set<string>();
  const roots: { readonly definition: RustProjectTypeDefinition; readonly carrier: TargetTypeRef }[] = [];
  const methodArguments = new WeakMap<Node, Set<string>>();
  const forwarders = new WeakMap<Node, Set<Node>>();
  const methodRequest = (member: Node, arguments_: readonly TargetTypeRef[], receiver: TargetTypeRef): void => {
    let requests = methodArguments.get(member);
    if (requests === undefined) { requests = new Set(); methodArguments.set(member, requests); }
    const key = closedMetadataKey([arguments_, receiver]);
    if (requests.has(key)) return;
    requests.add(key);
    const selected = instantiateRustProjectMethodDispatchArguments(member, arguments_, receiver, program.projectTypes);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native method requires its exact receiver-instantiated type arguments.", member);
    producer.arguments(member, arguments_, receiver, selected);
  };
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(...rustTargetTypeChildren(carrier));
    const definition = program.projectTypes.definitionForCarrier(carrier);
    // A type-only contract (a type-family predicate interface) has no native object layout or instance.
    if (definition === undefined || !members.has(definition) ||
      program.records.typeOnlyDeclaration.get(definition.declaration) !== undefined) continue;
    const contracts = rustProjectInstanceContracts(program.projectTypes, definition, carrier);
    if (contracts === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native instance requires its exact checked contract graph.", definition.declaration);
    producer.contracts(carrier, contracts);
    for (const contract of contracts) {
      classContexts.forInstance(contract.definition, contract.carrier);
      producer.relationship(carrier, contract.definition, contract.carrier);
      for (const member of members.get(contract.definition) ?? []) {
        if (ast.hasModifierKind(member, "static") || !ast.is.IsMethodDeclaration(member) && ast.kindName(member) !== "KindMethodSignature" &&
          ast.kindName(member) !== "KindGetAccessor" && ast.kindName(member) !== "KindSetAccessor") continue;
        const implementation = definition.kind === "class" ? program.projectTypes.memberImplementation(definition, member) : undefined;
        const selectedImplementation = implementation?.kind === "resolved" ? implementation.implementation.declaration : undefined;
        const exact = contract.definition.kind === "class" && !ast.hasModifierKind(member, "abstract")
          ? program.projectTypes.memberImplementation(contract.definition, member) : undefined;
        const implementations = new Set([...(selectedImplementation === undefined ? [] : [selectedImplementation]),
          ...(exact?.kind === "resolved" ? [exact.implementation.declaration] : [])]);
        for (const variant of program.projectMethodDispatch.variantsForMember(member)) {
          methodRequest(member, variant.targetTypeArguments, carrier);
          for (const selected of implementations) methodRequest(selected, variant.targetTypeArguments, carrier);
        }
        for (const selectedImplementation of implementations) {
          let selected = forwarders.get(member);
          if (selected === undefined) { selected = new Set(); forwarders.set(member, selected); }
          if (selected.has(selectedImplementation)) continue;
          selected.add(selectedImplementation);
          const source = producer.records.projectCallableSignature.get(selectedImplementation);
          const target = producer.records.projectCallableSignature.get(member);
          if (source === undefined || target === undefined) continue;
          // A dispatch slot keeps its contract safety; an implementation with a different unsafe contract cannot fill it.
          if (source.safety.declaration !== target.safety.declaration || source.safety.getter !== target.safety.getter ||
            source.safety.setter !== target.safety.setter) {
            issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: selectedImplementation,
              message: `Selected project member implementation does not preserve its finalized contract-to-implementation Rust ABI adapter. Node kind: ${ast.kindName(selectedImplementation)}.`,
              evidence: ["target.capability=rust.backend.project-dispatch-signature"] });
            continue;
          }
          const accessor = ast.kindName(member) === "KindGetAccessor" || ast.kindName(member) === "KindSetAccessor";
          producer.forwarder(member, selectedImplementation, selectRustProjectForwarder(source.errorCarrier, target.errorCarrier, accessor));
        }
      }
    }
    const ancestors = [carrier];
    const visitedAncestors = new Set<string>();
    for (let ancestorIndex = 0; ancestorIndex < ancestors.length; ancestorIndex++) {
      const ancestor = ancestors[ancestorIndex]!;
      const ancestorKey = closedMetadataKey(ancestor);
      if (visitedAncestors.has(ancestorKey)) continue;
      visitedAncestors.add(ancestorKey);
      const target = program.projectTypes.definitionForCarrier(ancestor);
      const relationship = target === undefined ? undefined : program.projectTypes.relationship(carrier, target);
      if (target !== undefined && relationship?.kind === "related" && rustTargetTypeRefEquals(relationship.targetType, ancestor)) {
        const aliasKey = closedMetadataKey([carrier, ancestor]);
        if (!aliases.has(aliasKey)) {
          aliases.add(aliasKey);
          producer.alias(carrier, ancestor, { same: rustTargetTypeRefEquals(carrier, ancestor),
            polymorphic: program.projectTypes.isPolymorphic(definition) && program.projectTypes.isPolymorphic(target) });
        }
      }
      ancestors.push(...(program.projectTypes.directSupertypes(ancestor) ?? []));
    }
    instance(definition, carrier);
    pending.push(...(program.projectTypes.directSupertypes(carrier) ?? []));
    if (definition.kind !== "class") continue;
    const lineage = program.projectTypes.classLineage(definition);
    if (lineage === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native class requires its exact state lineage.", definition.declaration);
    const layers: RustProjectClassStateEmission[] = lineage.map(owner => {
      const relation = program.projectTypes.relationship(carrier, owner);
      if (relation.kind !== "related") failTargetAnalysisInvariant("tsonic-rust", "A native class state layer requires its exact checked generic relationship.", owner.declaration);
      const selected = instance(owner, relation.targetType);
      return Object.freeze({ definition: owner, carrier: relation.targetType, methodProperties: selected.properties,
        fields: Object.freeze(selected.fields.filter(field => field.storage === "stored" &&
          program.objectRepresentations.receiverCaptures.storageDeclaration(field.declaration) === field.declaration && !ast.hasModifierKind(field.declaration, "abstract"))) });
    });
    producer.state(definition, carrier, Object.freeze(layers));
    const native = program.records.nativeClass.get(definition.declaration);
    if (native?.kind === "polymorphic" && !native.abstract) roots.push({ definition, carrier });
  }
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind !== "class" || !members.has(definition)) continue;
    const layers = producer.records.projectClassState.get(definition, program.projectTypes.openCarrier(definition));
    if (layers === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native class requires its selected physical state lineage.", definition.declaration);
    const fields = new Map<Node, readonly string[]>();
    const properties = new Map<Node, readonly string[]>();
    const storagePaths = new Map<Node, readonly string[]>();
    for (const [index, layer] of layers.entries()) {
      const prefix = layers.slice(index + 1).reverse().map(next => program.projectTypes.baseStateFieldName(next.definition));
      for (const field of layer.fields) {
        if (storagePaths.has(field.declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native class field requires one physical state slot.", field.declaration);
        storagePaths.set(field.declaration, Object.freeze([...prefix, field.targetName]));
      }
      for (const property of layer.methodProperties) properties.set(property.declaration, Object.freeze([...prefix, property.targetName]));
    }
    for (const layer of layers) for (const member of [...(members.get(layer.definition) ?? []), ...layer.fields.map(field => field.declaration)]) {
      const physical = program.objectRepresentations.receiverCaptures.storageDeclaration(member);
      const path = storagePaths.get(physical);
      if (path !== undefined) fields.set(member, path);
    }
    producer.paths(definition, fields, properties);
    const implementations = new Map<Node, Node>();
    for (const contract of program.projectTypes.contractsForClass(definition) ?? []) for (const member of members.get(contract) ?? []) {
      const selection = program.projectTypes.memberImplementation(definition, member);
      if (selection.kind === "resolved") implementations.set(member, selection.implementation.declaration);
    }
    producer.implementations(definition, implementations);
  }
  for (const root of roots) {
    analyzeRustProjectRootEmission(program, root.definition, root.carrier, producer, methodRequest);
    rootHeader(root.definition, root.carrier);
  }
  for (const definition of members.keys()) if (program.projectTypes.isPolymorphic(definition))
    issues.push(...analyzeRustProjectDispatchEmission(program, definition, reachability, producer));
  if (issues.length !== 0) return Object.freeze(issues);
  for (const definition of members.keys()) if (program.projectTypes.isPolymorphic(definition))
    analyzeRustProjectPolymorphicEmission(program, definition, reachability, producer);
  return Object.freeze(issues);
}
