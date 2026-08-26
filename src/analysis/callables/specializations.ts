import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import {
  rustGenericArgumentOpenIdentityKeys,
  rustGenericParameterIdentityKey,
  rustGenericSubstitutionsForArguments,
  substituteRustGenericArgument,
} from "../../target-model/types/index.js";
import {
  compareRustSemanticKeys,
  rustGenericArgumentSemanticKey,
} from "../../target-model/semantics/index.js";
import type { RustGenericArgument, RustGenerics } from "../../target-model/semantics/index.js";
import type { RustGenericSubstitutions } from "../../target-model/types/index.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustSourceGenericIndex } from "../../policy/types/source-generics.js";

export interface RustSourceCallableSpecializationVariant {
  readonly declaration: Node;
  readonly sourceGenerics: RustGenerics;
  readonly targetGenericArguments: readonly RustGenericArgument[];
  readonly specialization: RustGenericSubstitutions;
  readonly targetName: string;
}

export interface RustProjectMethodSpecializationRequest {
  readonly declaration: Node;
  readonly targetGenericArguments: readonly RustGenericArgument[];
}

export interface RustSourceCallableSpecializationIssue {
  readonly subject: Node;
  readonly message: string;
}

export interface RustSourceCallableSpecializationPlan {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  readonly projectMethodRequests: readonly RustProjectMethodSpecializationRequest[];
  requiresSpecialization(declaration: Node): boolean;
  variantsForCallable(declaration: Node): readonly RustSourceCallableSpecializationVariant[];
  variantForCall(
    declaration: Node,
    targetGenericArguments: readonly RustGenericArgument[],
  ): RustSourceCallableSpecializationVariant | undefined;
}

export type RustSourceCallableSpecializationRegistration =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustSourceCallableSpecializationPlanRegistry
  extends RustSourceCallableSpecializationPlan {
  recordSourceCall(input: {
    readonly subject: Node;
    readonly caller?: Node;
    readonly callee: Node;
    readonly targetGenericArguments: readonly RustGenericArgument[];
    readonly ast: AstReader;
    readonly sourceGenerics: RustSourceGenericIndex;
  }): RustSourceCallableSpecializationRegistration;
  recordProjectMethodCall(input: {
    readonly subject: Node;
    readonly caller?: Node;
    readonly declaration: Node;
    readonly targetGenericArguments: readonly RustGenericArgument[];
    readonly ast: AstReader;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceGenerics: RustSourceGenericIndex;
  }): RustSourceCallableSpecializationRegistration;
  initialize(input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceGenerics: RustSourceGenericIndex;
  }): RustSourceCallableSpecializationPlan;
  seal(): RustSourceCallableSpecializationPlan;
}

interface SourceCallEdge {
  readonly subject: Node;
  readonly caller?: Node;
  readonly callee: Node;
  readonly targetGenericArguments: readonly RustGenericArgument[];
}

interface MutableSpecializationVariant {
  readonly declaration: Node;
  readonly sourceGenerics: RustGenerics;
  readonly targetGenericArguments: readonly RustGenericArgument[];
  readonly specialization: RustGenericSubstitutions;
  targetName?: string;
}

interface ProjectMethodEdge {
  readonly subject: Node;
  readonly caller?: Node;
  readonly declaration: Node;
  readonly targetGenericArguments: readonly RustGenericArgument[];
}

export function createRustSourceCallableSpecializationPlanRegistry(): RustSourceCallableSpecializationPlanRegistry {
  const sourceCalls: SourceCallEdge[] = [];
  const projectMethodCalls: ProjectMethodEdge[] = [];
  let current: RustSourceCallableSpecializationPlan | undefined;
  const requireCurrent = (): RustSourceCallableSpecializationPlan => {
    if (current === undefined) {
      throw new Error("Rust source-callable specialization plan was read before source analysis initialized it.");
    }
    return current;
  };
  const registry: RustSourceCallableSpecializationPlanRegistry = {
    recordSourceCall(input) {
      if (current !== undefined) {
        throw new Error("Rust source-callable specialization requests cannot be recorded after initialization.");
      }
      const contract = input.sourceGenerics.contractFor(input.callee);
      if (contract === undefined || rustGenericSubstitutionsForArguments(
        contract.generics,
        input.targetGenericArguments,
      ) === undefined) {
        return rejected("Selected project-source call arguments do not match the exact mixed-generic callee contract.");
      }
      sourceCalls.push(Object.freeze({
        subject: input.subject,
        ...(input.caller === undefined ? {} : { caller: input.caller }),
        callee: input.callee,
        targetGenericArguments: Object.freeze([...input.targetGenericArguments]),
      }));
      return accepted;
    },
    recordProjectMethodCall(input) {
      if (current !== undefined) {
        throw new Error("Rust project-method specialization requests cannot be recorded after initialization.");
      }
      const owner = input.projectTypes.definitionContainingDeclaration(input.declaration);
      const contract = input.sourceGenerics.contractFor(input.declaration);
      if (owner === undefined || contract === undefined || rustGenericSubstitutionsForArguments(
        contract.generics,
        input.targetGenericArguments,
      ) === undefined) {
        return rejected("Selected project method has no exact owner or matching mixed-generic contract.");
      }
      projectMethodCalls.push(Object.freeze({
        subject: input.subject,
        ...(input.caller === undefined ? {} : { caller: input.caller }),
        declaration: input.declaration,
        targetGenericArguments: Object.freeze([...input.targetGenericArguments]),
      }));
      return accepted;
    },
    initialize(input) {
      if (current !== undefined) {
        throw new Error("Rust source-callable specialization plan can be initialized only once.");
      }
      current = createRustSourceCallableSpecializationPlan(
        sourceCalls,
        projectMethodCalls,
        input,
      );
      return current;
    },
    seal() {
      return requireCurrent();
    },
    get issues() {
      return requireCurrent().issues;
    },
    get projectMethodRequests() {
      return requireCurrent().projectMethodRequests;
    },
    requiresSpecialization(declaration) {
      return requireCurrent().requiresSpecialization(declaration);
    },
    variantsForCallable(declaration) {
      return requireCurrent().variantsForCallable(declaration);
    },
    variantForCall(declaration, targetGenericArguments) {
      return requireCurrent().variantForCall(declaration, targetGenericArguments);
    },
  };
  return Object.freeze(registry);
}

function createRustSourceCallableSpecializationPlan(
  sourceCalls: readonly SourceCallEdge[],
  projectMethodCalls: readonly ProjectMethodEdge[],
  input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceGenerics: RustSourceGenericIndex;
  },
): RustSourceCallableSpecializationPlan {
  const required = requiredCallableSpecializations(
    sourceCalls,
    projectMethodCalls,
    input.sourceGenerics,
  );
  const variants = new Map<Node, MutableSpecializationVariant[]>();
  const methodRequests: RustProjectMethodSpecializationRequest[] = [];
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const issueKeys = new WeakMap<Node, Set<string>>();

  const addIssue = (subject: Node, message: string): void => {
    const messages = issueKeys.get(subject) ?? new Set<string>();
    if (!messages.has(message)) {
      messages.add(message);
      issueKeys.set(subject, messages);
      issues.push(Object.freeze({ subject, message }));
    }
  };
  const addCallableVariant = (
    declaration: Node,
    targetGenericArguments: readonly RustGenericArgument[],
    subject: Node,
  ): boolean => {
    const contract = input.sourceGenerics.contractFor(declaration);
    const complete = contract === undefined
      ? undefined
      : rustGenericSubstitutionsForArguments(contract.generics, targetGenericArguments);
    if (contract === undefined || complete === undefined) {
      addIssue(subject, "A required Rust source-callable specialization conflicts with its exact mixed-generic declaration contract.");
      return false;
    }
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const allowedOpenIdentities = new Set(
      owner?.genericArguments.flatMap(rustGenericArgumentOpenIdentityKeys) ?? [],
    );
    const unresolved = new Set(targetGenericArguments
      .filter((argument) => argument.kind !== "lifetime")
      .flatMap(rustGenericArgumentOpenIdentityKeys));
    if ([...unresolved].some((identity) => !allowedOpenIdentities.has(identity))) {
      return false;
    }
    const existing = variants.get(declaration) ?? [];
    if (existing.some((variant) => specializationArgumentsEqual(
      variant.targetGenericArguments,
      targetGenericArguments,
    ))) {
      return false;
    }
    existing.push({
      declaration,
      sourceGenerics: contract.generics,
      targetGenericArguments: Object.freeze([...targetGenericArguments]),
      specialization: specializationOnly(complete),
    });
    variants.set(declaration, existing);
    return true;
  };
  const addMethodRequest = (
    declaration: Node,
    targetGenericArguments: readonly RustGenericArgument[],
    subject: Node,
  ): boolean => {
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const allowedOpenIdentities = new Set(
      owner?.genericArguments.flatMap(rustGenericArgumentOpenIdentityKeys) ?? [],
    );
    const unresolved = new Set(targetGenericArguments
      .filter((argument) => argument.kind !== "lifetime")
      .flatMap(rustGenericArgumentOpenIdentityKeys));
    if (owner === undefined || [...unresolved].some((identity) =>
      !allowedOpenIdentities.has(identity))) {
      return false;
    }
    if (methodRequests.some((request) => request.declaration === declaration &&
      specializationArgumentsEqual(request.targetGenericArguments, targetGenericArguments))) {
      return false;
    }
    methodRequests.push(Object.freeze({
      declaration,
      targetGenericArguments: Object.freeze([...targetGenericArguments]),
    }));
    addCallableVariant(declaration, targetGenericArguments, subject);
    return true;
  };

  for (const edge of sourceCalls) {
    if (!required.has(edge.callee)) {
      continue;
    }
    const callerIdentities = callableSpecializationIdentitySet(edge.caller, input.sourceGenerics);
    if (edge.caller === undefined ||
      !targetArgumentsUseIdentities(edge.targetGenericArguments, callerIdentities)) {
      addCallableVariant(edge.callee, edge.targetGenericArguments, edge.subject);
    }
  }
  for (const edge of projectMethodCalls) {
    const callerIdentities = callableSpecializationIdentitySet(edge.caller, input.sourceGenerics);
    if (edge.caller === undefined ||
      !targetArgumentsUseIdentities(edge.targetGenericArguments, callerIdentities)) {
      addMethodRequest(edge.declaration, edge.targetGenericArguments, edge.subject);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of sourceCalls) {
      if (!required.has(edge.callee) || edge.caller === undefined) {
        continue;
      }
      for (const callerVariant of variants.get(edge.caller) ?? []) {
        const arguments_ = edge.targetGenericArguments.map((argument) =>
          substituteRustGenericArgument(argument, callerVariant.specialization));
        changed = addCallableVariant(edge.callee, arguments_, edge.subject) || changed;
      }
    }
    for (const edge of projectMethodCalls) {
      if (edge.caller === undefined) {
        continue;
      }
      for (const callerVariant of variants.get(edge.caller) ?? []) {
        const arguments_ = edge.targetGenericArguments.map((argument) =>
          substituteRustGenericArgument(argument, callerVariant.specialization));
        changed = addMethodRequest(edge.declaration, arguments_, edge.subject) || changed;
      }
    }
  }

  for (const declaration of required) {
    if (!callableCanBeSpecialized(declaration, input.ast)) {
      addIssue(
        declaration,
        "Rust finite callable specialization currently requires a concrete function or method declaration body.",
      );
      continue;
    }
    if (callableIsExternallyReachable(declaration, input.ast)) {
      addIssue(
        declaration,
        "An exported generic callable reaches Rust object-safe dynamic dispatch and cannot preserve an open public target contract; expose closed non-generic entry points instead.",
      );
      continue;
    }
    const declarationVariants = variants.get(declaration) ?? [];
    if (declarationVariants.length === 0) {
      addIssue(
        declaration,
        "A reachable generic callable that requires Rust object-safe dispatch has no finite closed project instantiation.",
      );
    }
  }

  assignCallableVariantNames(variants, input.ast, input.names);
  for (const declarationVariants of variants.values()) {
    declarationVariants.sort((left, right) => compareRustSemanticKeys(
      variantKey(left),
      variantKey(right),
    ));
    declarationVariants.forEach((variant) => {
      if (variant.targetName === undefined) {
        addIssue(
          variant.declaration,
          "A required Rust source-callable specialization has no deterministic target name.",
        );
      }
      Object.freeze(variant);
    });
  }
  methodRequests.sort((left, right) => {
    const fileOrder = compareRustSemanticKeys(
      input.ast.getFileName(input.ast.getSourceFile(left.declaration)),
      input.ast.getFileName(input.ast.getSourceFile(right.declaration)),
    );
    return fileOrder || input.ast.pos(left.declaration) - input.ast.pos(right.declaration) ||
      compareRustSemanticKeys(
        closedMetadataKey(specializationArguments(left.targetGenericArguments)),
        closedMetadataKey(specializationArguments(right.targetGenericArguments)),
      );
  });
  const plan: RustSourceCallableSpecializationPlan = {
    issues: Object.freeze(issues),
    projectMethodRequests: Object.freeze(methodRequests),
    requiresSpecialization(declaration) {
      return required.has(declaration);
    },
    variantsForCallable(declaration) {
      return Object.freeze((variants.get(declaration) ?? []).filter(
        (variant): variant is RustSourceCallableSpecializationVariant =>
          variant.targetName !== undefined,
      ));
    },
    variantForCall(declaration, targetGenericArguments) {
      const matches = (variants.get(declaration) ?? []).filter((variant) =>
        variant.targetName !== undefined &&
        specializationArgumentsEqual(
          variant.targetGenericArguments,
          targetGenericArguments,
        ));
      return matches.length === 1
        ? matches[0] as RustSourceCallableSpecializationVariant
        : undefined;
    },
  };
  return Object.freeze(plan);
}

function requiredCallableSpecializations(
  sourceCalls: readonly SourceCallEdge[],
  projectMethodCalls: readonly ProjectMethodEdge[],
  sourceGenerics: RustSourceGenericIndex,
): Set<Node> {
  const required = new Set<Node>();
  for (const edge of projectMethodCalls) {
    const identities = callableSpecializationIdentitySet(edge.caller, sourceGenerics);
    if (edge.caller !== undefined &&
      targetArgumentsUseIdentities(edge.targetGenericArguments, identities)) {
      required.add(edge.caller);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of sourceCalls) {
      if (!required.has(edge.callee) || edge.caller === undefined) {
        continue;
      }
      const identities = callableSpecializationIdentitySet(edge.caller, sourceGenerics);
      if (targetArgumentsUseIdentities(edge.targetGenericArguments, identities) &&
        !required.has(edge.caller)) {
        required.add(edge.caller);
        changed = true;
      }
    }
  }
  return required;
}

function assignCallableVariantNames(
  variants: ReadonlyMap<Node, MutableSpecializationVariant[]>,
  ast: AstReader,
  names: RustNamePlan,
): void {
  const usedByScope = new WeakMap<object, Set<string>>();
  const usedNames = (scope: Node | SourceFile): Set<string> => {
    const existing = usedByScope.get(scope);
    if (existing !== undefined) {
      return existing;
    }
    const used = new Set<string>();
    const visit = (node: Node): void => {
      const name = names.nameForDeclaration(node);
      const functionName = names.functionNameForDeclaration(node);
      if (name !== undefined) {
        used.add(name);
      }
      if (functionName !== undefined) {
        used.add(functionName);
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child);
        }
      });
    };
    visit(scope);
    usedByScope.set(scope, used);
    return used;
  };
  for (const [declaration, entries] of variants) {
    const kind = ast.kindName(declaration);
    const base = kind === "KindFunctionDeclaration"
      ? names.functionNameForDeclaration(declaration)
      : names.nameForDeclaration(declaration);
    if (base === undefined) {
      continue;
    }
    const scope = kind === "KindFunctionDeclaration"
      ? ast.getSourceFile(declaration)
      : ast.parent(declaration);
    if (scope === undefined) {
      continue;
    }
    const used = usedNames(scope);
    entries
      .sort((left, right) => compareRustSemanticKeys(variantKey(left), variantKey(right)))
      .forEach((entry, index) => {
        const targetName = allocateRustGeneratedName(
          used,
          `${base}_specialization_${index + 1}`,
        );
        entry.targetName = targetName;
      });
  }
}

function callableCanBeSpecialized(declaration: Node, ast: AstReader): boolean {
  const kind = ast.kindName(declaration);
  return (kind === "KindFunctionDeclaration" || kind === "KindMethodDeclaration") &&
    ast.body(declaration) !== undefined;
}

function callableIsExternallyReachable(declaration: Node, ast: AstReader): boolean {
  if (ast.hasModifierKind(declaration, "export")) {
    return true;
  }
  if (ast.kindName(declaration) !== "KindMethodDeclaration" ||
    ast.hasModifierKind(declaration, "private") ||
    ast.hasModifierKind(declaration, "protected")) {
    return false;
  }
  const owner = ast.parent(declaration);
  return owner !== undefined && ast.hasModifierKind(owner, "export");
}

function callableSpecializationIdentitySet(
  declaration: Node | undefined,
  sourceGenerics: RustSourceGenericIndex,
): ReadonlySet<string> {
  const contract = sourceGenerics.contractFor(declaration);
  return new Set(contract?.parameters.flatMap((entry) => {
    const parameter = entry.parameter;
    return parameter.kind === "lifetime"
      ? []
      : [rustGenericParameterIdentityKey(parameter)].filter(
          (identity): identity is string => identity !== undefined,
        );
  }) ?? []);
}

function targetArgumentsUseIdentities(
  targetGenericArguments: readonly RustGenericArgument[],
  identities: ReadonlySet<string>,
): boolean {
  return targetGenericArguments.some((argument) => argument.kind !== "lifetime" &&
    rustGenericArgumentOpenIdentityKeys(argument).some((identity) =>
      identities.has(identity)));
}

function variantKey(variant: MutableSpecializationVariant): string {
  return closedMetadataKey(specializationArguments(variant.targetGenericArguments));
}

function specializationArgumentsEqual(
  left: readonly RustGenericArgument[],
  right: readonly RustGenericArgument[],
): boolean {
  const leftSpecialized = specializationArguments(left);
  const rightSpecialized = specializationArguments(right);
  return leftSpecialized.length === rightSpecialized.length && leftSpecialized.every((entry, index) =>
    rustGenericArgumentSemanticKey(entry) === rustGenericArgumentSemanticKey(rightSpecialized[index]!));
}

function specializationArguments(
  arguments_: readonly RustGenericArgument[],
): readonly RustGenericArgument[] {
  return arguments_.filter((argument) => argument.kind !== "lifetime");
}

function specializationOnly(
  substitutions: RustGenericSubstitutions,
): RustGenericSubstitutions {
  return Object.freeze({
    lifetimes: new Map(),
    types: substitutions.types,
    consts: substitutions.consts,
    associatedTypes: substitutions.associatedTypes,
  });
}

function rejected(reason: string): RustSourceCallableSpecializationRegistration {
  return { kind: "rejected", reason };
}

const accepted: RustSourceCallableSpecializationRegistration = Object.freeze({ kind: "accepted" });
