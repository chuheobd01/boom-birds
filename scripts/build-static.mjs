import { cp, mkdir, rm } from "node:fs/promises";

const outputDirectory = new URL("../dist/", import.meta.url);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  cp(new URL("../index.html", import.meta.url), new URL("index.html", outputDirectory)),
  cp(new URL("../styles.css", import.meta.url), new URL("styles.css", outputDirectory)),
  cp(new URL("../script.js", import.meta.url), new URL("script.js", outputDirectory)),
  cp(new URL("../assets/", import.meta.url), new URL("assets/", outputDirectory), {
    recursive: true,
  }),
]);

console.log("Static Boom Birds site prepared in dist/.");
