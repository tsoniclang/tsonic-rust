import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { allocateRustGeneratedName as allocateGeneratedName, rustGeneratedNameComponent } from "../../target-model/names/generated.js";
import { denseNodes, projectMemberNames } from "../project-types/catalog/helpers.js";

import { rustScreamingSnakeIdentifier, rustSnakeCaseIdentifier, rustTargetIdentifier } from "../../target-model/names/identifiers.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import { sourceClassFieldIsTypeOnly, sourceObjectMemberDeclarations, sourceParameterIsProperty } from "@tsonic/target-api/source";

import type { RustExternalProjectBase } from "../../target-model/types/external-project-types.js";
import type { RustProjectTypePolicyHost } from "../../policy/types/project/project-types.js";
import type { RustProjectConstructorSignature, RustProjectMemberSlotCandidate, RustProjectMemberSlotRole, RustProjectTypeDefinition } from "../../target-model/types/project-types.js";

import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import type { RustProjectObjectLayout } from "../../target-model/types/project-types.js";

export function analyzeRustProjectNames(
  host: RustProjectTypePolicyHost,
  definitions: readonly RustProjectTypeDefinition[],
  externalBaseByDeclaration: ReadonlyMap<Node, RustExternalProjectBase> | Pick<WeakMap<Node, RustExternalProjectBase>, "get">,
  constructorsByDefinition: Pick<WeakMap<RustProjectTypeDefinition, readonly RustProjectConstructorSignature[]>, "get">,
  usedModuleNamesBySourceFile: Pick<WeakMap<SourceFile, Set<string>>, "get">,
) {
  const fieldStorageNamesByDefinition = new WeakMap<
    RustProjectTypeDefinition,
    ReadonlyMap<Node, string>
  >();
  const objectLayoutsByDefinition = new WeakMap<RustProjectTypeDefinition, RustProjectObjectLayout>();
  const baseStateFieldNamesByDefinition = new WeakMap<RustProjectTypeDefinition, string>();
  const stateMarkerFieldNamesByDefinition = new WeakMap<RustProjectTypeDefinition, string>();
  for (const definition of definitions) {
    const names = new Map<Node, string>();
    const layout = rustProjectObjectLayout(definition.declaration, host.ast, host.semanticsFor);
    if (layout !== undefined) objectLayoutsByDefinition.set(definition, layout);
    const externalBase = externalBaseByDeclaration.get(definition.declaration);
    const usedNames = projectMemberNames(definition.declaration, host.ast, host.names);
    for (const field of externalBase?.fields ?? []) usedNames.add(rustTargetIdentifier(field.sourceName));
    for (const field of externalBase?.fields ?? []) {
      names.set(
        field.declaration,
        rustTargetIdentifier(field.sourceName),
      );
    }
    for (const member of denseNodes(sourceObjectMemberDeclarations(host.ast, definition.declaration)) ?? []) {
      const kind = host.ast.kindName(member);
      if (definition.kind === "interface" && kind === "KindIndexSignature") {
        names.set(
          member,
          allocateGeneratedName(usedNames, "index_entries"),
        );
        continue;
      }
      if ((kind === "KindMethodDeclaration" || kind === "KindMethodSignature") &&
        !host.ast.hasModifierKind(member, "static")) {
        const implementation = host.navigation.callableImplementation(member);
        const canonical = implementation.kind === "resolved"
          ? implementation.implementation.declaration
          : member;
        const existing = names.get(canonical);
        const targetName = host.names.nameForDeclaration(member);
        if (targetName !== undefined) {
          const storageName = existing ?? allocateGeneratedName(
            usedNames,
            `${rustSnakeCaseIdentifier(targetName)}_override`,
          );
          names.set(member, storageName);
          names.set(canonical, storageName);
        }
        continue;
      }
      const isField = definition.kind === "class"
        ? (kind === "KindPropertyDeclaration" || sourceParameterIsProperty(host.ast, member)) &&
          !sourceClassFieldIsTypeOnly(host.ast, member) &&
          !host.ast.hasModifierKind(member, "static")
        : kind === "KindPropertySignature";
      if (!isField) {
        continue;
      }
      const targetName = host.names.nameForDeclaration(member);
      if (targetName !== undefined) {
        names.set(member, targetName);
      }
    }
    fieldStorageNamesByDefinition.set(definition, names);
    baseStateFieldNamesByDefinition.set(definition, allocateGeneratedName(usedNames, "base"));
    stateMarkerFieldNamesByDefinition.set(
      definition,
      allocateGeneratedName(usedNames, "_type_marker"),
    );
  }

  const memberSlotNames = new WeakMap<Node, Map<RustProjectMemberSlotRole, string>>();
  const canonicalSlotNames = new WeakMap<Node, Map<RustProjectMemberSlotRole, string>>();
  const dispatchUsedNamesByDefinition = new WeakMap<RustProjectTypeDefinition, Set<string>>();
  const callableTargetNames = new WeakMap<Node, string>();
  const setMemberSlotName = (
    declaration: Node,
    role: RustProjectMemberSlotRole,
    name: string,
  ): void => {
    const names = memberSlotNames.get(declaration) ?? new Map<RustProjectMemberSlotRole, string>();
    names.set(role, name);
    memberSlotNames.set(declaration, names);
  };
  const canonicalCallable = (declaration: Node): Node => {
    const implementation = host.navigation.callableImplementation(declaration);
    return implementation.kind === "resolved"
      ? implementation.implementation.declaration
      : declaration;
  };
  for (const definition of definitions) {
    const dispatchUsedNames = projectMemberNames(definition.declaration, host.ast, host.names);
    for (const constructor of constructorsByDefinition.get(definition) ?? []) {
      dispatchUsedNames.add(constructor.targetName);
    }
    dispatchUsedNamesByDefinition.set(definition, dispatchUsedNames);
    const moduleUsedNames = usedModuleNamesBySourceFile.get(definition.sourceFile);
    if (moduleUsedNames === undefined) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust project definition has no module name scope.");
    }
    const candidates: RustProjectMemberSlotCandidate[] = [
      ...(externalBaseByDeclaration.get(definition.declaration)?.fields ?? []).map((field) => ({
        declaration: field.declaration,
        targetName: rustTargetIdentifier(field.sourceName),
        roles: ["read", "write"] as readonly RustProjectMemberSlotRole[],
      })),
    ];
    for (const member of denseNodes(sourceObjectMemberDeclarations(host.ast, definition.declaration)) ?? []) {
      const kind = host.ast.kindName(member);
      const targetName = kind === "KindMethodDeclaration" || kind === "KindMethodSignature"
        ? host.targetNameForCallable(member)
        : host.names.nameForDeclaration(member);
      if (targetName === undefined) {
        continue;
      }
      if (kind === "KindMethodDeclaration" || kind === "KindMethodSignature") {
        callableTargetNames.set(member, targetName);
        if (definition.genericParameters.length > 0 && host.ast.hasModifierKind(member, "static")) {
          const canonical = canonicalCallable(member);
          const slots = canonicalSlotNames.get(canonical) ?? new Map<RustProjectMemberSlotRole, string>();
          const name = slots.get("static") ?? allocateGeneratedName(moduleUsedNames,
            rustSnakeCaseIdentifier(`${definition.targetName}_${host.targetNameForCallable(canonical) ?? targetName}`));
          slots.set("static", name);
          canonicalSlotNames.set(canonical, slots);
          setMemberSlotName(member, "static", name);
          setMemberSlotName(canonical, "static", name);
        }
      }
      if (kind === "KindPropertyDeclaration" && host.ast.hasModifierKind(member, "static")) {
        const staticName = allocateGeneratedName(
          moduleUsedNames,
          rustScreamingSnakeIdentifier(
            `${rustGeneratedNameComponent(definition.targetName)}_${rustGeneratedNameComponent(targetName)}`,
          ),
        );
        setMemberSlotName(member, "static", staticName);
        continue;
      }
      if (kind === "KindPropertyDeclaration" || kind === "KindPropertySignature" ||
        sourceParameterIsProperty(host.ast, member)) {
        candidates.push({ declaration: member, targetName, roles: ["read", "write", "capture"] });
      } else if (kind === "KindGetAccessor") {
        candidates.push({ declaration: member, targetName, roles: ["read"] });
      } else if (kind === "KindSetAccessor") {
        candidates.push({ declaration: member, targetName, roles: ["write"] });
      } else if ((kind === "KindMethodDeclaration" || kind === "KindMethodSignature") &&
        !host.ast.hasModifierKind(member, "static")) {
        candidates.push({
          declaration: member,
          targetName,
          roles: ["virtual", "exact", "method-write"],
        });
      }
    }
    for (const candidate of candidates) {
      for (const role of candidate.roles) {
        const canonical = role === "method-write"
          ? canonicalCallable(candidate.declaration)
          : candidate.declaration;
        const canonicalNames = canonicalSlotNames.get(canonical) ??
          new Map<RustProjectMemberSlotRole, string>();
        const existing = canonicalNames.get(role);
        const preferredRole = role === "virtual"
          ? "dispatch"
          : role === "method-write" ? "replace" : role;
        const name = existing ?? allocateGeneratedName(
          dispatchUsedNames,
          `${preferredRole}_${rustGeneratedNameComponent(definition.targetName)}_${rustGeneratedNameComponent(candidate.targetName)}`,
        );
        canonicalNames.set(role, name);
        setMemberSlotName(candidate.declaration, role, name);
        setMemberSlotName(canonical, role, name);
        canonicalSlotNames.set(canonical, canonicalNames);
      }
    }
  }

  return Object.freeze({ fieldStorageNamesByDefinition, objectLayoutsByDefinition, baseStateFieldNamesByDefinition, stateMarkerFieldNamesByDefinition, memberSlotNames, dispatchUsedNamesByDefinition, callableTargetNames });
}
