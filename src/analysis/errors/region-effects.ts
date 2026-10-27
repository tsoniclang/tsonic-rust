import type { AstReader, Node } from "@tsonic/tsts";
import { CatchClause_Block, TryStatement_CatchClause, TryStatement_FinallyBlock,
  TryStatement_TryBlock, forEachSourceImmediateEvaluationChild } from "@tsonic/target-api/source";
import { mergeRustErrorEffects, rustErrorEffectsAreFallible } from "./error-effects.js";
import type { RustErrorEffectsFact } from "../../target-model/records/errors/error-effects.js";

export function collectRustErrorRegionEffects(
  root: Node,
  ast: AstReader,
  directEffects: (node: Node) => RustErrorEffectsFact | undefined,
  record: (node: Node, effects: RustErrorEffectsFact) => void,
): RustErrorEffectsFact | undefined {
  const selected: RustErrorEffectsFact[] = [];
  let valid = true;
  const append = (effects: RustErrorEffectsFact | undefined): void => {
    if (effects === undefined) valid = false;
    else if (rustErrorEffectsAreFallible(effects)) selected.push(effects);
  };
  const region = (node: Node): RustErrorEffectsFact | undefined => collectRustErrorRegionEffects(node, ast, directEffects, record);
  const visit = (node: Node): void => {
    if (ast.kindName(node) === "KindTryStatement") {
      const body = TryStatement_TryBlock(ast, node);
      const caught = CatchClause_Block(ast, TryStatement_CatchClause(ast, node));
      const finalized = TryStatement_FinallyBlock(ast, node);
      if (body === undefined) { valid = false; return; }
      const bodyEffects = region(body);
      if (bodyEffects === undefined) { valid = false; return; }
      if (caught === undefined) append(bodyEffects);
      else append(region(caught));
      if (finalized !== undefined) append(region(finalized));
    } else {
      append(directEffects(node));
      forEachSourceImmediateEvaluationChild(ast, node, visit);
    }
  };
  visit(root);
  const effects = valid ? mergeRustErrorEffects(selected) : undefined;
  if (effects !== undefined) record(root, effects);
  return effects;
}
