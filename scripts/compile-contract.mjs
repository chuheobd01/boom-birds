import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const sourcePath = path.join(root, "contracts", "EggoriaBirds.sol");
const sourceName = "contracts/EggoriaBirds.sol";

function findImports(importPath) {
  const candidates = [
    path.join(root, importPath),
    path.join(root, "node_modules", importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `Import not found: ${importPath}` };
}

const input = {
  language: "Solidity",
  sources: {
    [sourceName]: { content: fs.readFileSync(sourcePath, "utf8") },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");

if (errors.length > 0) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}

const compiled = output.contracts[sourceName].EggoriaBirds;
const artifactDir = path.join(root, "artifacts", "contracts");
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(
  path.join(artifactDir, "EggoriaBirds.json"),
  JSON.stringify(
    {
      contractName: "EggoriaBirds",
      sourceName,
      abi: compiled.abi,
      bytecode: `0x${compiled.evm.bytecode.object}`,
      deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
    },
    null,
    2,
  ),
);

console.log("Compiled contracts/EggoriaBirds.sol");
