import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  rustSourceGenericParameterFactKey,
  rustSourceTypeContractFactKey,
} from "../../source/semantics/facts.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { rustSnakeCaseIdentifier } from "../../target-model/names/identifiers.js";
import {
  rustPlaceholderLifetime,
  rustStaticLifetime,
} from "../../target-model/lifetimes/index.js";
import type {
  RustLifetimeIndex,
  RustLifetimeRef,
  RustSourceGenericContract,
  RustSourceGenericParameterContract,
} from "../../target-model/lifetimes/index.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";

export interface AnalyzeRustLifetimesInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  referencedDeclaration(node: Node): Node | undefined;
}

export interface AnalyzeRustLifetimesResult {
  readonly index?: RustLifetimeIndex;
  readonly diagnostics: readonly TargetDiagnostic[];
}

export function analyzeRustLifetimes(
  input: AnalyzeRustLifetimesInput,
): AnalyzeRustLifetimesResult {
  const diagnostics: TargetDiagnostic[] = [];
  const declarations = collectGenericDeclarations(input.ast, input.sourceFiles);
  if (declarations === undefined) {
    return {
      diagnostics: [diagnostic(
        "RUST_LIFETIME_SOURCE_AST_INVALID",
        "A source generic declaration contains an undefined parameter slot.",
      )],
    };
  }
  const parameterByDeclaration = new WeakMap<Node, RustSourceGenericParameterContract>();
  const contracts: RustSourceGenericContract[] = [];
  const unresolved = new Map<Node, {
    readonly owner: Node;
    readonly sourceName: string;
    readonly targetName: string;
    readonly kind: "lifetime" | "type";
  }>();

  for (const owner of declarations) {
    for (const parameter of input.ast.typeParameters(owner) as readonly Node[]) {
      const fact = readFact(input.facts, parameter, rustSourceGenericParameterFactKey);
      const nameNode = input.ast.name(parameter);
      const sourceName = nameNode === undefined ? "" : input.ast.text(nameNode);
      const targetName = input.names.nameForDeclaration(parameter) ?? "";
      if (fact === undefined || fact.owner !== owner || fact.parameter !== parameter ||
        sourceName.length === 0 || targetName.length === 0) {
        diagnostics.push(diagnostic(
          "RUST_LIFETIME_GENERIC_IDENTITY_MISSING",
          "A generic parameter has no exact finalized owner, kind, and target name.",
          parameter,
        ));
        continue;
      }
      unresolved.set(parameter, {
        owner,
        sourceName,
        targetName,
        kind: fact.kind,
      });
    }
  }

  const resolve = (node: Node | undefined): RustLifetimeRef | undefined => {
    if (node === undefined) return undefined;
    const typeFact = readFact(input.facts, node, rustSourceTypeContractFactKey);
    if (typeFact?.kind === "static-lifetime") return rustStaticLifetime;
    if (typeFact?.kind === "lifetime-kind") return rustPlaceholderLifetime;
    const declaration = referencedTypeParameter(node, input);
    if (declaration === undefined) return undefined;
    const registered = unresolved.get(declaration);
    if (registered?.kind !== "lifetime") return undefined;
    const identity = parameterIdentity(declaration, input.ast, "lifetime");
    return identity === undefined
      ? undefined
      : Object.freeze({
          kind: "parameter" as const,
          identity,
          name: rustSnakeCaseIdentifier(registered.sourceName),
        });
  };

  for (const owner of declarations) {
    const parameters: RustSourceGenericParameterContract[] = [];
    for (const parameter of input.ast.typeParameters(owner) as readonly Node[]) {
      const registered = unresolved.get(parameter);
      const fact = readFact(input.facts, parameter, rustSourceGenericParameterFactKey);
      if (registered === undefined || fact === undefined) continue;
      const outlivesNodes = fact.kind === "lifetime" ? fact.outlives : fact.typeOutlives;
      const outlives = outlivesNodes.map(resolve);
      if (outlives.some((lifetime) => lifetime === undefined ||
        lifetime.kind === "placeholder")) {
        diagnostics.push(diagnostic(
          "RUST_LIFETIME_BOUND_NOT_PROVEN",
          "A Rust outlives bound has no exact named or static lifetime identity.",
          parameter,
        ));
        continue;
      }
      const contract: RustSourceGenericParameterContract = fact.kind === "lifetime"
        ? (() => {
            const lifetime = resolve(parameter);
            if (lifetime?.kind !== "parameter") {
              throw new Error("Registered Rust lifetime parameter lost its exact identity.");
            }
            return Object.freeze({
              kind: "lifetime" as const,
              declaration: parameter,
              sourceName: registered.sourceName,
              lifetime,
              outlives: Object.freeze(outlives as RustLifetimeRef[]),
            });
          })()
        : Object.freeze({
            kind: "type" as const,
            declaration: parameter,
            sourceName: registered.sourceName,
            targetName: registered.targetName,
            outlives: Object.freeze(outlives as RustLifetimeRef[]),
            maybeSized: fact.maybeSized,
          });
      parameterByDeclaration.set(parameter, contract);
      parameters.push(contract);
    }
    if (parameters.length === input.ast.typeParameters(owner).length) {
      contracts.push(Object.freeze({
        declaration: owner,
        parameters: Object.freeze(parameters),
      }));
    }
  }

  if (diagnostics.length > 0) return { diagnostics: Object.freeze(diagnostics) };
  const contractByDeclaration = new WeakMap<Node, RustSourceGenericContract>();
  for (const contract of contracts) contractByDeclaration.set(contract.declaration, contract);
  return {
    index: Object.freeze({
      contractFor(declaration) {
        return declaration === undefined ? undefined : contractByDeclaration.get(declaration);
      },
      parameterFor(declaration) {
        return declaration === undefined ? undefined : parameterByDeclaration.get(declaration);
      },
      resolve,
      allContracts() {
        return Object.freeze([...contracts]);
      },
    }),
    diagnostics: Object.freeze([]),
  };
}

function collectGenericDeclarations(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): readonly Node[] | undefined {
  const declarations: Node[] = [];
  let malformed = false;
  const visit = (node: Node): void => {
    if (isGenericOwner(ast.kindName(node))) {
      const parameters = ast.typeParameters(node);
      if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
        malformed = true;
        return;
      }
      if (parameters.length > 0) declarations.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined && !malformed) visit(child);
    });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  return malformed ? undefined : Object.freeze(declarations);
}

function isGenericOwner(kind: string | undefined): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" || kind === "KindConstructor" ||
    kind === "KindConstructSignature" || kind === "KindCallSignature" ||
    kind === "KindFunctionType" || kind === "KindConstructorType" ||
    kind === "KindGetAccessor" || kind === "KindSetAccessor" ||
    kind === "KindClassDeclaration" || kind === "KindClassExpression" ||
    kind === "KindInterfaceDeclaration" || kind === "KindTypeAliasDeclaration";
}

function referencedTypeParameter(
  node: Node,
  input: AnalyzeRustLifetimesInput,
): Node | undefined {
  if (input.ast.is.IsTypeParameterDeclaration(node) &&
    readFact(input.facts, node, rustSourceGenericParameterFactKey)?.kind === "lifetime") {
    return node;
  }
  if (!input.ast.is.IsTypeReferenceNode(node)) return undefined;
  const typeName = input.ast.as.AsTypeReferenceNode(node)?.TypeName;
  const declaration = typeName === undefined
    ? undefined
    : input.referencedDeclaration(typeName);
  return declaration !== undefined &&
      readFact(input.facts, declaration, rustSourceGenericParameterFactKey)?.kind === "lifetime"
    ? declaration
    : undefined;
}

function parameterIdentity(
  declaration: Node,
  ast: AstReader,
  role: string,
): string | undefined {
  const occurrence = sourceNodeIdentity(ast, declaration);
  return occurrence === undefined ? undefined : `${role}\0${occurrence}`;
}

function readFact<T>(
  facts: RustPlanQueries,
  subject: Node,
  key: import("@tsonic/tsts").ExtensionFactKey<T>,
): T | undefined {
  return facts.resolve(subject, key) ?? facts.get(subject, key);
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
    evidence: ["target.capability=rust.lifetimes.exact-source-contract"],
  };
}
