export interface RustPlanKey<T> {
  readonly id: string;
  readonly equals: (left: T, right: T) => boolean;
}
