import { createHash } from "node:crypto";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustGenericCallableSignature } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { rustClosureCaptureFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustClosureCaptureFact } from "../facts/operations/keys.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustAsyncFunctionFactKey, rustGeneratorFactKey } from "../facts/keys.js";

export interface RustGenericCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly sourceFileName: string;
  readonly variantName: string;
  readonly stateName: string;
  readonly functionName: string;
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly substitutions: readonly (readonly [string, TargetTypeRef])[];
}

export interface RustGenericCallableDefinition {
  readonly identity: string;
  readonly targetName: string;
  readonly storage: "value" | "shared";
  readonly ownerFileName: string;
  readonly signature: RustGenericCallableSignature;
  readonly implementations: readonly RustGenericCallableImplementation[];
}

export interface RustGenericCallablePlan {
  readonly definitions: readonly RustGenericCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  definitionFor(carrier: TargetTypeRef): RustGenericCallableDefinition | undefined;
  implementationFor(declaration: Node): RustGenericCallableImplementation | undefined;
}

export function createRustGenericCallablePlan(
  ast: AstReader, sourceFiles: readonly SourceFile[], facts: RustPlanQueries, names: RustNamePlan,
  navigation: SourceProgramNavigation,
): RustGenericCallablePlan {
  const groups = new Map<string, { signature: RustGenericCallableSignature; implementations: RustGenericCallableImplementation[] }>();
  const implementations = new Map<Node, RustGenericCallableImplementation>();
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const usedNames = new Set<string>();
  const closures: Node[] = [];
  const visit = (node: Node): void => {
    for (const name of [names.nameForDeclaration(node), names.functionNameForDeclaration(node), names.callableValueNameForDeclaration(node)]) {
      if (name !== undefined) usedNames.add(name);
    }
    if (facts.getFact(node, rustTargetOperationFactKey)?.kind === "closure") closures.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  closures.sort((left, right) => ast.getFileName(ast.getSourceFile(left)).localeCompare(ast.getFileName(ast.getSourceFile(right)), "en") || ast.pos(left) - ast.pos(right));
  for (const node of closures) {
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    const carrier = operation?.kind === "closure" ? operation.resultCarrier : undefined;
    const value = rustGenericCallableValue(carrier);
    if (carrier !== undefined && value !== undefined) {
      const capture = facts.getFact(node, rustClosureCaptureFactKey);
      const signatureKey = closedMetadataKey(value.signature);
      const identity = createHash("sha256").update(signatureKey).digest("hex");
      const sourceFileName = ast.getFileName(ast.getSourceFile(node));
      const implementationIdentity = createHash("sha256").update(`${sourceFileName}:${ast.pos(node)}:${ast.end(node)}`).digest("hex");
      const substitutions = new Map<string, TargetTypeRef>();
      for (const [index, argument] of value.environment.entries()) {
        if (argument.kind === "type-parameter") substitutions.set(argument.name,
          { kind: "type-parameter", name: value.signature.environmentParameters[index]! });
      }
      const captures = capture?.captures.map(selected => Object.freeze({ ...selected,
        storageCarrier: snapshotClosedMetadata(substituteRustTargetTypeParameters(selected.carrier, substitutions)),
      }));
      if (sourceFileName.length === 0 || capture === undefined || captures === undefined ||
        capture.recursiveDeclaration !== undefined || captures.some(selected =>
          rustTargetTypeParameterNames(selected.storageCarrier).some(name => !value.signature.environmentParameters.includes(name)))) {
        issues.push({ subject: node, message: "A generic callable environment has no exact closed capture contract; recursive or hidden existential captures are not erased." });
      } else {
        const implementation = Object.freeze({ declaration: node, carrier, sourceFileName,
          variantName: allocateRustGeneratedName(usedNames, `Implementation${implementationIdentity.slice(0, 12)}`),
          stateName: allocateRustGeneratedName(usedNames, `CallableEnvironment${implementationIdentity.slice(0, 12)}`),
          functionName: allocateRustGeneratedName(usedNames, `call_generic_${implementationIdentity.slice(0, 12)}`),
          captures: Object.freeze(captures), substitutions: snapshotClosedMetadata([...substitutions]),
        });
        const group = groups.get(identity);
        if (group !== undefined && closedMetadataKey(group.signature) !== signatureKey) {
          issues.push({ subject: node, message: "Generic callable identities collided; no environment can be selected." });
        } else {
          const selected = group ?? { signature: snapshotClosedMetadata(value.signature), implementations: [] };
          selected.implementations.push(implementation);
          groups.set(identity, selected);
          implementations.set(node, implementation);
        }
      }
    }
  }
  const definitions = [...groups].sort(([left], [right]) => left.localeCompare(right, "en")).map(([identity, group]) => {
    group.implementations.sort((left, right) => left.sourceFileName.localeCompare(right.sourceFileName, "en") || ast.pos(left.declaration) - ast.pos(right.declaration));
    const storage = group.implementations.every(implementation => {
      const flow = navigation.expressionValueFlow(implementation.declaration);
      return !flow.escapes && !flow.identityCompared && !flow.hasUnclassifiedUse && !flow.captured &&
        facts.getFact(implementation.declaration, rustAsyncFunctionFactKey) === undefined &&
        facts.getFact(implementation.declaration, rustGeneratorFactKey) === undefined &&
        implementation.captures.every(capture => capture.storage === "value" && isRustCopyCarrier(capture.storageCarrier));
    }) ? "value" as const : "shared" as const;
    return Object.freeze({ identity, targetName: allocateRustGeneratedName(usedNames, `GenericCallable${identity.slice(0, 12)}`),
      storage,
      ownerFileName: group.implementations[0]!.sourceFileName, signature: group.signature,
      implementations: Object.freeze(group.implementations),
    });
  });
  const bySignature = new Map(definitions.map(definition => [closedMetadataKey(definition.signature), definition]));
  return Object.freeze({ definitions: Object.freeze(definitions), issues: Object.freeze(issues),
    definitionFor(carrier: TargetTypeRef) {
      const value = rustGenericCallableValue(carrier);
      return value === undefined ? undefined : bySignature.get(closedMetadataKey(value.signature));
    },
    implementationFor: (declaration: Node) => implementations.get(declaration),
  });
}
