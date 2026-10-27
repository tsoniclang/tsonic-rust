import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { isSourceCallableBodyBoundary, Node_Initializer, sourceDeclarationIsModuleScoped, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { SourceOwnershipUnresolved } from "@tsonic/target-api/analysis";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustCallableEntryConstruction } from "./entry-parameters.js";
import type { RustCallableEntryHeaderPlacement, RustCallableEntryHeaderSelection, RustCallableEntryHeaderVariant } from "../../../target-model/records/callable-entry-headers.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceGenericParameterContract } from "../../../target-model/lifetimes/model.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustClassImplementationContextConstruction } from "../../objects/class-implementation-contexts.js";
import type { prepareRustProjectGenericMembership } from "../../project-types/generic-membership.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustGenericCallablePlan } from "../generics/generic-values.js";
import type { RustNativeCallableEntry } from "../../../target-model/records/declaration-emission.js";

export function createRustCallableEntryHeaderPlacements(input: {
  readonly program: Pick<RustAnalysisProgram, "promiseBodies" | "projectTypes" | "sourceCallableSpecializations" | "names"> & {
    readonly source: Pick<RustAnalysisProgram["source"], "ast">;
    readonly records: RustProgramRecords;
    readonly callableValues: Pick<RustAnalysisProgram["callableValues"], "frames"> & {
      readonly generic: Pick<RustGenericCallablePlan, "implementationFor">;
    };
  };
  readonly entries: Pick<RustCallableEntryConstruction, "get" | "selectHeader">;
  readonly classContexts: Pick<RustClassImplementationContextConstruction, "forInstance">;
  readonly memberships: ReturnType<typeof prepareRustProjectGenericMembership>;
}) {
  const { program, entries } = input;
  const { ast } = program.source;
  const empty: RustTargetGenericBindings = { types: new Map(), lifetimes: new Map(), consts: new Map() };
  const parameterArgument = (parameter: RustSourceGenericParameterContract): RustTargetGenericArgument => parameter.kind === "type"
    ? { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } }
    : { kind: "lifetime", lifetime: parameter.lifetime };
  const projectArguments = (definition: RustProjectTypeDefinition, indexes: readonly number[]) => {
    const selected = input.memberships.forDeclaration(definition, indexes);
    return [...selected.parameters.map(entry => parameterArgument(entry.parameter)),
      ...selected.optionalStorage.map(entry => ({ kind: "type" as const, type: entry.carrier }))];
  };
  const specialization = (variant: RustCallableEntryHeaderVariant | undefined, arguments_ = variant?.targetTypeArguments) => {
    if (variant === undefined) return undefined;
    if (arguments_?.length !== variant.sourceTypeParameterIdentities.length)
      failTargetAnalysisInvariant("tsonic-rust", "A selected native header requires its exact specialization argument vector.", variant.declaration);
    return new Map(variant.sourceTypeParameterIdentities.map((identity, index) => [identity, arguments_[index]!]));
  };
  const select = (declaration: Node, placement: RustCallableEntryHeaderPlacement,
    variant: RustCallableEntryHeaderVariant | undefined, parent: RustCallableEntryHeaderSelection | undefined,
    inherited: RustTargetGenericBindings, ownerLifetimes: ReadonlySet<string>,
    enclosingArguments: readonly RustTargetGenericArgument[], capturedParameters = program.records.lexicalFunction.get(declaration)?.genericParameters ?? [],
    arguments_ = variant?.targetTypeArguments, finalArguments?: readonly RustTargetGenericArgument[],
    trailingArguments: readonly RustTargetGenericArgument[] = [], traverse = true) => {
    const selected = entries.selectHeader(declaration, placement, variant, parent, { inherited, ownerLifetimes,
      enclosingArguments, trailingArguments, capturedParameters, specialization: specialization(variant, arguments_), finalArguments,
      splitBody: program.promiseBodies.declarations.has(declaration) });
    if (traverse) visitBody(declaration, selected.body, selected.body, selected.body.bindings);
    return selected;
  };
  const selectModule = (declaration: Node, variant: RustCallableEntryHeaderVariant | undefined, traverse = true) => {
    const file = ast.getSourceFile(declaration);
    if (file === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native module entry requires its original source file.", declaration);
    return select(declaration, file, variant, undefined, empty, new Set(), [], undefined, undefined, undefined, [], traverse);
  };
  const selectClassMember = (declaration: Node, definition: RustProjectTypeDefinition,
    variant: RustCallableEntryHeaderVariant | undefined, traverse = true) => {
    const ownerLifetimes = new Set(definition.genericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
    const staticSlot = program.projectTypes.memberSlotName(declaration, "static");
    const environment = entries.get(declaration)?.nativeEntry.direct?.body.slots.find(slot => slot.kind === "class-environment");
    const trailing = staticSlot === undefined || environment === undefined ? []
      : projectArguments(definition, environment.genericParameterIndexes);
    return select(declaration, definition.declaration, variant, undefined, empty, ownerLifetimes,
      staticSlot === undefined ? projectArguments(definition, definition.genericParameters.map((_, index) => index)) : [],
      [], undefined, undefined, trailing, traverse);
  };
  const nativeBody = (declaration: Node, variant: RustCallableEntryHeaderVariant | undefined,
    enter: () => boolean, active = new Set<Node>()): SourceOwnershipUnresolved | {
      readonly kind: "resolved"; readonly entry: RustNativeCallableEntry; readonly header: RustCallableEntryHeaderSelection;
    } => {
    const unresolved = (reason: string): SourceOwnershipUnresolved => ({ kind: "unresolved", at: declaration, reason });
    if (!enter() || active.has(declaration)) return unresolved("A native pending entry requires a finite complete original header placement.");
    if (program.sourceCallableSpecializations.requiresSpecialization(declaration) && variant === undefined ||
      variant !== undefined && (variant.declaration !== declaration ||
        !program.sourceCallableSpecializations.variantsForCallable(declaration).some(registered => registered === variant)))
      return unresolved("A native pending entry requires its exact registered original specialization variant.");
    const entry = entries.get(declaration);
    if (entry?.genericHeader === undefined || entry.nativeEntry.direct === undefined)
      return unresolved("A native pending entry requires its completed original direct physical ABI.");
    active.add(declaration);
    try {
      const parent = ast.parent(declaration);
      const owner = program.projectTypes.definitionContainingDeclaration(declaration);
      if (owner?.kind === "class" && parent === owner.declaration) {
        if (program.projectTypes.isPolymorphic(owner) && !ast.hasModifierKind(declaration, "static"))
          return unresolved("A rooted native pending entry requires its exact original implementation placement and variant.");
        return { kind: "resolved", entry: entry.nativeEntry.direct.body,
          header: selectClassMember(declaration, owner, variant, false).body };
      }
      if (ast.is.IsMethodDeclaration(declaration) || ast.is.IsGetAccessorDeclaration(declaration) || ast.is.IsSetAccessorDeclaration(declaration))
        return unresolved("A structural native pending entry requires its exact canonical owner and field placement.");
      const binding = parent === undefined ? undefined : program.records.moduleBinding.get(parent);
      if (sourceDeclarationIsModuleScoped(declaration, ast) ||
        binding?.storage === "native-callable" && binding.callableDeclaration === declaration)
        return { kind: "resolved", entry: entry.nativeEntry.direct.body, header: selectModule(declaration, variant, false).body };
      let enclosing = sourceEnclosingCallable(parent, ast);
      while (enclosing !== undefined) {
        if (!enter()) return unresolved("A native pending entry exhausted its original parent header budget.");
        const enclosingEntry = entries.get(enclosing);
        const frame = program.callableValues.frames.implementationFor(enclosing);
        const generic = program.callableValues.generic.implementationFor(enclosing);
        let header: RustCallableEntryHeaderSelection | undefined;
        if (frame !== undefined && !frame.independent) {
          const selected = enclosingEntry?.frameEntries.get(frame);
          if (selected === undefined) return unresolved("A native pending entry requires its identical parent frame implementation.");
          header = select(enclosing, frame, undefined, undefined, empty, new Set(), [], undefined, undefined,
            selected.type.definition.environmentParameters.map(type => ({ kind: "type", type })), [], false).body;
        } else if (generic !== undefined && enclosingEntry?.genericEntries.get(generic)?.helper === true) {
          const selected = enclosingEntry.genericEntries.get(generic)!;
          header = select(enclosing, generic, undefined, undefined, selected.environment.substitutions,
            new Set(), selected.arguments, undefined, undefined, undefined, [], false).body;
        } else if (ast.is.IsFunctionDeclaration(enclosing) || program.records.lexicalFunction.get(enclosing) !== undefined ||
          ast.is.IsMethodDeclaration(enclosing) || ast.is.IsGetAccessorDeclaration(enclosing) || ast.is.IsSetAccessorDeclaration(enclosing)) {
          if (program.sourceCallableSpecializations.requiresSpecialization(enclosing))
            return unresolved("A native pending lexical entry requires its actual specialized parent body placement.");
          const selected = nativeBody(enclosing, undefined, enter, active);
          if (selected.kind === "unresolved") return selected;
          header = selected.header;
        }
        if (header !== undefined) return { kind: "resolved", entry: entry.nativeEntry.direct.body,
          header: select(declaration, header, variant, header, header.bindings, new Set(), [], undefined,
            undefined, undefined, [], false).body };
        enclosing = sourceEnclosingCallable(ast.parent(enclosing), ast);
      }
      const scope = program.names.sourceScopeForDeclaration(declaration);
      const file = ast.getSourceFile(declaration);
      if (scope !== undefined && scope === file)
        return { kind: "resolved", entry: entry.nativeEntry.direct.body, header: selectModule(declaration, variant, false).body };
      return unresolved("A native pending entry requires its exact admitted emitted source scope or construction placement.");
    } finally {
      active.delete(declaration);
    }
  };
  const visited = new Map<RustCallableEntryHeaderPlacement, Set<Node>>();
  const visitBody = (declaration: Node, placement: RustCallableEntryHeaderPlacement,
    parent: RustCallableEntryHeaderSelection | undefined, inherited: RustTargetGenericBindings,
    roots?: readonly Node[]): void => {
    let nodes = visited.get(placement);
    if (nodes === undefined) { nodes = new Set(); visited.set(placement, nodes); }
    if (nodes.has(declaration)) return;
    nodes.add(declaration);
    const visit = (node: Node): void => {
      if (ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node)) return;
      const local = program.records.localBinding.get(node);
      if (local?.kind === "function") {
        select(local.initializer, placement, undefined, parent, inherited, new Set(), []);
        return;
      }
      if (node !== declaration && ast.is.IsFunctionDeclaration(node)) {
        const emitted = program.records.callableDeclaration.get(node);
        if (emitted !== undefined) for (const variant of emitted.requiresSpecialization ? emitted.specializations : [undefined])
          select(node, placement, variant, parent, inherited, new Set(), []);
        return;
      }
      if (ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node)) return;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    const callable = isSourceCallableBodyBoundary(ast, declaration);
    const body = callable ? ast.body(declaration) : undefined;
    for (const root of roots ?? (callable ? body === undefined ? [] : [body] : [declaration])) visit(root);
    if (!callable) return;
    for (const parameter of ast.parameters(declaration)) {
      if (parameter === undefined) continue;
      const initializer = Node_Initializer(ast, parameter);
      if (initializer !== undefined) visit(initializer);
    }
  };
  const module = (file: SourceFile): void => {
    const visit = (node: Node): void => {
      if (ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node)) return;
      const local = program.records.localBinding.get(node);
      if (local?.kind === "function") {
        selectModule(local.initializer, undefined);
        return;
      }
      const binding = program.records.moduleBinding.get(node);
      if (binding?.storage === "native-callable" && binding.callableDeclaration !== undefined) {
        const declaration = binding.callableDeclaration;
        const emitted = program.records.callableDeclaration.get(declaration);
        if (emitted !== undefined) for (const variant of emitted.requiresSpecialization ? emitted.specializations : [undefined])
          selectModule(declaration, variant);
        return;
      }
      if (ast.is.IsFunctionDeclaration(node)) {
        const declaration = program.records.callableDeclaration.get(node);
        if (declaration !== undefined) for (const variant of declaration.requiresSpecialization ? declaration.specializations : [undefined])
          selectModule(node, variant);
        return;
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const node of ast.statements(file)) if (node !== undefined) visit(node);
    for (const definition of program.projectTypes.definitions) {
      if (definition.sourceFile !== file || program.records.classDeclaration.get(definition.declaration) === undefined) continue;
      const initialization = program.records.classInitialization.get(definition.declaration);
      if (initialization === undefined) failTargetAnalysisInvariant("tsonic-rust", "An emitted class requires its exact module initialization inventory.", definition.declaration);
      for (const selected of initialization) visit(selected.kind === "block" ? selected.body : selected.initializer);
    }
    for (const request of program.records.objectLiteralEmissions.get(file) ?? []) {
      if (request.kind === "project" || request.selection.shape.dispatchName !== undefined) continue;
      const shape = request.selection.shape;
      const types = new Map<string, TargetTypeRef>();
      for (const parameter of shape.stateGenericParameters) if (parameter.kind === "type")
        types.set(parameter.identity, { kind: "type-parameter", identity: parameter.identity, name: parameter.name });
      const lifetimes = new Set(shape.stateGenericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
      const enclosing = shape.stateGenericParameters.map((parameter): RustTargetGenericArgument => parameter.kind === "type"
        ? { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.name } }
        : { kind: "lifetime", lifetime: parameter.lifetime });
      for (const field of shape.fields) if (field.methodPlan?.kind === "fixed")
        select(field.methodPlan.declaration, field, undefined, undefined, { ...empty, types }, lifetimes, enclosing);
    }
    for (const implementation of program.records.genericDeclarations.get(file)?.implementations ?? []) {
      const entry = entries.get(implementation.declaration)?.genericEntries.get(implementation);
      if (entry?.helper) select(implementation.declaration, implementation, undefined, undefined,
        entry.environment.substitutions, new Set(), entry.arguments);
    }
    for (const definition of program.callableValues.frames.definitions) {
      if (ast.getSourceFile(definition.activation.ownerDeclaration) !== file) continue;
      for (const entry of definition.entries) for (const implementation of entry.implementations) {
        if (implementation.independent) continue;
        select(implementation.declaration, implementation, undefined, undefined, empty, new Set(), [], undefined, undefined,
          definition.environmentParameters.map(type => ({ kind: "type", type })));
      }
    }
    for (const implementation of program.records.suspendedDeclarations.get(file) ?? [])
      select(implementation.declaration, implementation, undefined, undefined, empty, new Set(),
        implementation.elision === undefined ? [] : [{ kind: "lifetime", lifetime: implementation.elision.lifetime }], implementation.parameters);
  };
  return Object.freeze({ module, nativeBody,
    directClass(definition: RustProjectTypeDefinition): void {
      if (definition.kind !== "class" || program.records.classDeclaration.get(definition.declaration) === undefined) return;
      for (const member of ast.members(definition.declaration)) {
        if (member === undefined) continue;
        if (ast.is.IsConstructorDeclaration(member)) {
          visitBody(member, definition.declaration, undefined, empty, []);
          continue;
        }
        const method = program.records.methodDeclaration.get(member);
        if (method?.kind !== "body") continue;
        if (program.projectTypes.isPolymorphic(definition) && !method.isStatic) continue;
        for (const variant of method.variants) {
          const selected = nativeBody(member, variant.specialization, () => true);
          if (selected.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust",
            "An admitted direct class method requires its identical native body header placement.", member);
          visitBody(member, selected.header, selected.header, selected.header.bindings);
        }
      }
      const construction = program.records.classConstruction.get(definition.declaration);
      if (construction === undefined) return;
      const polymorphic = program.projectTypes.isPolymorphic(definition);
      const state = polymorphic ? program.records.projectClassState.get(definition, program.projectTypes.openCarrier(definition)) : undefined;
      for (const layer of construction.layers) {
        if (!polymorphic && layer.definition !== definition) continue;
        const carrier = state?.find(candidate => candidate.definition === layer.definition)?.carrier;
        const context = carrier === undefined ? undefined : input.classContexts.forInstance(layer.definition, carrier);
        if (polymorphic && context === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native constructor header requires its exact declaring layer correspondence.", layer.definition.declaration);
        const inherited: RustTargetGenericBindings = context === undefined ? empty
          : { types: context.types, lifetimes: context.lifetimes, consts: empty.consts };
        visitBody(layer.constructor ?? layer.definition.declaration, layer, undefined, inherited,
          [...layer.fields.flatMap(field => field.initializer === undefined ? [] : [field.initializer]), ...layer.statements]);
      }
    },
    root(definition: RustProjectTypeDefinition, carrier: TargetTypeRef): void {
      const root = program.records.projectRootEmission.get(carrier);
      const rootContext = input.classContexts.forInstance(definition, carrier);
      if (root === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native root header requires its selected physical implementation.", definition.declaration);
      const enclosing = projectArguments(definition, definition.genericParameters.map((_, index) => index));
      const method = (declaration: Node, variant: RustCallableEntryHeaderVariant | undefined) => {
        const owner = program.records.projectMemberOwner.get(declaration);
        const relationship = owner === undefined ? undefined : program.records.projectRelationship.get(carrier, owner);
        if (owner === undefined || relationship === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native method header requires its original declaring-owner carrier.", declaration);
        const context = input.classContexts.forInstance(owner, relationship);
        const arguments_ = variant === undefined ? undefined : program.records.projectMethodArguments.get(declaration, variant.targetTypeArguments, carrier);
        if (variant !== undefined && arguments_ === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native method header requires its receiver-instantiated arguments.", declaration);
        select(declaration, rootContext, variant, undefined, { types: context.types, lifetimes: context.lifetimes, consts: empty.consts },
          new Set(owner.genericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : [])), enclosing, [], arguments_);
      };
      for (const contract of root.contracts) {
        for (const field of contract.fields.values()) if (field.implementation.kind === "accessor") {
          method(field.implementation.getter, undefined);
          if (field.dispatch.write !== undefined && field.implementation.setter !== undefined) method(field.implementation.setter, undefined);
        }
        for (const accessor of contract.accessors) method(accessor.implementation, undefined);
        for (const selected of contract.methods) {
          method(selected.virtual.declaration, selected.virtual.variant);
          if (program.records.projectForwarder.get(selected.member, selected.virtual.declaration) === "direct")
            method(selected.virtual.declaration, selected.variant);
          if (selected.exact !== undefined) method(selected.exact.declaration, selected.exact.variant);
        }
      }
    },
  });
}
