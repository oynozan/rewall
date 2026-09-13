import { createRequire } from "node:module";
import path from "node:path";
import nextra from "nextra";

const require = createRequire(path.join(process.cwd(), "package.json"));

// Nextra aliases this import with a path in the OS separator, which Turbopack cannot follow on Windows
const mermaid = path
    .relative(process.cwd(), path.join(path.dirname(require.resolve("@theguild/remark-mermaid/package.json")), "dist"))
    .replaceAll("\\", "/");

const withNextra = nextra({
    defaultShowCopyCode: true,
    // The landing page paints its code sample in these colours, so the docs use the same theme
    mdxOptions: { rehypePrettyCodeOptions: { theme: { light: "dark-plus", dark: "dark-plus" } } },
});

export default withNextra({
    devIndicators: false,
    agentRules: false,
    turbopack: { resolveAlias: { "@theguild/remark-mermaid/mermaid": `${mermaid}/mermaid.js` } },
});
