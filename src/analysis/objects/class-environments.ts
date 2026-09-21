import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustClosureCaptureFact } from "../facts/keys.js";
import type { RustFactWalk } from "../program/walk.js";
import { collectRustLexicalCaptures } from "../callables/closures.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustSnakeCaseIdentifier } from "../../target-model/names/identifiers.js";
import { Node_Initializer, sourceClassFieldIsTypeOnly } from "@tsonic/target-api/source";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustSourceBindingFactKey } from "../facts/keys.js";

export interface RustClassEnvironment {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly storage: "value" | "shared";
  readonly copy: boolean;
  readonly constructorValue: boolean;
  readonly consumers: readonly Node[];
  readonly initializationUsesEnvironment: boolean;
  readonly instancesUseEnvironment: boolean;
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & {
    readonly fieldName: string;
  })[];
  readonly staticFields: readonly {
    readonly declaration: Node;
    readonly fieldName: string;
    readonly carrier: TargetTypeRef;
    readonly readonly: boolean;
  }[];
}

export type RustClassEnvironmentSelection =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly environment: RustClassEnvironment }
  | { readonly kind: "unresolved"; readonly reason: string };

export function selectRustClassEnvironment(walk: RustFactWalk, declaration: Node): RustClassEnvironmentSelection {
  const { ast, projectTypes, names, facts } = walk.context;
  const definition = projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class") return { kind: "none" };
  const moduleClass = ast.parent(declaration) === ast.getSourceFile(declaration);
  const constructorValue = walk.context.classValues.hasConstructorView(declaration);
  if (moduleClass && !constructorValue) return { kind: "none" };
  const captureRoots = ast.members(declaration).filter((member): member is Node => member !== undefined &&
    !(ast.hasModifierKind(member, "static") && ast.kindName(member) === "KindPropertyDeclaration"));
  const selected = moduleClass ? { captures: [], recursiveDeclaration: undefined } : collectRustLexicalCaptures(walk, declaration, captureRoots);
  if (selected === undefined || selected.recursiveDeclaration !== undefined) {
    return { kind: "unresolved", reason: "Class captures require exact lexical binding and storage facts." };
  }
  const fieldNames = new Set<string>([projectTypes.stateMarkerFieldName(definition)]);
  const captures = selected.captures.map(capture => ({ ...capture,
    fieldName: allocateRustGeneratedName(fieldNames, rustSnakeCaseIdentifier(
      names.nameForDeclaration(capture.declaration) ?? "capture")),
  }));
  const staticFields: RustClassEnvironment["staticFields"][number][] = [];
  for (const member of ast.members(declaration)) {
    if (member === undefined) return { kind: "unresolved", reason: "Class environment has an absent authored member." };
    if (!ast.hasModifierKind(member, "static") || sourceClassFieldIsTypeOnly(ast, member) ||
      ast.kindName(member) !== "KindPropertyDeclaration" || moduleClass) continue;
    if (Node_Initializer(ast, member) === undefined) {
      return { kind: "unresolved", reason: "Local static fields require an exact authored initializer." };
    }
    const carrier = facts.getRuntimeCarrierFact(member)?.carrier;
    const name = names.nameForDeclaration(member);
    if (carrier === undefined || name === undefined) {
      return { kind: "unresolved", reason: "Class static storage requires a finalized carrier and declaration name." };
    }
    staticFields.push({ declaration: member, carrier,
      fieldName: allocateRustGeneratedName(fieldNames, rustSnakeCaseIdentifier(name)),
      readonly: ast.hasModifierKind(member, "readonly"),
    });
  }
  if (captures.length === 0 && staticFields.length === 0 && !constructorValue) return { kind: "none" };
  const capturedDeclarations = new Set(captures.map(capture => capture.declaration));
  const usesEnvironment = (node: Node): boolean => {
    const binding = facts.getFact(node, rustSourceBindingFactKey);
    if (binding !== undefined && (capturedDeclarations.has(binding.sourceDeclaration) || binding.sourceDeclaration === declaration)) return true;
    let used = false;
    ast.forEachChild(node, child => { if (!used && child !== undefined) used = usesEnvironment(child); });
    return used;
  };
  const consumers = ast.members(declaration).filter((member): member is Node => member !== undefined && usesEnvironment(member));
  for (const field of staticFields) {
    let selfReference = false;
    const visit = (node: Node): void => {
      if (facts.getFact(node, rustSourceBindingFactKey)?.sourceDeclaration === declaration) selfReference = true;
      ast.forEachChild(node, child => { if (!selfReference && child !== undefined) visit(child); });
    };
    visit(Node_Initializer(ast, field.declaration)!);
    if (selfReference) return { kind: "unresolved", reason: "Self-referencing static initialization requires an exact staged class-evaluation contract." };
  }
  const copy = !constructorValue && staticFields.length === 0 && captures.every(capture => capture.storage === "value" && isRustCopyCarrier(capture.carrier));
  return { kind: "available", environment: Object.freeze({ declaration, carrier: projectTypes.openCarrier(definition),
    storage: !constructorValue && (copy || staticFields.length === 0 && captures.length === 1 && captures[0]!.storage === "location") ? "value" : "shared",
    copy, constructorValue,
    consumers: Object.freeze(consumers),
    initializationUsesEnvironment: consumers.some(member => ast.kindName(member) === "KindConstructor" ||
      ast.kindName(member) === "KindPropertyDeclaration" && !ast.hasModifierKind(member, "static")),
    instancesUseEnvironment: consumers.some(member => !ast.hasModifierKind(member, "static") &&
      ["KindMethodDeclaration", "KindGetAccessor", "KindSetAccessor"].includes(ast.kindName(member))),
    captures: Object.freeze(captures.map(capture => Object.freeze(capture))),
    staticFields: Object.freeze(staticFields.map(field => Object.freeze(field))),
  }) };
}
