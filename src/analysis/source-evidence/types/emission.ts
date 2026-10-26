import type { Node } from "@tsonic/tsts";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustTypeEmissionProducer } from "../../program/records/type-emission.js";
import type { RustProjectEmissionProducer } from "../../program/records/project-emission.js";
import { analyzeRustOptionalStorageTypeEmission } from "../../project-types/optional-storage-emission.js";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../../target-model/types/model.js";
import type { RustTypeEmission, RustTypePositions, RustOptionalStorageEmission, RustSourceOptionalEmission, RustOptionPayloadView } from "../../../target-model/records/type-emission.js";
import { isRustOptionCarrier, rustOptionValueCarrier, isRustStringCarrier } from "../../../target-model/types/index.js";
import { rustOptionalStorageValue, rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier, isRustUnitCarrier, isRustJsValueCarrier, rustOptionElementCarrier, rustOptionTargetType, rustAbsenceTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustUnionPayloadAdmission } from "../../../policy/conversions/union-injection.js";
import { isRustNativeFutureCarrier, rustJsPromiseTargetId } from "../../../target-model/types/index.js";
import { rustUninhabitedError } from "../../../policy/conversions/callable-physical.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { rustSourceUnionPayloadArguments } from "../../../target-model/types/source-union-definitions.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustTargetTypeParameterIdentities } from "../../../target-model/types/carriers/generic-references.js";
import { rustNativeFutureCallableResult } from "../../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableStorageArguments } from "../../../target-model/types/carriers/generic-callable-storage.js";
import { rustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinReference } from "../../../target-model/types/native-error-joins.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { rustPhysicalEmissionRecordCarriers } from "../../callables/emission-contexts.js";
import { rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue, rustSourceTypeCarrierValue,
  rustNamedTypeCarrierValue, rustFixedArrayCarrierValue, rustCallableInputTargetId, rustCallableTargetId, rustFutureTargetId, rustProgramErrorTargetType, rustUnitTargetType, rustEmptyObjectTargetId } from "../../../target-model/types/index.js";
import { selectRustTypePositions } from "../../../policy/types/resolution/type-emission.js";
import { isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier, isRustRetainedErrorCarrier,
  isRustWritableRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import { isRustProgramErrorCarrier } from "../../../target-model/types/index.js";
import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";
import { rustCarrierProvidesErrorObservation } from "../../../policy/constraints/error-protocols.js";
import { rustCapturedLifetimeEmissionCarriers, rustDeclarationEmissionCarriers } from "./emission-inventory.js";
import { rustProgramNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { selectRustCheckedProjectProjection } from "../../../policy/types/objects/checked-project-projections.js";

export function analyzeRustTypeEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustTypeEmissionProducer, extraTypes: readonly TargetTypeRef[],
  projectEmissionProducer: Pick<RustProjectEmissionProducer, "optionalType" | "checkedProjection" | "union">): void {
  const typeArguments = (arguments_: readonly RustTargetGenericArgument[]): readonly TargetTypeRef[] =>
    arguments_.flatMap(argument => argument.kind === "type" ? [argument.type] : []);
  const retainedCarriersFor = (node: Node): readonly TargetTypeRef[] => {
    const selected = program.records.nativeGenerics.get(node);
    return [...selected?.retention?.source ?? [], ...selected?.retention?.body ?? [],
      ...selected?.inputs.flatMap(input => [
        ...input.retained === undefined ? [] : [input.retained.error, ...input.retained.targets],
        ...input.caught === undefined ? [] : [input.caught.error, input.caught.target],
      ]) ?? []];
  };
  const pending = [...extraTypes, ...nodes.flatMap(node => rustPhysicalEmissionRecordCarriers(program.records, node)), rustProgramErrorTargetType(), rustUnitTargetType()];
  pending.push(program.errorRegions.initialization.binary.lifecycle.carrier);
  pending.push(...program.providerErrorCarriers, ...rustDeclarationEmissionCarriers(program, nodes));
  pending.push(...program.structuralShapes.unionDefinitions.flatMap(union => union.sourceCarriers));
  for (const view of program.classValues.constructorViewImplementations) pending.push(view.sourceCarrier, view.targetCarrier);
  for (const protocol of program.callableValues.native.protocols) pending.push(protocol.trait, ...protocol.method.parameters, protocol.result);
  pending.push(...rustCapturedLifetimeEmissionCarriers(program, nodes, node =>
    [...rustPhysicalEmissionRecordCarriers(program.records, node), ...rustDeclarationEmissionCarriers(program, [node]),
      ...retainedCarriersFor(node)]));
  for (const sourceFile of program.sourceFiles) for (const protocol of program.records.nativeProtocols.get(sourceFile) ?? []) {
    pending.push(...protocol.method.parameters, protocol.method.result, protocol.result, protocol.trait);
    const emission = program.records.nativeProtocol.get(protocol);
    if (emission === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native protocol requires its exact sealed emission contract.", sourceFile);
    pending.push(...emission.genericProducers.map(producer => producer.returnCarrier));
    const bridge = emission.producer;
    if (bridge !== undefined) pending.push(bridge.implementation, bridge.invocationError, bridge.arguments,
      ...bridge.genericTypes, ...bridge.boundTypes, ...bridge.errors.map(error => error.parameter),
      ...bridge.futureBounds.flatMap(bound => [bound.parameter, bound.output, bound.error]),
      bridge.concreteResult, bridge.implementationResult,
      ...bridge.higherRanked === undefined ? [] : [bridge.higherRanked.helperResult, bridge.higherRanked.publicResult, ...bridge.higherRanked.outputs]);
  }
  for (const hook of program.binaryHooks) {
    const dispatch = program.records.binaryDispatch.get(hook.id);
    if (dispatch === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted binary hook requires its exact dispatch carrier inventory.");
    for (const group of dispatch.groups) pending.push(group.rootEmptyOwner, ...group.components.map(component => component.emptyOwner));
  }
  for (const component of program.sourcePackageComponents.components) {
    const roots = program.records.dispatchRoots.get(component.componentId);
    if (roots === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native component requires its complete dispatch root type inventory.");
    pending.push(...roots.map(root => root.carrier));
  }
  for (const context of program.physicalEmissionContexts.contexts) pending.push(...context.operands, ...context.bindings.types.values(),
    ...(context.returnDestination.kind === "value" ? [context.returnDestination.carrier] : []),
    ...retainedCarriersFor(context.declaration).map(carrier => substituteRustTargetGenerics(carrier,
      context.bindings.types, context.bindings.lifetimes, context.bindings.consts)));
  for (const operand of program.physicalEmissionContexts.operands) pending.push(operand.carrier,
    ...(operand.destination === undefined ? [] : [operand.destination]));
  for (const definition of program.projectTypes.definitions) pending.push(program.projectTypes.openCarrier(definition));
  // An inherited constructor layer renders the instantiated parameters of its implicit constructor.
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    const root = program.projectTypes.openCarrier(definition);
    for (const layer of program.projectConstructions.forDefinition(definition)?.layers ?? []) {
      if (layer.constructor !== undefined) continue;
      const relation = program.projectTypes.relationship(root, layer.definition);
      if (relation.kind !== "related") continue;
      for (const parameter of program.records.implicitConstructorParameters.get(layer.signature, relation.targetType) ?? [])
        pending.push(parameter.carrier);
    }
  }
  for (const shape of program.structuralShapes.instances) pending.push(shape.carrier, ...shape.fields.flatMap(field =>
    [field.carrier, ...(field.methodPlan?.carrier === undefined ? [] : [field.methodPlan.carrier])]));
  for (const view of program.classValues.instanceViewImplementations) pending.push(view.sourceCarrier, view.targetCarrier);
  for (const sourceFile of program.sourceFiles) {
    const inventory = program.records.genericDeclarations.get(sourceFile);
    if (inventory === undefined) failTargetAnalysisInvariant("tsonic-rust", "An emitted source module requires its finalized generic declaration inventory.", sourceFile);
    for (const implementation of inventory.implementations) {
      const emission = program.records.genericImplementation.get(implementation);
      if (emission === undefined) failTargetAnalysisInvariant("tsonic-rust", "An emitted generic implementation requires its finalized physical environment.", implementation.declaration);
      const environment = emission.entry.environment;
      const bindings = environment.substitutions;
      pending.push(...typeArguments(emission.entry.arguments),
        ...[...environment.captures, ...environment.receiverFields, ...environment.receivers].map(capture =>
          substituteRustTargetGenerics(capture.storageCarrier, bindings.types, bindings.lifetimes, bindings.consts)),
        ...environment.inputs.flatMap(input => [input.carrier, input.implementation, input.trait, ...input.environment]).map(carrier =>
          substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts)));
    }
  }
  for (const definition of program.callableValues.generic.physical.definitions()) {
    pending.push(definition.carrier, ...definition.signature.parameters, definition.signature.result,
      ...definition.members.flatMap(member => typeArguments(member.arguments)));
    const emission = program.records.genericDefinition.get(definition);
    if (emission === undefined) failTargetAnalysisInvariant("tsonic-rust", "An emitted generic family requires its finalized native definition.");
    if (emission.invoked) pending.push(...emission.parameters, emission.result);
    for (const member of definition.members) {
      const environment = member.environment.substitutions;
      pending.push(...retainedCarriersFor(member.implementation.declaration).map(carrier =>
        substituteRustTargetGenerics(carrier, environment.types, environment.lifetimes, environment.consts)));
      if (!emission.invoked) continue;
      const bindings = member.bindings;
      if (bindings === undefined) failTargetAnalysisInvariant("tsonic-rust", "An emitted generic member requires its finalized native environment bindings.", member.implementation.declaration);
      pending.push(...member.environment.inputs.flatMap(input => [input.implementation, input.trait]).map(carrier =>
        substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts)));
    }
  }
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const task = program.records.nativeTaskUse.get(node);
    if (task !== undefined) pending.push(task.scope.carrier, task.scope.errorCarrier,
      ...(task.kind === "owner" || task.kind === "entry" ? [task.inputCarrier] : []),
      ...(task.kind === "entry" && task.initializer !== undefined ? [task.initializer.inputCarrier] : []));
    const parameter = program.records.callableParameter.get(node);
    if (parameter !== undefined) pending.push(parameter.carrier);
    const returned = program.records.callableReturn.get(node);
    if (returned !== undefined) {
      if (returned.invocation !== undefined) pending.push(returned.invocation);
      if (returned.outward !== undefined) pending.push(returned.outward);
      if (returned.destination.kind === "selected") pending.push(returned.destination.carrier);
    }
    const callable = program.records.projectCallableSignature.get(node);
    if (callable !== undefined) pending.push(callable.returnCarrier,
      ...(callable.errorCarrier === undefined ? [] : [callable.errorCarrier]));
    // A retained callable renders an outlives bound for each retained carrier in its source and Promise-body items.
    pending.push(...retainedCarriersFor(node));
    // A generic invocation propagates through its native error join, which renders every source error carrier.
    const invocation = program.records.genericCallableInvocation.get(node);
    if (invocation !== undefined) pending.push(...invocation.invocation.map(source => source.errorType),
      ...invocation.awaiting.map(source => source.errorType));
    // A native input invocation propagates its invocation error, which renders as the input's associated error type.
    const nativeInvocation = program.records.nativeInputInvocation.get(node)?.call;
    if (nativeInvocation !== undefined) pending.push(nativeInvocation.invocationError);
    // A source call renders the absence witness of each native input it leaves absent, and passes an omitted argument as
    // that witness's absent value (no argument node carries it).
    for (const witness of program.records.sourceCall.get(node)?.witnesses ?? []) if (witness !== undefined) pending.push(witness, rustSourceOptionalTargetType(witness));
    const hoisted = program.records.moduleHoistedCallable.get(node);
    if (hoisted !== undefined) pending.push(hoisted.carrier);
    // A callable written through the eliminating adapter renders the callable carrying the destination's error.
    const joinWrite = program.records.callableJoinWrite.get(node);
    if (joinWrite !== undefined) pending.push(joinWrite.source, joinWrite.carrier);
    const contract = program.records.declarationRequirements.get(node);
    if (contract !== undefined) pending.push(...contract.optionalStorage.map(storage => storage.carrier),
      ...contract.associatedTypes.flatMap(requirement => [requirement.carrier, ...(requirement.output === undefined ? [] : [requirement.output])]),
      ...contract.projectProjections.flatMap(projection => [projection.sourceCarrier, projection.targetCarrier]));
  }
  const selections = new Map<string, { readonly carrier: TargetTypeRef; readonly value: Omit<RustTypeEmission, "positions" | "constructionArguments">;
    readonly children: readonly TargetTypeRef[]; readonly optionalArguments: readonly TargetTypeRef[] }>();
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (selections.has(key)) continue;
    const optionalArguments = analyzeRustOptionalStorageTypeEmission(program, carrier, projectEmissionProducer);
    const generic = rustGenericCallableValue(carrier);
    const physical = generic === undefined ? undefined : program.callableValues.generic.physical.existingSelectionFor(carrier);
    // A carrier that still names source type parameters is rendered only after its emission context substitutes them;
    // the substituted closed carrier is the one prepared and selected. Only a physical key (one naming its selected
    // members and arguments) has a prepared selection; a logical generic callable carrier has none by construction.
    if (generic?.physical !== undefined && physical === undefined && rustTargetTypeParameterIdentities(carrier).length === 0)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted native generic carrier requires its exact selected physical definition and arguments.");
    const union = rustSourceUnionCarrierValue(carrier);
    const unionArguments = union === undefined ? undefined : rustSourceUnionPayloadArguments(carrier, program.typeDefinitions);
    const unionDefinition = union?.origin === "generated" ? program.structuralShapes.unionForCarrier(carrier) : undefined;
    if (union?.origin === "generated" && unionDefinition === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted generated union requires its exact native declaration owner.");
    if (unionDefinition !== undefined) projectEmissionProducer.union(carrier, unionDefinition);
    const shape = program.structuralShapes.definitionForCarrier(carrier);
    const optionalValue = rustOptionalStorageValue(carrier);
    const optionalElement = rustOptionElementCarrier(carrier);
    const payloadView = (string: boolean): RustOptionPayloadView => string && !isRustStringCarrier(rustOptionValueCarrier(carrier))
      ? Object.freeze({ kind: "identity" }) : isRustOptionCarrier(optionalElement)
        ? Object.freeze({ kind: "nested", element: optionalElement! }) : Object.freeze({ kind: "leaf", method: string ? "as_deref" : "as_ref" });
    const optionalStorage: RustOptionalStorageEmission | undefined = isRustAbsenceCarrier(carrier) ? { kind: "unit" }
      : optionalValue !== undefined ? { kind: "custom", element: optionalValue }
      : optionalElement !== undefined ? { kind: "option", element: optionalElement }
      : union === undefined && rustRuntimeUnionContract(carrier) === undefined ? undefined
        : { kind: "union", absence: rustUnionPayloadAdmission(rustAbsenceTargetType(), carrier, program.typeDefinitions)?.path };
    const sourceStorage = rustSourceOptionalTargetType(carrier);
    const sourceOptional: RustSourceOptionalEmission = rustTargetTypeRefEquals(sourceStorage, rustOptionTargetType(carrier)) ? { kind: "identity" }
      : optionalElement !== undefined && rustTargetTypeRefEquals(sourceStorage, carrier)
        ? { kind: optionalValue === undefined ? "flatten" : "custom-flatten" }
      : isRustJsValueCarrier(carrier) ? { kind: "js-value" }
      : isRustAbsenceCarrier(carrier) || isRustUnitCarrier(carrier) ? { kind: "unit" }
      : { kind: "custom", storage: sourceStorage };
    if (sourceOptional.kind === "custom") pending.push(sourceStorage);
    const error = rustProducerErrorReference(carrier);
    const producerError = error === undefined ? undefined : program.errorRegions.producerError(error);
    if (error !== undefined && producerError === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted native producer error requires its exact closed source carrier.");
    if (union !== undefined && unionArguments === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted source union requires its exact selected native payload arguments.");
    const value: Omit<RustTypeEmission, "positions" | "constructionArguments"> = Object.freeze({ producerError, unionArguments,
      errorView: Object.freeze({ kind: isRustProgramErrorCarrier(carrier) ? "program" : isRustSourceErrorCarrier(carrier) ? "source"
        : isRustRetainedErrorCarrier(carrier) ? "retained" : isRustClosedValueCarrier(carrier) ? "closed" : "other",
        observed: rustCarrierProvidesErrorObservation(carrier, program.typeDefinitions), optional: rustOptionElementCarrier(carrier) }),
      errorStorage: isRustRetainedErrorCarrier(carrier) ? Object.freeze({ kind: "retained", writable: isRustWritableRetainedErrorCarrier(carrier),
        path: isRustWritableRetainedErrorCarrier(carrier) ? "tsonic_rust_runtime::WritableRetainedError" : "tsonic_rust_runtime::RetainedError" })
        : isRustSourceErrorCarrier(carrier) ? Object.freeze({ kind: "source", writable: isRustWritableSourceErrorCarrier(carrier),
          path: isRustWritableSourceErrorCarrier(carrier) ? "rt::WritableSourceError" : "rt::SourceError" }) : undefined,
      option: isRustOptionCarrier(carrier), anonymousOptional: rustNativeFutureCallableResult(carrier)?.optional === true, string: isRustStringCarrier(carrier),
      sharedStringReference: carrier.kind === "reference" && !carrier.mutable && isRustStringCarrier(carrier.referent),
      optionPayload: optionalElement === undefined ? undefined : Object.freeze({ str: payloadView(true), shared: payloadView(false) }),
      completion: isRustUnitCarrier(carrier) ? "unit" : rustUninhabitedError(carrier) ? "never" : "value",
      promiseObject: carrier.kind === "target-named" && carrier.id === rustJsPromiseTargetId,
      // A never value has nothing to bind: evaluating it as a statement is the discard (let _ = never is let_unit_value).
      discard: isRustNativeFutureCarrier(optionalElement ?? carrier) ? "drop" : isRustUnitCarrier(carrier) || rustUninhabitedError(carrier) ? "unit" : "value",
      optionalStorage: optionalStorage === undefined ? undefined : Object.freeze(optionalStorage), sourceOptional: Object.freeze(sourceOptional),
      emptyRecord: carrier.kind === "target-named" && carrier.id === rustEmptyObjectTargetId ? "native-empty"
        : shape?.fields.length === 0 && rustStructuralObjectCarrierValue(carrier)?.representation === "value" ? "structural" : undefined,
      // A module cell holding a runtime callable (target-named, or its emitted named-type form) names its long callable
      // type through an alias, as the checkpoint planner did for every rt::Callable cell (clippy type_complexity).
      moduleCallableAlias: carrier.kind === "target-named" && carrier.id === rustCallableTargetId ||
        rustNamedTypeCarrierValue(carrier)?.id === rustCallableTargetId,
      callArgumentInfer: carrier.kind === "target-named" && carrier.id === rustFutureTargetId,
      generic: generic === undefined || physical === undefined ? undefined : Object.freeze({ fileName: physical.definition.ownerFileName,
        name: physical.definition.targetName, arguments: rustGenericCallableStorageArguments(generic.environment, physical.arguments) }),
      structural: unionDefinition !== undefined ? Object.freeze({ ownerFileName: unionDefinition.ownerFileName,
        targetName: unionDefinition.targetName, arguments: unionArguments!, handle: false, context: undefined })
        : shape === undefined ? undefined : Object.freeze({ ownerFileName: shape.ownerFileName, targetName: shape.targetName,
          arguments: shape.stateGenericArguments, handle: rustStructuralObjectCarrierValue(carrier)?.representation !== "value" && shape.dispatchName === undefined,
          context: rustStructuralObjectCarrierValue(carrier)?.representation === "value" || shape.dispatchName !== undefined ? undefined
            : shape.fields.some(field => field.methodPlan?.kind === "fixed") ? Object.freeze({ kind: "tuple" as const,
              elements: Object.freeze(shape.fields.map(field => {
                if (field.methodPlan?.kind !== "fixed") return rustUnitTargetType();
                return field.methodPlan.context;
              })) }) : rustUnitTargetType() }) });
    const frame = program.records.frameType.get(carrier);
    const constructed = rustClassConstructorInstance(carrier);
    const definition = program.projectTypes.definitionForCarrier(carrier);
    const projection = selectRustCheckedProjectProjection({ project: definition !== undefined, structural: shape !== undefined,
      hasDispatch: shape?.dispatchName !== undefined, lifetimeParameters: definition?.genericParameters.some(parameter => parameter.kind === "lifetime") === true });
    if (projection !== undefined) projectEmissionProducer.checkedProjection(carrier, projection);
    const parents = definition === undefined ? [] : program.projectTypes.directSupertypes(carrier);
    if (parents === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native project type requires its exact checked parent carriers.", definition?.declaration);
    const state = definition === undefined ? undefined : program.records.projectClassState.get(definition, carrier);
    const fields = definition === undefined ? undefined : program.records.projectClassFields.get(definition, carrier);
    const properties = definition === undefined ? undefined : program.records.projectMethodProperties.get(definition, carrier);
    const contracts = program.records.projectInstanceContracts.get(carrier);
    const root = program.records.projectRootEmission.get(carrier);
    const dispatch = definition === undefined || closedMetadataKey(program.projectTypes.openCarrier(definition)) !== key
      ? undefined : program.records.projectDispatchEmission.get(definition);
    const rootMethodArguments = root?.contracts.flatMap(contract => contract.methods.flatMap(method =>
      [method.virtual, ...method.exact === undefined ? [] : [method.exact]].flatMap(selected => {
        const arguments_ = program.records.projectMethodArguments.get(selected.declaration, selected.variant.targetTypeArguments, carrier);
        if (arguments_ === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted root method requires its finalized receiver-specialized arguments.", selected.declaration);
        return [...selected.variant.targetTypeArguments, ...arguments_];
      }))) ?? [];
    const children = [...rustTargetTypeChildren(carrier), ...(producerError === undefined ? [] : [producerError]),
      ...(constructed === undefined ? [] : [constructed]),
      ...(unionArguments ?? []).flatMap(argument => argument.kind === "type" ? [argument.type] : []),
      ...(value.generic?.arguments ?? []).flatMap(argument => argument.kind === "type" ? [argument.type] : []),
      ...(value.structural === undefined ? [] : typeArguments(value.structural.arguments)),
      ...(value.structural?.context === undefined ? [] : [value.structural.context]),
      ...(frame?.environment ?? []), ...(frame === undefined ? [] : [frame.error]),
      ...(frame?.independentCarrier === undefined ? [] : [frame.independentCarrier]),
      ...optionalArguments, ...parents,
      ...fields?.map(field => field.carrier) ?? [],
      ...properties?.map(property => property.ownerCarrier) ?? [],
      ...state?.flatMap(layer => [layer.carrier, ...layer.fields.map(field => field.carrier),
        ...layer.methodProperties.map(property => property.ownerCarrier)]) ?? [],
      ...contracts?.map(contract => contract.carrier) ?? [],
      ...root === undefined ? [] : [...root.projections, ...root.contracts.flatMap(contract => [contract.carrier,
        ...contract.routes.map(route => route.targetCarrier), ...contract.methods.flatMap(method =>
          method.write === undefined ? [] : [method.write.property.ownerCarrier])])],
      ...rootMethodArguments,
      ...dispatch === undefined ? [] : [...dispatch.projectSupers,
        ...dispatch.structuralSupers.flatMap(supertrait => [supertrait.carrier, ...typeArguments(supertrait.genericArguments)]),
        ...dispatch.routes.map(selected => selected.route.targetCarrier),
        ...dispatch.methodWrites.map(write => write.property.ownerCarrier),
        ...dispatch.methods.flatMap(method => method.variant.targetTypeArguments)]];
    selections.set(key, { carrier, value, children, optionalArguments });
    pending.push(...children);
  }
  const positions = new Map<string, RustTypePositions>();
  const active = new Set<string>();
  const positionFor = (carrier: TargetTypeRef): RustTypePositions => {
    const key = closedMetadataKey(carrier);
    const existing = positions.get(key);
    if (existing !== undefined) return existing;
    if (active.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An admitted native type syntax graph requires finite explicit carrier structure.");
    active.add(key);
    const selected = selections.get(key);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native type requires its closed rendering metadata.");
    const argumentTypes = (arguments_: readonly RustTargetGenericArgument[] | undefined): readonly TargetTypeRef[] =>
      (arguments_ ?? []).flatMap(argument => argument.kind === "type" ? [argument.type] : []);
    const traitLegal = (trait: Extract<TargetTypeRef, { readonly kind: "trait-ref" }>, position: "parameter" | "return"): boolean =>
      argumentTypes(trait.genericArguments).every(carrier => !positionFor(carrier).opaque) && trait.associatedConstraints.every(constraint =>
        argumentTypes(constraint.genericArguments).every(carrier => !positionFor(carrier).opaque) && (constraint.kind === "equality"
          ? positionFor(constraint.type)[position] : constraint.traits.every(trait => traitLegal(trait, position))));
    let children: readonly TargetTypeRef[] = [];
    let opaque: "none" | "callable" | "input" | "explicit" = "none";
    let nested = true;
    let capturesOpaque = false;
    let boundPositions = { parameter: true, return: true };
    if (selected.value.producerError !== undefined) children = [selected.value.producerError];
    else if (selected.value.generic !== undefined) children = argumentTypes(selected.value.generic.arguments);
    else if (selected.value.structural !== undefined) children = [...argumentTypes(selected.value.structural.arguments),
      ...(selected.value.structural.context === undefined ? [] : [selected.value.structural.context])];
    else if (rustFrameCallableValue(carrier) !== undefined) children = program.records.frameType.get(carrier)?.environment ?? [];
    else if (rustClassConstructorInstance(carrier) !== undefined) children = rustTargetTypeChildren(rustClassConstructorInstance(carrier)!);
    else if (unionSource(carrier) !== undefined) children = [...argumentTypes(selected.value.unionArguments ?? rustSourceTypeCarrierValue(carrier)?.genericArguments),
      ...selected.optionalArguments];
    else if (carrier.kind === "closure") { opaque = "callable"; children = [...carrier.args, carrier.result]; }
    else if (carrier.kind === "impl-trait") {
      opaque = "explicit";
      boundPositions = { parameter: carrier.bounds.every(trait => traitLegal(trait, "parameter")), return: carrier.bounds.every(trait => traitLegal(trait, "return")) };
      capturesOpaque = argumentTypes(carrier.captures).some(carrier => positionFor(carrier).opaque);
    } else if (carrier.kind === "target-named" && carrier.id === rustCallableInputTargetId) {
      opaque = "input";
      const arguments_ = argumentTypes(carrier.genericArguments);
      const input = arguments_[0];
      const output = arguments_[1];
      boundPositions = { parameter: input !== undefined && output !== undefined && !positionFor(input).opaque && positionFor(output).parameter,
        return: input !== undefined && output !== undefined && !positionFor(input).opaque && positionFor(output).return };
    } else if (carrier.kind === "type-parameter" || carrier.kind === "source-primitive") children = [];
    else if (carrier.kind === "target-named") children = argumentTypes(carrier.genericArguments);
    else if (carrier.kind === "trait-ref") {
      children = [...argumentTypes(carrier.genericArguments), ...carrier.associatedConstraints.flatMap<TargetTypeRef>(constraint => constraint.kind === "equality" ? [constraint.type] : constraint.traits)];
      nested = false;
    } else if (carrier.kind === "function-pointer" || carrier.kind === "trait-object" || carrier.kind === "associated-type") {
      children = rustTargetTypeChildren(carrier); nested = false;
    } else {
      const named = rustNamedTypeCarrierValue(carrier);
      const array = rustFixedArrayCarrierValue(carrier);
      const joined = rustNativeErrorJoinReference(carrier);
      children = named !== undefined ? argumentTypes(named.genericArguments) : array !== undefined ? [array.element]
        : joined !== undefined ? joined.errors : rustTargetTypeChildren(carrier);
    }
    const selectedPositions = selectRustTypePositions({ carrier, children: children.map(positionFor), opaque, nested, boundPositions, capturesOpaque });
    active.delete(key);
    positions.set(key, selectedPositions);
    return selectedPositions;
  };
  const argumentGroups = (arguments_: readonly RustTargetGenericArgument[]): readonly (readonly TargetTypeRef[])[] =>
    arguments_.map(argument => argument.kind === "type" ? [argument.type] : []);
  const construction = (carrier: TargetTypeRef): readonly boolean[] | undefined => {
    const selected = selections.get(closedMetadataKey(carrier));
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native constructor requires its exact carrier rendering selection.");
    if (selected.value.producerError !== undefined) return construction(selected.value.producerError);
    let groups: readonly (readonly TargetTypeRef[])[] | undefined;
    if (selected.value.generic !== undefined) groups = argumentGroups(selected.value.generic.arguments);
    else if (selected.value.structural !== undefined) groups = selected.value.structural.handle
      ? [selected.value.structural.arguments.flatMap(argument => argument.kind === "type" ? [argument.type] : [])]
      : argumentGroups(selected.value.structural.arguments);
    else if (rustFrameCallableValue(carrier) !== undefined) {
      const frame = program.records.frameType.get(carrier);
      if (frame === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native frame constructor requires its exact environment metadata.");
      groups = [frame.environment, frame.environment];
    } else if (carrier.kind === "target-named" && carrier.id === rustCallableTargetId) {
      const arguments_ = carrier.genericArguments ?? [];
      groups = [[], arguments_[1]?.kind === "type" ? [arguments_[1].type] : [], arguments_.slice(2).flatMap(argument => argument.kind === "type" ? [argument.type] : [])];
    } else if (carrier.kind === "target-named") groups = argumentGroups(carrier.genericArguments ?? []);
    else if (carrier.kind === "array") groups = [[carrier.element]];
    else {
      const named = rustNamedTypeCarrierValue(carrier);
      const source = rustSourceTypeCarrierValue(carrier);
      if (named !== undefined) groups = argumentGroups(named.genericArguments);
      else if (source !== undefined) groups = [...argumentGroups(source.genericArguments), ...selected.optionalArguments.map(carrier => [carrier])];
      else if (selected.value.unionArguments !== undefined) groups = argumentGroups(selected.value.unionArguments);
    }
    return groups === undefined ? undefined : Object.freeze(groups.map(group => group.some(carrier => positionFor(carrier).opaque)));
  };
  for (const selected of selections.values()) producer.publish(selected.carrier, { ...selected.value,
    positions: positionFor(selected.carrier), constructionArguments: construction(selected.carrier) });
}

function unionSource(carrier: TargetTypeRef) {
  return rustSourceTypeCarrierValue(carrier) ?? rustSourceUnionCarrierValue(carrier);
}
