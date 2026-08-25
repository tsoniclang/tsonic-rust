import type {
  AstReader,
  Node,
  ReadonlySourceFactResolver,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import {
  rustSourceDeclarationFactKey,
} from "../../source/semantics/facts.js";
import type {
  RustSourceDeclarationApplication,
  RustSourceDeclarationApplicationFact,
  RustSourceDeclarationFact,
} from "../../source/semantics/model.js";
import type {
  RustAbi,
  RustDialect,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import {
  rustSemanticIdentitiesEqual,
  rustTypeSemanticKey,
} from "../../target-model/semantics/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustProjectTypePolicy } from "../../policy/types/project-types.js";
import type { RustProviderTypeRow } from "../../providers/packages/model.js";
import { selectedSourceIntegerLiteralValue } from "../../policy/types/selected-numeric-literal.js";

export interface RustDeclarationApplicationOccurrence {
  readonly sourceSubject: Node;
  readonly sourceFile: SourceFile;
  readonly fact: RustSourceDeclarationFact;
  readonly targetDeclaration?: Node;
}

export interface RustDeclarationApplicationIndex {
  readonly all: readonly RustDeclarationApplicationOccurrence[];
  forDeclaration(declaration: Node): readonly RustDeclarationApplicationOccurrence[];
  operationForExpression(expression: Node): RustSourceDeclarationFact | undefined;
  isCompileTimeApplicationReference(declaration: Node, reference: Node): boolean;
  requiresTraitRepresentation(declaration: Node): boolean;
}

export interface RustDeclarationImplContract {
  readonly polarity: "positive" | "negative";
  readonly safety: "safe" | "unsafe";
  readonly emission: "project-relation" | "standalone";
  readonly traitTypeNode: Node;
  readonly trait: RustTypeRef;
  readonly sourceSubject: Node;
}

export interface RustDeclarationContract {
  readonly declaration: Node;
  readonly applications: readonly RustDeclarationApplicationOccurrence[];
  readonly abi?: RustAbi;
  readonly variadic: boolean;
  readonly representations: readonly (
    | { readonly kind: "c" | "transparent" }
    | { readonly kind: "packed"; readonly alignment: bigint }
    | { readonly kind: "align"; readonly alignment: bigint }
  )[];
  readonly nativeUnion: boolean;
  readonly mutableStatic: boolean;
  readonly threadLocal: boolean;
  readonly unsafeTrait: boolean;
  readonly traitImpls: readonly RustDeclarationImplContract[];
  readonly nativeDrop: boolean;
}

export interface RustDeclarationContractIndex {
  forDeclaration(declaration: Node | undefined): RustDeclarationContract | undefined;
  allContracts(): readonly RustDeclarationContract[];
  isCompileTimeApplicationExpression(expression: Node): boolean;
}

export type AnalyzeRustDeclarationContractsResult =
  | { readonly kind: "resolved"; readonly index: RustDeclarationContractIndex }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function createRustDeclarationApplicationIndex(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceFacts: ReadonlySourceFactResolver;
  readonly navigation: SourceProgramNavigation;
}): RustDeclarationApplicationIndex {
  const all: RustDeclarationApplicationOccurrence[] = [];
  const byDeclaration = new WeakMap<Node, RustDeclarationApplicationOccurrence[]>();
  const bySubject = new WeakMap<Node, RustSourceDeclarationFact>();
  const traitRepresentations = new WeakSet<Node>();
  for (const sourceFile of input.sourceFiles) {
    walkSource(sourceFile, input.ast, (node) => {
      const fact = input.sourceFacts.getFact(node, rustSourceDeclarationFactKey);
      if (fact === undefined) return;
      const targetDeclaration = projectDeclaration(fact.applicationTarget, input.navigation);
      const occurrence = Object.freeze({
        sourceSubject: node,
        sourceFile,
        fact,
        ...(targetDeclaration === undefined ? {} : { targetDeclaration }),
      });
      all.push(occurrence);
      bySubject.set(node, fact);
      if (targetDeclaration !== undefined) {
        const existing = byDeclaration.get(targetDeclaration) ?? [];
        existing.push(occurrence);
        byDeclaration.set(targetDeclaration, existing);
      }
      if (fact.kind === "application") {
        if (fact.application.operation === "unsafe-trait" && targetDeclaration !== undefined) {
          traitRepresentations.add(targetDeclaration);
        } else if (fact.application.operation === "unsafe-impl" ||
          fact.application.operation === "negative-impl") {
          const traitDeclaration = projectDeclaration(
            fact.application.traitTypeNode,
            input.navigation,
          );
          if (traitDeclaration !== undefined) traitRepresentations.add(traitDeclaration);
        }
      }
    });
  }
  return Object.freeze({
    all: Object.freeze(all),
    forDeclaration(declaration: Node) {
      return byDeclaration.get(declaration) ?? emptyOccurrences;
    },
    operationForExpression(expression: Node) {
      let current: Node | undefined = expression;
      while (current !== undefined) {
        const fact = bySubject.get(current);
        if (fact !== undefined) return fact;
        current = input.ast.parent(current);
      }
      return undefined;
    },
    isCompileTimeApplicationReference(declaration: Node, reference: Node) {
      return (byDeclaration.get(declaration) ?? emptyOccurrences).some((occurrence) =>
        nodeIsWithin(reference, occurrence.sourceSubject, input.ast));
    },
    requiresTraitRepresentation(declaration: Node) {
      return traitRepresentations.has(declaration);
    },
  });
}

export function analyzeRustDeclarationContracts(input: {
  readonly ast: AstReader;
  readonly applications: RustDeclarationApplicationIndex;
  readonly dialect: RustDialect;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly providerTypes: readonly RustProviderTypeRow[];
  resolveType(node: Node): RustTypeRef | undefined;
}): AnalyzeRustDeclarationContractsResult {
  const diagnostics: TargetDiagnostic[] = [];
  const contracts: RustDeclarationContract[] = [];
  const byDeclaration = new WeakMap<Node, RustDeclarationContract>();
  const declarations = new Set(input.applications.all.flatMap((occurrence) =>
    occurrence.targetDeclaration === undefined ? [] : [occurrence.targetDeclaration]));
  for (const declaration of declarations) {
    const contract = declarationContract(
      declaration,
      input.applications.forDeclaration(declaration),
      input,
      diagnostics,
    );
    if (contract !== undefined) {
      contracts.push(contract);
      byDeclaration.set(declaration, contract);
    }
  }
  for (const occurrence of input.applications.all) {
    if (occurrence.targetDeclaration === undefined) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_APPLICATION_TARGET_NOT_PROVEN",
        "Rust declaration control has no exact project declaration target.",
        occurrence.sourceSubject,
      ));
    }
  }
  validateRequiredUnsafeProjectImplementations(
    input,
    byDeclaration,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }
  const frozen = Object.freeze(contracts);
  return {
    kind: "resolved",
    index: Object.freeze({
      forDeclaration(declaration: Node | undefined) {
        return declaration === undefined ? undefined : byDeclaration.get(declaration);
      },
      allContracts() {
        return frozen;
      },
      isCompileTimeApplicationExpression(expression: Node) {
        return input.applications.operationForExpression(expression) !== undefined;
      },
    }),
  };
}

function declarationContract(
  declaration: Node,
  occurrences: readonly RustDeclarationApplicationOccurrence[],
  input: Parameters<typeof analyzeRustDeclarationContracts>[0],
  diagnostics: TargetDiagnostic[],
): RustDeclarationContract | undefined {
  const applications = occurrences.filter((occurrence): occurrence is RustDeclarationApplicationOccurrence & {
    readonly fact: RustSourceDeclarationApplicationFact;
  } => occurrence.fact.kind === "application");
  if (!validateApplicationChains(occurrences, input.ast, diagnostics)) return undefined;
  const byOperation = new Map<RustSourceDeclarationApplication["operation"], typeof applications>();
  for (const occurrence of applications) {
    const operation = occurrence.fact.application.operation;
    const existing = byOperation.get(operation) ?? [];
    byOperation.set(operation, [...existing, occurrence]);
  }
  for (const [operation, values] of byOperation) {
    if (operation !== "unsafe-impl" && operation !== "negative-impl" && values.length > 1) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_CONTROL_DUPLICATE",
        `Rust declaration control '${operation}' may be applied exactly once to a declaration.`,
        values[1]!.sourceSubject,
      ));
    }
  }
  const kind = input.ast.kindName(declaration);
  const callable = isCallableDeclaration(kind);
  const typeDeclaration = isTypeDeclaration(kind);
  const variable = kind === "KindVariableDeclaration";
  const abiOccurrence = oneApplication(byOperation, "extern");
  const abi = abiOccurrence === undefined
    ? undefined
    : readAbi(abiOccurrence.fact.application, abiOccurrence.sourceSubject, input.ast, diagnostics);
  const variadic = hasApplication(byOperation, "variadic");
  const nativeUnion = hasApplication(byOperation, "union");
  const mutableStatic = hasApplication(byOperation, "mutable-static");
  const threadLocal = hasApplication(byOperation, "thread-local");
  const unsafeTrait = hasApplication(byOperation, "unsafe-trait");
  const nativeDrop = hasApplication(byOperation, "drop");
  const enabledFeatures = new Set(input.dialect.enabledLanguageFeatures.map((feature) => feature.name));
  if ((abiOccurrence !== undefined || variadic) && !callable) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_CALLABLE_CONTROL_TARGET_INVALID",
      "Rust ABI and variadic controls require an exact callable declaration.",
      (abiOccurrence ?? oneApplication(byOperation, "variadic"))!.sourceSubject,
    ));
  }
  if (variadic && abi !== "C" && abi !== "cdecl") {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_VARIADIC_ABI_INVALID",
      "A Rust C-variadic callable requires an explicit C or cdecl ABI.",
      oneApplication(byOperation, "variadic")!.sourceSubject,
    ));
  }
  if (variadic && input.ast.body(declaration) !== undefined && !enabledFeatures.has("c_variadic")) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_VARIADIC_DEFINITION_UNSTABLE",
      "Defining a C-variadic Rust function requires the c_variadic language feature in the selected dialect.",
      oneApplication(byOperation, "variadic")!.sourceSubject,
    ));
  }
  if ((nativeUnion || hasLayoutApplication(byOperation)) && !typeDeclaration) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_LAYOUT_TARGET_INVALID",
      "Rust union and representation controls require an exact type declaration.",
      firstLayoutApplication(byOperation)!.sourceSubject,
    ));
  }
  if (nativeUnion && kind !== "KindClassDeclaration") {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_UNION_TARGET_INVALID",
      "A native Rust union requires an exact concrete class declaration so construction and active-field state remain explicit.",
      oneApplication(byOperation, "union")!.sourceSubject,
    ));
  }
  if (nativeUnion && kind === "KindClassDeclaration") {
    const initializedOrConstructedMember = input.ast.members(declaration).find((member) =>
      member !== undefined &&
      (input.ast.kindName(member) === "KindConstructor" ||
        input.ast.kindName(member) === "KindPropertyDeclaration" &&
        Node_Initializer(input.ast, member) !== undefined));
    if (initializedOrConstructedMember !== undefined) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_UNION_CONSTRUCTION_UNSUPPORTED",
        "A project-native Rust union is an exact declaration-only ABI type; constructors and field initializers cannot prove one active field.",
        initializedOrConstructedMember,
      ));
    }
    const construction = input.navigation.declarationUses(declaration).find((use) =>
      use.kind !== "source-linkage" && use.kind !== "type-only" &&
      directNewExpressionFor(use.reference, input.ast) !== undefined);
    if (construction !== undefined) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_UNION_CONSTRUCTION_UNSUPPORTED",
        "A project-native Rust union cannot be constructed with new because TypeScript construction does not identify one exact active Rust field.",
        directNewExpressionFor(construction.reference, input.ast)!,
      ));
    }
  }
  if ((mutableStatic || threadLocal) && !variable) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_STORAGE_TARGET_INVALID",
      "Rust static storage controls require an exact variable declaration.",
      (oneApplication(byOperation, "mutable-static") ?? oneApplication(byOperation, "thread-local"))!.sourceSubject,
    ));
  }
  if ((mutableStatic || threadLocal) && variable &&
    !isTopLevelVariableDeclaration(declaration, input.ast)) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_STORAGE_SCOPE_INVALID",
      "Rust static and thread-local controls require an exact top-level variable declaration.",
      (oneApplication(byOperation, "mutable-static") ?? oneApplication(byOperation, "thread-local"))!.sourceSubject,
    ));
  }
  if (mutableStatic && variable && input.ast.variableDeclarationKind(declaration) === "const") {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_MUTABLE_STATIC_CONST_INVALID",
      "Rust mutable-static control requires an authored let or var declaration, not const.",
      oneApplication(byOperation, "mutable-static")!.sourceSubject,
    ));
  }
  if (mutableStatic && threadLocal) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_STORAGE_CONTROLS_CONFLICT",
      "Rust mutable-static and thread-local storage are independent, incompatible storage forms.",
      oneApplication(byOperation, "thread-local")!.sourceSubject,
    ));
  }
  if (unsafeTrait && kind !== "KindInterfaceDeclaration") {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_UNSAFE_TRAIT_TARGET_INVALID",
      "Rust unsafe-trait control requires an exact interface declaration emitted as a trait.",
      oneApplication(byOperation, "unsafe-trait")!.sourceSubject,
    ));
  }
  if ((byOperation.has("unsafe-impl") || byOperation.has("negative-impl")) && !typeDeclaration) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_TRAIT_IMPL_TARGET_INVALID",
      "Rust trait implementation controls require an exact type declaration.",
      (oneApplication(byOperation, "unsafe-impl") ?? oneApplication(byOperation, "negative-impl"))!.sourceSubject,
    ));
  }
  if (byOperation.has("negative-impl") && !enabledFeatures.has("negative_impls")) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_NEGATIVE_IMPL_UNSTABLE",
      "Negative Rust implementations require the negative_impls language feature in the selected dialect.",
      oneApplication(byOperation, "negative-impl")!.sourceSubject,
    ));
  }
  if (nativeDrop && (kind !== "KindMethodDeclaration" || input.ast.body(declaration) === undefined)) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_DROP_TARGET_INVALID",
      "Rust Drop control requires an exact method declaration with a body.",
      oneApplication(byOperation, "drop")!.sourceSubject,
    ));
  }
  if (nativeDrop && input.navigation.declarationUses(declaration).some((use) =>
    use.kind !== "source-linkage" && use.kind !== "type-only" &&
    !input.applications.isCompileTimeApplicationReference(declaration, use.reference))) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_DROP_RUNTIME_USE_INVALID",
      "A method selected as native Drop cannot also be invoked as an ordinary source method.",
      oneApplication(byOperation, "drop")!.sourceSubject,
    ));
  }
  if (nativeDrop && nativeUnion) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_UNION_DROP_INVALID",
      "A native Rust union cannot also own a native Drop implementation.",
      oneApplication(byOperation, "drop")!.sourceSubject,
    ));
  }
  const representations = layoutRepresentations(byOperation, input.ast, diagnostics);
  const traitImpls = traitImplementationContracts(byOperation, input, diagnostics);
  if (representations === undefined || traitImpls === undefined) return undefined;
  if (representations.some((entry) => entry.kind === "transparent") && representations.length > 1) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_TRANSPARENT_LAYOUT_CONFLICT",
      "repr(transparent) cannot be combined with another explicit Rust representation control.",
      oneApplication(byOperation, "repr-transparent")!.sourceSubject,
    ));
  }
  return Object.freeze({
    declaration,
    applications: Object.freeze([...occurrences]),
    ...(abi === undefined ? {} : { abi }),
    variadic,
    representations,
    nativeUnion,
    mutableStatic,
    threadLocal,
    unsafeTrait,
    traitImpls,
    nativeDrop,
  });
}

function validateApplicationChains(
  occurrences: readonly RustDeclarationApplicationOccurrence[],
  ast: AstReader,
  diagnostics: TargetDiagnostic[],
): boolean {
  const bySubject = new Map(occurrences.map((occurrence) =>
    [occurrence.sourceSubject, occurrence] as const));
  let valid = true;
  for (const occurrence of occurrences) {
    if (occurrence.fact.kind !== "application") continue;
    const predecessor = occurrence.fact.predecessor === undefined
      ? undefined
      : bySubject.get(occurrence.fact.predecessor);
    if (predecessor === undefined ||
      predecessor.fact.applicationTarget !== occurrence.fact.applicationTarget ||
      ast.getSourceFile(predecessor.sourceSubject) !== occurrence.sourceFile) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_APPLICATION_CHAIN_INVALID",
        "Rust declaration control does not have one exact same-target predecessor in the checked source chain.",
        occurrence.sourceSubject,
      ));
      valid = false;
    }
  }
  return valid;
}

function readAbi(
  application: RustSourceDeclarationApplication,
  sourceSubject: Node,
  ast: AstReader,
  diagnostics: TargetDiagnostic[],
): RustAbi | undefined {
  if (application.operation !== "extern" || !ast.is.IsStringLiteral(application.abiExpression)) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_ABI_NOT_LITERAL",
      "Rust extern ABI must be one exact authored string literal.",
      sourceSubject,
    ));
    return undefined;
  }
  const value = ast.text(application.abiExpression);
  if (!rustAbiNames.has(value)) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_ABI_UNSUPPORTED",
      `Rust ABI '${value}' is not supported by the selected target dialect.`,
      sourceSubject,
    ));
    return undefined;
  }
  return value as RustAbi;
}

function layoutRepresentations(
  byOperation: ReadonlyMap<RustSourceDeclarationApplication["operation"], readonly (RustDeclarationApplicationOccurrence & { readonly fact: RustSourceDeclarationApplicationFact })[]>,
  ast: AstReader,
  diagnostics: TargetDiagnostic[],
): RustDeclarationContract["representations"] | undefined {
  const values: RustDeclarationContract["representations"][number][] = [];
  if (hasApplication(byOperation, "repr-c")) values.push({ kind: "c" });
  if (hasApplication(byOperation, "repr-transparent")) values.push({ kind: "transparent" });
  for (const operation of ["repr-packed", "repr-align"] as const) {
    const occurrence = oneApplication(byOperation, operation);
    if (occurrence === undefined) continue;
    const application = occurrence.fact.application;
    const expression = application.operation === "repr-packed" || application.operation === "repr-align"
      ? application.alignmentExpression
      : undefined;
    const alignment = expression === undefined
      ? undefined
      : selectedSourceIntegerLiteralValue(expression, ast);
    if (alignment === undefined || alignment <= 0n || alignment > 536_870_912n ||
      (alignment & (alignment - 1n)) !== 0n) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_ALIGNMENT_INVALID",
        "Rust packed/alignment control requires a positive power-of-two integer no greater than 2^29.",
        occurrence.sourceSubject,
      ));
      return undefined;
    }
    values.push({ kind: operation === "repr-packed" ? "packed" : "align", alignment });
  }
  return Object.freeze(values);
}

function traitImplementationContracts(
  byOperation: ReadonlyMap<RustSourceDeclarationApplication["operation"], readonly (RustDeclarationApplicationOccurrence & { readonly fact: RustSourceDeclarationApplicationFact })[]>,
  input: Parameters<typeof analyzeRustDeclarationContracts>[0],
  diagnostics: TargetDiagnostic[],
): readonly RustDeclarationImplContract[] | undefined {
  const diagnosticCount = diagnostics.length;
  const result: RustDeclarationImplContract[] = [];
  const identities = new Map<string, "positive" | "negative">();
  for (const operation of ["unsafe-impl", "negative-impl"] as const) {
    for (const occurrence of byOperation.get(operation) ?? []) {
      const application = occurrence.fact.application;
      if (application.operation !== operation) continue;
      const trait = input.resolveType(application.traitTypeNode);
      if (trait === undefined) {
        diagnostics.push(diagnostic(
          "RUST_DECLARATION_TRAIT_IMPL_TYPE_NOT_PROVEN",
          "Rust trait implementation control has no exact finalized trait type.",
          occurrence.sourceSubject,
        ));
        continue;
      }
      const identity = rustTypeSemanticKey(trait);
      const polarity = operation === "negative-impl" ? "negative" : "positive";
      const existingPolarity = identities.get(identity);
      if (existingPolarity !== undefined) {
        diagnostics.push(diagnostic(
          existingPolarity === polarity
            ? "RUST_DECLARATION_TRAIT_IMPL_DUPLICATE"
            : "RUST_DECLARATION_TRAIT_IMPL_POLARITY_CONFLICT",
          existingPolarity === polarity
            ? "The same Rust trait implementation control is applied more than once."
            : "Positive and negative Rust implementations cannot target the same exact trait.",
          occurrence.sourceSubject,
        ));
        continue;
      }
      identities.set(identity, polarity);
      const emission = traitImplementationEmission(
        occurrence.targetDeclaration,
        trait,
        operation,
        occurrence.sourceSubject,
        input,
        diagnostics,
      );
      if (emission === undefined) continue;
      result.push(Object.freeze({
        polarity,
        safety: operation === "unsafe-impl" ? "unsafe" : "safe",
        emission,
        traitTypeNode: application.traitTypeNode,
        trait,
        sourceSubject: occurrence.sourceSubject,
      }));
    }
  }
  return diagnostics.length !== diagnosticCount ? undefined : Object.freeze(result);
}

function traitImplementationEmission(
  targetDeclaration: Node | undefined,
  trait: RustTypeRef,
  operation: "unsafe-impl" | "negative-impl",
  sourceSubject: Node,
  input: Parameters<typeof analyzeRustDeclarationContracts>[0],
  diagnostics: TargetDiagnostic[],
): RustDeclarationImplContract["emission"] | undefined {
  const traitDefinition = input.projectTypes.definitionForCarrier(trait);
  if (traitDefinition !== undefined) {
    if (traitDefinition.kind !== "interface") {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_TRAIT_IMPL_TYPE_INVALID",
        "Rust trait implementation control selected a project type that is not an interface trait.",
        sourceSubject,
      ));
      return undefined;
    }
    const unsafeTrait = declarationHasApplication(
      input.applications,
      traitDefinition.declaration,
      "unsafe-trait",
    );
    if (operation === "unsafe-impl" && !unsafeTrait) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_SAFE_TRAIT_UNSAFE_IMPL_INVALID",
        "An unsafe implementation requires an exact unsafe trait declaration; safety is not inferred from the implementation marker.",
        sourceSubject,
      ));
      return undefined;
    }
    const targetDefinition = input.projectTypes.definitionForDeclaration(targetDeclaration);
    const relation = targetDefinition === undefined
      ? { kind: "unrelated" as const }
      : input.projectTypes.relationship(
          input.projectTypes.openCarrier(targetDefinition),
          traitDefinition,
        );
    const generated = relation.kind === "related" &&
      rustTargetTypeRefEquals(relation.targetType, trait);
    if (generated) {
      if (operation === "negative-impl") {
        diagnostics.push(diagnostic(
          "RUST_DECLARATION_NEGATIVE_IMPL_POSITIVE_RELATION_CONFLICT",
          "A negative Rust implementation conflicts with the exact positive TypeScript heritage relation.",
          sourceSubject,
        ));
        return undefined;
      }
      return "project-relation";
    }
    if (operation === "unsafe-impl" && projectTraitRequiresImplementationItems(
      traitDefinition.declaration,
      input.ast,
    )) {
      diagnostics.push(diagnostic(
        "RUST_DECLARATION_STANDALONE_TRAIT_IMPL_ITEMS_UNAVAILABLE",
        "A standalone Rust implementation cannot synthesize required trait items; use an exact TypeScript heritage relation so implementations are selected structurally.",
        sourceSubject,
      ));
      return undefined;
    }
    return "standalone";
  }
  const providerTraits = input.providerTypes.filter((row) =>
    row.targetDeclarationKind === "trait" && sameProviderTraitIdentity(row.targetCarrier, trait));
  if (providerTraits.length !== 1) {
    diagnostics.push(diagnostic(
      providerTraits.length === 0
        ? "RUST_DECLARATION_TRAIT_IMPL_IDENTITY_NOT_PROVEN"
        : "RUST_DECLARATION_TRAIT_IMPL_IDENTITY_AMBIGUOUS",
      providerTraits.length === 0
        ? "Rust trait implementation control has no exact project or provider trait identity."
        : "Rust trait implementation control resolves to more than one provider trait contract.",
      sourceSubject,
    ));
    return undefined;
  }
  const providerTrait = providerTraits[0]!;
  if (operation === "unsafe-impl" && providerTrait.targetTraitSafety !== "unsafe") {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_SAFE_PROVIDER_TRAIT_UNSAFE_IMPL_INVALID",
      "An unsafe implementation requires an exact provider trait declared unsafe.",
      sourceSubject,
    ));
    return undefined;
  }
  if (operation === "unsafe-impl" && providerTrait.targetTraitRequiresImplementationItems === true) {
    diagnostics.push(diagnostic(
      "RUST_DECLARATION_PROVIDER_TRAIT_IMPL_ITEMS_UNAVAILABLE",
      "The selected provider trait requires implementation items that are not supplied by this standalone declaration control.",
      sourceSubject,
    ));
    return undefined;
  }
  return "standalone";
}

function validateRequiredUnsafeProjectImplementations(
  input: Parameters<typeof analyzeRustDeclarationContracts>[0],
  contracts: WeakMap<Node, RustDeclarationContract>,
  diagnostics: TargetDiagnostic[],
): void {
  for (const definition of input.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    const interfaces = input.projectTypes.interfacesForClass(definition);
    if (interfaces === undefined) continue;
    const contract = contracts.get(definition.declaration);
    for (const traitDefinition of interfaces) {
      if (!declarationHasApplication(
        input.applications,
        traitDefinition.declaration,
        "unsafe-trait",
      )) continue;
      const relation = input.projectTypes.relationship(
        input.projectTypes.openCarrier(definition),
        traitDefinition,
      );
      if (relation.kind !== "related") continue;
      const matching = contract?.traitImpls.filter((implementation) =>
        implementation.emission === "project-relation" &&
        rustTargetTypeRefEquals(implementation.trait, relation.targetType)) ?? [];
      if (matching.length !== 1 || matching[0]!.safety !== "unsafe") {
        diagnostics.push(diagnostic(
          "RUST_DECLARATION_UNSAFE_PROJECT_IMPL_REQUIRED",
          "A class implementing an exact unsafe project trait requires one explicit unsafeImpl<Trait>() declaration control.",
          definition.declaration,
        ));
      }
    }
  }
}

function declarationHasApplication(
  applications: RustDeclarationApplicationIndex,
  declaration: Node,
  operation: RustSourceDeclarationApplication["operation"],
): boolean {
  return applications.forDeclaration(declaration).some((occurrence) =>
    occurrence.fact.kind === "application" &&
    occurrence.fact.application.operation === operation);
}

function projectTraitRequiresImplementationItems(
  declaration: Node,
  ast: AstReader,
): boolean {
  return ast.members(declaration).some((member) => member !== undefined);
}

function sameProviderTraitIdentity(left: RustTypeRef, right: RustTypeRef): boolean {
  return left.kind === "path" && right.kind === "path" &&
    rustSemanticIdentitiesEqual(left.identity, right.identity);
}

function oneApplication<T extends RustSourceDeclarationApplication["operation"]>(
  byOperation: ReadonlyMap<RustSourceDeclarationApplication["operation"], readonly (RustDeclarationApplicationOccurrence & { readonly fact: RustSourceDeclarationApplicationFact })[]>,
  operation: T,
): (RustDeclarationApplicationOccurrence & { readonly fact: RustSourceDeclarationApplicationFact & { readonly application: Extract<RustSourceDeclarationApplication, { readonly operation: T }> } }) | undefined {
  return byOperation.get(operation)?.[0] as (RustDeclarationApplicationOccurrence & { readonly fact: RustSourceDeclarationApplicationFact & { readonly application: Extract<RustSourceDeclarationApplication, { readonly operation: T }> } }) | undefined;
}

function hasApplication(
  byOperation: ReadonlyMap<RustSourceDeclarationApplication["operation"], readonly unknown[]>,
  operation: RustSourceDeclarationApplication["operation"],
): boolean {
  return (byOperation.get(operation)?.length ?? 0) > 0;
}

function hasLayoutApplication(
  byOperation: ReadonlyMap<RustSourceDeclarationApplication["operation"], readonly unknown[]>,
): boolean {
  return ["repr-c", "repr-transparent", "repr-packed", "repr-align"].some((operation) =>
    hasApplication(byOperation, operation as RustSourceDeclarationApplication["operation"]));
}

function firstLayoutApplication(
  byOperation: ReadonlyMap<RustSourceDeclarationApplication["operation"], readonly (RustDeclarationApplicationOccurrence & { readonly fact: RustSourceDeclarationApplicationFact })[]>,
): RustDeclarationApplicationOccurrence | undefined {
  return oneApplication(byOperation, "union") ?? oneApplication(byOperation, "repr-c") ??
    oneApplication(byOperation, "repr-transparent") ?? oneApplication(byOperation, "repr-packed") ??
    oneApplication(byOperation, "repr-align");
}

function projectDeclaration(
  subject: Node,
  navigation: SourceProgramNavigation,
): Node | undefined {
  return navigation.sourceReferenceFor(subject)?.declaration ??
    navigation.referenceFor(subject)?.declaration ??
    navigation.declarationFor(subject) ??
    (navigation.isProjectDeclaration(subject) ? subject : undefined);
}

function isCallableDeclaration(kind: string | undefined): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" || kind === "KindCallSignature";
}

function isTypeDeclaration(kind: string | undefined): boolean {
  return kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration" ||
    kind === "KindEnumDeclaration";
}

function isTopLevelVariableDeclaration(declaration: Node, ast: AstReader): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined && ast.kindName(current) !== "KindVariableStatement") {
    const parent = ast.parent(current);
    if (parent === undefined || ast.kindName(parent) === "KindSourceFile") return false;
    current = parent;
  }
  const parent = current === undefined ? undefined : ast.parent(current);
  return parent !== undefined && ast.kindName(parent) === "KindSourceFile";
}

function nodeIsWithin(node: Node, ancestor: Node, ast: AstReader): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = ast.parent(current);
  }
  return false;
}

function directNewExpressionFor(reference: Node, ast: AstReader): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined) return undefined;
    const kind = ast.kindName(parent);
    if (isTransparent(kind)) {
      current = parent;
      continue;
    }
    return kind === "KindNewExpression" && Node_Expression(ast, parent) === current
      ? parent
      : undefined;
  }
}

function isTransparent(kind: string | undefined): boolean {
  return kind === "KindParenthesizedExpression" || kind === "KindAsExpression" ||
    kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression" ||
    kind === "KindTypeAssertionExpression";
}

function walkSource(node: Node, ast: AstReader, visit: (node: Node) => void): void {
  visit(node);
  ast.forEachChild(node, (child) => {
    if (child !== undefined) walkSource(child, ast, visit);
  });
}

function diagnostic(code: string, message: string, sourceNode: Node): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    sourceNode,
    evidence: ["target.capability=rust.declarations.explicit-contract"],
  };
}

const rustAbiNames = new Set<string>([
  "Rust", "C", "C-unwind", "system", "system-unwind", "cdecl", "stdcall",
  "fastcall", "vectorcall", "thiscall", "aapcs", "win64", "sysv64", "efiapi",
]);

const emptyOccurrences = Object.freeze([]) as readonly RustDeclarationApplicationOccurrence[];
