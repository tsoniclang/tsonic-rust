import type { Node } from "@tsonic/tsts";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import type { RustEmissionReturnDestination, RustEmissionErrorContext, RustPhysicalEmissionRole, RustEmissionCallableSpecialization } from "../../target-model/records/physical-emission-contexts.js";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "./generic-bindings.js";
import { rustCallableImplicitLifetimeParameters } from "./source-input-lifetimes.js";
import type { RustPhysicalCallableEmissionRequest } from "./physical-lifecycle.js";
import { emissionDiagnostic, rustEmissionSourceIdentity, rustEmissionIdentityBindings,
  type RustCallableEmissionPreparationInput, type RustEmissionContextRequest } from "./emission-contexts.js";
import type { RustEmissionSourceOwner } from "./emission-source-origins.js";

export function prepareRustCallableEmissionRequests(
  input: RustCallableEmissionPreparationInput,
): TargetStageResult<readonly RustEmissionContextRequest[]> {
  if (!Array.isArray(input.emissionRequests)) throw new Error("Physical emission requires its complete selecting-owner request vector.");
  if (!Array.isArray(input.helperEmissionRequests) || typeof input.declaredBindings !== "function")
    throw new Error("Physical emission requires its original pre-error-catalog helper requests and canonical binding inputs.");
  const requests: RustEmissionContextRequest[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  for (const issue of input.projectMethodDispatch.bodyIssues) if (input.isNativeNode(issue.node))
    diagnostics.push(emissionDiagnostic(issue.node, issue.reason));
  const byOwner = new Map<Node, RustPhysicalCallableEmissionRequest[]>();
  for (const demand of input.emissionRequests) {
    const demands = byOwner.get(demand.owner) ?? [];
    demands.push(demand);
    byOwner.set(demand.owner, demands);
  }
  const declaredBindings = input.declaredBindings;
  const suspendedParameters = new Map(input.suspended.implementations.map(implementation =>
    [implementation.declaration, implementation.parameters] as const));
  const bodyBindings = (declaration: Node, bindings: RustTargetGenericBindings): RustTargetGenericBindings | undefined => {
    const lexical = input.lexicalFunctions.forDeclaration(declaration);
    if (lexical?.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(declaration, lexical.reason));
      return undefined;
    }
    const captured = [...suspendedParameters.get(declaration) ?? (lexical?.genericParameters ?? []),
      ...rustCallableImplicitLifetimeParameters(declaration, input.ast, input.records)];
    const contract = input.sourceLifetimes.contractFor(declaration);
    const formal = contract?.parameters ?? [];
    const usedNames = new Set(formal.flatMap(parameter => parameter.kind === "lifetime" ? [parameter.lifetime.name] : []));
    const lifetimes = new Map(bindings.lifetimes);
    let changed = false;
    const select = (lifetime: import("../../target-model/lifetimes/model.js").RustLifetimeRef): void => {
      const key = rustLifetimeKey(lifetime);
      const existing = lifetimes.get(key);
      if (existing?.kind === lifetime.kind && "name" in existing && "name" in lifetime && existing.name === lifetime.name) return;
      lifetimes.set(key, lifetime);
      changed = true;
    };
    for (const parameter of formal) if (parameter.kind === "lifetime") select(parameter.lifetime);
    for (const parameter of captured) if (parameter.kind === "lifetime") select({
      ...parameter.lifetime, name: allocateRustGeneratedName(usedNames, parameter.lifetime.name),
    });
    return changed ? snapshotRustCallableBindings({ types: bindings.types, lifetimes, consts: bindings.consts }) : bindings;
  };
  const request = (subject: object, role: RustPhysicalEmissionRole, declaration: Node, identity: string, nativeOwnerFileName: string,
    bindings: RustTargetGenericBindings | undefined, demands: readonly RustPhysicalCallableEmissionRequest[], source: RustEmissionSourceOwner,
    sourceCarriers: readonly TargetTypeRef[],
    callableAdapterInputs: RustEmissionContextRequest["callableAdapterInputs"],
    physicalCarriers: readonly TargetTypeRef[] = [], physicalReturn: TargetTypeRef | undefined = undefined,
    specialization: RustEmissionCallableSpecialization = Object.freeze({ kind: "ordinary" })): void => {
    if (bindings !== undefined && (role === "native-body" || role === "specialized-body" || role === "project-body" || role === "body")) {
      const selected = bodyBindings(declaration, bindings);
      if (selected === undefined) return;
      bindings = selected;
    }
    if (bindings === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted native context has no exact canonical type, lifetime and const bindings."));
      return;
    }
    if (specialization.kind === "finite") {
      const parameters = input.sourceLifetimes.contractFor(declaration)?.parameters.filter(parameter => parameter.kind === "type") ?? [];
      if (parameters.length !== specialization.typeParameterIdentities.length ||
        parameters.some((parameter, index) => parameter.identity !== specialization.typeParameterIdentities[index]) ||
        new Set(specialization.typeParameterIdentities).size !== parameters.length ||
        specialization.typeParameterIdentities.some(identity => !bindings.types.has(identity))) {
        diagnostics.push(emissionDiagnostic(declaration, "A finite emitted body requires its exact original source-binder vector and selected replacements."));
        return;
      }
    }
    const returned = input.records.sourceCallableReturn.get(declaration);
    const generator = input.records.generator.get(declaration);
    const selected = returned === undefined || physicalReturn !== undefined || generator !== undefined
      ? undefined : input.nativeStorage.returnFor(declaration);
    if (selected?.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(declaration, selected.reason));
      return;
    }
    const region = input.errorRegions.get(declaration);
    if (region === undefined && input.records.errorEffects.get(declaration) !== undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted callable has no selected native error region."));
      return;
    }
    const returnDestination: RustEmissionReturnDestination = physicalReturn !== undefined
      ? Object.freeze({ kind: "value", carrier: physicalReturn, borrowedParameter: returned?.borrowedParameter })
      : generator !== undefined ? Object.freeze({ kind: "value", carrier: generator.returnType, borrowedParameter: undefined })
      : selected === undefined ? Object.freeze({ kind: "none" })
      : Object.freeze({ kind: "value", carrier: selected.carrier, borrowedParameter: returned?.borrowedParameter });
    const error: RustEmissionErrorContext<RustNativeErrorSource<TargetTypeRef>> = region === undefined ? Object.freeze({ kind: "none" })
      : Object.freeze({ kind: "region", owner: declaration, region });
    const requirements = input.declarationGenericRequirements.contractFor(declaration,
      role === "body" || role === "native-body" || role === "specialized-body" || role === "project-body" ? true : undefined);
    const required = requirements === undefined ? [] : [
      ...requirements.associatedTypes.flatMap(value => [value.carrier, ...value.output === undefined ? [] : [value.output]]),
      ...requirements.projectProjections.flatMap(value => [value.sourceCarrier, value.targetCarrier]),
      ...requirements.optionalStorage.map(value => value.carrier),
    ];
    let nativeCaptureInputs: readonly RustClosureCaptureFact["captures"][number][] = [];
    if (role === "frame") {
      const frame = input.frames.definitionForOwner(declaration);
      if (frame === undefined || subject !== frame) {
        diagnostics.push(emissionDiagnostic(declaration, "A native frame capture inventory requires its original complete frame owner."));
        return;
      }
      nativeCaptureInputs = frame.entries.flatMap(entry => entry.implementations.flatMap(implementation => implementation.captures));
    } else if (role === "native-backing") {
      const implementation = input.suspended.implementationFor(declaration);
      if (implementation === undefined || subject !== implementation) {
        diagnostics.push(emissionDiagnostic(declaration, "A suspended capture inventory requires its original selected implementation."));
        return;
      }
      nativeCaptureInputs = implementation.captures;
    } else if (source.kind === "callable" || role === "native-body" || role === "specialized-body" || role === "project-body" || role === "body") {
      const lexical = input.lexicalFunctions.forDeclaration(declaration);
      if (source.kind === "callable" || lexical === undefined) nativeCaptureInputs = input.records.closureCapture.get(declaration)?.captures ?? [];
      else if (lexical.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(declaration, lexical.reason));
        return;
      } else {
        const captures: RustClosureCaptureFact["captures"][number][] = [];
        for (const capture of lexical.captures) {
          const carrier = input.records.runtimeCarrier.get(capture.declaration)?.carrier;
          if (carrier === undefined) diagnostics.push(emissionDiagnostic(capture.reference,
            "A lexical capture requires its original declared logical carrier before native storage publication."));
          else captures.push(Object.freeze({ ...capture, carrier,
            storage: input.records.bindingStorage.get(capture.declaration)?.storage ?? "value" }));
        }
        nativeCaptureInputs = Object.freeze(captures);
      }
    }
    requests.push({ use: targetUseSiteRef(subject, role, identity), role, specialization, declaration, nativeOwnerFileName, bindings, demands, source,
      callableAdapterInputs, nativeCaptureInputs: Object.freeze([...nativeCaptureInputs]),
      returnDestination, error, sourceCarriers: [...sourceCarriers, ...required,
        ...generator === undefined ? [] : [generator.yieldType, generator.returnType, generator.nextType, generator.resultCarrier]], physicalCarriers });
  };
  for (const producer of input.nativeProducers.producers) {
    const implementation = input.generic.implementationFor(producer.declaration);
    const bindings = declaredBindings(producer.declaration);
    if (implementation?.creation === "activation") continue;
    request(producer.declaration, "native-body", producer.declaration, producer.identity, producer.fileName, bindings,
      byOwner.get(producer.declaration) ?? [], { kind: "declaration" },
      producer.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []), [],
      [input.nativeProducers.outwardReturnFor(producer.declaration), input.nativeProducers.invocationResultFor(producer.declaration),
        input.nativeProducers.bodyResultFor(producer.declaration)].filter((carrier): carrier is TargetTypeRef => carrier !== undefined));
    for (const variant of input.sourceCallableSpecializations.variantsForCallable(producer.declaration)) {
      if (bindings === undefined || variant.sourceTypeParameterIdentities.length !== variant.targetTypeArguments.length ||
        new Set(variant.sourceTypeParameterIdentities).size !== variant.sourceTypeParameterIdentities.length ||
        variant.sourceTypeParameterIdentities.some(identity => !bindings.types.has(identity))) {
        diagnostics.push(emissionDiagnostic(producer.declaration, "An emitted callable specialization requires every original declared binder exactly once."));
        continue;
      }
      const types = new Map(bindings.types);
      for (const [index, identity] of variant.sourceTypeParameterIdentities.entries()) types.set(identity, variant.targetTypeArguments[index]!);
      request(variant, "specialized-body", producer.declaration, `${producer.identity}:${variant.targetName}`,
        producer.fileName, snapshotRustCallableBindings({ types, lifetimes: bindings.lifetimes, consts: bindings.consts }),
        byOwner.get(producer.declaration) ?? [], { kind: "declaration" },
        producer.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []), [], [], undefined,
        Object.freeze({ kind: "finite", typeParameterIdentities: variant.sourceTypeParameterIdentities }));
    }
  }
  for (const body of input.projectMethodDispatch.bodies) {
    if (!input.isNativeNode(body.declaration)) continue;
    const lexical = declaredBindings(body.declaration);
    if (lexical === undefined) {
      diagnostics.push(emissionDiagnostic(body.declaration, "A concrete project body requires its original callable binding input."));
      continue;
    }
    const bindings = snapshotRustCallableBindings({
      types: new Map([...lexical.types, ...body.bindings.types]),
      lifetimes: new Map([...lexical.lifetimes, ...body.bindings.lifetimes]),
      consts: new Map([...lexical.consts, ...body.bindings.consts]),
    });
    const identity = rustEmissionSourceIdentity(input.ast, body.declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(body.declaration, "A concrete project body has no original source identity."));
      continue;
    }
    request(body, "project-body", body.declaration, `${body.concrete.targetPath}:${identity}:${body.targetName}`,
      body.concrete.fileName, bindings, byOwner.get(body.declaration) ?? [], { kind: "declaration" }, [body.ownerCarrier, ...body.targetTypeArguments], [], [], undefined,
      body.variant === undefined ? Object.freeze({ kind: "ordinary" })
        : Object.freeze({ kind: "finite", typeParameterIdentities: body.variant.sourceTypeParameterIdentities }));
  }
  for (const definition of input.generic.definitions) for (const implementation of definition.implementations) {
    const environment = input.generic.physical.environmentFor(implementation);
    if (environment === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "An emitted generic callable has no completed canonical physical environment."));
      continue;
    }
    const payloads = [...environment.captures.map(value => value.storageCarrier),
      ...environment.receiverFields.map(value => value.storageCarrier), ...environment.receivers.map(value => value.storageCarrier),
      ...environment.inputs.flatMap(value => [value.implementation, value.trait]),
      ...definition.signature.parameters, definition.signature.result];
    const identity = `${definition.identity}:${implementation.sourceFileName}:${sourceNodeIdentity(input.ast, implementation.declaration)}`;
    const source = { kind: "callable" as const, implementation: implementation.declaration, member: undefined };
    request(implementation, "helper", implementation.declaration, identity, definition.ownerFileName, environment.substitutions, [], source, payloads, []);
    if (implementation.creation === "activation") {
      request(implementation, "body", implementation.declaration, identity, definition.ownerFileName, environment.substitutions,
        byOwner.get(implementation.declaration) ?? [], source, payloads, []);
    }
  }
  for (const definition of input.generic.physical.definitions()) {
    const completion = input.genericCompletions.forDefinition(definition);
    const errors = input.genericErrors.forDefinition(definition);
    if (completion.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(definition.implementations[0]!.declaration, completion.reason));
      continue;
    }
    for (const member of definition.members) {
      const environment = input.generic.physical.environmentFor(member.implementation);
      const selectedCompletion = completion.kind === "direct" ? completion.result : completion.forMember(member)?.result;
      const selectedErrors = errors?.forMember(member);
      if (environment === undefined || selectedCompletion === undefined || selectedErrors === undefined) {
        diagnostics.push(emissionDiagnostic(member.implementation.declaration,
          "An emitted physical member has no selected environment or completion payload."));
        continue;
      }
      request(member, "member", member.implementation.declaration, definition.identity, definition.ownerFileName, member.bindings, [],
        { kind: "callable", implementation: member.implementation.declaration, member },
        [...environment.captures.map(value => value.storageCarrier), ...environment.receiverFields.map(value => value.storageCarrier),
          ...environment.receivers.map(value => value.storageCarrier), ...environment.inputs.flatMap(value => [value.implementation, value.trait]),
          ...definition.signature.parameters], [],
        [selectedCompletion, selectedErrors?.invocation?.errorType, selectedErrors?.awaiting?.errorType]
          .filter((carrier): carrier is TargetTypeRef => carrier !== undefined), selectedCompletion);
    }
  }
  for (const selected of input.native.inputs) {
    const identity = rustEmissionSourceIdentity(input.ast, selected.owner);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(selected.owner, "A native callable input has no canonical declaration identity."));
      continue;
    }
    request(selected, "native-input", selected.owner, identity, selected.protocol.ownerFileName, declaredBindings(selected.owner), [],
      { kind: "declaration" },
      [selected.carrier, selected.implementation, selected.trait, ...selected.environment,
        ...selected.protocol.method.parameters, selected.protocol.method.result], []);
  }
  for (const implementation of input.suspended.implementations) {
    const identity = rustEmissionSourceIdentity(input.ast, implementation.declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "A suspended native implementation has no canonical declaration identity."));
      continue;
    }
    request(implementation, "native-backing", implementation.declaration, identity, implementation.sourceFileName,
      declaredBindings(implementation.declaration), [], { kind: "declaration" }, [implementation.carrier, ...implementation.storage], []);
  }
  for (const frame of input.frames.definitions) {
    const declaration = frame.activation.ownerDeclaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected native frame has no canonical source owner identity."));
      continue;
    }
    const bindings = declaredBindings(declaration);
    request(frame, "frame", declaration, identity, frame.ownerFileName, bindings, [], { kind: "declaration" }, [...frame.bindings.map(value => value.carrier),
      ...frame.entries.flatMap(entry => [...entry.signature.parameters, entry.signature.result])], []);
  }
  for (const plan of input.constructions) {
    if (!input.isNativeNode(plan.definition.declaration) || input.ast.hasModifierKind(plan.definition.declaration, "abstract")) continue;
    for (const issue of plan.emission.issues) diagnostics.push(emissionDiagnostic(issue.node, issue.reason));
    const declaration = plan.definition.declaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected constructor has no canonical declaration identity."));
      continue;
    }
    request(plan, "constructor", declaration, identity, plan.definition.fileName, declaredBindings(declaration),
      [], { kind: "construction", plan, layer: undefined }, plan.fields.map(field => field.carrier), []);
    const root = input.projectTypes.openCarrier(plan.definition);
    for (const layer of plan.layers) {
      const source = layer.constructor ?? layer.definition.declaration;
      const selected = input.projectTypes.relationship(root, layer.definition);
      const carrier = selected.kind === "related" ? rustSourceTypeCarrierValue(selected.targetType) : undefined;
      const parameters: RustTargetGenericArgument[] = layer.definition.genericParameters.map(parameter => parameter.kind === "lifetime"
        ? { kind: "lifetime", lifetime: parameter.lifetime }
        : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
      const inherited = carrier === undefined ? undefined : rustGenericCallablePhysicalBindings(parameters, carrier.genericArguments);
      const lexical = declaredBindings(source);
      const bindings = inherited === undefined || lexical === undefined ? undefined : snapshotRustCallableBindings({
        types: new Map([...lexical.types, ...inherited.types]), lifetimes: new Map([...lexical.lifetimes, ...inherited.lifetimes]),
        consts: new Map([...lexical.consts, ...inherited.consts]) });
      const points = plan.points.filter(point => plan.emission.preparationFor(point.node)?.layer === layer);
      const demands = [...byOwner.get(layer.definition.declaration) ?? [],
        ...layer.constructor === undefined ? [] : byOwner.get(layer.constructor) ?? []];
      request(layer, "constructor-layer", source, identity, plan.definition.fileName, bindings, demands,
        { kind: "construction", plan, layer },
        layer.fields.map(field => field.carrier), [], points.flatMap(point =>
          plan.emission.preparationFor(point.node)?.projections.flatMap(projection => projection.kind === "receiver" ? [projection.carrier] : []) ?? []));
    }
  }
  for (const selected of input.helperEmissionRequests) {
    request(selected.subject, "helper", selected.declaration, selected.identity, selected.nativeOwnerFileName,
      selected.bindings, [], { kind: "declaration" }, selected.sourceCarriers, selected.callableAdapterInputs, [], selected.returnCarrier);
  }
  const coveredBodies = new Set(requests.flatMap(request => request.demands.map(demand => demand.owner)));
  for (const [owner, demands] of byOwner) {
    if (!input.records.sourceCallableReturn.get(owner) || input.ast.body(owner) === undefined || coveredBodies.has(owner)) continue;
    diagnostics.push(emissionDiagnostic(demands[0]!.subject,
      "An emitted callable demand requires its original selected body context before publication."));
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(requests)) : rejectedTargetStage(diagnostics);
}
