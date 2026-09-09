declare module "temml" {
  interface TemmlOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
    annotate?: boolean;
  }
  const temml: {
    renderToString(tex: string, options?: TemmlOptions): string;
  };
  export default temml;
}
