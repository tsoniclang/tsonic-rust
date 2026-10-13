import { createHash } from "node:crypto";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceCallableDefinitionIsDiscarded } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustCallableProtocol, rustLocationTargetType, rustTargetGenericReferences } from "../../target-model/types/index.js";

import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import type { RustLifetimeIndex, RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey, rustStaticLifetime, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { bindRustElidedCallableInput, substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { resolveRustEnclosingGenericParameters } from "../../policy/types/resolution/generic-environment.js";
import { rustCallableImplicitLifetimeParameters } from "./source-input-lifetimes.js";
import type { RustNativeCapturePlan } from "./native-captures.js";

export interface RustSuspendedCallableImplementation {
  readonly declaration: Node;
  readonly sourceFileName: string;
  readonly stateName: string;
  readonly carrier: TargetTypeRef;
  readonly captures: RustClosureCaptureFact["captures"];
  readonly receiverFields: RustClosureCaptureFact["receiverFields"];
  readonly receivers: RustClosureCaptureFact["receivers"];
  readonly storage: readonly TargetTypeRef[];
  readonly environment: ReturnType<typeof rustTargetGenericReferences>;
  readonly signature: ReturnType<typeof rustTargetGenericReferences>;
  readonly parameters: readonly RustSourceGenericParameterContract[];
  readonly elision?: {
    readonly parameterIndex: number;
    readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
  };
}

export interface RustSuspendedCallablePlan {
  readonly implementations: readonly RustSuspendedCallableImplementation[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  implementationFor(node: Node): RustSuspendedCallableImplementation | undefined;
}

export function createRustSuspendedCallablePlan(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  records: RustProgramRecords,
  names: RustNamePlan,
  lifetimes: RustLifetimeIndex,
  nativeCaptures: RustNativeCapturePlan,
): RustSuspendedCallablePlan {
  const selected: Node[] = [];
  const usedNames = new Set<string>();
  const visit = (node: Node): void => {
    if ((ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) &&
      sourceCallableDefinitionIsDiscarded(node, ast)) return;
    const name = names.nameForDeclaration(node);
    if (name !== undefined) usedNames.add(name);
    if (records.closureCapture.get(node)?.invocationOwner === "shared-state") selected.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  selected.sort((left, right) => ast.getFileName(ast.getSourceFile(left)).localeCompare(ast.getFileName(ast.getSourceFile(right)), "en") || ast.pos(left) - ast.pos(right));
  const implementations = new Map<Node, RustSuspendedCallableImplementation>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  for (const declaration of selected) {
    const operation = records.targetOperation.get(declaration);
    const captureFact = records.closureCapture.get(declaration);
    const captures = captureFact?.captures;
    const receiverFields = captureFact?.receiverFields;
    const receivers = captureFact?.receivers;
    const carrier = operation?.kind === "closure" ? operation.resultCarrier : undefined;
    const protocol = rustCallableProtocol(carrier);
    const physical = nativeCaptures.forDeclaration(declaration);
    if (carrier === undefined || protocol === undefined || captures === undefined || receiverFields === undefined || receivers === undefined) {
      issues.push({ subject: declaration, message: "A suspended callable owner has no exact invocation signature and capture storage." });
      continue;
    }
    if (physical.kind === "unresolved") {
      issues.push({ subject: declaration, message: physical.reason });
      continue;
    }
    const sourceFileName = ast.getFileName(ast.getSourceFile(declaration));
    const identity = createHash("sha256").update(`${sourceFileName}:${ast.pos(declaration)}:${ast.end(declaration)}`).digest("hex");
    const storage = Object.freeze([...captures.map((capture, index) => {
      const carrier = substituteElidedLifetime(physical.captures[index]!, rustStaticLifetime);
      return capture.storage === "location" ? rustLocationTargetType(carrier) : carrier;
    }), ...physical.receiverFields.map(carrier => substituteElidedLifetime(carrier, rustStaticLifetime)),
    ...physical.receivers.map(carrier => substituteElidedLifetime(carrier, rustStaticLifetime))]);
    const environment = rustTargetGenericReferences({ kind: "tuple", elements: storage });
    const authoredSignature = rustTargetGenericReferences({ kind: "tuple", elements: [...storage, ...protocol.parameters, protocol.result] });
    const lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }> = {
      kind: "parameter", identity: `suspended-callable:${identity}:input`,
      name: allocateRustGeneratedName(new Set(authoredSignature.lifetimes.map(selected => selected.name)), "input"),
    };
    const bound = authoredSignature.hasUnnameableLifetime && !environment.hasUnnameableLifetime
      ? bindRustElidedCallableInput(protocol.parameters, protocol.result, lifetime) : undefined;
    const signature = bound === undefined ? authoredSignature
      : rustTargetGenericReferences({ kind: "tuple", elements: [...storage, ...bound.parameters, bound.result] });
    if (signature.hasUnnameableLifetime) {
      issues.push({ subject: declaration, message: "A suspended callable signature has no nameable native lifetime contract." });
      continue;
    }
    const nativeIdentities = new Set(physical.inputs.map(input => input.implementation.identity));
    const requested = [...signature.lifetimes.filter(selected => bound === undefined || selected.identity !== lifetime.identity)
      .map(rustLifetimeKey), ...signature.typeIdentities.filter(identity => !nativeIdentities.has(identity))];
    const parameters = resolveRustEnclosingGenericParameters(declaration, requested, ast,
      owner => [...lifetimes.contractFor(owner)?.parameters ?? [],
        ...rustCallableImplicitLifetimeParameters(owner, ast, records)]);
    if (parameters === undefined || signature.constIdentities.length > 0) {
      issues.push({ subject: declaration, message: "A suspended callable state lost its exact enclosing generic parameter declarations." });
      continue;
    }
    implementations.set(declaration, Object.freeze({ declaration, sourceFileName, carrier, captures, receiverFields, receivers, storage,
      stateName: allocateRustGeneratedName(usedNames, `CallableState${identity.slice(0, 12)}`), environment, signature,
      parameters,
      ...(bound === undefined ? {} : { elision: Object.freeze({ parameterIndex: bound.parameterIndex, lifetime }) }),
    }));
  }
  return Object.freeze({ implementations: Object.freeze([...implementations.values()]),
    issues: Object.freeze(issues), implementationFor: (node: Node) => implementations.get(node),
  });
}
