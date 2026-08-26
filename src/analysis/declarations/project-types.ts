import {
  ClassStaticBlock_Body,
  KindClassStaticBlockDeclaration,
  Node_Initializer,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustGeneratorFactKey,
  rustSelfModeFactKey,
  rustSourceCallableReturnFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic } from "../program/walk.js";
import {
  recordCallableSuspensionFacts,
  recordCallableTypeSignatureFacts,
  rustImplicitCallableReceiverLifetime,
} from "../callables/signatures.js";
import {
  rustArgumentModeForSourceContract,
  validateOwnershipExpressionAgainstContract,
} from "./types-and-bindings.js";
import { recordStatementFacts, resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustUnitTargetType } from "../../target-model/types/index.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { sourceTypeCarrierForDeclaration } from "../operations/inputs.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceOwnershipContractForType } from "../../policy/ownership/source-callable-abi.js";
import { rustResolutionContext } from "../program/walk.js";

export function recordMethodSelfModeFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const { ast } = walk.context;
  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      if (ast.kindName(statement) !== "KindClassDeclaration") {
        continue;
      }
      const members = requireDenseSourceNodes(walk, ast.members(statement), "Class declaration contains an undefined or non-data member slot.");
      if (members === undefined) {
        return;
      }
      for (const member of members) {
        if ((ast.kindName(member) === "KindMethodDeclaration" ||
            ast.kindName(member) === "KindGetAccessor" ||
            ast.kindName(member) === "KindSetAccessor") &&
          !ast.hasModifierKind(member, "static")) {
          const mode = walk.context.objectRepresentations.methodSelfMode(member);
          walk.context.facts.set(member, rustSelfModeFactKey, { mode }, [
            { message: `rust ${mode} project object method self mode` },
          ]);
        }
      }
    }
  }
}

export function recordClassSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  const classCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (classCarrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, classCarrier);
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === KindClassStaticBlockDeclaration) {
      continue;
    }
    if (memberKind === "KindPropertyDeclaration") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration" ||
      memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      if (memberKind !== "KindConstructor") {
        recordCallableSuspensionFacts(walk, member);
      }
      const instanceMember = memberKind !== "KindConstructor" &&
        !ast.hasModifierKind(member, "static");
      const receiverLifetime = instanceMember
        ? rustImplicitCallableReceiverLifetime(walk, member)
        : undefined;
      if (instanceMember && receiverLifetime === undefined) {
        continue;
      }
      recordCallableTypeSignatureFacts(walk, member, {
        recordReturn: memberKind !== "KindConstructor",
        ...(memberKind === "KindSetAccessor"
          ? { returnCarrier: rustUnitTargetType() }
          : {}),
        ...(receiverLifetime === undefined ? {} : { receiverLifetime }),
      });
    }
  }
}

export function recordClassBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const classCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (classCarrier === undefined) {
    return;
  }
  const previousThis = walk.currentThisCarrier;
  const previousSuper = walk.currentSuperCarrier;
  walk.currentThisCarrier = classCarrier;
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  walk.currentSuperCarrier = definition === undefined
    ? undefined
    : walk.context.projectTypes.heritageForDefinition(definition).find((edge) =>
        edge.kind === "extends" && edge.target.kind === "class")?.targetType ??
      walk.context.projectTypes.externalBaseForDefinition(definition)?.targetType;
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    walk.currentThisCarrier = previousThis;
    walk.currentSuperCarrier = previousSuper;
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === KindClassStaticBlockDeclaration) {
      const previousStaticThis: TargetTypeRef | undefined = walk.currentThisCarrier;
      const previousStaticSuper: TargetTypeRef | undefined = walk.currentSuperCarrier;
      walk.currentThisCarrier = undefined;
      walk.currentSuperCarrier = undefined;
      const body = ClassStaticBlock_Body(ast, member);
      const statements = body === undefined
        ? undefined
        : requireDenseSourceNodes(
            walk,
            ast.statements(body),
            "Class static block contains an undefined or non-data statement slot.",
          );
      if (body === undefined) {
        appendMalformedSourceAst(
          walk,
          "Class static block has no exact body node.",
        );
      } else if (statements !== undefined) {
        for (const statement of statements) {
          recordStatementFacts(walk, statement, sourceFile, undefined);
        }
      }
      walk.currentThisCarrier = previousStaticThis;
      walk.currentSuperCarrier = previousStaticSuper;
      continue;
    }
    if (memberKind === "KindPropertyDeclaration") {
      const initializer = Node_Initializer(ast, member);
      const fieldCarrier = walk.context.facts.get(member, rustRuntimeCarrierKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(ast, member));
      if (initializer !== undefined && fieldCarrier !== undefined) {
        resolveExpressionCarrier(walk, initializer, sourceFile, fieldCarrier);
        const sourceContract = rustSourceOwnershipContractForType(
          Node_Type(ast, member),
          rustResolutionContext(walk, member),
        );
        validateOwnershipExpressionAgainstContract(
          walk,
          initializer,
          rustArgumentModeForSourceContract(sourceContract),
          sourceContract === "ordinary" ? undefined : sourceContract,
        );
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration" ||
      memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      const asyncFact = walk.context.facts.get(member, rustAsyncFunctionFactKey);
      const generatorFact = walk.context.facts.get(member, rustGeneratorFactKey);
      const returnCarrier = memberKind !== "KindConstructor"
        ? generatorFact?.returnType ?? asyncFact?.outputCarrier ??
          walk.context.facts.get(member, rustSourceCallableReturnFactKey)?.returnCarrier
        : undefined;
      const previousMethod = walk.currentMethodDeclaration;
      const previousCallable = walk.currentCallableDeclaration;
      const previousGenerator = walk.currentGeneratorDeclaration;
      walk.currentMethodDeclaration = memberKind === "KindConstructor" ? undefined : member;
      walk.currentCallableDeclaration = member;
      walk.currentGeneratorDeclaration = generatorFact === undefined ? undefined : member;
      const body = ast.body(member);
      if (body !== undefined) {
        const statements = requireDenseSourceNodes(walk, ast.statements(body), "Class callable body contains an undefined or non-data statement slot.");
        if (statements === undefined) {
          walk.currentMethodDeclaration = previousMethod;
          walk.currentCallableDeclaration = previousCallable;
          walk.currentGeneratorDeclaration = previousGenerator;
          walk.currentThisCarrier = previousThis;
          walk.currentSuperCarrier = previousSuper;
          return;
        }
        for (const statement of statements) {
          recordStatementFacts(walk, statement, sourceFile, returnCarrier);
        }
      }
      walk.currentMethodDeclaration = previousMethod;
      walk.currentCallableDeclaration = previousCallable;
      walk.currentGeneratorDeclaration = previousGenerator;
    }
  }
  walk.currentThisCarrier = previousThis;
  walk.currentSuperCarrier = previousSuper;
}

export function recordInterfaceFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Interface declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertySignature") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
    } else if (memberKind === "KindIndexSignature") {
      const parameters = requireDenseSourceNodes(
        walk,
        ast.parameters(member),
        "Interface index signature contains an undefined key parameter slot.",
      );
      const keyParameter = parameters?.length === 1 ? parameters[0] : undefined;
      const keyCarrier = keyParameter === undefined
        ? undefined
        : resolveTypeNodeCarrier(walk, Node_Type(ast, keyParameter));
      const valueCarrier = resolveTypeNodeCarrier(walk, Node_Type(ast, member));
      if (keyParameter === undefined || keyCarrier === undefined || valueCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_INTERFACE_INDEX_SIGNATURE_NOT_CLOSED",
          "Interface index signatures require one exact key carrier and one exact value carrier.",
          member,
          ["target.capability=rust.project-index-signature"],
        );
        continue;
      }
      setCarrierFact(walk, keyParameter, keyCarrier);
      setCarrierFact(walk, member, valueCarrier);
    } else if (memberKind === "KindMethodSignature") {
      walk.context.facts.set(member, rustSelfModeFactKey, { mode: "ref" }, [
        { message: "rust reference-backed project interface method self mode" },
      ]);
      const receiverLifetime = rustImplicitCallableReceiverLifetime(walk, member);
      if (receiverLifetime === undefined) {
        continue;
      }
      recordCallableTypeSignatureFacts(walk, member, {
        receiverLifetime,
      });
    }
  }
}

export function appendMalformedSourceAstDiagnostic(context: RustAnalysisContext, message: string): void {
  context.diagnostics.push({
    code: "RUST_SOURCE_AST_INCOMPLETE",
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.source-ast.closed"],
  });
}

export function appendMalformedSourceAst(walk: RustFactWalk, message: string): void {
  appendMalformedSourceAstDiagnostic(walk.context, message);
}
