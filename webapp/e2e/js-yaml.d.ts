// js-yaml ships no types and is only used by the OpenAPI contract test.
// Declaring it here avoids adding a devDependency (and a lockfile change) for
// one import in one test.
declare module "js-yaml" {
  export function load(input: string): unknown;
  const _default: { load(input: string): unknown };
  export default _default;
}
