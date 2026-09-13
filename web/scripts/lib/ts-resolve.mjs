// Node will not resolve the extensionless relative imports TypeScript writes, so a check that loads
// an app module gets the extension put back for it

export async function resolve(specifier, context, next) {
    try {
        return await next(specifier, context);
    } catch (failure) {
        if (!specifier.startsWith(".")) throw failure;
        const [path, query] = specifier.split("?");
        return next(query ? `${path}.ts?${query}` : `${path}.ts`, context);
    }
}
