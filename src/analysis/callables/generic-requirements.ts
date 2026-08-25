import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  resolveTargetContractFixedPoint,
} from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  getRustGeneratorProtocol,
  rustCarrierSupportsTrait,
  rustCloneTrait,
  rustDefaultTrait,
  rustSendTrait,
  rustSourceTypeCarrierValue,
  rustSyncTrait,
  rustUnpinTrait,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSemanticIdentity } from "../../target-model/semantics/index.js";
import {
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityKey,
} from "../../target-model/semantics/index.js";
import {
  rustClosureCaptureFactKey,
  rustGeneratorFactKey,
  rustLocationStorageFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
  rustTypedLocationPlanKey,
  rustYieldFactKey,
} from "../facts/keys.js";
import type { RustSourceGenericIndex } from "../../policy/types/source-generics.js";
import type { RustOwnershipAnalysis } from "../ownership/model.js";

export type RustGenericRequirement =
  | "clone"
  | "default"
  | "send"
  | "sync"
  | "unpin"
  | "static";

export interface RustCallableTypeParameterRequirements {
  readonly identity: RustSemanticIdentity;
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
  "send",
  "sync",
  "unpin",
  "static",
];

export function analyzeRustCallableGenericRequirements(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  sourceGenerics: RustSourceGenericIndex,
  ownership: RustOwnershipAnalysis,
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
        sourceGenerics,
        ownership,
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
  readonly sourceGenerics: RustSourceGenericIndex;
  readonly ownership: RustOwnershipAnalysis;
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
  const { ast, declaration, facts } = input;
  const sourceGenericContract = input.sourceGenerics.contractFor(declaration);
  if (sourceGenericContract === undefined) {
    return {
      kind: "rejected",
      reason: "A Rust callable has no exact sealed source-generic contract.",
    };
  }
  const exactParameters = sourceGenericContract.parameters.flatMap((parameter) =>
    parameter.parameter.kind !== "type"
      ? []
      : [Object.freeze({
          identity: parameter.parameter.identity,
          name: parameter.parameter.displayName,
        })]);
  const declared = new Map(exactParameters.map((parameter) =>
    [rustSemanticIdentityKey(parameter.identity), parameter] as const));
  const byParameter = new Map(exactParameters.map((parameter) =>
    [rustSemanticIdentityKey(parameter.identity), new Set<RustGenericRequirement>()] as const));
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
    const execution = input.ownership.executionContractFor(declaration);
    if (execution === undefined) {
      return { kind: "rejected", reason: "A Rust generator has no sealed execution contract." };
    }
    const executionRequirements: RustGenericRequirement[] = [
      ...(execution.lifetime.kind === "static" ? ["static" as const] : []),
      ...(execution.requiresSend ? ["send" as const] : []),
      ...(execution.requiresSync ? ["sync" as const] : []),
    ];
    for (const parameter of ast.parameters(declaration)) {
      const error = parameter === undefined
        ? "A generator contains an undefined parameter slot."
        : addUse(
            parameter,
            facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier,
            executionRequirements,
          );
      if (error !== undefined) {
        return { kind: "rejected", reason: error };
      }
    }
    for (const carrier of [generator.yieldType, generator.returnType, generator.nextType]) {
      const error = addUse(declaration, carrier, executionRequirements);
      if (error !== undefined) {
        return { kind: "rejected", reason: error };
      }
    }
  }
  const visit = (node: Node): string | undefined => {
    if (node !== declaration && isIndependentCallable(ast, node)) {
      return undefined;
    }
    const location = facts.getFact(node, rustLocationStorageFactKey);
    if (location !== undefined) {
      const error = addUse(node, location.valueCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    const typedLocation = facts.getFact(node, rustTypedLocationPlanKey);
    if (typedLocation !== undefined &&
      (typedLocation.operation === "address-of" ||
        typedLocation.operation === "allocate" ||
        typedLocation.operation === "load")) {
      const error = addUse(node, typedLocation.pointeeCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "default-value") {
      const error = addUse(node, operation.resultCarrier, ["default"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "closure") {
      const captures = facts.getFact(node, rustClosureCaptureFactKey);
      const execution = input.ownership.executionContractFor(node);
      if (captures === undefined || execution === undefined) {
        return "A Rust closure has no exact capture classification.";
      }
      for (const capture of captures.captures) {
        const selectedCapture = input.ownership.captureFor(capture.reference);
        if (selectedCapture === undefined) {
          return "A Rust closure capture has no sealed ownership classification.";
        }
        const required: RustGenericRequirement[] = [];
        if (selectedCapture.mode === "clone") required.push("clone");
        if (execution.storage === "owned") required.push("static");
        if (execution.requiresSend) {
          required.push(selectedCapture.sendProof !== undefined &&
              rustSemanticIdentitiesEqual(
                selectedCapture.sendProof.trait,
                rustSyncTrait.identity,
              )
            ? "sync"
            : "send");
        }
        if (execution.requiresSync) required.push("sync");
        const error = addUse(capture.reference, selectedCapture.carrier, required);
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
        const targetTypeArguments = Object.freeze([
          ...(operation.targetGenericArguments ?? [])
            .filter((argument) => argument.kind === "type")
            .map((argument) => argument.value),
        ]);
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
      typeParameters: Object.freeze(exactParameters.map((parameter) => Object.freeze({
        identity: parameter.identity,
        name: parameter.name,
        requirements: normalizeRequirements([
          ...(byParameter.get(rustSemanticIdentityKey(parameter.identity)) ?? []),
        ]),
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
    if (isCallableContractOwner(ast, node)) {
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

function isCallableContractOwner(ast: AstReader, node: Node): boolean {
  const kind = ast.kindName(node);
  return isIndependentCallable(ast, node) ||
    kind === "KindMethodSignature" ||
    kind === "KindConstructSignature" ||
    kind === "KindCallSignature" ||
    kind === "KindFunctionType" ||
    kind === "KindConstructorType";
}

function classifyCarrierRequirements(
  carrier: TargetTypeRef,
  required: readonly RustGenericRequirement[],
  declared: ReadonlyMap<string, { readonly identity: RustSemanticIdentity; readonly name: string }>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
): boolean {
  for (const requirement of required) {
    if (requirement === "static") {
      if (!classifyStaticCarrier(carrier, declared, byParameter)) return false;
      continue;
    }
    const trait = requirement === "clone"
      ? rustCloneTrait
      : requirement === "default"
        ? rustDefaultTrait
        : requirement === "send"
          ? rustSendTrait
          : requirement === "sync"
            ? rustSyncTrait
            : rustUnpinTrait;
    if (!rustCarrierSupportsTrait(carrier, trait, (identity, selectedTrait) => {
      const key = rustSemanticIdentityKey(identity);
      if (!declared.has(key) || !rustSemanticIdentitiesEqual(
        selectedTrait.identity,
        trait.identity,
      )) return false;
      byParameter.get(key)!.add(requirement);
      return true;
    })) {
      return false;
    }
  }
  return true;
}

function classifyStaticCarrier(
  carrier: TargetTypeRef,
  declared: ReadonlyMap<string, { readonly identity: RustSemanticIdentity; readonly name: string }>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      if (declared.has(rustSemanticIdentityKey(carrier.identity))) {
        byParameter.get(rustSemanticIdentityKey(carrier.identity))!.add("static");
      }
      return true;
    case "array":
    case "sequence":
      return classifyStaticCarrier(carrier.element, declared, byParameter);
    case "slice":
    case "str":
      return false;
    case "tuple":
      return carrier.elements.every((element) =>
        classifyStaticCarrier(element, declared, byParameter));
    case "path":
      return carrier.arguments.every((argument) =>
        argument.kind === "const" ||
        (argument.kind === "lifetime"
          ? argument.value.kind === "static"
          : classifyStaticCarrier(argument.value, declared, byParameter)));
    case "source-carrier": {
      const sourceType = rustSourceTypeCarrierValue(carrier);
      return sourceType === undefined || !sourceType.genericArguments.some((argument) =>
        argument.kind === "type" && containsDeclaredTypeParameter(argument.value, declared));
    }
    case "reference":
      return carrier.lifetime.kind === "static" &&
        classifyStaticCarrier(carrier.target, declared, byParameter);
    case "raw-pointer":
      return classifyStaticCarrier(carrier.target, declared, byParameter);
    case "function-pointer":
      return carrier.parameters.every((argument) =>
        classifyStaticCarrier(argument, declared, byParameter)) &&
        classifyStaticCarrier(carrier.result, declared, byParameter);
    case "closure":
      return carrier.parameters.every((argument) =>
        classifyStaticCarrier(argument, declared, byParameter)) &&
        classifyStaticCarrier(carrier.result, declared, byParameter) &&
        carrier.captures.every((capture) => capture.kind !== "lifetime" ||
          capture.value.kind === "static");
    case "trait-object":
      return carrier.lifetime.kind === "static";
    case "associated-type":
    case "opaque":
      return !containsDeclaredTypeParameter(carrier, declared);
    case "inference-variable":
      return false;
    default:
      return true;
  }
}

function containsDeclaredTypeParameter(
  carrier: TargetTypeRef,
  declared: ReadonlyMap<string, { readonly identity: RustSemanticIdentity; readonly name: string }>,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      return declared.has(rustSemanticIdentityKey(carrier.identity));
    case "path":
      return carrier.arguments.some((argument) => argument.kind === "type" &&
        containsDeclaredTypeParameter(argument.value, declared));
    case "array":
    case "sequence":
    case "slice":
      return containsDeclaredTypeParameter(carrier.element, declared);
    case "tuple":
      return carrier.elements.some((element) =>
        containsDeclaredTypeParameter(element, declared));
    case "reference":
    case "raw-pointer":
      return containsDeclaredTypeParameter(carrier.target, declared);
    case "function-pointer":
    case "closure":
      return carrier.parameters.some((argument) =>
        containsDeclaredTypeParameter(argument, declared)) ||
        containsDeclaredTypeParameter(carrier.result, declared);
    case "associated-type":
      return containsDeclaredTypeParameter(carrier.owner, declared) ||
        carrier.arguments.some((argument) => argument.kind === "type" &&
          containsDeclaredTypeParameter(argument.value, declared));
    case "trait-object":
      return carrier.principal.arguments.some((argument) => argument.kind === "type" &&
        containsDeclaredTypeParameter(argument.value, declared));
    case "opaque":
      return carrier.captures.some((capture) => capture.kind === "type" &&
        declared.has(rustSemanticIdentityKey(capture.identity)));
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
        : requirement === "send"
          ? "an exact Rust Send implementation"
          : requirement === "sync"
            ? "an exact Rust Sync implementation"
            : requirement === "unpin"
              ? "an exact Rust Unpin implementation"
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
        rustSemanticIdentitiesEqual(parameter.identity, other.identity) &&
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
