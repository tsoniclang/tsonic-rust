import { createHash } from "node:crypto";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustCallableProtocol, rustLocationTargetType, rustTargetGenericReferences } from "../../target-model/types/index.js";
import { rustClosureCaptureFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustClosureCaptureFact } from "../facts/operations/keys.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import type { RustLifetimeIndex, RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";

export interface RustSuspendedCallableImplementation {
  readonly declaration: Node;
  readonly sourceFileName: string;
  readonly stateName: string;
  readonly carrier: TargetTypeRef;
  readonly captures: RustClosureCaptureFact["captures"];
  readonly storage: readonly TargetTypeRef[];
  readonly environment: ReturnType<typeof rustTargetGenericReferences>;
  readonly signature: ReturnType<typeof rustTargetGenericReferences>;
  readonly parameters: readonly RustSourceGenericParameterContract[];
}

export interface RustSuspendedCallablePlan {
  readonly implementations: readonly RustSuspendedCallableImplementation[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  implementationFor(node: Node): RustSuspendedCallableImplementation | undefined;
}

export function createRustSuspendedCallablePlan(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  names: RustNamePlan,
  lifetimes: RustLifetimeIndex,
): RustSuspendedCallablePlan {
  const selected: Node[] = [];
  const usedNames = new Set<string>();
  const visit = (node: Node): void => {
    const name = names.nameForDeclaration(node);
    if (name !== undefined) usedNames.add(name);
    if (facts.getFact(node, rustClosureCaptureFactKey)?.invocationOwner === "shared-state") selected.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  selected.sort((left, right) => ast.getFileName(ast.getSourceFile(left)).localeCompare(ast.getFileName(ast.getSourceFile(right)), "en") || ast.pos(left) - ast.pos(right));
  const implementations = new Map<Node, RustSuspendedCallableImplementation>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  for (const declaration of selected) {
    const operation = facts.getFact(declaration, rustTargetOperationFactKey);
    const captures = facts.getFact(declaration, rustClosureCaptureFactKey)?.captures;
    const carrier = operation?.kind === "closure" ? operation.resultCarrier : undefined;
    const protocol = rustCallableProtocol(carrier);
    if (carrier === undefined || protocol === undefined || captures === undefined) {
      issues.push({ subject: declaration, message: "A suspended callable owner has no exact invocation signature and capture storage." });
      continue;
    }
    const sourceFileName = ast.getFileName(ast.getSourceFile(declaration));
    const identity = createHash("sha256").update(`${sourceFileName}:${ast.pos(declaration)}:${ast.end(declaration)}`).digest("hex");
    const storage = Object.freeze(captures.map(capture => capture.storage === "location"
      ? rustLocationTargetType(capture.carrier) : capture.carrier));
    const environment = rustTargetGenericReferences({ kind: "tuple", elements: storage });
    const signature = rustTargetGenericReferences({ kind: "tuple", elements: [...storage, ...protocol.parameters, protocol.result] });
    if (signature.hasUnnameableLifetime) {
      issues.push({ subject: declaration, message: "A suspended callable signature has no nameable native lifetime contract." });
      continue;
    }
    const available = new Map<string, RustSourceGenericParameterContract>();
    for (let owner: Node | undefined = declaration; owner !== undefined; owner = ast.parent(owner)) {
      for (const parameter of lifetimes.contractFor(owner)?.parameters ?? []) {
        const key = parameter.kind === "type" ? parameter.targetName : parameter.lifetime.identity;
        if (!available.has(key)) available.set(key, parameter);
      }
    }
    const requested = [...signature.lifetimes.map(lifetime => lifetime.identity), ...signature.typeNames];
    const parameters = requested.map(key => available.get(key));
    if (parameters.some(parameter => parameter === undefined) || signature.constIdentities.length > 0) {
      issues.push({ subject: declaration, message: "A suspended callable state lost its exact enclosing generic parameter declarations." });
      continue;
    }
    implementations.set(declaration, Object.freeze({ declaration, sourceFileName, carrier, captures, storage,
      stateName: allocateRustGeneratedName(usedNames, `CallableState${identity.slice(0, 12)}`), environment, signature,
      parameters: Object.freeze(parameters as RustSourceGenericParameterContract[]),
    }));
  }
  return Object.freeze({ implementations: Object.freeze([...implementations.values()]),
    issues: Object.freeze(issues), implementationFor: (node: Node) => implementations.get(node),
  });
}
