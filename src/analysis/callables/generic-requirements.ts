import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  resolveTargetContractFixedPoint,
} from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  getRustGeneratorProtocol,
  rustCarrierSupportsTrait,
  rustClosureProtocol,
  rustFixedArrayCarrierValue,
  rustLocationTargetId,
  rustNamedTypeCarrierValue,
  rustOptionTargetId,
  rustSourceTypeCarrierValue,
  rustTargetGenericTypeArguments,
  rustTargetLifetimeArguments,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import {
  rustClosureCaptureFactKey,
  rustGeneratorFactKey,
  rustLocationStorageFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
  rustTypedLocationPlanKey,
  rustYieldFactKey,
} from "../facts/keys.js";

export type RustGenericRequirement = "clone" | "default" | "static";

export interface RustCallableTypeParameterRequirements {
  readonly name: string;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RustCallableGenericRequirementContract {
  readonly declaration: Node;
  readonly typeParameters: readonly RustCallableTypeParameterRequirements[];
}

export interface RustCallableGenericRequirementIndex {
  contractFor(declaration: Node): RustCallableGenericRequirementContract | undefined;
  hasUse(
    declaration: Node,
    node: Node,
    carrier: TargetTypeRef,
    requirements: readonly RustGenericRequirement[],
  ): boolean;
}

export type AnalyzeRustCallableGenericRequirementsResult =
  | {
      readonly kind: "resolved";
      readonly index: RustCallableGenericRequirementIndex;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

interface RequirementUse {
  readonly node: Node;
  readonly carrier: TargetTypeRef;
  readonly requirements: readonly RustGenericRequirement[];
}

interface RequirementContractState extends RustCallableGenericRequirementContract {
  readonly uses: readonly RequirementUse[];
}

const requirementOrder: readonly RustGenericRequirement[] = [
  "clone",
  "default",
  "static",
];

export function analyzeRustCallableGenericRequirements(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  names: RustNamePlan,
  sourceLifetimes: RustLifetimeIndex,
): AnalyzeRustCallableGenericRequirementsResult {
  const ast = source.ast;
  const diagnostics: TargetDiagnostic[] = [];
  const declarations = collectCallableDeclarations(ast, sourceFiles);
  const declarationById = new Map<string, Node>();
  const idByDeclaration = new WeakMap<Node, string>();
  for (const declaration of declarations) {
    const id = sourceNodeIdentity(ast, declaration);
    if (id === undefined || declarationById.has(id)) {
      diagnostics.push(diagnostic(
        "RUST_CALLABLE_CONTRACT_IDENTITY_MISSING",
        "A Rust callable contract requires one unique compiler-owned source identity.",
        declaration,
      ));
      continue;
    }
    declarationById.set(id, declaration);
    idByDeclaration.set(declaration, id);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }
  const maximumEvaluations = declarations.length * declarations.length +
    declarations.length;
  if (!Number.isSafeInteger(maximumEvaluations)) {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([diagnostic(
        "RUST_CALLABLE_CONTRACT_BUDGET_INVALID",
        "The callable inventory cannot produce a finite generic-contract analysis budget.",
      )]),
    };
  }
  const implementationDeclaration = (declaration: Node): Node => {
    if (idByDeclaration.has(declaration)) {
      return declaration;
    }
    const implementation = source.navigation.callableImplementation(declaration);
    return implementation?.kind === "resolved" &&
        idByDeclaration.has(implementation.implementation.declaration)
      ? implementation.implementation.declaration
      : declaration;
  };
  const closure = resolveTargetContractFixedPoint<RequirementContractState>({
    roots: [...declarationById.keys()],
    evaluate(id, context) {
      const declaration = declarationById.get(id);
      if (declaration === undefined) {
        return {
          kind: "rejected",
          reason: `Rust callable contract '${id}' has no exact source declaration.`,
        };
      }
      const result = classifyCallableRequirements({
        ast,
        declaration,
        facts,
        names,
        sourceLifetimes,
        idByDeclaration,
        implementationDeclaration,
        contractFor(candidate) {
          const candidateId = idByDeclaration.get(candidate);
          return candidateId === undefined ? undefined : context.get(candidateId);
        },
      });
      return result.kind === "rejected"
        ? result
        : {
            kind: "resolved",
            revision: {
              contract: result.contract,
              dependencies: result.dependencies,
            },
          };
    },
    equals: requirementContractsEqual,
    maximumContracts: Math.max(1, declarations.length),
    maximumRevisionsPerContract: Math.max(8, declarations.length + 1),
    maximumEvaluations: Math.max(64, maximumEvaluations),
  });
  if (closure.kind === "rejected") {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([diagnostic(
        "RUST_CALLABLE_CONTRACT_CLOSURE_REJECTED",
        closure.reason,
        closure.contractId === undefined
          ? undefined
          : declarationById.get(closure.contractId),
      )]),
    };
  }
  const contractByDeclaration = new WeakMap<Node, RequirementContractState>();
  const usesByNode = new WeakMap<Node, RequirementUse[]>();
  for (const id of closure.program.ids) {
    const contract = closure.program.get(id)!;
    contractByDeclaration.set(contract.declaration, contract);
    for (const use of contract.uses) {
      const uses = usesByNode.get(use.node) ?? [];
      uses.push(use);
      usesByNode.set(use.node, uses);
    }
  }
  const index: RustCallableGenericRequirementIndex = Object.freeze({
    contractFor(declaration: Node) {
      return contractByDeclaration.get(declaration);
    },
    hasUse(
      declaration: Node,
      node: Node,
      carrier: TargetTypeRef,
      requirements: readonly RustGenericRequirement[],
    ) {
      const normalized = normalizeRequirements(requirements);
      return contractByDeclaration.has(declaration) &&
        (usesByNode.get(node) ?? []).some((use) =>
          rustTargetTypeRefEquals(use.carrier, carrier) &&
          stringListsEqual(use.requirements, normalized));
    },
  });
  return { kind: "resolved", index };
}

interface ClassifyCallableInput {
  readonly ast: AstReader;
  readonly declaration: Node;
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly idByDeclaration: WeakMap<Node, string>;
  readonly implementationDeclaration: (declaration: Node) => Node;
  readonly contractFor: (declaration: Node) => RequirementContractState | undefined;
}

function classifyCallableRequirements(input: ClassifyCallableInput):
  | {
      readonly kind: "resolved";
      readonly contract: RequirementContractState;
      readonly dependencies: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: string } {
  const { ast, declaration, facts, names } = input;
  const typeParameterNodes = ast.typeParameters(declaration).filter(
    (candidate): candidate is Node => candidate !== undefined &&
      input.sourceLifetimes.parameterFor(candidate)?.kind !== "lifetime",
  );
  const typeParameterNames = typeParameterNodes.map((parameter) =>
    names.nameForDeclaration(parameter));
  if (typeParameterNames.some((name) => name === undefined)) {
    return {
      kind: "rejected",
      reason: "A Rust callable type parameter has no exact target identity.",
    };
  }
  const exactNames = typeParameterNames as string[];
  const declared = new Set(exactNames);
  const byParameter = new Map(exactNames.map((name) =>
    [name, new Set<RustGenericRequirement>()] as const));
  const uses: RequirementUse[] = [];
  const dependencies = new Set<string>();
  const addUse = (
    node: Node,
    carrier: TargetTypeRef | undefined,
    requirements: readonly RustGenericRequirement[],
  ): string | undefined => {
    if (carrier === undefined) {
      return "A Rust generic requirement has no exact target carrier.";
    }
    const normalized = normalizeRequirements(requirements);
    const classified = classifyCarrierRequirements(
      carrier,
      normalized,
      declared,
      byParameter,
    );
    if (!classified) {
      return `A generated Rust operation requires ${rustRequirementDescription(normalized)} that its exact target carrier does not provide.`;
    }
    if (!uses.some((use) => use.node === node &&
      rustTargetTypeRefEquals(use.carrier, carrier) &&
      stringListsEqual(use.requirements, normalized))) {
      uses.push(Object.freeze({ node, carrier, requirements: normalized }));
    }
    return undefined;
  };
  const generator = facts.getFact(declaration, rustGeneratorFactKey);
  if (generator !== undefined) {
    if (generator.storage.kind !== "lifetime") {
      for (const parameter of generator.capturedParameters) {
        const error = addUse(
          parameter,
          facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier,
          ["static"],
        );
        if (error !== undefined) {
          return { kind: "rejected", reason: error };
        }
      }
      for (const carrier of [generator.yieldType, generator.returnType, generator.nextType]) {
        const error = addUse(declaration, carrier, ["static"]);
        if (error !== undefined) {
          return { kind: "rejected", reason: error };
        }
      }
    }
  }
  const visit = (node: Node): string | undefined => {
    if (node !== declaration && isIndependentCallable(ast, node)) {
      return undefined;
    }
    const location = facts.getFact(node, rustLocationStorageFactKey);
    if (location !== undefined) {
      const error = addUse(node, location.valueCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
    }
    const typedLocation = facts.getFact(node, rustTypedLocationPlanKey);
    if (typedLocation?.operation === "allocate") {
      const error = addUse(node, typedLocation.pointeeCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
    }
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "default-value") {
      const error = addUse(node, operation.resultCarrier, ["default"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "closure") {
      const captures = facts.getFact(node, rustClosureCaptureFactKey);
      if (captures === undefined) {
        return "A Rust closure has no exact capture classification.";
      }
      const required: readonly RustGenericRequirement[] =
        rustClosureProtocol(operation.resultCarrier) === undefined
          ? ["clone", "static"]
          : ["clone"];
      for (const capture of captures.captures) {
        const error = addUse(capture.reference, capture.carrier, required);
        if (error !== undefined) return error;
      }
    }
    const yieldFact = facts.getFact(node, rustYieldFactKey);
    if (yieldFact?.kind === "delegate") {
      const delegated = getRustGeneratorProtocol(yieldFact.delegatedCarrier);
      if (delegated === undefined) {
        return "A delegated Rust generator yield has no exact generator protocol.";
      }
      const nextError = addUse(node, delegated.nextType, ["default"]);
      if (nextError !== undefined) return nextError;
      const returnError = addUse(node, delegated.returnType, ["clone"]);
      if (returnError !== undefined) return returnError;
    }
    if (operation?.kind === "source-call") {
      const selected = facts.getSelectedTargetCall(node);
      if (selected?.sourceDeclaration !== undefined) {
        const selectedDeclaration = input.implementationDeclaration(
          selected.sourceDeclaration,
        );
        const calleeId = input.idByDeclaration.get(selectedDeclaration);
        const targetTypeArguments = rustTargetGenericTypeArguments(
          operation.targetGenericArguments,
        );
        if (calleeId !== undefined) {
          dependencies.add(calleeId);
          const callee = input.contractFor(selectedDeclaration);
          if (callee !== undefined && callee.typeParameters.length > 0) {
            if (callee.typeParameters.length !== targetTypeArguments.length) {
              return "A selected Rust source call has inconsistent generic contract arity.";
            }
            for (let index = 0; index < callee.typeParameters.length; index += 1) {
              const requirements = callee.typeParameters[index]!.requirements;
              if (requirements.length === 0) continue;
              const error = addUse(node, targetTypeArguments[index], requirements);
              if (error !== undefined) return error;
            }
          }
        }
      }
    }
    let childError: string | undefined;
    ast.forEachChild(node, (child) => {
      if (child !== undefined && childError === undefined) {
        childError = visit(child);
      }
    });
    return childError;
  };
  const body = ast.body(declaration);
  const error = body === undefined ? undefined : visit(declaration);
  if (error !== undefined) {
    return { kind: "rejected", reason: error };
  }
  return {
    kind: "resolved",
    dependencies: Object.freeze([...dependencies]),
    contract: Object.freeze({
      declaration,
      typeParameters: Object.freeze(exactNames.map((name) => Object.freeze({
        name,
        requirements: normalizeRequirements([...(byParameter.get(name) ?? [])]),
      }))),
      uses: Object.freeze(uses),
    }),
  };
}

function collectCallableDeclarations(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): readonly Node[] {
  const result: Node[] = [];
  const visit = (node: Node): void => {
    if (isIndependentCallable(ast, node) && ast.body(node) !== undefined) {
      result.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  return Object.freeze(result);
}

function isIndependentCallable(ast: AstReader, node: Node): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" ||
    kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" ||
    kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" ||
    kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}

function classifyCarrierRequirements(
  carrier: TargetTypeRef,
  required: readonly RustGenericRequirement[],
  declared: ReadonlySet<string>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
): boolean {
  for (const requirement of required) {
    if (requirement === "static") {
      if (!classifyStaticCarrier(carrier, declared, byParameter)) return false;
      continue;
    }
    const traitPath = requirement === "clone"
      ? "core::clone::Clone"
      : "core::default::Default";
    if (!rustCarrierSupportsTrait(carrier, traitPath, (name, selectedTrait) => {
      if (!declared.has(name) || selectedTrait !== traitPath) return false;
      byParameter.get(name)!.add(requirement);
      return true;
    })) {
      return false;
    }
  }
  return true;
}

function classifyStaticCarrier(
  carrier: TargetTypeRef,
  declared: ReadonlySet<string>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      if (declared.has(carrier.name)) {
        byParameter.get(carrier.name)!.add("static");
      }
      return true;
    case "array":
      return classifyStaticCarrier(carrier.element, declared, byParameter);
    case "slice":
      return false;
    case "tuple":
      return carrier.elements.every((element) =>
        classifyStaticCarrier(element, declared, byParameter));
    case "target-named": {
      if (rustTargetLifetimeArguments(carrier.genericArguments).some((lifetime) =>
        lifetime.kind !== "static")) {
        return false;
      }
      const arguments_ = rustTargetGenericTypeArguments(carrier.genericArguments);
      if (carrier.id === rustOptionTargetId || carrier.id === rustLocationTargetId) {
        return arguments_.every((argument) =>
          classifyStaticCarrier(argument, declared, byParameter));
      }
      return !arguments_.some((argument) =>
        containsDeclaredTypeParameter(argument, declared));
    }
    case "target-specific": {
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray !== undefined) {
        return classifyStaticCarrier(fixedArray.element, declared, byParameter);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      if (named !== undefined) {
        if (rustTargetLifetimeArguments(named.genericArguments).some((lifetime) =>
          lifetime.kind !== "static")) return false;
        return !rustTargetGenericTypeArguments(named.genericArguments).some((argument) =>
          containsDeclaredTypeParameter(argument, declared));
      }
      const sourceType = rustSourceTypeCarrierValue(carrier);
      return sourceType === undefined ||
        rustTargetLifetimeArguments(sourceType.genericArguments).every((lifetime) =>
          lifetime.kind === "static") &&
        !rustTargetGenericTypeArguments(sourceType.genericArguments).some((argument) =>
          containsDeclaredTypeParameter(argument, declared));
    }
    case "reference":
      return carrier.lifetime?.kind === "static" &&
        classifyStaticCarrier(carrier.referent, declared, byParameter);
    case "pointer":
      return classifyStaticCarrier(carrier.pointee, declared, byParameter);
    case "function-pointer":
      return carrier.args.every((argument) =>
        classifyStaticCarrier(argument, declared, byParameter)) &&
        classifyStaticCarrier(carrier.result, declared, byParameter);
    case "trait-object":
      return carrier.lifetime?.kind === "static" &&
        classifyStaticCarrier(carrier.principal, declared, byParameter) &&
        carrier.autoTraits.every((trait) =>
          classifyStaticCarrier(trait, declared, byParameter));
    case "impl-trait":
      return carrier.captures.every((capture) => {
        if (capture.kind === "const") return true;
        if (capture.kind === "lifetime") return capture.lifetime.kind === "static";
        return classifyStaticCarrier(capture.type, declared, byParameter);
      }) &&
        carrier.bounds.every((bound) =>
          classifyStaticCarrier(bound, declared, byParameter));
    case "closure":
      return !containsDeclaredTypeParameter(carrier, declared);
    case "associated-type":
      return rustTargetLifetimeArguments(carrier.genericArguments).every((lifetime) =>
        lifetime.kind === "static") &&
        !containsDeclaredTypeParameter(carrier, declared);
    default:
      return true;
  }
}

function containsDeclaredTypeParameter(
  carrier: TargetTypeRef,
  declared: ReadonlySet<string>,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      return declared.has(carrier.name);
    case "target-named":
      return rustTargetGenericTypeArguments(carrier.genericArguments).some((argument) =>
        containsDeclaredTypeParameter(argument, declared));
    case "array":
    case "slice":
      return containsDeclaredTypeParameter(carrier.element, declared);
    case "tuple":
      return carrier.elements.some((element) =>
        containsDeclaredTypeParameter(element, declared));
    case "reference":
      return containsDeclaredTypeParameter(carrier.referent, declared);
    case "pointer":
      return containsDeclaredTypeParameter(carrier.pointee, declared);
    case "function-pointer":
    case "closure":
      return carrier.args.some((argument) =>
        containsDeclaredTypeParameter(argument, declared)) ||
        containsDeclaredTypeParameter(carrier.result, declared);
    case "associated-type":
      return containsDeclaredTypeParameter(carrier.owner, declared) ||
        (carrier.trait !== undefined &&
          containsDeclaredTypeParameter(carrier.trait, declared)) ||
        rustTargetGenericTypeArguments(carrier.genericArguments).some((argument) =>
          containsDeclaredTypeParameter(argument, declared));
    case "trait-object":
      return containsDeclaredTypeParameter(carrier.principal, declared) ||
        carrier.autoTraits.some((trait) =>
          containsDeclaredTypeParameter(trait, declared));
    case "impl-trait":
      return carrier.bounds.some((bound) =>
        containsDeclaredTypeParameter(bound, declared)) ||
        carrier.captures.some((capture) => capture.kind === "type" &&
          containsDeclaredTypeParameter(capture.type, declared));
    case "target-specific": {
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray !== undefined) {
        return containsDeclaredTypeParameter(fixedArray.element, declared);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      if (named !== undefined) {
        return rustTargetGenericTypeArguments(named.genericArguments).some((argument) =>
          containsDeclaredTypeParameter(argument, declared));
      }
      const sourceType = rustSourceTypeCarrierValue(carrier);
      return sourceType !== undefined &&
        rustTargetGenericTypeArguments(sourceType.genericArguments).some((argument) =>
          containsDeclaredTypeParameter(argument, declared));
    }
    default:
      return false;
  }
}

function normalizeRequirements(
  requirements: readonly RustGenericRequirement[],
): readonly RustGenericRequirement[] {
  const selected = new Set(requirements);
  return Object.freeze(requirementOrder.filter((requirement) =>
    selected.has(requirement)));
}

function rustRequirementDescription(
  requirements: readonly RustGenericRequirement[],
): string {
  const descriptions = requirements.map((requirement) =>
    requirement === "clone"
      ? "an exact Rust Clone implementation"
      : requirement === "default"
        ? "an exact Rust Default implementation"
        : "an exact Rust 'static lifetime");
  if (descriptions.length <= 1) return descriptions[0] ?? "an exact Rust carrier contract";
  return `${descriptions.slice(0, -1).join(", ")} and ${descriptions[descriptions.length - 1]}`;
}

function requirementContractsEqual(
  left: RequirementContractState,
  right: RequirementContractState,
): boolean {
  return left.declaration === right.declaration &&
    left.typeParameters.length === right.typeParameters.length &&
    left.typeParameters.every((parameter, index) => {
      const other = right.typeParameters[index];
      return other !== undefined && parameter.name === other.name &&
        stringListsEqual(parameter.requirements, other.requirements);
    }) &&
    left.uses.length === right.uses.length &&
    left.uses.every((use, index) => {
      const other = right.uses[index];
      return other !== undefined && use.node === other.node &&
        rustTargetTypeRefEquals(use.carrier, other.carrier) &&
        stringListsEqual(use.requirements, other.requirements);
    });
}

function stringListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    entry === right[index]);
}

function diagnostic(
  code: string,
  message: string,
  sourceNode?: Node,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    ...(sourceNode === undefined ? {} : { sourceNode }),
    evidence: ["target.capability=rust.callable.generic-contract-closure"],
  };
}
