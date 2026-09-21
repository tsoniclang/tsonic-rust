import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { rustSourceParameterAbiFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { mapRustTargetTypes, substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { resolveRustTypeFamilyApplication } from "../../policy/types/resolution/type-families.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/type-family-normalization.js";

interface FamilyDemandContext {
  readonly types: ReadonlyMap<Type, Type>;
  readonly carriers: ReadonlyMap<string, TargetTypeRef>;
}

interface FamilyDemandTask {
  readonly declaration: Node;
  readonly context: FamilyDemandContext;
}

export function realizeRustSourceTypeFamilyDemands(walk: RustFactWalk, files: readonly SourceFile[]): void {
  if (walk.context.typeFamilies.families().length === 0) return;
  const { ast, facts } = walk.context;
  const tasks: FamilyDemandTask[] = [];
  const seen = new WeakMap<Node, Set<string>>();
  const typeIds = new WeakMap<Type, number>();
  let nextTypeId = 0;
  let rejected = false;
  const normalize = rustTypeFamilyNormalizer(walk.context.typeFamilies);
  const empty: FamilyDemandContext = { types: new Map(), carriers: new Map() };
  const typeId = (type: Type): number => {
    let identity = typeIds.get(type);
    if (identity === undefined) { identity = ++nextTypeId; typeIds.set(type, identity); }
    return identity;
  };
  const reject = (node: Node, message: string): void => {
    if (!rejected) appendRustDiagnostic(walk, "RUST_TYPE_FAMILY_DEMAND_NOT_PROVEN", message, node,
      ["target.capability=rust.checked-dependent-type-family"]);
    rejected = true;
  };
  const enqueue = (declaration: Node, context: FamilyDemandContext): void => {
    const key = closedMetadataKey({
      types: [...context.types].map(([parameter, argument]) => [typeId(parameter), typeId(argument)]),
      carriers: [...context.carriers],
    });
    const entries = seen.get(declaration) ?? new Set<string>();
    if (entries.has(key)) return;
    if (tasks.length >= 65_536) {
      reject(declaration, "Dependent native type applications exceed the bounded 65536-declaration instantiation inventory.");
      return;
    }
    entries.add(key);
    seen.set(declaration, entries);
    tasks.push({ declaration, context });
  };
  const visitCall = (node: Node, parent: FamilyDemandContext): void => {
    const selected = facts.getSelectedTargetCall(node);
    if (selected?.sourceDeclaration === undefined ||
      !walk.context.source.navigation.isProjectDeclaration(selected.sourceDeclaration)) return;
    const implementation = walk.context.source.navigation.callableImplementation(selected.sourceDeclaration);
    const declaration = implementation?.kind === "resolved" ? implementation.implementation.declaration : selected.sourceDeclaration;
    const contract = walk.context.sourceLifetimes.contractFor(declaration);
    if (contract === undefined) return;
    const arguments_ = selected.sourceSelectedMethodTypeArguments ?? [];
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    const targetArguments = (operation?.kind === "source-call" ? operation.targetGenericArguments : undefined) ??
      selected.targetGenericArguments ?? [];
    if (arguments_.length !== contract.parameters.length || targetArguments.length !== arguments_.length) return;
    const types = new Map<Type, Type>();
    const carriers = new Map<string, TargetTypeRef>();
    for (const [index, parameter] of contract.parameters.entries()) {
      const source = arguments_[index]!;
      const target = targetArguments[index];
      if (parameter.kind !== "type" || target?.kind !== "type") continue;
      const parameterType = walk.context.semanticsFor(declaration).declarations.declaredType(parameter.declaration);
      if (parameterType === undefined) { reject(node, "A dependent source call lost its exact generic parameter type."); return; }
      types.set(parameterType, parent.types.get(source.selectedType) ?? source.selectedType);
      carriers.set(parameter.targetName, substituteRustTargetTypeParameters(target.type, parent.carriers));
    }
    enqueue(declaration, { types, carriers });
  };
  const visitCarrier = (carrier: TargetTypeRef, node: Node, demand: FamilyDemandContext): void => {
    if (rejected) return;
    if (carrier.kind === "associated-type" && carrier.trait?.sourceItem !== undefined) {
      const family = walk.context.typeFamilies.get(carrier.trait.id);
      const owner = substituteRustTargetTypeParameters(carrier.owner, demand.carriers);
      const applicationCarrier: TargetTypeRef = { ...carrier, owner };
      const normalized = mapRustTargetTypes(applicationCarrier, normalize);
      if (!rustTargetTypeRefEquals(normalized, applicationCarrier)) {
        visitCarrier(normalized, node, demand);
        return;
      }
      let type: Type | undefined;
      if (carrier.owner.kind === "type-parameter") {
        const declaration = enclosingParameter(node, carrier.owner.name, walk);
        const parameterType = declaration === undefined ? undefined
          : walk.context.semanticsFor(declaration).declarations.declaredType(declaration);
        type = parameterType === undefined ? undefined : demand.types.get(parameterType);
        if (type === undefined && owner.kind === "type-parameter") type = parameterType;
      } else {
        const declaration = walk.sourceTypes.declarationForCarrier(owner);
        type = declaration === undefined ? undefined : walk.context.semanticsFor(declaration).declarations.declaredType(declaration);
      }
      if (family?.kind !== "conditional" || type === undefined) {
        reject(node, "A dependent type application has no exact source argument correspondence."); return;
      }
      const application = walk.context.semanticsFor(node).types.instantiateAlias(family.declaration, [type]);
      const output = application === undefined ? undefined : resolveRustTypeFamilyApplication(application, [owner],
        rustResolutionContext(walk, node), walk.operationOptions, new Set());
      if (output === undefined) { reject(node, "The selected source type family has no exact native output implementation."); return; }
    }
    const sourceType = rustSourceTypeCarrierValue(carrier);
    const definition = sourceType === undefined ? undefined : walk.context.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined && definition.genericParameters.length === sourceType!.genericArguments.length) {
      const semantics = walk.context.semanticsFor(node);
      const selectedType = semantics.types.expressionType(node);
      const candidates = selectedType === undefined ? [] : semantics.types.isUnion(selectedType)
        ? semantics.types.unionOrIntersectionTypes(selectedType) : [selectedType];
      const bindings = candidates.flatMap(type => {
        const symbol = semantics.declarations.typeSymbol(type);
        const declaration = symbol === undefined ? undefined : semantics.declarations.primarySymbolDeclaration(symbol);
        return declaration === definition.declaration ? semantics.types.typeArgumentBindings(type) ?? [] : [];
      });
      const types = new Map<Type, Type>();
      const carriers = new Map<string, TargetTypeRef>();
      for (const [index, parameter] of definition.genericParameters.entries()) {
        const argument = sourceType!.genericArguments[index]!;
        if (parameter.kind !== "type" || argument.kind !== "type") continue;
        const sourceParameter = walk.context.semanticsFor(definition.declaration).declarations.declaredType(parameter.declaration);
        let argumentType: Type | undefined;
        const selectedBindings = bindings.filter(binding => binding.declaration === parameter.declaration);
        if (selectedBindings.length === 1) argumentType = demand.types.get(selectedBindings[0]!.argumentType) ?? selectedBindings[0]!.argumentType;
        if (argument.type.kind === "type-parameter") {
          const origin = enclosingParameter(node, argument.type.name, walk);
          const originType = origin === undefined ? undefined : walk.context.semanticsFor(origin).declarations.declaredType(origin);
          argumentType = originType === undefined ? argumentType : demand.types.get(originType) ?? originType;
        }
        if (sourceParameter !== undefined && argumentType !== undefined) types.set(sourceParameter, argumentType);
        carriers.set(parameter.targetName, substituteRustTargetTypeParameters(argument.type, demand.carriers));
      }
      enqueue(definition.declaration, { types, carriers });
    }
    for (const child of rustTargetTypeChildren(carrier)) visitCarrier(child, node, demand);
  };
  const seed = (node: Node): void => {
    visitCall(node, empty);
    ast.forEachChild(node, child => { if (child !== undefined) seed(child); });
  };
  for (const file of files) seed(file);
  for (let index = 0; index < tasks.length && !rejected; index++) {
    const task = tasks[index]!;
    const visit = (node: Node): void => {
      if (node !== task.declaration && createsGenericScope(ast.kindName(node))) return;
      const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
      if (carrier !== undefined) visitCarrier(carrier, node, task.context);
      const parameter = facts.getFact(node, rustSourceParameterAbiFactKey)?.parameterCarrier;
      if (parameter !== undefined) visitCarrier(parameter, node, task.context);
      visitCall(node, task.context);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(task.declaration);
  }
}

function createsGenericScope(kind: string | undefined): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" || kind === "KindArrowFunction" ||
    kind === "KindMethodDeclaration" || kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration" ||
    kind === "KindTypeAliasDeclaration" || kind === "KindConstructor";
}

function enclosingParameter(node: Node, name: string, walk: RustFactWalk): Node | undefined {
  const { ast, sourceLifetimes } = walk.context;
  for (let ancestor: Node | undefined = node; ancestor !== undefined; ancestor = ast.parent(ancestor)) {
    const contract = sourceLifetimes.contractFor(ancestor);
    const parameter = contract?.parameters.find(candidate => candidate.kind === "type" && candidate.targetName === name);
    if (parameter !== undefined) return parameter.declaration;
  }
  return undefined;
}
