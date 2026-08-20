import type {
  TsonicSafetyApplicationFact,
  TsonicSafetyBuilderFact,
  TsonicUnsafeContextFact,
} from "@tsonic/source-core/facts";
import type {
  AstReader,
  Node,
  ReadonlySourceFactResolver,
  SourceFile,
} from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  readRustSourceSafetyBuilder,
  readRustSourceUnsafeContext,
} from "../../policy/safety/source-explicit-safety.js";

export interface RustSafetyApplicationFactIndex {
  readonly all: readonly RustSafetyApplication[];
  forSourceFile(sourceFile: SourceFile): readonly RustSafetyApplication[];
  forDeclaration(declaration: Node): readonly RustSafetyApplication[];
  isCompileTimeApplicationReference(
    declaration: Node,
    reference: Node,
  ): boolean;
  operationForSubject(subject: Node): RustSafetyOperation | undefined;
  operationForExpression(expression: Node): RustSafetyOperation | undefined;
}

export interface RustSafetyApplication extends TsonicSafetyApplicationFact {
  readonly sourceSubject: Node;
  readonly sourceFile: SourceFile;
  readonly selectedMemberDeclarations: readonly Node[];
  readonly resolvedRootDeclaration?: Node;
  readonly targetDeclarations: readonly Node[];
}

export type RustSafetyOperation =
  | { readonly kind: "unsafe-context"; readonly fact: TsonicUnsafeContextFact }
  | { readonly kind: "safety-builder"; readonly fact: TsonicSafetyBuilderFact };

export interface RustSafetyApplicationFactIndexInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceFacts: ReadonlySourceFactResolver;
  readonly navigation: SourceProgramNavigation;
}

export function createRustSafetyApplicationFactIndex(
  input: RustSafetyApplicationFactIndexInput,
): RustSafetyApplicationFactIndex {
  const all: RustSafetyApplication[] = [];
  const bySourceFile = new Map<SourceFile, readonly RustSafetyApplication[]>();
  const byDeclaration = new Map<Node, RustSafetyApplication[]>();
  const bySubject = new Map<Node, RustSafetyOperation>();
  for (const sourceFile of input.sourceFiles) {
    const applications: RustSafetyApplication[] = [];
    walkSourceFile(sourceFile, input.ast, (node) => {
      const unsafeContext = readRustSourceUnsafeContext(input.sourceFacts, node);
      if (unsafeContext !== undefined) {
        bySubject.set(node, { kind: "unsafe-context", fact: unsafeContext });
      }
      const builder = readRustSourceSafetyBuilder(input.sourceFacts, node);
      if (builder === undefined) {
        return;
      }
      bySubject.set(node, { kind: "safety-builder", fact: builder });
      if (builder.kind !== "application") {
        return;
      }
      const application = resolveApplication(node, sourceFile, builder, input);
      applications.push(application);
      all.push(application);
      for (const declaration of application.targetDeclarations) {
        const existing = byDeclaration.get(declaration) ?? [];
        existing.push(application);
        byDeclaration.set(declaration, existing);
      }
    });
    bySourceFile.set(sourceFile, Object.freeze(applications));
  }
  return Object.freeze({
    all: Object.freeze(all),
    forSourceFile: (sourceFile: SourceFile) =>
      bySourceFile.get(sourceFile) ?? emptyApplications,
    forDeclaration: (declaration: Node) =>
      byDeclaration.get(declaration) ?? emptyApplications,
    isCompileTimeApplicationReference(declaration: Node, reference: Node) {
      return (byDeclaration.get(declaration) ?? emptyApplications).some(
        (application) => nodeIsWithin(reference, application.sourceSubject, input.ast),
      );
    },
    operationForSubject: (subject: Node) => bySubject.get(subject),
    operationForExpression(expression: Node) {
      let current: Node | undefined = expression;
      while (current !== undefined) {
        const operation = bySubject.get(current);
        if (operation !== undefined) {
          return operation;
        }
        current = input.ast.kindName(current) === "KindParenthesizedExpression"
          ? Node_Expression(input.ast, current)
          : undefined;
      }
      return undefined;
    },
  });
}

function nodeIsWithin(node: Node, ancestor: Node, ast: AstReader): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === ancestor) {
      return true;
    }
    current = ast.parent(current);
  }
  return false;
}

function resolveApplication(
  sourceSubject: Node,
  sourceFile: SourceFile,
  fact: TsonicSafetyApplicationFact,
  input: RustSafetyApplicationFactIndexInput,
): RustSafetyApplication {
  const selectedMemberDeclarations = Object.freeze(
    [
      ...(fact.selectedMemberDeclarations ?? []),
      fact.selectedMemberDeclaration,
      fact.selectedMember,
    ].filter((subject): subject is Node => isAstNode(input.ast, subject)),
  );
  const applicationTarget = isAstNode(input.ast, fact.applicationTarget)
    ? fact.applicationTarget
    : undefined;
  const resolvedRootDeclaration = applicationTarget === undefined
    ? undefined
    : projectDeclaration(applicationTarget, input);
  const application: Omit<RustSafetyApplication, "targetDeclarations"> = {
    ...fact,
    sourceSubject,
    sourceFile,
    selectedMemberDeclarations,
    ...(resolvedRootDeclaration === undefined ? {} : { resolvedRootDeclaration }),
  };
  return Object.freeze({
    ...application,
    targetDeclarations: applicationDeclarations(application, input.ast),
  });
}

function projectDeclaration(
  subject: Node,
  input: RustSafetyApplicationFactIndexInput,
): Node | undefined {
  return input.navigation.referenceFor(subject)?.declaration ??
    input.navigation.declarationFor(subject) ??
    (input.navigation.isProjectDeclaration(subject) ? subject : undefined);
}

function applicationDeclarations(
  application: Omit<RustSafetyApplication, "targetDeclarations">,
  ast: AstReader,
): readonly Node[] {
  switch (application.applicationPlacement) {
    case "declaration":
      return uniqueNodes([
        ...application.selectedMemberDeclarations,
        application.resolvedRootDeclaration,
      ]);
    case "constructor": {
      const owner = application.resolvedRootDeclaration;
      return owner === undefined || !ast.is.IsClassDeclaration(owner)
        ? []
        : uniqueNodes([
            owner,
            ...ast.members(owner).filter(
              (member): member is Node =>
                member !== undefined && ast.is.IsConstructorDeclaration(member),
            ),
          ]);
    }
    case "getter":
    case "setter":
      return application.selectedMemberDeclarations;
  }
}

function isAstNode(ast: AstReader, subject: unknown): subject is Node {
  return typeof subject === "object" && subject !== null &&
    ast.kind(subject as Node) !== undefined;
}

function uniqueNodes(nodes: readonly (Node | undefined)[]): readonly Node[] {
  return Object.freeze([...new Set(nodes.filter(
    (node): node is Node => node !== undefined,
  ))]);
}

function walkSourceFile(
  sourceFile: SourceFile,
  ast: AstReader,
  visit: (node: Node) => void,
): void {
  const pending: Node[] = [sourceFile];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    visit(node);
    const children = ast.children(node).filter(
      (child): child is Node => child !== undefined,
    );
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]!);
    }
  }
}

const emptyApplications = Object.freeze([]) as readonly RustSafetyApplication[];
