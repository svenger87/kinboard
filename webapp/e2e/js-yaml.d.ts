// js-yaml ships no types and is only used by a few tests.
// Declaring it here avoids adding a devDependency (and a lockfile change) for
// one import in one test.
declare module "js-yaml" {
  export function load(input: string): unknown;
  export function dump(input: unknown, options?: { indent?: number; noArrayIndent?: boolean; lineWidth?: number }): string;
  const _default: {
    load(input: string): unknown;
    dump(input: unknown, options?: { indent?: number; noArrayIndent?: boolean; lineWidth?: number }): string;
  };
  export default _default;
}
