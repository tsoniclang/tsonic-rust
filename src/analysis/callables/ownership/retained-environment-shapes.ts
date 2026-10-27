import type { Node } from "@tsonic/tsts";
import { defaultSourceStorageLimits, createSourceStorageBudget, createSourceCallableRetentionQuery,
  type SourceStorageBindings, type SourceStorageProjection, type SourceStorageSubject,
  type SourceNativeTaskGraph } from "@tsonic/target-api/analysis";
import { Node_Initializer, sourceLexicalEnvironment,
  sourceNodeIdentity, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../../../policy/model/context.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/callables/retained-environments.js";
import type { RustRetainedEnvironmentSelection } from "../../../target-model/records/callables/retained-environments.js";

type RustRetainedEnvironmentHost = Pick<RustSourcePolicyContext, "source" | "sourceStorage" | "sourceLifetimes"> & {
  readonly nativeTasks: SourceNativeTaskGraph;
};
import type { RustRetainedEnvironmentQueries, RustRetainedLexicalSelection } from "../../../target-model/records/callables/retained-environments.js";

export function createRustRetainedEnvironmentQueries(
  input: RustRetainedEnvironmentHost, maximumSteps = defaultSourceStorageLimits.maximumSteps,
): RustRetainedEnvironmentQueries {
  const { ast, navigation } = input.source;
  const storage = input.sourceStorage;
  const environments = new Map<Node, RustRetainedEnvironmentSelection>();
  const suspended = new Map<Node, readonly Node[]>();
  const lexical = new Map<Node, RustRetainedLexicalSelection>();
  const taskOwners = new Set(input.nativeTasks.owners);
  const callableRetention = createSourceCallableRetentionQuery({ source: input.source, storage,
    budget: createSourceStorageBudget({ ...defaultSourceStorageLimits, maximumSteps }) });
  let opaqueInvocations: ReadonlySet<Node> | undefined;
  let remaining = Number.isSafeInteger(maximumSteps) && maximumSteps > 0 ? maximumSteps : 0;
  const step = (): boolean => remaining > 0 && --remaining >= 0;
  const unresolved = (reason = "Retained native environments require exact declaration-owned storage within the finite source work budget.") =>
    Object.freeze({ kind: "unresolved" as const, reason });
  const none = Object.freeze({ kind: "none" as const });
  const suspendedParametersFor = (declaration: Node): readonly Node[] | undefined => {
    const cached = suspended.get(declaration);
    if (cached !== undefined) return cached;
    if (!step()) return undefined;
    const retained: Node[] = [];
    const parameters = sourceCallableValueParameters(ast, declaration, input.source.semantics.forNode(declaration));
    if (parameters === undefined) return undefined;
    for (const parameter of parameters) {
      if (!step() || parameter === undefined) return undefined;
      const uses = navigation.parameterUseSummary(parameter);
      if (uses === undefined) return undefined;
      let used = false;
      for (const use of uses.uses) {
        if (!step()) return undefined;
        if (use.kind !== "type-only" && use.role !== "type-only") used = true;
      }
      if (used) retained.push(parameter);
    }
    const result = Object.freeze(retained);
    suspended.set(declaration, result);
    return result;
  };
  const lexicalFor = (declaration: Node): RustRetainedLexicalSelection => {
    const cached = lexical.get(declaration);
    if (cached !== undefined) return cached;
    const body = ast.body(declaration);
    if (!step() || body === undefined) return unresolved();
    const roots = [...ast.parameters(declaration).flatMap(parameter => {
      const initializer = parameter === undefined ? undefined : Node_Initializer(ast, parameter);
      return initializer === undefined ? [] : [initializer];
    }), body];
    const selected = sourceLexicalEnvironment(declaration, roots, ast, navigation, "source");
    if (selected.kind !== "unresolved") lexical.set(declaration, selected);
    return selected;
  };
  const ownership = new Map<Node, ReturnType<RustRetainedEnvironmentQueries["inputsFor"]>>();
  // A declared class or interface result is a nominal native record without lifetime parameters: storage it retains
  // from the inputs is owned by the record, so those inputs are 'static rather than an environment lifetime.
  const returnsNominalRecord = (declaration: Node): boolean => {
    const semantics = input.source.semantics.forNode(declaration);
    const result = semantics.types.declarationSignatureInfo(declaration)?.returnType;
    const symbol = result === undefined ? undefined
      : semantics.declarations.typeSymbol(semantics.types.nonNullableType(result) ?? result);
    const declarations = symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol);
    return declarations.length !== 0 && declarations.every((node: Node) =>
      ast.is.IsInterfaceDeclaration(node) || ast.is.IsClassDeclaration(node));
  };
  const inputsFor = (declaration: Node): ReturnType<RustRetainedEnvironmentQueries["inputsFor"]> => {
    const cached = ownership.get(declaration);
    if (cached !== undefined) return cached;
    const retention = isSuspended(declaration) ? callableRetention.forDeclaration(declaration) : undefined;
    const selected = retention?.kind === "unresolved" ? unresolved(retention.reason)
      : Object.freeze({ kind: "resolved" as const,
        ownership: (retention === undefined ? returnsNominalRecord(declaration)
          : retention.retention === "retained") ? "owned" as const : "borrowed" as const });
    if (selected.kind !== "unresolved") ownership.set(declaration, selected);
    return selected;
  };
  const isSuspended = (declaration: Node): boolean => ast.hasModifierKind(declaration, "async") ||
    input.source.semantics.forNode(declaration).operations.generator(declaration) !== undefined;
  // A call to a suspended source implementation keeps that implementation's suspended parameters in its result
  // (the Promise or generator), bound at the invocation's activation. "not-suspended" leaves the value to the
  // structural walk.
  type SuspendedInputs = { readonly kind: "not-suspended" } | { readonly kind: "unresolved" } |
    { readonly kind: "inputs"; readonly inputs: readonly { subject: SourceStorageSubject; bindings: SourceStorageBindings }[] };
  const suspendedCallInputs = (subject: SourceStorageSubject, bindings: SourceStorageBindings): SuspendedInputs => {
    const node = subject.node;
    if (subject.kind !== "value" || subject.projection.length !== 0 || !ast.is.IsCallExpression(node))
      return { kind: "not-suspended" };
    const semantics = input.source.semantics.forNode(node);
    const call = semantics.operations.call(node);
    const selected = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
    const implementation = selected === undefined ? undefined : navigation.callableImplementation(selected);
    if (implementation?.kind !== "resolved") return { kind: "not-suspended" };
    const owner = implementation.implementation.declaration;
    if (!isSuspended(owner)) return { kind: "not-suspended" };
    const activation = storage.bindingsForInvocation(owner, node, bindings);
    const parameters = suspendedParametersFor(owner);
    if (activation.kind !== "resolved" || parameters === undefined) return { kind: "unresolved" };
    const inputs: { subject: SourceStorageSubject; bindings: SourceStorageBindings }[] = [];
    for (const parameter of parameters) {
      if (!step()) return { kind: "unresolved" };
      const selectedInput = storage.subject(parameter, "input");
      if (selectedInput.kind !== "resolved") return { kind: "unresolved" };
      inputs.push({ subject: selectedInput.subject, bindings: activation.bindings });
    }
    return { kind: "inputs", inputs };
  };
  const select = (declaration: Node): RustRetainedEnvironmentSelection => {
    if (!step()) return unresolved();
    if (ast.body(declaration) === undefined) return none;
    const parameters = sourceCallableValueParameters(ast, declaration, input.source.semantics.forNode(declaration));
    if (parameters === undefined) return unresolved();
    const candidates = new Set(parameters);
    const retained = new Set<Node>();
    if (isSuspended(declaration)) {
      const selected = suspendedParametersFor(declaration);
      if (selected === undefined) return unresolved();
      selected.forEach(parameter => retained.add(parameter));
    } else {
      const subject = storage.subject(declaration, ast.is.IsConstructorDeclaration(declaration) ? "receiver" : "return");
      const bindings = storage.bindingsForLexicalOwner(declaration);
      if (subject.kind !== "resolved" || bindings.kind !== "resolved") return unresolved();
      const returned = storage.typeFor(subject.subject);
      if (returned.kind === "unresolved") return unresolved(returned.reason);
      const resultTypes = input.source.semantics.forFile(returned.sourceFile).types;
      const resultType = resultTypes.nonNullableType(returned.type);
      if (resultType !== undefined && (resultTypes.isNever(resultType) || resultTypes.isVoidLike(resultType) ||
        resultTypes.isNullish(resultType) || resultTypes.isStringLike(resultType) || resultTypes.isNumberLike(resultType) ||
        resultTypes.isBooleanLike(resultType) || resultTypes.isBigIntLike(resultType) || resultTypes.isSymbolLike(resultType))) return none;
      const producers = storage.storageProducersFor(subject.subject, bindings.bindings);
      if (producers.kind === "unresolved") return unresolved(producers.reason);
      const visited = new Map<SourceStorageSubject, Set<SourceStorageBindings>>();
      const retain = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
        const pending = [{ subject, bindings }];
        const components = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
          if (!step()) return false;
          if (opaqueInvocations === undefined) {
            const invocations = new Set<Node>();
            for (const boundary of storage.boundaries) {
              if (!step()) return false;
              if (boundary.kind === "opaque-invocation") invocations.add(boundary.invocation);
            }
            opaqueInvocations = invocations;
          }
          if (opaqueInvocations.has(subject.node)) return true;
          const selected = storage.typeFor(subject);
          if (selected.kind === "unresolved") return false;
          const semantics = input.source.semantics.forFile(selected.sourceFile);
          const types = semantics.types;
          const type = types.nonNullableType(selected.type);
          if (type === undefined) return false;
          if (types.isNullish(type) || types.isNever(type) || types.isVoidLike(type) ||
            types.isStringLike(type) || types.isNumberLike(type) || types.isBooleanLike(type) ||
            types.isBigIntLike(type) || types.isSymbolLike(type) || types.callSignatures(type).length !== 0) return true;
          if (types.isAny(type) || types.isUnknown(type)) return false;
          const projections: SourceStorageProjection[] = [];
          if (types.isTuple(type)) {
            for (const [index, element] of types.tupleElementInfos(type).entries()) {
              if (!step()) return false;
              if (element.elementKind === "required" || element.elementKind === "optional")
                projections.push({ kind: "tuple-element", index });
            }
          } else if (types.isArrayLike(type)) projections.push({ kind: "array-element" });
          else {
            const members = types.structuralMembers(type, type, "read");
            if (members.kind !== "available") return false;
            for (const member of members.members) {
              if (!step()) return false;
              if (member.kind !== "present" || member.source.read !== "method" && member.source.read !== "property") continue;
              for (const declaration of member.source.declarations) {
                if (!step()) return false;
                projections.push({ kind: member.source.read === "method" ? "method-value" : "member", declaration });
              }
            }
          }
          for (const projection of projections) {
            if (!step()) return false;
            const child = storage.subject(subject.node, subject.kind, [...subject.projection, projection]);
            if (child.kind === "unresolved") return false;
            const values = storage.storageProducersFor(child.subject, bindings);
            if (values.kind === "unresolved") return false;
            for (const producer of values.producers) {
              if (!step()) return false;
              pending.push({ subject: producer.subject, bindings: producer.bindings });
            }
          }
          return true;
        };
        while (pending.length !== 0) {
          if (!step()) return false;
          const { subject, bindings } = pending.pop()!;
          const visits = visited.get(subject) ?? new Set<SourceStorageBindings>();
          if (visits.has(bindings)) continue;
          visits.add(bindings);
          visited.set(subject, visits);
          const origins = storage.boundOriginsFor(subject, bindings);
          if (origins.kind !== "resolved") return false;
          for (const origin of origins.subjects) {
            if (!step()) return false;
            if (origin.kind === "input") {
              if (candidates.has(origin.node)) retained.add(origin.node);
              continue;
            }
            const suspendedInputs = suspendedCallInputs(origin, bindings);
            if (suspendedInputs.kind === "unresolved") return false;
            if (suspendedInputs.kind === "inputs") { pending.push(...suspendedInputs.inputs); continue; }
            if (origin.kind !== "value" || origin.projection.length !== 0 || ast.body(origin.node) === undefined) {
              if (!components(origin, bindings)) return false;
              continue;
            }
            const captures = lexicalFor(origin.node);
            if (captures.kind === "unresolved") return false;
            for (const capture of captures.captures) {
              if (!step()) return false;
              const source = storage.subjectFor(capture.references[0]!);
              if (source.kind !== "resolved") return false;
              pending.push({ subject: source.subject, bindings });
            }
          }
        }
        return true;
      };
      for (const producer of producers.producers) {
        if (!step() || !retain(producer.subject, producer.bindings)) return unresolved();
        const suspendedInputs = suspendedCallInputs(producer.subject, producer.bindings);
        if (suspendedInputs.kind === "unresolved") return unresolved();
        if (suspendedInputs.kind === "inputs")
          for (const { subject, bindings } of suspendedInputs.inputs)
            if (!step() || !retain(subject, bindings)) return unresolved();
      }
    }
    const selected = parameters.filter((parameter): parameter is Node => parameter !== undefined && retained.has(parameter));
    const scopeDemand = taskOwners.has(declaration) && input.nativeTasks.parameterOwners.has(declaration) && isSuspended(declaration);
    const retention = scopeDemand ? callableRetention.forDeclaration(declaration) : undefined;
    if (retention?.kind === "unresolved") return unresolved(retention.reason);
    const retainsScope = retention?.kind === "resolved" && retention.retention === "scoped";
    if (selected.length === 0 && !retainsScope) return none;
    const inputs = selected.length === 0 ? undefined : inputsFor(declaration);
    if (inputs?.kind === "unresolved") return inputs;
    const borrowed = inputs?.ownership === "owned" ? [] : selected;
    if (borrowed.length === 0 && !retainsScope) return none;
    const identity = sourceNodeIdentity(ast, declaration);
    if (identity === undefined) return unresolved();
    const names = new Set<string>();
    for (let owner: Node | undefined = declaration; owner !== undefined; owner = ast.parent(owner)) {
      if (!step()) return unresolved();
      for (const parameter of input.sourceLifetimes.contractFor(owner)?.parameters ?? [])
        if (parameter.kind === "lifetime") names.add(parameter.lifetime.name);
    }
    const environment: RustRetainedEnvironment = Object.freeze({
      lifetime: Object.freeze({ kind: "parameter", identity: `retained-environment\0${identity}`,
        name: allocateRustGeneratedName(names, "environment") }), inputs: Object.freeze([
          ...borrowed.map(declaration => Object.freeze({ kind: "parameter" as const, declaration })),
          ...retainsScope ? [Object.freeze({ kind: "native-task-scope" as const })] : [],
        ]) });
    return Object.freeze({ kind: "selected", environment });
  };
  // Selected on demand by the analysis passes that need them, after the source storage facts they read exist
  // (the checkpoint behaviour). Selecting every declaration while the analysis context is still being created ran
  // source storage queries too early, and the first unresolved collector failed the shared storage budget for the
  // whole program.
  return Object.freeze({ suspendedParametersFor, lexicalFor, inputsFor, environmentFor(declaration: Node) {
    const cached = environments.get(declaration);
    if (cached !== undefined) return cached;
    const selected = select(declaration);
    if (selected.kind !== "unresolved") environments.set(declaration, selected);
    return selected;
  } });
}
