import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { targetUseSiteRef, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { IsTypeSyntaxNode, Node_Initializer, sourceClassFieldHasStorage, sourceConstructValueInputs, sourceExpressionValueInputs, type SourceValueInput } from "@tsonic/target-api/source";
import { rustLifetimeKey, type RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import type { RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";
import { type RustStructuralStorageLookup } from "../../../policy/model/operation-record-inputs.js";
import { rustSourceCallCallableStorageCarrier } from "../../../policy/operations/members/native-contracts.js";
import type { RustPhysicalEmissionSourceOccurrence } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustValueDomainCarrierHost } from "../../objects/value-domain-carriers.js";
import type { RustGenericCallablePlan } from "../generics/generic-values.js";
import type { RustFrameCallablePlan } from "../../../target-model/records/frame-callables.js";
import type { RustSuspendedCallablePlan } from "../../../target-model/records/suspended-callables.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native-producers.js";
import type { RustLexicalFunctionEnvironments } from "../../../target-model/records/lexical-functions.js";
import type { RustPhysicalCallableEmissionRequest } from "../ownership/physical-lifecycle.js";
import type { RustGenericCallableIdentitySources } from "../generics/generic-identities.js";
import { emissionDiagnostic, rustEmissionIdentityBindings, rustEmissionSourceIdentity, rustPhysicalEmissionOperationCarriers, rustPhysicalEmissionRecordCarriers } from "./emission-contexts.js";

export interface RustPhysicalCallableEmissionRequestInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly generic: RustGenericCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly native: Pick<RustNativeCallableInputPlan, "callFor">;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly structuralShapes: RustStructuralStorageLookup;
  readonly projectTypes: RustProjectTypePolicy;
  readonly carrierHost: RustValueDomainCarrierHost;
  readonly adapterFlows: readonly { readonly subject: Node; readonly conversion: RustGenericCallableConversion }[];
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly identitySources: RustGenericCallableIdentitySources;
}

export function rustEmissionDeclarationBindings(
  parameters: readonly RustTargetGenericArgument[], environment: readonly RustTargetGenericArgument[],
): RustTargetGenericBindings | undefined {
  const identity = (argument: RustTargetGenericArgument): { readonly key: string; readonly name: string } | undefined => {
    if (argument.kind === "type" && argument.type.kind === "type-parameter")
      return { key: `type\0${argument.type.identity}`, name: argument.type.name };
    if (argument.kind === "lifetime" && (argument.lifetime.kind === "parameter" || argument.lifetime.kind === "bound"))
      return { key: `lifetime\0${rustLifetimeKey(argument.lifetime)}`, name: argument.lifetime.name };
    if (argument.kind === "const" && argument.value.kind === "parameter")
      return { key: `const\0${argument.value.identity}`, name: argument.value.name };
    return undefined;
  };
  const declared = new Map<string, string>();
  for (const parameter of parameters) {
    const selected = identity(parameter);
    if (selected === undefined || declared.has(selected.key)) return undefined;
    declared.set(selected.key, selected.name);
  }
  const arguments_ = [...parameters];
  const captured = new Set<string>();
  for (const argument of environment) {
    const selected = identity(argument);
    if (selected === undefined || captured.has(selected.key)) return undefined;
    captured.add(selected.key);
    const name = declared.get(selected.key);
    if (name === undefined) arguments_.push(argument);
    else if (name !== selected.name) return undefined;
  }
  return rustEmissionIdentityBindings(arguments_);
}

export function prepareRustPhysicalCallableEmissionRequests(
  input: RustPhysicalCallableEmissionRequestInput,
): TargetStageResult<readonly RustPhysicalCallableEmissionRequest[]> {
  const { ast, records } = input;
  const requests: RustPhysicalCallableEmissionRequest[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  const storage = input.carrierHost.sourceStorage;
  if (storage === undefined) return rejectedTargetStage([{ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust",
    message: "Physical callable emission requires its exact original checked source storage.", evidence: ["target.capability=rust.callable-value.exact-implementation"] }]);
  const sourceFiles = new Set(input.sourceFiles);
  const checkedSourceFile = (node: Node): SourceFile | undefined => {
    const sourceFile = ast.getSourceFile(node);
    if (sourceFile === undefined || !sourceFiles.has(sourceFile)) {
      diagnostics.push(emissionDiagnostic(node,
        "An emitted source occurrence requires its exact checked owning SourceFile in the current source-file domain."));
      return undefined;
    }
    return sourceFile;
  };
  const contexts = new Map<Node, { readonly identity: string; readonly bindings: RustTargetGenericBindings }>();
  const constructs = new Set<Node>();
  const states = new Map<Node, Map<TargetUseSiteRef, "visiting" | "closed">>();
  const owners = new Map<Node, Node>();
  const sites = new Map<object, Map<string, TargetUseSiteRef>>();
  const requested = new Map<TargetUseSiteRef, Map<Node, Set<string | TargetTypeRef>>>();
  const sourceOccurrences = new Map<Node, RustPhysicalEmissionSourceOccurrence[]>();
  for (const occurrence of input.sourceOccurrences) {
    const selected = sourceOccurrences.get(occurrence.node) ?? [];
    selected.push(occurrence);
    sourceOccurrences.set(occurrence.node, selected);
  }
  const declared = (owner: Node) => {
    const previous = contexts.get(owner);
    if (previous !== undefined) return previous;
    const identity = rustEmissionSourceIdentity(ast, owner);
    const producer = input.nativeProducers.forDeclaration(owner);
    const definition = input.projectTypes.definitionForDeclaration(owner);
    const contract = input.sourceLifetimes.contractFor(owner);
    const parameters = definition?.genericParameters ?? contract?.parameters;
    if (identity === undefined || parameters === undefined && records.sourceCallableReturn.get(owner) !== undefined &&
      ast.typeParameters(owner).length !== 0) {
      diagnostics.push(emissionDiagnostic(owner, "An actual emitted use requires its original declaration identity and canonical generic parameter contract."));
      return undefined;
    }
    const arguments_: RustTargetGenericArgument[] = (parameters ?? []).map(parameter =>
      parameter.kind === "lifetime" ? { kind: "lifetime" as const, lifetime: parameter.lifetime }
        : { kind: "type" as const, type: { kind: "type-parameter" as const, identity: parameter.identity, name: parameter.targetName } });
    const bindings = rustEmissionDeclarationBindings(arguments_, producer?.environment ?? []);
    if (bindings === undefined) {
      diagnostics.push(emissionDiagnostic(owner, "An actual emitted use has no exact type, lifetime and const identity bindings."));
      return undefined;
    }
    const selected = Object.freeze({ identity, bindings });
    contexts.set(owner, selected);
    return selected;
  };
  const site = (owner: Node, sourceOwner: object, role: string): TargetUseSiteRef | undefined => {
    const context = declared(owner);
    if (context === undefined) return undefined;
    const uses = sites.get(sourceOwner) ?? new Map<string, TargetUseSiteRef>();
    const key = `${context.identity}:${role}`;
    let selected = uses.get(key);
    if (selected === undefined) {
      selected = targetUseSiteRef(sourceOwner, role, context.identity);
      uses.set(key, selected);
      sites.set(sourceOwner, uses);
    }
    return selected;
  };
  const request = (owner: Node, subject: Node, role: string,
    selected: { readonly kind: "value" | "operand" | "return" | "invocation" }
      | { readonly kind: "type"; readonly carrier: TargetTypeRef }
      | { readonly kind: "producer"; readonly declaration: Node; readonly carrier: TargetTypeRef }, sourceOwner: object): void => {
    const context = declared(owner);
    const use = site(owner, sourceOwner, role);
    if (context === undefined || use === undefined) return;
    const subjects = requested.get(use) ?? new Map<Node, Set<string | TargetTypeRef>>();
    const keys = subjects.get(subject) ?? new Set<string | TargetTypeRef>();
    const key = selected.kind === "type" || selected.kind === "producer" ? selected.carrier : selected.kind;
    if (keys.has(key)) return;
    keys.add(key);
    subjects.set(subject, keys);
    requested.set(use, subjects);
    requests.push(Object.freeze({ ...selected, subject, owner, bindings: context.bindings,
      context: use }));
  };
  const type = (owner: Node, subject: Node, role: string, carrier: TargetTypeRef | undefined): void => {
    if (carrier === undefined) diagnostics.push(emissionDiagnostic(subject, "An emitted declaration, member, parameter or return requires its exact selected type carrier."));
    else request(owner, subject, role, { kind: "type", carrier }, subject);
  };
  const runtime = (owner: Node, subject: Node, role: string, sourceOwner: object): void => {
    request(owner, subject, role, { kind: "value" }, sourceOwner);
    request(owner, subject, role, { kind: "operand" }, sourceOwner);
  };
  const producer = (owner: Node, subject: Node, declaration: Node, carrier: TargetTypeRef): void => {
    request(owner, subject, "native-producer", { kind: "producer", declaration, carrier }, subject);
  };
  const inputRole = (value: SourceValueInput): string => value.slot.kind +
    ("position" in value.slot ? `:${value.slot.position}` : "branch" in value.slot ? `:${value.slot.branch}`
      : "index" in value.slot ? `:${value.slot.index}` : "");
  // A location callback argument is adapted from its operand storage (location-callbacks.ts), so it requests the operand
  // as well as its value uses.
  const callback = (node: Node, owner: Node, role: string, sourceOwner: Node): void => {
    visitUse(node, owner, role, sourceOwner);
    if (input.isNativeNode(node) && records.compileTimeSource.get(node) !== true && records.nativeUnreachable.get(node) !== true)
      request(owner, node, role, { kind: "operand" }, sourceOwner);
  };
  const visitUse = (node: Node, owner: Node, role: string, sourceOwner: Node): void => {
    if (!input.isNativeNode(node) || records.compileTimeSource.get(node) === true || records.nativeUnreachable.get(node) === true) return;
    const key = site(owner, sourceOwner, role);
    if (key === undefined) return;
    const rows = states.get(node) ?? new Map<TargetUseSiteRef, "visiting" | "closed">();
    const previous = rows.get(key);
    if (previous === "closed") return;
    if (previous === "visiting" || states.size >= 262_144) {
      diagnostics.push(emissionDiagnostic(node, "Actual native emission uses require a finite acyclic source occurrence graph."));
      return;
    }
    rows.set(key, "visiting");
    states.set(node, rows);
    owners.set(node, owner);
    for (const [index, carrier] of rustPhysicalEmissionRecordCarriers(records, node).entries())
      type(owner, node, `${role}:endpoint:${index}`, carrier);
    const direct = records.directCallableReference.get(node) ?? records.sourceCallableValue.get(node);
    if (direct !== undefined && rustCallableProtocol(direct.carrier) !== undefined)
      producer(owner, node, direct.sourceDeclaration, direct.carrier);
    const operation = records.targetOperation.get(node);
    const handler = records.nativeHandler.get(node);
    const flow = records.contextualValueConversion.get(node)?.conversion;
    if (flow?.kind === "generic-callable-flow" || flow?.kind === "callable-adapter" || flow?.kind === "callable-input")
      runtime(owner, node, role, sourceOwner);
    if (operation?.kind === "source-field" && rustCallableProtocol(operation.resultCarrier) !== undefined)
      runtime(owner, node, role, sourceOwner);
    if (handler?.kind === "memory-binding") {
      const selected = handler.selection;
      if (selected.kind === "field") visitUse(selected.expression, owner, "native-memory:value", node);
      else for (const [index, field] of selected.fields.entries()) visitUse(field.expression, owner, `native-memory:field:${index}`, node);
    } else if (handler?.kind === "explicit-safety") {
      const selected = handler.selection;
      if (selected.kind === "unsafe-context" && selected.fact.kind === "expression") visitUse(selected.fact.expression, owner, "unsafe-value", node);
    } else if (handler?.kind === "native-pointer") {
      const selected = handler.selection;
      if (selected.kind === "raw-location") visitUse(selected.plan.expression, owner, "native-pointer:value", node);
      else if (selected.kind === "raw-address" || selected.kind === "raw-identity")
        for (const [index, argument] of selected.plan.arguments.entries()) visitUse(argument.expression, owner, `native-pointer:argument:${index}`, node);
      else if (selected.kind === "native-pointer") {
        visitUse(selected.operation.pointerExpression, owner, "native-pointer:location", node);
        if (selected.operation.valueExpression !== undefined) visitUse(selected.operation.valueExpression, owner, "native-pointer:value", node);
        if (selected.operation.offsetExpression !== undefined) visitUse(selected.operation.offsetExpression, owner, "native-pointer:offset", node);
      }
    } else if (handler?.kind === "typed-location") {
      const plan = handler.selection.plan;
      switch (plan.operation) {
        case "address-of": visitUse(plan.storageExpression, owner, "location:storage", node); break;
        case "allocate": visitUse(plan.initialExpression, owner, "location:initial", node); break;
        case "load": case "hash-pointer": visitUse(plan.pointerExpression, owner, "location:pointer", node); break;
        case "store":
          visitUse(plan.pointerExpression, owner, "location:pointer", node);
          visitUse(plan.valueExpression, owner, "location:value", node);
          break;
        case "equal-pointer":
          visitUse(plan.leftExpression, owner, "location:left", node);
          visitUse(plan.rightExpression, owner, "location:right", node);
          break;
        case "bind-pointer":
          visitUse(plan.identityExpression, owner, "location:identity", node);
          callback(plan.readExpression, owner, "location:read", node);
          callback(plan.writeExpression, owner, "location:write", node);
          break;
        case "view-pointer":
          visitUse(plan.pointerExpression, owner, "location:pointer", node);
          callback(plan.readExpression, owner, "location:read", node);
          callback(plan.writeExpression, owner, "location:write", node);
          break;
        case "project-pointer":
          visitUse(plan.pointerExpression, owner, "location:pointer", node);
          callback(plan.fromSourceExpression, owner, "location:from-source", node);
          callback(plan.toSourceExpression, owner, "location:to-source", node);
          break;
      }
    } else if (sourceOccurrences.has(node)) {
      for (const [ordinal, occurrence] of sourceOccurrences.get(node)!.entries()) {
        for (const [index, carrier] of rustPhysicalEmissionOperationCarriers(occurrence.operation.abi).entries())
          type(owner, node, `native-abi:${ordinal}:${index}`, carrier);
        for (const slot of occurrence.slots) {
          visitUse(slot.node, owner, slot.key, node);
          runtime(owner, slot.node, slot.key, slot);
        }
      }
    } else if (operation?.kind === "source-call") {
      const sourceFile = checkedSourceFile(node);
      if (sourceFile === undefined) {
        rows.set(key, "closed");
        return;
      }
      const checked = input.carrierHost.semantics(sourceFile).operations.call(node);
      const target = operation.target;
      if (target.form === "constructor" || target.form === "constructor-value") runtime(owner, node, role, sourceOwner);
      if (target.form === "callable" || target.form === "constructor-value") {
        const callee = checked?.sourceCallee.expression;
        if (callee === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted native callable invocation requires its original checked callee."));
        else {
          visitUse(callee, owner, "callee", node);
          if (target.form === "callable" && rustCallableProtocol(target.carrier) !== undefined &&
            input.native.callFor(node) === undefined && records.directCallableReference.get(callee) === undefined)
            request(owner, callee, "native-callable-callee", { kind: "operand" }, node);
        }
      } else if (target.form === "method" || target.form === "union-method" || target.form === "structural-method") {
        const receiver = checked?.sourceReceiver?.expression ?? checked?.sourceCalleeAccess?.receiver.expression;
        if (receiver === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source method requires its original checked receiver."));
        else {
          visitUse(receiver, owner, "receiver", node);
          if (target.form === "structural-method" &&
            input.structuralShapes.field(target.receiverCarrier, target.storageIndex)?.methodPlan?.kind === "fixed")
            request(owner, receiver, "receiver", { kind: "operand" }, node);
        }
      } else if (target.classReceiver !== undefined) visitUse(target.classReceiver, owner, "receiver", node);
      if (checked === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source call requires its original checked argument occurrences."));
      else {
        const arguments_ = ast.arguments(node);
        for (const [index, argument] of checked.sourceArguments.entries()) {
          const original = arguments_[index];
          if (original === undefined || original !== argument.expression) {
            diagnostics.push(emissionDiagnostic(node, "A physical source argument requires its identical original checked argument slot."));
            continue;
          }
          visitUse(original, owner, `argument:${index}`, node);
          runtime(owner, original, `argument:${index}`, node);
        }
      }
      const callable = rustSourceCallCallableStorageCarrier(operation, input.structuralShapes);
      // A generic callable value, or a stored (non-native) structural method slot, is invoked through its physical
      // invocation storage, which is prepared together with the other physical callable storage.
      const storedStructuralMethod = target.form === "structural-method" && callable !== undefined &&
        rustCallableProtocol(callable) !== undefined &&
        input.structuralShapes.field(target.receiverCarrier, target.storageIndex)?.methodPlan?.kind !== "native-dispatch";
      if (input.native.callFor(node) === undefined && (rustGenericCallableValue(callable) !== undefined || storedStructuralMethod))
        request(owner, node, "invocation", { kind: "invocation" }, node);
    } else if (operation?.kind === "closure") {
      const implementation = input.frames.implementationFor(node);
      const frame = input.frames.entryFor(operation.resultCarrier);
      const independent = implementation?.independent === true && frame?.hasIndependent === true && frame.implementations.includes(implementation)
        ? input.frames.independentCarrierFor(operation.resultCarrier) : undefined;
      if (implementation?.independent === true && independent === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An independent closure construction requires its completed native frame entry carrier.", node);
      const carrier = independent ?? records.receiverIndependentMethod.get(node)?.carrier ?? operation.resultCarrier;
      if (rustFrameCallableValue(carrier) === undefined && rustCallableProtocol(carrier) !== undefined)
        producer(owner, node, node, carrier);
      visitConstruct(node, node);
    } else if (operation?.kind === "record-literal") {
      if (operation.storage === "structural-object" && rustStructuralObjectCarrierValue(operation.resultCarrier)?.implementation !== undefined)
        request(owner, node, role, { kind: "value" }, sourceOwner);
      for (const [index, contribution] of operation.contributions.entries()) {
        if (contribution.kind === "property") {
          const property = contribution.property;
          const expression = ast.is.IsPropertyAssignment(property) ? ast.as.AsPropertyAssignment(property)?.Initializer : ast.name(property);
          if (expression !== undefined) visitUse(expression, owner, `member:${index}`, node);
          // A record member typed as a logical generic callable stores the physical family selected for its written value.
          const field = operation.storage === "project-object"
            ? operation.fields.find(candidate => candidate.storageIndex === contribution.targetStorageIndex) : undefined;
          const generic = rustGenericCallableValue(field?.carrier);
          if (expression !== undefined && generic !== undefined && generic.physical === undefined)
            runtime(owner, expression, `member:${index}`, node);
        } else if (contribution.kind === "structural-method" && input.structuralShapes.field(
          operation.resultCarrier, contribution.targetStorageIndex)?.methodPlan?.kind === "fixed")
          visitConstruct(contribution.expression, contribution.expression);
        else if (contribution.kind === "method" || contribution.kind === "structural-method") visitUse(contribution.expression, owner, `member:${index}`, node);
        // An accessor is a callable created where the literal is evaluated, so it is a used native producer like a method.
        else if (contribution.kind === "accessor") visitUse(contribution.property, owner, `member:${index}`, node);
        else visitUse(contribution.expression, owner, `member:${index}`, node);
      }
    } else if (operation?.kind === "provider-record-literal" || operation?.kind === "closed-record-literal") {
      for (const [index, field] of operation.fields.entries()) visitUse(field.expression, owner, `member:${index}`, node);
    } else if (operation?.kind === "native-range") {
      for (const [index, operand] of operation.operands.entries()) visitUse(operand, owner, `operand:${index}`, node);
    } else if (operation?.kind === "native-propagation" || operation?.kind === "reference-operation") {
      visitUse(operation.operandExpression, owner, "operand:only", node);
      if (operation.kind === "reference-operation" && operation.operation === "store") visitUse(operation.valueExpression, owner, "operand:right", node);
    } else if (operation?.kind === "source-static-field" || operation?.kind === "source-enum-member" ||
      operation?.kind === "source-accessor" && operation.receiver.kind === "static") {
      if (operation.kind === "source-static-field" && operation.classReceiver !== undefined) visitUse(operation.classReceiver, owner, "receiver", node);
    } else {
      if (operation?.kind === "array-literal" && rustCallableProtocol(operation.elementCarrier) !== undefined)
        request(owner, node, role, { kind: "value" }, sourceOwner);
      const children = sourceExpressionValueInputs(ast, node);
      if (children === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source value requires an admitted operation and exact source operand occurrences."));
      else for (const child of children) visitUse(child.expression, owner, inputRole(child), child.owner);
      if (input.projectTypes.definitionForDeclaration(node) !== undefined) visitConstruct(node, node);
    }
    rows.set(key, "closed");
  };
  const visitConstruct = (node: Node, owner: Node): void => {
    if (constructs.has(node) || !input.isNativeNode(node) || records.compileTimeSource.get(node) === true ||
      records.nativeUnreachable.get(node) === true || records.nativeParticipation.get(node) === "erased" || records.typeOnlyDeclaration.get(node) !== undefined) return;
    constructs.add(node);
    if (!owners.has(node)) owners.set(node, owner);
    const native = input.nativeProducers.forDeclaration(node);
    if (native !== undefined) {
      const returned = records.sourceCallableReturn.get(node);
      const generator = records.generator.get(node);
      request(node, node, "body-return", { kind: "return" }, node);
      if (generator !== undefined) for (const [index, carrier] of [generator.yieldType, generator.returnType, generator.nextType, generator.resultCarrier].entries())
        type(node, node, `generator-signature:${index}`, carrier);
      if (returned !== undefined) type(node, node, "return-type", returned.returnCarrier);
      const parameters = sourceCallableValueParameters(ast, node, storage.source.semantics.forNode(node));
      if (parameters === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted native callable requires exact checked value parameters."));
      for (const parameter of parameters ?? []) {
        const abi = records.sourceParameterAbi.get(parameter);
        type(node, parameter, "parameter-value", abi?.valueCarrier);
        type(node, parameter, "parameter-abi", abi?.parameterCarrier);
        const name = ast.name(parameter);
        if (name !== undefined && (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name))) {
          request(node, parameter, "binding", { kind: "value" }, parameter);
          visitConstruct(name, node);
        }
        for (const child of sourceConstructValueInputs(ast, parameter)) visitUse(child.expression, node, inputRole(child), child.owner);
      }
      const lexical = input.lexicalFunctions.forDeclaration(node);
      if (lexical?.kind === "unresolved") diagnostics.push(emissionDiagnostic(node, lexical.reason));
      else if (lexical?.kind === "resolved") for (const capture of lexical.captures) request(node, capture.reference, "capture", { kind: "operand" }, capture.reference);
      const body = ast.body(node);
      if (body !== undefined) {
        if (sourceExpressionValueInputs(ast, body) !== undefined) visitUse(body, node, "return", node);
        else visitConstruct(body, node);
      }
      return;
    }
    const definition = input.projectTypes.definitionForDeclaration(node);
    if (definition !== undefined) {
      type(node, node, "declaration-type", input.projectTypes.openCarrier(definition));
      for (const member of ast.members(node)) {
        if (member === undefined) continue;
        if (sourceClassFieldHasStorage(ast, member)) {
          const storageOwner = ast.hasModifierKind(member, "static") ? checkedSourceFile(member) : node;
          if (storageOwner === undefined) continue;
          type(storageOwner, member, "member-type", records.runtimeCarrier.get(member)?.carrier);
          const initializer = Node_Initializer(ast, member);
          if (initializer !== undefined) visitUse(initializer, storageOwner, "initializer", member);
        } else visitConstruct(member, member);
      }
      return;
    }
    const alias = records.typeAliasDeclaration.get(node);
    if (alias !== undefined) {
      if (alias.kind === "native-alias") type(owner, node, "alias-type", alias.target);
      else if (alias.kind === "runtime") for (const [index, variant] of alias.variants.entries()) type(owner, node, `alias-arm:${index}`, variant.carrier);
      return;
    }
    const signature = records.sourceCallableReturn.get(node);
    if (signature !== undefined) {
      type(node, node, "signature-return", signature.returnCarrier);
      const parameters = sourceCallableValueParameters(ast, node, storage.source.semantics.forNode(node));
      if (parameters === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted signature requires exact checked value parameters."));
      for (const parameter of parameters ?? []) {
        const abi = records.sourceParameterAbi.get(parameter);
        type(node, parameter, "signature-parameter-value", abi?.valueCarrier);
        type(node, parameter, "signature-parameter-abi", abi?.parameterCarrier);
      }
      return;
    }
    if (IsTypeSyntaxNode(ast, node) || ast.is.IsTypeLiteralNode(node)) return;
    if (ast.is.IsVariableDeclaration(node)) {
      const initializer = Node_Initializer(ast, node);
      if (records.moduleBinding.get(node)?.storage !== "native-callable" &&
        (initializer === undefined || input.lexicalFunctions.forDeclaration(initializer) === undefined))
        request(owner, node, "binding", { kind: "value" }, node);
    }
    if (ast.is.IsBindingElement(node) && "bindingCarrier" in (records.bindingProjection.get(node) ?? {}))
      request(owner, node, "binding", { kind: "value" }, node);
    const operation = records.targetOperation.get(node);
    if (operation?.kind === "iteration") {
      type(owner, node, "iteration-element", operation.elementCarrier);
      if (operation.iterationKind === "for-in") type(owner, node, "iteration-input", operation.iterableCarrier);
    }
    const roots = sourceConstructValueInputs(ast, node);
    for (const root of roots) {
      visitUse(root.expression, owner, inputRole(root), root.owner);
      if (ast.is.IsBindingElement(node) && root.slot.kind === "default" ||
        ast.is.IsExportAssignment(node) && root.slot.kind === "initializer")
        request(owner, root.expression, inputRole(root), { kind: "value" }, root.owner);
    }
    const expressions = new Set(roots.map(root => root.expression));
    ast.forEachChild(node, child => {
      if (child !== undefined && !expressions.has(child) && sourceExpressionValueInputs(ast, child) === undefined &&
        !IsTypeSyntaxNode(ast, child) && !ast.is.IsTypeLiteralNode(child)) visitConstruct(child, owner);
    });
  };
  for (const file of input.sourceFiles) visitConstruct(file, file);
  for (const producer of input.nativeProducers.producers) visitConstruct(producer.declaration, producer.declaration);
  for (const definition of input.generic.definitions) for (const implementation of definition.implementations) {
    const owner = owners.get(implementation.declaration);
    if (owner === undefined) diagnostics.push(emissionDiagnostic(implementation.declaration, "A selected generic implementation requires its exact emitted creation owner."));
    else request(owner, implementation.declaration, "generic-implementation", { kind: "operand" }, implementation.declaration);
    if (rustCallableProtocol(implementation.carrier) !== undefined) producer(implementation.declaration,
      implementation.declaration, implementation.declaration, implementation.carrier);
  }
  for (const implementation of input.suspended.implementations) if (rustCallableProtocol(implementation.carrier) !== undefined)
    producer(implementation.declaration, implementation.declaration, implementation.declaration, implementation.carrier);
  for (const flow of input.adapterFlows) {
    const owner = owners.get(flow.subject);
    if (owner === undefined) diagnostics.push(emissionDiagnostic(flow.subject, "A selected callable flow requires its actual emitted source owner before physical admission."));
    else runtime(owner, flow.subject, "callable-flow", flow.subject);
  }
  for (const comparison of input.identitySources.comparisons) {
    const owner = owners.get(comparison.node);
    if (owner === undefined) diagnostics.push(emissionDiagnostic(comparison.node, "A selected callable comparison requires its actual emitted source owner."));
    else for (const [role, subject] of [["left", comparison.leftNode], ["right", comparison.rightNode]] as const) {
      if (subject === undefined) diagnostics.push(emissionDiagnostic(comparison.node, "A selected callable comparison requires both original checked operands."));
      else request(owner, subject, `callable-identity:${role}`, { kind: "value" }, comparison.node);
    }
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(requests)) : rejectedTargetStage(diagnostics);
}
