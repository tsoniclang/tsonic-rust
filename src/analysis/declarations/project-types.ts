import { requireRustRecord } from "../program/records/required-records.js";
import {
  ClassStaticBlock_Body,
  KindClassStaticBlockDeclaration,
  Node_Initializer,
  Node_Type,
  sourceClassFieldIsTypeOnly,
  sourceObjectMemberDeclarations,
  sourceParameterIsProperty,
} from "@tsonic/target-api/source";

import { appendRustDiagnostic, rustOperationContext, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { selectRustCapturedFieldStorage } from "../../policy/ownership/captured-field-storage.js";

import { finalizeRustCallableSignature } from "../callables/calls/signature-query.js";
import { recordCallableDefaultParameterFacts, recordParameterAbiFacts } from "../callables/values/parameter-facts.js";
import { recordStatementFacts } from "../control-flow/statements.js";
import { resolveTypeNodeCarrier } from "../source-evidence/types/source-carriers.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { setCarrierFact } from "../operations/project-calls.js";
import { sourceTypeCarrierForDeclaration } from "../operations/inputs.js";
import { rustClassReceiverCarriers } from "./classes/receivers.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCapturedFieldStorageFact } from "../../target-model/records/receiver-captures.js";
import { rustSourceTypeDeclarations } from "../project-types/source-declarations.js";
import { closeRustSuspendedStorage } from "../../policy/types/storage/suspended-storage.js";
import { rustNativePropertyNameIssue } from "../objects/computed-field-names.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustSourceStorageSubjectContext } from "../source-evidence/types/resolution/source-storage-projection.js";
import { resolveRustTargetType } from "../source-evidence/types/resolution/target.js";

export function recordMethodSelfModeFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  for (const sourceFile of sourceFiles) {
    for (const statement of rustSourceTypeDeclarations(sourceFile, ast, walk.context.isNativeNode)) {
      if (ast.kindName(statement) !== "KindClassDeclaration" && ast.kindName(statement) !== "KindClassExpression") {
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
          requireRustRecord(walk.context.requiredRecords, "selfMode", member, "class-method", "recordMethodSelfModeFacts");
          walk.context.records.selfModes.method(member, mode);
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
  if (ast.kindName(declaration) !== "KindClassExpression") setCarrierFact(walk, declaration, classCarrier);
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  for (const constructor of definition === undefined ? [] : walk.context.projectTypes.constructorsForDefinition(definition)) {
    if (!constructor.implicit) continue;
    for (const parameter of constructor.parameters) recordParameterAbiFacts(walk, parameter.parameterDeclaration);
  }
  const members = requireDenseSourceNodes(walk, sourceObjectMemberDeclarations(ast, declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (sourceClassFieldIsTypeOnly(ast, member)) continue;
    const name = ast.name(member);
    const selectedName = name === undefined ? undefined : walk.context.semanticsFor(member).propertyNames.get(name);
    if (name !== undefined && selectedName === undefined && ast.is.IsComputedPropertyName(name)) {
      failTargetAnalysisInvariant("tsonic-rust", "A native computed field requires its completed checked property-name selection.", name);
    }
    if (name !== undefined && selectedName !== undefined) {
      const issue = rustNativePropertyNameIssue(name, selectedName);
      if (issue !== undefined) {
        if (!walk.rejectedExpressions.has(name)) appendRustDiagnostic(walk, issue.code, issue.message, name, []);
        continue;
      }
    }
    if (memberKind === KindClassStaticBlockDeclaration) {
      continue;
    }
    if (memberKind === "KindPropertyDeclaration" || sourceParameterIsProperty(ast, member)) {
      const fieldCarrier = sourceParameterIsProperty(ast, member)
        ? walk.context.records.runtimeCarrier.get(member)?.carrier
        : walk.context.callableOwnership.componentForSlot(member) !== undefined
          ? resolveRustTargetType(walk.context.semanticsFor(member).types.expressionType(member),
            rustResolutionContext(walk, member), walk.operationOptions, new Set(), Node_Type(ast, member))
        : resolveRustTargetTypeRef(member, rustSourceStorageSubjectContext(
          rustOperationContext(walk, member), undefined), walk.operationOptions);
      if (fieldCarrier !== undefined) {
        const storage = closeRustSuspendedStorage(fieldCarrier, "field");
        if (storage === undefined) {
          appendRustDiagnostic(walk, "RUST_FIELD_STORAGE_LIFETIME_NOT_CLOSED",
            "The field's suspended storage has no exact enclosing native lifetime contract.", member,
            ["target.capability=rust.field.suspended-storage"]);
        } else {
          setCarrierFact(walk, member, storage);
          walk.context.records.capturedFieldStoragePlans.resolve(walk, member, storage);
        }
      }
      continue;
    }
    if (memberKind === "KindConstructor") {
      const parameters = requireDenseSourceNodes(walk,
        sourceCallableValueParameters(ast, member, walk.context.semanticsFor(member)), "Class callable contains an undefined or non-data parameter slot.");
      if (parameters === undefined) {
        return;
      }
      for (const parameter of parameters) {
        recordParameterAbiFacts(walk, parameter);
        if (sourceParameterIsProperty(ast, parameter)) {
          const name = ast.name(parameter);
          const carrier = walk.context.records.runtimeCarrier.get(parameter)?.carrier;
          if (name !== undefined && carrier !== undefined) {
            setCarrierFact(walk, name, carrier);
            requireRustRecord(walk.context.requiredRecords, "sourceBinding", name, "parameter-property", "analysis/declarations/project-types.ts");
            walk.context.records.sourceBindings.lexical(name, parameter, ast.text(name));
            requireRustRecord(walk.context.requiredRecords, "sourceParameterAbi", name, "parameter-property", "analysis/declarations/project-types.ts");
            walk.context.records.sourceParameterAbis.use(name, parameter);
          }
        }
      }
    } else if (memberKind === "KindMethodDeclaration" || memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      finalizeRustCallableSignature(walk, member);
    }
  }
}

export function selectRustCapturedFieldStorageFact(
  walk: RustFactWalk, member: Node, carrier: TargetTypeRef,
): RustCapturedFieldStorageFact | undefined {
  const captures = walk.context.objectRepresentations.receiverCaptures;
  if (!captures.isCaptured(member)) return undefined;
  const storageDeclaration = captures.storageDeclaration(member);
  const storageCarrier = storageDeclaration === member ? carrier : resolveRustTargetTypeRef(
    storageDeclaration, rustResolutionContext(walk, storageDeclaration), walk.operationOptions);
  if (storageCarrier === undefined) {
    appendRustDiagnostic(walk, "RUST_CAPTURED_FIELD_STORAGE_NOT_CLOSED",
      "A retained override family has no exact physical declaration carrier.", member,
      ["target.capability=rust.field.capture-storage"]);
    return undefined;
  }
  return { storage: selectRustCapturedFieldStorage(storageCarrier, captures.storageReadonly(member), captures.isDeferred(member),
    captures.storageImmutable(member)), valueCarrier: carrier };
}

export function recordClassBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const receivers = rustClassReceiverCarriers(walk, declaration);
  if (receivers === undefined) {
    return;
  }
  const previousThis = walk.currentThisCarrier;
  const previousSuper = walk.currentSuperCarrier;
  walk.currentThisCarrier = receivers.thisCarrier;
  walk.currentSuperCarrier = receivers.superCarrier;
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
      const fieldCarrier = walk.context.records.runtimeCarrier.get(member)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(ast, member));
      if (initializer !== undefined && fieldCarrier !== undefined) {
        resolveExpressionCarrier(walk, initializer, sourceFile, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration" ||
      memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      const asyncFact = walk.context.records.asyncFunction.get(member);
      const generatorFact = walk.context.records.generator.get(member);
      const returnCarrier = memberKind !== "KindConstructor"
        ? generatorFact?.returnType ?? asyncFact?.outputCarrier ??
          walk.context.records.sourceCallableReturn.get(member)?.returnCarrier
        : undefined;
      const previousMethod = walk.currentMethodDeclaration;
      const previousCallable = walk.currentCallableDeclaration;
      const previousGenerator = walk.currentGeneratorDeclaration;
      walk.currentMethodDeclaration = memberKind === "KindConstructor" ? undefined : member;
      walk.currentCallableDeclaration = member;
      walk.currentGeneratorDeclaration = generatorFact === undefined ? undefined : member;
      recordCallableDefaultParameterFacts(walk, member);
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
      const fieldCarrier = resolveRustTargetTypeRef(member,
        rustSourceStorageSubjectContext(rustResolutionContext(walk, member), undefined), walk.operationOptions);
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
    } else if (memberKind === "KindMethodSignature" || memberKind === "KindConstructSignature") {
      if (memberKind === "KindMethodSignature") {
        requireRustRecord(walk.context.requiredRecords, "selfMode", member, "interface-method", "analysis/declarations/project-types.ts");
        walk.context.records.selfModes.method(member, "ref");
      }
      finalizeRustCallableSignature(walk, member);
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
