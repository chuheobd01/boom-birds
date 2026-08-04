import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outputDirectory = new URL("../dist/", import.meta.url);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const sourceHTML = await readFile(new URL("../index.html", import.meta.url), "utf8");
const clientId = process.env.GOOGLE_CLIENT_ID || "__GOOGLE_CLIENT_ID__";
const builtHTML = sourceHTML.replaceAll("__GOOGLE_CLIENT_ID__", clientId);

await Promise.all([
  writeFile(new URL("index.html", outputDirectory), builtHTML),
  cp(new URL("../styles.css", import.meta.url), new URL("styles.css", outputDirectory)),
  cp(new URL("../script.js", import.meta.url), new URL("script.js", outputDirectory)),
  cp(new URL("../assets/", import.meta.url), new URL("assets/", outputDirectory), {
    recursive: true,
  }),
]);

console.log("Static Boom Birds site prepared in dist/.");
