import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { sourceClassFieldIsTypeOnly } from "@tsonic/target-api/source";
import { rustNativePropertyNameIssue } from "../../objects/computed-field-names.js";
import { appendRustDiagnostic, rustResolutionContext } from "../../program/walk.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { resolveRustTargetTypeRef } from "./resolution/source.js";
import { setCarrierFact } from "../../operations/project-calls.js";
import { resolveRustAuthoredTargetType } from "./resolution/tuples.js";

export function resolveTypeNodeCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  return resolveTypeNode(walk, typeNode, undefined);
}

export function resolveTypeNodeContract(walk: RustFactWalk, typeNode: Node | undefined,
  declaration: Node): TargetTypeRef | undefined {
  return resolveTypeNode(walk, typeNode, declaration);
}

function resolveTypeNode(walk: RustFactWalk, typeNode: Node | undefined, contractOwner: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) return undefined;
  if (walk.rejectedExpressions.has(typeNode)) return undefined;
  const semantics = walk.context.semanticsFor(typeNode);
  const requiredType = semantics.types.authoredType(typeNode);
  let rejectedName = false;
  if (requiredType !== undefined) {
    for (const property of semantics.types.propertyInfos(requiredType)) {
      for (const symbol of new Set([property.symbol, ...property.rootSymbols])) {
        for (const member of semantics.declarations.symbolDeclarations(symbol)) {
          if (!walk.context.source.navigation.isProjectDeclaration(member) ||
            sourceClassFieldIsTypeOnly(walk.context.ast, member)) continue;
          const name = walk.context.ast.name(member);
          if (name === undefined) continue;
          const selectedName = walk.context.semanticsFor(member).propertyNames.get(name);
          if (selectedName === undefined) {
            if (walk.context.ast.is.IsComputedPropertyName(name)) failTargetAnalysisInvariant("tsonic-rust",
              "A native computed field requires its completed checked property-name selection.", name);
            continue;
          }
          const issue = rustNativePropertyNameIssue(name, selectedName);
          if (issue === undefined) continue;
          if (!walk.rejectedExpressions.has(name)) appendRustDiagnostic(walk, issue.code, issue.message, name, []);
          rejectedName = true;
        }
      }
    }
  }
  if (rejectedName) {
    walk.rejectedExpressions.add(typeNode);
    return undefined;
  }
  if (contractOwner !== undefined) return requiredType === undefined ? undefined : resolveRustAuthoredTargetType(typeNode,
    { ...rustResolutionContext(walk, contractOwner), callableRepresentation: "signature" }, walk.operationOptions, new Set<object>());
  const existing = walk.context.records.runtimeCarrier.get(typeNode);
  if (existing !== undefined) return existing.carrier;
  const carrier = resolveRustTargetTypeRef(typeNode, rustResolutionContext(walk, typeNode), walk.operationOptions);
  return carrier === undefined ? undefined : setCarrierFact(walk, typeNode, carrier);
}
