export interface RustPlanKey<T> {
  readonly id: string;
  readonly equals: (left: T, right: T) => boolean;
}

export function defineRustPlanKey<T>(
  name: string,
  equals: (left: T, right: T) => boolean,
): RustPlanKey<T> {
  return Object.freeze({ id: `tsonic.rust.${name}`, equals });
}
