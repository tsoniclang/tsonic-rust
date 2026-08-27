import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { closedMetadataKey, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustTargetTypeParameterNames,
  substituteRustTargetTypeParameters,
} from "../../target-model/types/index.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";

export interface RustSourceCallableSpecializationVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterNames: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly targetName: string;
}

export interface RustProjectMethodSpecializationRequest {
  readonly declaration: Node;
  readonly targetTypeArguments: readonly TargetTypeRef[];
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
    targetTypeArguments: readonly TargetTypeRef[],
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
    readonly targetTypeArguments: readonly TargetTypeRef[];
    readonly ast: AstReader;
    readonly sourceLifetimes: RustLifetimeIndex;
  }): RustSourceCallableSpecializationRegistration;
  recordProjectMethodCall(input: {
    readonly subject: Node;
    readonly caller?: Node;
    readonly declaration: Node;
    readonly targetTypeArguments: readonly TargetTypeRef[];
    readonly ast: AstReader;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceLifetimes: RustLifetimeIndex;
  }): RustSourceCallableSpecializationRegistration;
  initialize(input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceLifetimes: RustLifetimeIndex;
  }): RustSourceCallableSpecializationPlan;
  seal(): RustSourceCallableSpecializationPlan;
}

interface SourceCallEdge {
  readonly subject: Node;
  readonly caller?: Node;
  readonly callee: Node;
  readonly targetTypeArguments: readonly TargetTypeRef[];
}

interface MutableSpecializationVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterNames: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
  targetName?: string;
}

interface ProjectMethodEdge {
  readonly subject: Node;
  readonly caller?: Node;
  readonly declaration: Node;
  readonly targetTypeArguments: readonly TargetTypeRef[];
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
      const names = callableTypeParameterNames(
        input.callee,
        input.ast,
        input.sourceLifetimes,
      );
      if (names === undefined || names.length !== input.targetTypeArguments.length) {
        return rejected("Selected project-source call type arguments do not match the exact callee declaration arity.");
      }
      sourceCalls.push(Object.freeze({
        subject: input.subject,
        ...(input.caller === undefined ? {} : { caller: input.caller }),
        callee: input.callee,
        targetTypeArguments: Object.freeze([...input.targetTypeArguments]),
      }));
      return accepted;
    },
    recordProjectMethodCall(input) {
      if (current !== undefined) {
        throw new Error("Rust project-method specialization requests cannot be recorded after initialization.");
      }
      const owner = input.projectTypes.definitionContainingDeclaration(input.declaration);
      const names = callableTypeParameterNames(
        input.declaration,
        input.ast,
        input.sourceLifetimes,
      );
      if (owner === undefined || names === undefined || names.length !== input.targetTypeArguments.length) {
        return rejected("Selected project method has no exact owner or matching type-parameter arity.");
      }
      projectMethodCalls.push(Object.freeze({
        subject: input.subject,
        ...(input.caller === undefined ? {} : { caller: input.caller }),
        declaration: input.declaration,
        targetTypeArguments: Object.freeze([...input.targetTypeArguments]),
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
    variantForCall(declaration, targetTypeArguments) {
      return requireCurrent().variantForCall(declaration, targetTypeArguments);
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
    readonly sourceLifetimes: RustLifetimeIndex;
  },
): RustSourceCallableSpecializationPlan {
  const required = requiredCallableSpecializations(
    sourceCalls,
    projectMethodCalls,
    input.ast,
    input.sourceLifetimes,
  );
  const variants = new Map<Node, MutableSpecializationVariant[]>();
  const methodRequests: RustProjectMethodSpecializationRequest[] = [];
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const issueKeys = new Set<string>();

  const addIssue = (subject: Node, message: string): void => {
    const key = `${input.ast.getFileName(input.ast.getSourceFile(subject))}:${input.ast.pos(subject)}:${input.ast.end(subject)}:${message}`;
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(Object.freeze({ subject, message }));
    }
  };
  const addCallableVariant = (
    declaration: Node,
    targetTypeArguments: readonly TargetTypeRef[],
    subject: Node,
  ): boolean => {
    const parameterNames = callableTypeParameterNames(
      declaration,
      input.ast,
      input.sourceLifetimes,
    );
    if (parameterNames === undefined || parameterNames.length !== targetTypeArguments.length) {
      addIssue(subject, "A required Rust source-callable specialization conflicts with its exact declaration arity.");
      return false;
    }
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const allowedOpenNames = new Set(owner?.typeParameterNames ?? []);
    const unresolved = new Set(targetTypeArguments.flatMap(rustTargetTypeParameterNames));
    if ([...unresolved].some((name) => !allowedOpenNames.has(name))) {
      return false;
    }
    const existing = variants.get(declaration) ?? [];
    if (existing.some((variant) => targetTypeRefListsEqual(
      variant.targetTypeArguments,
      targetTypeArguments,
    ))) {
      return false;
    }
    existing.push({
      declaration,
      sourceTypeParameterNames: Object.freeze(parameterNames),
      targetTypeArguments: Object.freeze([...targetTypeArguments]),
    });
    variants.set(declaration, existing);
    return true;
  };
  const addMethodRequest = (
    declaration: Node,
    targetTypeArguments: readonly TargetTypeRef[],
    subject: Node,
  ): boolean => {
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const allowedOpenNames = new Set(owner?.typeParameterNames ?? []);
    const unresolved = new Set(targetTypeArguments.flatMap(rustTargetTypeParameterNames));
    if (owner === undefined || [...unresolved].some((name) => !allowedOpenNames.has(name))) {
      return false;
    }
    if (methodRequests.some((request) => request.declaration === declaration &&
      targetTypeRefListsEqual(request.targetTypeArguments, targetTypeArguments))) {
      return false;
    }
    methodRequests.push(Object.freeze({
      declaration,
      targetTypeArguments: Object.freeze([...targetTypeArguments]),
    }));
    addCallableVariant(declaration, targetTypeArguments, subject);
    return true;
  };

  for (const edge of sourceCalls) {
    if (!required.has(edge.callee)) {
      continue;
    }
    const callerNames = callableTypeParameterNameSet(
      edge.caller,
      input.ast,
      input.sourceLifetimes,
    );
    if (edge.caller === undefined || !targetArgumentsUseNames(edge.targetTypeArguments, callerNames)) {
      addCallableVariant(edge.callee, edge.targetTypeArguments, edge.subject);
    }
  }
  for (const edge of projectMethodCalls) {
    const callerNames = callableTypeParameterNameSet(
      edge.caller,
      input.ast,
      input.sourceLifetimes,
    );
    if (edge.caller === undefined || !targetArgumentsUseNames(edge.targetTypeArguments, callerNames)) {
      addMethodRequest(edge.declaration, edge.targetTypeArguments, edge.subject);
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
        const substitutions = variantSubstitutions(callerVariant);
        const arguments_ = edge.targetTypeArguments.map((argument) =>
          substituteRustTargetTypeParameters(argument, substitutions));
        changed = addCallableVariant(edge.callee, arguments_, edge.subject) || changed;
      }
    }
    for (const edge of projectMethodCalls) {
      if (edge.caller === undefined) {
        continue;
      }
      for (const callerVariant of variants.get(edge.caller) ?? []) {
        const substitutions = variantSubstitutions(callerVariant);
        const arguments_ = edge.targetTypeArguments.map((argument) =>
          substituteRustTargetTypeParameters(argument, substitutions));
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
    declarationVariants.sort((left, right) => variantKey(left).localeCompare(variantKey(right), "en"));
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
    const fileOrder = input.ast.getFileName(input.ast.getSourceFile(left.declaration)).localeCompare(
      input.ast.getFileName(input.ast.getSourceFile(right.declaration)),
      "en",
    );
    return fileOrder || input.ast.pos(left.declaration) - input.ast.pos(right.declaration) ||
      closedMetadataKey(left.targetTypeArguments).localeCompare(
        closedMetadataKey(right.targetTypeArguments),
        "en",
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
    variantForCall(declaration, targetTypeArguments) {
      const matches = (variants.get(declaration) ?? []).filter((variant) =>
        variant.targetName !== undefined &&
        targetTypeRefListsEqual(variant.targetTypeArguments, targetTypeArguments));
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
  ast: AstReader,
  sourceLifetimes: RustLifetimeIndex,
): Set<Node> {
  const required = new Set<Node>();
  for (const edge of projectMethodCalls) {
    const names = callableTypeParameterNameSet(edge.caller, ast, sourceLifetimes);
    if (edge.caller !== undefined && targetArgumentsUseNames(edge.targetTypeArguments, names)) {
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
      const names = callableTypeParameterNameSet(edge.caller, ast, sourceLifetimes);
      if (targetArgumentsUseNames(edge.targetTypeArguments, names) && !required.has(edge.caller)) {
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
      .sort((left, right) => variantKey(left).localeCompare(variantKey(right), "en"))
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

function callableTypeParameterNames(
  declaration: Node,
  ast: AstReader,
  sourceLifetimes: RustLifetimeIndex,
): readonly string[] | undefined {
  const parameters = ast.typeParameters(declaration);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const names = (parameters as readonly Node[])
    .filter((parameter) => sourceLifetimes.parameterFor(parameter)?.kind !== "lifetime")
    .map((parameter) => {
      const name = ast.name(parameter);
      return name === undefined ? "" : ast.text(name);
    });
  return names.some((name) => name.length === 0) ? undefined : Object.freeze(names);
}

function callableTypeParameterNameSet(
  declaration: Node | undefined,
  ast: AstReader,
  sourceLifetimes: RustLifetimeIndex,
): ReadonlySet<string> {
  return new Set(declaration === undefined
    ? []
    : callableTypeParameterNames(declaration, ast, sourceLifetimes) ?? []);
}

function targetArgumentsUseNames(
  targetTypeArguments: readonly TargetTypeRef[],
  names: ReadonlySet<string>,
): boolean {
  return targetTypeArguments.some((argument) =>
    rustTargetTypeParameterNames(argument).some((name) => names.has(name)));
}

function variantSubstitutions(
  variant: Pick<
    MutableSpecializationVariant,
    "sourceTypeParameterNames" | "targetTypeArguments"
  >,
): ReadonlyMap<string, TargetTypeRef> {
  return new Map(variant.sourceTypeParameterNames.map((name, index) =>
    [name, variant.targetTypeArguments[index]!] as const));
}

function variantKey(variant: MutableSpecializationVariant): string {
  return closedMetadataKey(variant.targetTypeArguments);
}

function targetTypeRefListsEqual(
  left: readonly TargetTypeRef[],
  right: readonly TargetTypeRef[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    rustTargetTypeRefEquals(entry, right[index]));
}

function rejected(reason: string): RustSourceCallableSpecializationRegistration {
  return { kind: "rejected", reason };
}

const accepted: RustSourceCallableSpecializationRegistration = Object.freeze({ kind: "accepted" });
