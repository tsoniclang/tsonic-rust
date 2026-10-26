import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { Node_Type, Node_Initializer, sourceBindingCapturedBeforeInitialization, sourceIntegerInduction } from "@tsonic/target-api/source";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { closeRustSuspendedStorage } from "../../policy/types/storage/suspended-storage.js";
import { resolveTypeNodeCarrier, resolveTypeNodeContract } from "../source-evidence/types/source-carriers.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { reconcileRequiredCarrier } from "../conversions/contextual-values.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { rustGenericCallableValueOwner } from "../../policy/types/callables/callable-origins.js";
import { setCarrierFact } from "../operations/project-calls.js";

type RustDeclaredBindingSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef; readonly initializerCarrier?: TargetTypeRef }
  | { readonly kind: "unresolved"; readonly at: Node; readonly reason: string };

const selectingBindings = new WeakMap<RustFactWalk, Set<Node>>();

export function selectRustDeclaredBinding(
  walk: RustFactWalk,
  declaration: Node,
  sourceFile: SourceFile,
): RustDeclaredBindingSelection {
  const { ast, records } = walk.context;
  const fail = (at: Node, reason: string, code = "RUST_BINDING_CARRIER_NOT_PROVEN"): RustDeclaredBindingSelection => {
    if (!walk.rejectedExpressions.has(declaration) && !walk.rejectedExpressions.has(at))
      appendRustDiagnostic(walk, code, reason, at, [code === "RUST_INITIALIZER_CARRIER_MISMATCH"
        ? "target.capability=rust.initializer-carrier" : "target.capability=rust.native-binding-carrier"]);
    return Object.freeze({ kind: "unresolved", at, reason });
  };
  const active = selectingBindings.get(walk) ?? new Set<Node>();
  if (active.has(declaration)) return fail(declaration,
    "A native binding requires its completed initializer rather than a recursive storage assumption.");
  selectingBindings.set(walk, active);
  active.add(declaration);
  try {
    const authored = Node_Type(ast, declaration);
    const before = walk.context.diagnostics.length;
    const required = authored === undefined ? undefined : rustGenericCallableValueOwner(ast, declaration,
      resolveTypeNodeContract(walk, authored));
    if (authored !== undefined && required === undefined) {
      const reason = "A native binding requires its exact checked authored contract before initializer admission.";
      return walk.context.diagnostics.length === before ? fail(authored, reason)
        : Object.freeze({ kind: "unresolved", at: authored, reason });
    }
    const initializer = Node_Initializer(ast, declaration);
    const predeclared = records.runtimeCarrier.get(declaration)?.carrier;
    const enclosingList = ast.parent(declaration);
    const owner = enclosingList === undefined ? undefined : ast.parent(enclosingList);
    const induction = owner !== undefined && ast.is.IsForStatement(owner)
      ? sourceIntegerInduction(declaration, ast, walk.context.source.navigation, {
        sourceFacts: walk.context.source.sourceFacts, semanticsFor: walk.context.semanticsFor,
      }) : undefined;
    if (induction !== undefined) resolveExpressionCarrier(walk, induction.bound, sourceFile, undefined);
    const inferred = predeclared ?? (authored === undefined ? inferredBindingContext(walk, declaration) : undefined);
    const selected = required ?? (induction === undefined ? undefined
      : resolveRustTargetTypeRef(declaration, rustResolutionContext(walk, declaration), walk.operationOptions));
    if (initializer === undefined) {
      const storage = authored === undefined ? selected ?? inferred : resolveTypeNodeCarrier(walk, authored);
      if (storage === undefined) return fail(declaration,
        "A native binding requires an admitted source type and one finalized Rust value carrier.");
      const carrier = setCarrierFact(walk, declaration, storage);
      return carrier === undefined ? fail(declaration, "A native binding requires its exact selected storage owner.")
        : Object.freeze({ kind: "selected", carrier });
    }
    const inferredContext = ast.is.IsConditionalExpression(initializer) &&
      inferred?.kind === "source-primitive" && inferred.name === "float64" ? undefined : inferred;
    const initializerBefore = walk.context.diagnostics.length;
    const initializerCarrier = resolveExpressionCarrier(walk, initializer, sourceFile, selected ?? inferredContext);
    if (initializerCarrier === undefined || walk.rejectedExpressions.has(initializer)) {
      const reason = "A native binding requires its admitted initializer's exact selected value carrier.";
      return walk.context.diagnostics.length === initializerBefore ? fail(initializer, reason)
        : Object.freeze({ kind: "unresolved", at: initializer, reason });
    }
    if (required !== undefined && !reconcileRequiredCarrier(walk, initializer, initializerCarrier, required))
      return fail(initializer, "The initializer cannot be represented by the declaration's exact Rust carrier.",
        "RUST_INITIALIZER_CARRIER_MISMATCH");
    const effective = rustEffectiveValueCarrier(records, initializer);
    if (effective === undefined) return fail(initializer,
      "An admitted initializer requires its completed effective Rust value carrier.");
    const carrier = setCarrierFact(walk, declaration, effective);
    return carrier === undefined ? fail(declaration, "A native binding requires its exact selected storage owner.")
      : Object.freeze({ kind: "selected", carrier, initializerCarrier });
  } finally {
    active.delete(declaration);
    if (active.size === 0) selectingBindings.delete(walk);
  }
}

function inferredBindingContext(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const context = rustResolutionContext(walk, declaration);
  const finalized = walk.context.records.runtimeCarrier.get(declaration);
  if (finalized !== undefined) return finalized.carrier;
  const selected = sourceBindingCapturedBeforeInitialization(
    declaration, walk.context.ast, walk.context.source.navigation,
  ) ? context.currentSemantics.declarations.declaredValueType(declaration) : undefined;
  const carrier = resolveRustTargetTypeRef(selected, context, walk.operationOptions);
  return carrier === undefined ? undefined : closeRustSuspendedStorage(carrier, "field");
}
