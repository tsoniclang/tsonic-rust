import { targetSourceProfileDeclaration, typescriptNoLibUtilityDeclarations } from "@tsonic/target-api/provider";
import { jsSurfaceSourceProfileDeclarations, sourceNoLibBaseDeclarations, sourcePrimitiveProfileDeclarations } from "@tsonic/js-source-profile";
import type { TargetSourceProfileContributions } from "@tsonic/target-api/provider";
import { rustTargetId } from "../../target-model/identities/target.js";

export const rustSourceProfileOwnerId = rustTargetId;
export const rustJsSourceProfileOwnerId = "js";


const rustNativeProfileDeclarations = `
${sourcePrimitiveProfileDeclarations}
${sourceNoLibBaseDeclarations}

interface IArguments {
  readonly length: int32;
}

interface String {
  len(): import("@tsonic/rust/types.js").usize;
  is_empty(): boolean;
  contains(pattern: string): boolean;
  starts_with(pattern: string): boolean;
  ends_with(pattern: string): boolean;
  find(pattern: string): import("@tsonic/rust/types.js").usize | undefined;
  rfind(pattern: string): import("@tsonic/rust/types.js").usize | undefined;
}

interface Array<T> extends Iterable<T> {
  [index: number]: T;
}

interface ReadonlyArray<T> extends Iterable<T> {
  readonly [index: number]: T;
}
`.trim();



export function rustNativeSourceProfileContributions(): TargetSourceProfileContributions {
  return {
    declarations: [
      targetSourceProfileDeclaration(
        "typescript-utilities.d.ts",
        typescriptNoLibUtilityDeclarations,
      ),
      targetSourceProfileDeclaration("rust-globals.d.ts", rustNativeProfileDeclarations),
    ],
  };
}

export function rustJsSurfaceSourceProfileContributions(): TargetSourceProfileContributions {
  return {
    declarations: [
      targetSourceProfileDeclaration(
        "typescript-utilities.d.ts",
        typescriptNoLibUtilityDeclarations,
      ),
      targetSourceProfileDeclaration("js-globals.d.ts", jsSurfaceSourceProfileDeclarations),
    ],
  };
}
