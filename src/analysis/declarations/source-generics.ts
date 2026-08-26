import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustNamePlan } from "../../target-model/names/model.js";
import {
  rustScreamingSnakeIdentifier,
  rustSnakeCaseIdentifier,
} from "../../target-model/names/identifiers.js";
import type { RustProviderTypeRow } from "../../providers/packages/model.js";
import {
  rustSourceGenericParameterFactKey,
  rustSourceTypeContractFactKey,
} from "../../source/semantics/facts.js";
import type {
  RustBound,
  RustConstExpr,
  RustGenericArgument,
  RustGenericParameter,
  RustLifetimeRef,
  RustPrimitive,
  RustTraitRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import {
  rustLifetimeSemanticKey,
  rustSemanticIdentitiesEqual,
} from "../../target-model/semantics/index.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import {
  isRustIntegerCarrier,
  rustSizedTrait,
} from "../../target-model/types/index.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustSourceDeclarationIdentity } from "../../policy/types/resolution/rust-semantics.js";
import type {
  RustSourceGenericContract,
  RustSourceGenericIdentityContract,
  RustSourceGenericIndex,
  RustSourceGenericParameterContract,
  RustSourceGenericParameterIdentityContract,
} from "../../policy/types/source-generics.js";

export interface RustSourceGenericRegistry extends RustSourceGenericIndex {
  register(input: RustSourceGenericRegistrationInput): void;
  initialize(input: RustSourceGenericAnalysisInput): void;
  seal(): RustSourceGenericIndex;
}

export interface RustSourceGenericRegistrationInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  report(diagnostic: TargetDiagnostic): void;
}

export interface RustSourceGenericAnalysisInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  readonly providerTypes: readonly RustProviderTypeRow[];
  resolveType(node: Node): RustTypeRef | undefined;
  resolveLifetime(node: Node): RustLifetimeRef | undefined;
  resolveConst(node: Node): RustConstExpr | undefined;
  report(diagnostic: TargetDiagnostic): void;
}

export function createRustSourceGenericRegistry(): RustSourceGenericRegistry {
  let registered = false;
  let initialized = false;
  let sealed = false;
  let contracts: readonly RustSourceGenericContract[] = Object.freeze([]);
  let contractByDeclaration = new WeakMap<Node, RustSourceGenericContract>();
  let parameterByDeclaration = new WeakMap<Node, RustSourceGenericParameterContract>();
  let identityContracts: readonly RustSourceGenericIdentityContract[] = Object.freeze([]);
  let identityContractByDeclaration = new WeakMap<Node, RustSourceGenericIdentityContract>();
  let lifetimeOutlivesRelation: (
    longer: RustLifetimeRef,
    shorter: RustLifetimeRef,
  ) => boolean = () => false;

  const index: RustSourceGenericRegistry = {
    register(input) {
      if (registered || initialized || sealed) {
        input.report(diagnostic(
          "RUST_SOURCE_GENERIC_IDENTITIES_ALREADY_REGISTERED",
          "Source generic identities may be registered exactly once before semantic finalization.",
        ));
        return;
      }
      registered = true;
      const declarations = collectGenericDeclarations(input.ast, input.sourceFiles);
      if (declarations === undefined) {
        input.report(diagnostic(
          "RUST_SOURCE_GENERICS_AST_INVALID",
          "A source generic declaration contains an undefined or non-data parameter slot.",
        ));
        return;
      }
      const entries: RustSourceGenericIdentityContract[] = [];
      for (const declaration of declarations) {
        const parameters = (input.ast.typeParameters(declaration) as readonly Node[]).map((parameter) =>
          registerParameterIdentity(declaration, parameter, input));
        if (parameters.some((parameter) => parameter === undefined)) continue;
        const entry = Object.freeze({
          declaration,
          parameters: Object.freeze(parameters as RustSourceGenericParameterIdentityContract[]),
          arguments: Object.freeze((parameters as RustSourceGenericParameterIdentityContract[]).map(
            (parameter) => parameter.argument,
          )),
        });
        entries.push(entry);
        identityContractByDeclaration.set(declaration, entry);
      }
      identityContracts = Object.freeze(entries);
    },
    initialize(input) {
      if (!registered || initialized || sealed) {
        input.report(diagnostic(
          "RUST_SOURCE_GENERICS_ALREADY_INITIALIZED",
          "The source-generic semantic index requires one identity-registration pass and one finalization pass.",
        ));
        return;
      }
      initialized = true;
      const completed: RustSourceGenericContract[] = [];
      for (const identityContract of identityContracts) {
        const contract = analyzeDeclaration(identityContract, input);
        if (contract === undefined) continue;
        completed.push(contract);
        contractByDeclaration.set(identityContract.declaration, contract);
        for (const parameter of contract.parameters) {
          parameterByDeclaration.set(parameter.declaration, parameter);
        }
      }
      contracts = Object.freeze(completed);
      lifetimeOutlivesRelation = createSourceLifetimeOutlivesRelation(contracts);
    },
    contractFor(declaration) {
      return declaration === undefined ? undefined : contractByDeclaration.get(declaration);
    },
    identityContractFor(declaration) {
      return declaration === undefined ? undefined : identityContractByDeclaration.get(declaration);
    },
    parameterFor(declaration) {
      return declaration === undefined ? undefined : parameterByDeclaration.get(declaration);
    },
    allContracts() {
      return contracts;
    },
    lifetimeOutlives(longer, shorter) {
      return lifetimeOutlivesRelation(longer, shorter);
    },
    seal() {
      if (!initialized) {
        throw new Error("Rust source-generic semantic index was not initialized.");
      }
      sealed = true;
      return Object.freeze<RustSourceGenericIndex>({
        contractFor(declaration: Node | undefined) {
          return declaration === undefined ? undefined : contractByDeclaration.get(declaration);
        },
        identityContractFor(declaration: Node | undefined) {
          return declaration === undefined ? undefined : identityContractByDeclaration.get(declaration);
        },
        parameterFor(declaration: Node | undefined) {
          return declaration === undefined ? undefined : parameterByDeclaration.get(declaration);
        },
        allContracts() {
          return contracts;
        },
        lifetimeOutlives(longer, shorter) {
          return lifetimeOutlivesRelation(longer, shorter);
        },
      });
    },
  };
  return Object.freeze(index);
}

function createSourceLifetimeOutlivesRelation(
  contracts: readonly RustSourceGenericContract[],
): (longer: RustLifetimeRef, shorter: RustLifetimeRef) => boolean {
  const edges = new Map<string, Set<string>>();
  for (const contract of contracts) {
    for (const parameter of contract.parameters) {
      if (parameter.parameter.kind !== "lifetime") continue;
      const selected = edges.get(rustLifetimeSemanticKey(parameter.parameter.identity)) ??
        new Set<string>();
      for (const bound of parameter.parameter.bounds) {
        selected.add(rustLifetimeSemanticKey(bound));
      }
      edges.set(rustLifetimeSemanticKey(parameter.parameter.identity), selected);
    }
  }
  return (longer, shorter) => {
    const longerKey = rustLifetimeSemanticKey(longer);
    const shorterKey = rustLifetimeSemanticKey(shorter);
    if (longerKey === shorterKey || longer.kind === "static") return true;
    if (longer.kind === "inferred-region" || shorter.kind === "inferred-region") {
      return false;
    }
    const pending = [...(edges.get(longerKey) ?? [])];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const selected = pending.pop()!;
      if (selected === shorterKey) return true;
      if (seen.has(selected)) continue;
      seen.add(selected);
      pending.push(...(edges.get(selected) ?? []));
    }
    return false;
  };
}

function registerParameterIdentity(
  owner: Node,
  declaration: Node,
  input: RustSourceGenericRegistrationInput,
): RustSourceGenericParameterIdentityContract | undefined {
  const fact = input.facts.resolve(declaration, rustSourceGenericParameterFactKey) ??
    input.facts.get(declaration, rustSourceGenericParameterFactKey);
  const sourceNameNode = input.ast.name(declaration);
  const sourceName = sourceNameNode === undefined ? "" : input.ast.text(sourceNameNode);
  if (fact === undefined || fact.owner !== owner || fact.parameter !== declaration ||
    sourceName.length === 0) {
    input.report(diagnostic(
      "RUST_SOURCE_GENERIC_IDENTITY_MISSING",
      "A source generic parameter has no exact finalized kind, owner, and declaration identity.",
      declaration,
    ));
    return undefined;
  }
  const identity = rustSourceDeclarationIdentity(
    declaration,
    input.ast,
    `${fact.kind}-parameter`,
  );
  if (identity === undefined) {
    input.report(diagnostic(
      "RUST_SOURCE_GENERIC_IDENTITY_MISSING",
      "A source generic parameter has no exact compiler-owned source occurrence identity.",
      declaration,
    ));
    return undefined;
  }
  const argument: RustGenericArgument | undefined = fact.kind === "lifetime"
    ? Object.freeze({
        kind: "lifetime",
        value: Object.freeze({
          kind: "parameter",
          identity,
          displayName: rustSnakeCaseIdentifier(sourceName),
        }),
      })
    : fact.kind === "const"
      ? Object.freeze({
          kind: "const",
          value: Object.freeze({
            kind: "parameter",
            identity,
            displayName: rustScreamingSnakeIdentifier(sourceName),
          }),
        })
      : (() => {
          const displayName = input.names.nameForDeclaration(declaration);
          return displayName === undefined
            ? undefined
            : Object.freeze({
                kind: "type" as const,
                value: Object.freeze({
                  kind: "type-parameter" as const,
                  identity,
                  displayName,
                }),
              });
        })();
  if (argument === undefined) {
    input.report(diagnostic(
      "RUST_SOURCE_GENERIC_TARGET_NAME_MISSING",
      "A source generic parameter has no deterministic Rust target name.",
      declaration,
    ));
    return undefined;
  }
  return Object.freeze({ declaration, sourceName, argument });
}

function collectGenericDeclarations(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): readonly Node[] | undefined {
  const result: Node[] = [];
  const seen = new Set<Node>();
  let malformed = false;
  const visit = (node: Node): void => {
    const genericOwner = isSourceGenericOwner(ast.kindName(node));
    if (!genericOwner) {
      ast.forEachChild(node, (child) => {
        if (child !== undefined && !malformed) visit(child);
      });
      return;
    }
    const parameters = ast.typeParameters(node);
    if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
      malformed = true;
      return;
    }
    if (!seen.has(node)) {
      seen.add(node);
      result.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined && !malformed) visit(child);
    });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  return malformed ? undefined : Object.freeze(result);
}

function isSourceGenericOwner(kind: string | undefined): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" || kind === "KindConstructor" ||
    kind === "KindConstructSignature" || kind === "KindCallSignature" ||
    kind === "KindFunctionType" || kind === "KindConstructorType" ||
    kind === "KindGetAccessor" || kind === "KindSetAccessor" ||
    kind === "KindClassDeclaration" || kind === "KindClassExpression" ||
    kind === "KindInterfaceDeclaration" || kind === "KindTypeAliasDeclaration";
}

function analyzeDeclaration(
  identityContract: RustSourceGenericIdentityContract,
  input: RustSourceGenericAnalysisInput,
): RustSourceGenericContract | undefined {
  const declaration = identityContract.declaration;
  const parameterNodes = input.ast.typeParameters(declaration) as readonly Node[];
  if (parameterNodes.length !== identityContract.parameters.length) return undefined;
  const parameters: RustSourceGenericParameterContract[] = [];
  let failed = false;
  for (let index = 0; index < parameterNodes.length; index += 1) {
    const parameterNode = parameterNodes[index]!;
    const identity = identityContract.parameters[index];
    const parameter = identity?.declaration === parameterNode
      ? analyzeParameter(declaration, parameterNode, identity, input)
      : undefined;
    if (parameter === undefined) {
      failed = true;
    } else {
      parameters.push(parameter);
    }
  }
  if (failed) return undefined;
  return Object.freeze({
    declaration,
    parameters: Object.freeze(parameters),
    generics: Object.freeze({
      parameters: Object.freeze(parameters.map((parameter) => parameter.parameter)),
      wherePredicates: Object.freeze([]),
    }),
  });
}

function analyzeParameter(
  owner: Node,
  declaration: Node,
  registered: RustSourceGenericParameterIdentityContract,
  input: RustSourceGenericAnalysisInput,
): RustSourceGenericParameterContract | undefined {
  const fact = input.facts.resolve(declaration, rustSourceGenericParameterFactKey) ??
    input.facts.get(declaration, rustSourceGenericParameterFactKey);
  const sourceNameNode = input.ast.name(declaration);
  const sourceName = sourceNameNode === undefined ? "" : input.ast.text(sourceNameNode);
  if (fact === undefined || fact.owner !== owner || fact.parameter !== declaration || sourceName.length === 0) {
    input.report(diagnostic(
      "RUST_SOURCE_GENERIC_CONTRACT_MISSING",
      "A source generic parameter has no exact finalized Rust parameter contract.",
      declaration,
    ));
    return undefined;
  }
  const argument = registered.argument;
  if (fact.kind === "lifetime") {
    if (argument.kind !== "lifetime" || argument.value.kind !== "parameter") return undefined;
    if (fact.defaultType !== undefined || fact.constValueType !== undefined ||
      fact.typeOutlives.length !== 0 || fact.maybeSized ||
      hasNonLifetimeMarkerBounds(fact.bounds, input)) {
      input.report(diagnostic(
        "RUST_SOURCE_LIFETIME_PARAMETER_INVALID",
        "A Rust lifetime parameter may contain only Life and Outlives lifetime constraints.",
        declaration,
      ));
      return undefined;
    }
    const bounds = resolveLifetimeList(fact.outlives, input);
    if (bounds === undefined) {
      input.report(diagnostic(
        "RUST_SOURCE_LIFETIME_BOUND_NOT_PROVEN",
        "A Rust lifetime parameter has an unresolved outlives bound.",
        declaration,
      ));
      return undefined;
    }
    return freezeParameterContract(declaration, sourceName, {
      kind: "lifetime",
      identity: argument.value,
      bounds,
    });
  }
  if (fact.kind === "const") {
    if (argument.kind !== "const" || argument.value.kind !== "parameter") return undefined;
    if (fact.constValueType === undefined || fact.outlives.length !== 0 ||
      fact.typeOutlives.length !== 0 || fact.maybeSized ||
      hasNonConstMarkerBounds(fact.bounds, input)) {
      input.report(diagnostic(
        "RUST_SOURCE_CONST_PARAMETER_INVALID",
        "A Rust const parameter must have exactly one Const<T> classification and no ownership bounds.",
        declaration,
      ));
      return undefined;
    }
    const type = input.resolveType(fact.constValueType);
    const defaultValue = fact.defaultType === undefined
      ? undefined
      : input.resolveConst(fact.defaultType);
    if (type === undefined || !isRustConstParameterType(type) ||
      (fact.defaultType !== undefined && defaultValue === undefined)) {
      input.report(diagnostic(
        "RUST_SOURCE_CONST_PARAMETER_VALUE_INVALID",
        "A Rust const parameter has no exact scalar type or structured const default.",
        declaration,
      ));
      return undefined;
    }
    return freezeParameterContract(declaration, sourceName, {
      kind: "const",
      identity: argument.value.identity,
      displayName: argument.value.displayName,
      type,
      ...(defaultValue === undefined ? {} : { defaultValue }),
    });
  }

  if (fact.outlives.length !== 0 || fact.constValueType !== undefined) {
    input.report(diagnostic(
      "RUST_SOURCE_TYPE_PARAMETER_CLASSIFICATION_INVALID",
      "A Rust type parameter cannot carry lifetime-parameter or const-parameter classification.",
      declaration,
    ));
    return undefined;
  }
  if (argument.kind !== "type" || argument.value.kind !== "type-parameter") return undefined;
  const identity = argument.value.identity;
  const bounds: RustBound[] = [];
  for (const boundNode of fact.bounds) {
    const marker = input.facts.resolve(boundNode, rustSourceTypeContractFactKey) ??
      input.facts.get(boundNode, rustSourceTypeContractFactKey);
    if (marker?.kind === "valid-for") continue;
    if (marker?.kind === "maybe-sized") continue;
    if (marker !== undefined) {
      input.report(diagnostic(
        "RUST_SOURCE_TYPE_PARAMETER_BOUND_INVALID",
        `Rust source marker '${marker.kind}' is not valid on a type parameter.`,
        boundNode,
      ));
      return undefined;
    }
    const trait = resolveTraitBound(boundNode, input);
    if (trait === undefined) {
      input.report(diagnostic(
        "RUST_SOURCE_TYPE_PARAMETER_TRAIT_NOT_PROVEN",
        "A Rust type-parameter bound must resolve to one exact provider trait declaration.",
        boundNode,
      ));
      return undefined;
    }
    bounds.push(Object.freeze({ kind: "trait", trait, polarity: "required" }));
  }
  for (const lifetimeNode of fact.typeOutlives) {
    const lifetime = input.resolveLifetime(lifetimeNode);
    if (lifetime === undefined) {
      input.report(diagnostic(
        "RUST_SOURCE_TYPE_OUTLIVES_NOT_PROVEN",
        "A Rust type-outlives bound has no exact lifetime parameter identity.",
        lifetimeNode,
      ));
      return undefined;
    }
    bounds.push(Object.freeze({
      kind: "type-outlives",
      type: Object.freeze({
        kind: "type-parameter",
        identity,
        displayName: input.names.nameForDeclaration(declaration) ?? sourceName,
      }),
      lifetime,
    }));
  }
  if (fact.maybeSized) {
    bounds.push(Object.freeze({
      kind: "trait",
      trait: rustSizedTrait,
      polarity: "maybe",
    }));
  }
  const defaultType = fact.defaultType === undefined
    ? undefined
    : input.resolveType(fact.defaultType);
  const displayName = argument.value.displayName;
  if (displayName === undefined || (fact.defaultType !== undefined && defaultType === undefined)) {
    input.report(diagnostic(
      "RUST_SOURCE_TYPE_PARAMETER_TYPE_NOT_PROVEN",
      "A Rust type parameter has no exact target name or default target type.",
      declaration,
    ));
    return undefined;
  }
  return freezeParameterContract(declaration, sourceName, {
    kind: "type",
    identity,
    displayName,
    bounds: Object.freeze(bounds),
    ...(defaultType === undefined ? {} : { defaultType }),
  });
}

function isRustConstParameterType(type: RustTypeRef): boolean {
  if (type.kind === "primitive") {
    return rustConstParameterPrimitives.has(type.name);
  }
  return type.kind === "source-primitive" &&
    (type.name === "bool" || type.name === "char" || isRustIntegerCarrier(type));
}

const rustConstParameterPrimitives = new Set<RustPrimitive>([
    "bool",
    "char",
    "i8",
    "u8",
    "i16",
    "u16",
    "i32",
    "u32",
    "i64",
    "u64",
    "i128",
    "u128",
    "isize",
    "usize",
  ]);

function freezeParameterContract(
  declaration: Node,
  sourceName: string,
  parameter: RustGenericParameter,
): RustSourceGenericParameterContract {
  return Object.freeze({ declaration, sourceName, parameter: Object.freeze(parameter) });
}

function resolveTraitBound(
  node: Node,
  input: RustSourceGenericAnalysisInput,
): RustTraitRef | undefined {
  const type = input.resolveType(node);
  if (type?.kind !== "path") return undefined;
  const relation = input.providerTypes.find((candidate) =>
    candidate.targetDeclarationKind === "trait" &&
    candidate.targetCarrier.kind === "path" &&
    rustSemanticIdentitiesEqual(candidate.targetCarrier.identity, type.identity));
  return relation === undefined
    ? undefined
    : Object.freeze({
        identity: type.identity,
        displayPath: type.displayPath,
        arguments: type.arguments,
        associatedConstraints: Object.freeze([]),
      });
}

function resolveLifetimeList(
  nodes: readonly Node[],
  input: RustSourceGenericAnalysisInput,
): readonly RustLifetimeRef[] | undefined {
  const result = nodes.map((node) => input.resolveLifetime(node));
  return result.some((lifetime) => lifetime === undefined)
    ? undefined
    : Object.freeze(result as RustLifetimeRef[]);
}

function hasNonLifetimeMarkerBounds(
  nodes: readonly Node[],
  input: RustSourceGenericAnalysisInput,
): boolean {
  return nodes.some((node) => {
    const marker = input.facts.resolve(node, rustSourceTypeContractFactKey) ??
      input.facts.get(node, rustSourceTypeContractFactKey);
    return marker?.kind !== "lifetime-kind" && marker?.kind !== "outlives";
  });
}

function hasNonConstMarkerBounds(
  nodes: readonly Node[],
  input: RustSourceGenericAnalysisInput,
): boolean {
  return nodes.some((node) => {
    const marker = input.facts.resolve(node, rustSourceTypeContractFactKey) ??
      input.facts.get(node, rustSourceTypeContractFactKey);
    return marker?.kind !== "const-parameter";
  });
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
    evidence: ["target.capability=rust.source-generics.exact-semantics"],
  };
}

export const emptyRustSourceGenericIndex: RustSourceGenericIndex = Object.freeze<RustSourceGenericIndex>({
  contractFor() { return undefined; },
  identityContractFor() { return undefined; },
  parameterFor() { return undefined; },
  allContracts() { return Object.freeze([]); },
  lifetimeOutlives(longer, shorter) {
    return longer.kind === "static" ||
      rustLifetimeSemanticKey(longer) === rustLifetimeSemanticKey(shorter);
  },
});
