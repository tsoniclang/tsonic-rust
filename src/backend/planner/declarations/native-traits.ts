import type { Node } from "@tsonic/tsts";
import type { RustImplFunction, RustItem } from "../../target-ast/nodes.js";
import { rustReferenceReceiver } from "../../target-ast/builders.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { projectCallableShape, projectMemberImplementation, projectOwnMethods } from "../objects/polymorphism/model.js";
import { rustProjectGenerics } from "../objects/polymorphism/names.js";
import { planProjectDispatchTrait } from "../objects/polymorphism/traits.js";
import { rustProjectObjectDispatchField } from "../objects/project-objects.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planProjectMethod } from "./methods.js";
import { rustProjectTraitImplementationSafety } from "./explicit-contracts.js";

export function planRustNativeTraitDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  const contract = context.input.program.declarationContracts.forDeclaration(declaration);
  if (definition?.kind !== "interface" || contract?.unsafeTrait !== true) return undefined;
  const carrier = context.input.program.projectTypes.openCarrier(definition);
  const dispatch = planProjectDispatchTrait(definition, carrier, context);
  const generics = rustProjectGenerics(definition, context);
  if (dispatch === undefined || generics === undefined) return undefined;
  const functions = projectOwnMethods(definition, context).map((member) => {
    const name = context.input.program.projectTypes.callableTargetName(member);
    const shape = projectCallableShape(member, context);
    return name === undefined || shape === undefined
      ? undefined
      : Object.freeze({
          name,
          generics: shape.generics,
          receiver: rustReferenceReceiver(false),
          params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
          ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
          ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
          ...(shape.isUnsafe ? { isUnsafe: true } : {}),
        });
  });
  if (functions.some((fn) => fn === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.native-trait-signature",
      "An explicit native Rust trait has no exact callable signature plan.",
    ));
    return undefined;
  }
  const superTraits = context.input.program.projectTypes.heritageForDefinition(definition).map((edge) => {
    const target = context.input.program.projectTypes.definitionForCarrier(edge.targetType);
    const targetContract = target === undefined
      ? undefined
      : context.input.program.declarationContracts.forDeclaration(target.declaration);
    return targetContract?.unsafeTrait === true
      ? rustTypeFromCarrierInContext(edge.targetType, context)
      : undefined;
  });
  if (superTraits.some((trait) => trait === undefined)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.native-trait-heritage",
      "An explicit native Rust trait may extend only exact native Rust trait declarations.",
    ));
    return undefined;
  }
  return Object.freeze([{
    kind: "trait",
    name: definition.targetName,
    visibility: context.input.program.source.ast.hasModifierKind(declaration, "export")
      ? "public"
      : "crate",
    attrs: [
      ...(context.input.program.source.ast.hasModifierKind(declaration, "export")
        ? []
        : [rustLintAttributes.deadCode]),
      rustLintAttributes.missingSafetyDoc,
    ],
    generics,
    safety: "unsafe",
    auto: false,
    superTraits: (superTraits as readonly import("../../target-ast/nodes.js").RustType[]).map((trait) => ({
      kind: "trait" as const,
      trait,
    })),
    functions: functions as readonly import("../../target-ast/nodes.js").RustTraitFunction[],
    associatedTypes: [],
    associatedConstants: [],
  }, { ...dispatch, safety: "safe" }]);
}

export function planRustNativeTraitImplementations(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class") return Object.freeze([]);
  const interfaces = context.input.program.projectTypes.interfacesForClass(definition);
  const classCarrier = context.input.program.projectTypes.openCarrier(definition);
  const target = rustTypeFromCarrierInContext(classCarrier, context);
  const generics = rustProjectGenerics(definition, context);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (interfaces === undefined || target === undefined || generics === undefined ||
    representation === undefined) return undefined;
  const items: RustItem[] = [];
  for (const contractDefinition of interfaces) {
    const declarationContract = context.input.program.declarationContracts.forDeclaration(
      contractDefinition.declaration,
    );
    if (declarationContract?.unsafeTrait !== true) continue;
    const relation = context.input.program.projectTypes.relationship(classCarrier, contractDefinition);
    if (relation.kind !== "related") return undefined;
    const trait = rustTypeFromCarrierInContext(relation.targetType, context);
    const safety = rustProjectTraitImplementationSafety(declaration, relation.targetType, context);
    if (trait === undefined || safety === undefined) return undefined;
    const functions: RustImplFunction[] = [];
    for (const contractMember of projectOwnMethods(contractDefinition, context)) {
      const targetName = context.input.program.projectTypes.callableTargetName(contractMember);
      const shape = projectCallableShape(contractMember, context);
      if (targetName === undefined || shape === undefined) return undefined;
      if (representation.kind === "open-hierarchy" || representation.kind === "closed-hierarchy") {
        const variants = context.input.program.projectMethodDispatch.variantsForMember(contractMember);
        if (variants.length !== 1) {
          context.diagnostics.push(unsupportedConstructDiagnostic(
            diagnosticInput(context, contractMember),
            "rust.backend.native-trait-polymorphic-generic",
            "A native trait implemented by a project object requires one exact object-safe dispatch variant.",
          ));
          return undefined;
        }
        functions.push({
          name: targetName,
          visibility: "private",
          generics: shape.generics,
          receiver: rustReferenceReceiver(false),
          params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
          ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
          ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
          ...(shape.isUnsafe ? { isUnsafe: true } : {}),
          body: {
            statements: [{
              kind: "tail",
              expr: {
                kind: "method-call",
                receiver: {
                  kind: "method-call",
                  receiver: {
                    kind: "field",
                    receiver: { kind: "path", path: "self" },
                    name: rustProjectObjectDispatchField,
                  },
                  method: "clone",
                  args: [],
                },
                method: variants[0]!.virtualSlot,
                args: shape.params.map((parameter) => ({
                  kind: "path" as const,
                  path: parameter.name,
                })),
              },
            }],
          },
        });
        continue;
      }
      const implementation = projectMemberImplementation(definition, contractMember, context);
      const planned = implementation === undefined
        ? undefined
        : planProjectMethod(implementation, context, { targetName });
      if (planned === undefined) return undefined;
      functions.push({ ...planned, visibility: "private" });
    }
    items.push({
      kind: "impl",
      generics,
      trait,
      target,
      polarity: "positive",
      safety,
      functions,
      associatedTypes: [],
      associatedConstants: [],
    });
  }
  return Object.freeze(items);
}
