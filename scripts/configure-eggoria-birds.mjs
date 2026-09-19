import { readFile } from "node:fs/promises";

import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const PLACEHOLDER_PREFIX = "REPLACE_WITH_";
const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
];

const STAGE = Object.freeze({
  Primary: 0,
  Intermediate: 1,
});

const RARITY = Object.freeze({
  Common: 0,
  Rare: 1,
  Epic: 2,
  Legendary: 3,
  Mythic: 4,
});

// Replace every placeholder with an IPFS or HTTPS metadata JSON URI.
// Land indexes must stay aligned with EggoriaBirds.sol: 0 through 4.
const METADATA_BY_LAND = [
  {
    index: 0,
    name: "Forest",
    primary: "ipfs://bafkreieepdc6obx6kxpzbxdwbfdxn3cm6lx46capngykl32nlbmfuhcskm",
    intermediate: "ipfs://bafkreiclk6wlkklrbdrkjmkswisduyhqcbexfmi2t7fuhh64csjifvcjui",
    advanced: {
      Common: "REPLACE_WITH_FOREST_ADVANCED_COMMON_METADATA_URI",
      Rare: "REPLACE_WITH_FOREST_ADVANCED_RARE_METADATA_URI",
      Epic: "REPLACE_WITH_FOREST_ADVANCED_EPIC_METADATA_URI",
      Legendary: "REPLACE_WITH_FOREST_ADVANCED_LEGENDARY_METADATA_URI",
      Mythic: "REPLACE_WITH_FOREST_ADVANCED_MYTHIC_METADATA_URI",
    },
  },
  {
    index: 1,
    name: "Wind",
    primary: "ipfs://bafkreia3kzlmumbwzdy6hcjq64di4gd6onqjyiuvqrnerr6wqh5j7fyufy",
    intermediate: "ipfs://bafkreidbdao2ownynjaisznddvehld3quoheetbdze7i2cwj5f4balvcw4",
    advanced: {
      Common: "REPLACE_WITH_WIND_PILOT_ADVANCED_COMMON_METADATA_URI",
      Rare: "REPLACE_WITH_WIND_PILOT_ADVANCED_RARE_METADATA_URI",
      Epic: "REPLACE_WITH_WIND_PILOT_ADVANCED_EPIC_METADATA_URI",
      Legendary: "REPLACE_WITH_WIND_PILOT_ADVANCED_LEGENDARY_METADATA_URI",
      Mythic: "REPLACE_WITH_WIND_PILOT_ADVANCED_MYTHIC_METADATA_URI",
    },
  },
  {
    index: 2,
    name: "Wizard",
    primary: "ipfs://bafkreifr3st42sgcrcjasi2mf4vix3hx5pgvrnodl6kquvaqpypx6o2hdy",
    intermediate: "ipfs://bafkreighjj6zo5ig6qnbsoynqrxmj247azfdv6vjq55mz2ur6h4355axvi",
    advanced: {
      Common: "REPLACE_WITH_WIZARD_ADVANCED_COMMON_METADATA_URI",
      Rare: "REPLACE_WITH_WIZARD_ADVANCED_RARE_METADATA_URI",
      Epic: "REPLACE_WITH_WIZARD_ADVANCED_EPIC_METADATA_URI",
      Legendary: "REPLACE_WITH_WIZARD_ADVANCED_LEGENDARY_METADATA_URI",
      Mythic: "REPLACE_WITH_WIZARD_ADVANCED_MYTHIC_METADATA_URI",
    },
  },
  {
    index: 3,
    name: "Artist",
    primary: "ipfs://bafkreia6k55e7qcjgs7lma4suxt2qioon2dmv26rkxbfoxwqnwp5yqcboi",
    intermediate: "ipfs://bafkreidqolitzhbseuqnud4yxrusj6d4oyipz57ueabk32etqwuv67b47q",
    advanced: {
      Common: "REPLACE_WITH_ARTIST_ADVANCED_COMMON_METADATA_URI",
      Rare: "REPLACE_WITH_ARTIST_ADVANCED_RARE_METADATA_URI",
      Epic: "REPLACE_WITH_ARTIST_ADVANCED_EPIC_METADATA_URI",
      Legendary: "REPLACE_WITH_ARTIST_ADVANCED_LEGENDARY_METADATA_URI",
      Mythic: "REPLACE_WITH_ARTIST_ADVANCED_MYTHIC_METADATA_URI",
    },
  },
  {
    index: 4,
    name: "King",
    primary: "ipfs://bafkreiaaa5lmqvbi5mijpnlaqobp32vg5xdzqdskxadshw6cakp7iis2xq",
    intermediate: "ipfs://bafkreie4eevue3zecmfnvina5toxrhdob7svxi47mohgfdfmjhchwda6mq",
    advanced: {
      Common: "REPLACE_WITH_KING_ADVANCED_COMMON_METADATA_URI",
      Rare: "REPLACE_WITH_KING_ADVANCED_RARE_METADATA_URI",
      Epic: "REPLACE_WITH_KING_ADVANCED_EPIC_METADATA_URI",
      Legendary: "REPLACE_WITH_KING_ADVANCED_LEGENDARY_METADATA_URI",
      Mythic: "REPLACE_WITH_KING_ADVANCED_MYTHIC_METADATA_URI",
    },
  },
];

function assertMetadataIsReady() {
  const missing = [];
  const invalid = [];

  const inspect = (label, uri) => {
    if (!uri || uri.startsWith(PLACEHOLDER_PREFIX)) {
      missing.push(label);
      return;
    }
    if (!uri.startsWith("ipfs://") && !uri.startsWith("https://")) {
      invalid.push(label);
    }
  };

  for (const land of METADATA_BY_LAND) {
    inspect(`${land.name}.primary`, land.primary);
    inspect(`${land.name}.intermediate`, land.intermediate);
    for (const [rarity, uri] of Object.entries(land.advanced)) {
      inspect(`${land.name}.advanced.${rarity}`, uri);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Metadata configuration is incomplete. Replace these placeholders before running transactions:\n- ${missing.join("\n- ")}`,
    );
  }
  if (invalid.length > 0) {
    throw new Error(
      `Metadata URIs must start with ipfs:// or https://:\n- ${invalid.join("\n- ")}`,
    );
  }
}

function toHttpUris(uri) {
  return uri.startsWith("ipfs://")
    ? IPFS_GATEWAYS.map((gateway) => `${gateway}${uri.slice("ipfs://".length)}`)
    : [uri];
}

async function fetchMetadataResource(uri, options = {}) {
  let lastError;
  let lastResponse;

  for (const url of toHttpUris(uri)) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`Unable to fetch ${uri}.`);
}

async function validateMetadataDocument(label, uri, expectedImage) {
  const response = await fetchMetadataResource(uri);
  if (!response.ok) {
    throw new Error(`${label} metadata returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `${label} must point to metadata JSON, but resolved to ${contentType || "an unknown content type"}.`,
    );
  }

  const metadata = await response.json();
  if (!metadata || typeof metadata !== "object" || typeof metadata.image !== "string") {
    throw new Error(`${label} metadata is missing a valid image URI.`);
  }
  if (!metadata.image.startsWith("ipfs://") && !metadata.image.startsWith("https://")) {
    throw new Error(`${label} metadata image must use an IPFS or HTTPS URI.`);
  }
  if (metadata.image !== expectedImage) {
    throw new Error(
      `${label} points to stale metadata. Expected image ${expectedImage}, received ${metadata.image}.`,
    );
  }

  if (process.env.SKIP_IPFS_IMAGE_PROBE === "YES") {
    console.warn(`${label} metadata verified; image availability probe skipped by explicit override.`);
    return;
  }

  const imageResponse = await fetchMetadataResource(metadata.image, {
    method: "HEAD",
  });
  if (!imageResponse.ok) {
    throw new Error(`${label} image returned HTTP ${imageResponse.status}.`);
  }

  const imageContentType = imageResponse.headers.get("content-type") || "";
  if (!imageContentType.toLowerCase().startsWith("image/")) {
    throw new Error(
      `${label} metadata image resolved to ${imageContentType || "an unknown content type"}, not an image.`,
    );
  }

  console.log(`${label} metadata verified (${imageContentType}).`);
}

async function verifyAdminContext() {
  const { ethers } = await network.connect();
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ARC Testnet chain ID ${ARC_TESTNET_CHAIN_ID}, ` +
      `received ${currentNetwork.chainId}. No transactions were sent.`,
    );
  }

  const configuredAddress = process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS;
  if (!configuredAddress || !ethers.isAddress(configuredAddress)) {
    throw new Error("NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS is missing or invalid.");
  }
  const contractAddress = ethers.getAddress(configuredAddress);

  const deployedCode = await ethers.provider.getCode(contractAddress);
  if (deployedCode === "0x") {
    throw new Error(`No deployed bytecode found at ${contractAddress}.`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer is configured for ARC Testnet.");
  }
  const deployerAddress = await deployer.getAddress();
  const eggoriaBirds = await ethers.getContractAt("EggoriaBirds", contractAddress, deployer);

  const [defaultAdminRole, metadataRole] = await Promise.all([
    eggoriaBirds.DEFAULT_ADMIN_ROLE(),
    eggoriaBirds.METADATA_ROLE(),
  ]);
  const [hasDefaultAdminRole, hasMetadataRole] = await Promise.all([
    eggoriaBirds.hasRole(defaultAdminRole, deployerAddress),
    eggoriaBirds.hasRole(metadataRole, deployerAddress),
  ]);

  if (!hasDefaultAdminRole) {
    throw new Error(`Signer ${deployerAddress} does not have DEFAULT_ADMIN_ROLE.`);
  }
  if (!hasMetadataRole) {
    throw new Error(`Signer ${deployerAddress} does not have METADATA_ROLE.`);
  }

  console.log("Verified chain ID:", currentNetwork.chainId.toString());
  console.log("Verified contract bytecode at:", contractAddress);
  console.log("Verified admin signer:", deployerAddress);
  console.log("Verified roles: DEFAULT_ADMIN_ROLE, METADATA_ROLE");

  return { eggoriaBirds };
}

async function sendAndConfirm(label, transactionPromise) {
  const transaction = await transactionPromise;
  console.log(`${label}:`, transaction.hash);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed.`);
  }
}

async function configureMetadata(eggoriaBirds) {
  assertMetadataIsReady();

  for (const land of METADATA_BY_LAND) {
    await sendAndConfirm(
      `${land.name} Primary`,
      eggoriaBirds.setStageURI(land.index, STAGE.Primary, land.primary),
    );
    await sendAndConfirm(
      `${land.name} Intermediate`,
      eggoriaBirds.setStageURI(land.index, STAGE.Intermediate, land.intermediate),
    );
    for (const [rarityName, rarityIndex] of Object.entries(RARITY)) {
      await sendAndConfirm(
        `${land.name} Advanced ${rarityName}`,
        eggoriaBirds.setAdvancedURI(land.index, rarityIndex, land.advanced[rarityName]),
      );
    }
  }

  console.log("All 35 required NFT metadata URIs are configured.");
  console.log("Minting remains disabled.");
}

async function configurePrimaryMetadata(eggoriaBirds) {
  for (const land of METADATA_BY_LAND) {
    if (!land.primary.startsWith("ipfs://") && !land.primary.startsWith("https://")) {
      throw new Error(`${land.name}.primary must be an IPFS or HTTPS metadata JSON URI.`);
    }
  }

  const expectedMetadata = await Promise.all(
    METADATA_BY_LAND.map(async (land) =>
      JSON.parse(
        await readFile(
          new URL(`../metadata/${land.name.toLowerCase()}-primary.json`, import.meta.url),
          "utf8",
        ),
      ),
    ),
  );

  for (const [index, land] of METADATA_BY_LAND.entries()) {
    await validateMetadataDocument(
      `${land.name}.primary`,
      land.primary,
      expectedMetadata[index].image,
    );
  }

  for (const land of METADATA_BY_LAND) {
    await sendAndConfirm(
      `${land.name} Primary`,
      eggoriaBirds.setStageURI(land.index, STAGE.Primary, land.primary),
    );
  }

  console.log("All 5 Primary NFT metadata URIs are configured.");
}

async function configureIntermediateMetadata(eggoriaBirds) {
  for (const land of METADATA_BY_LAND) {
    if (!land.intermediate.startsWith("ipfs://") && !land.intermediate.startsWith("https://")) {
      throw new Error(`${land.name}.intermediate must be an IPFS or HTTPS metadata JSON URI.`);
    }
  }

  const expectedMetadata = await Promise.all(
    METADATA_BY_LAND.map(async (land) =>
      JSON.parse(
        await readFile(
          new URL(`../metadata/${land.name.toLowerCase()}-intermediate.json`, import.meta.url),
          "utf8",
        ),
      ),
    ),
  );

  for (const [index, land] of METADATA_BY_LAND.entries()) {
    await validateMetadataDocument(
      `${land.name}.intermediate`,
      land.intermediate,
      expectedMetadata[index].image,
    );
  }

  for (const land of METADATA_BY_LAND) {
    await sendAndConfirm(
      `${land.name} Intermediate`,
      eggoriaBirds.setStageURI(land.index, STAGE.Intermediate, land.intermediate),
    );
  }

  console.log("All 5 Intermediate NFT metadata URIs are configured.");
}

async function enableMinting(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EGGORIA_MINTING !== "YES") {
    throw new Error(
      "Minting was not enabled. Set CONFIRM_ENABLE_EGGORIA_MINTING=YES only when metadata has been verified.",
    );
  }
  await sendAndConfirm("Enable minting", eggoriaBirds.setMintingEnabled(true));
  console.log("Minting is enabled.");
}

async function enableEvolutionTestMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_TEST_MODE !== "YES") {
    throw new Error(
      "Evolution test mode was not enabled. Set CONFIRM_ENABLE_EVOLUTION_TEST_MODE=YES only on a test deployment.",
    );
  }
  await sendAndConfirm(
    "Enable evolution test mode",
    eggoriaBirds.setEvolutionTestMode(true),
  );
  console.log("Evolution test mode is enabled. New mints start at 9/10 check-ins.");
}

async function printContractStatus(eggoriaBirds) {
  const [totalSupply, mintingEnabled, evolutionTestMode] = await Promise.all([
    eggoriaBirds.totalSupply(),
    eggoriaBirds.mintingEnabled(),
    eggoriaBirds.evolutionTestMode(),
  ]);
  console.log("Total supply:", totalSupply.toString());
  console.log("Minting enabled:", mintingEnabled);
  console.log("Evolution test mode:", evolutionTestMode);
}

async function main() {
  const action = process.env.EGGORIA_ADMIN_ACTION ?? "configure-metadata";
  const { eggoriaBirds } = await verifyAdminContext();

  if (action === "configure-metadata") {
    await configureMetadata(eggoriaBirds);
    return;
  }
  if (action === "configure-primary") {
    await configurePrimaryMetadata(eggoriaBirds);
    return;
  }
  if (action === "configure-intermediate") {
    await configureIntermediateMetadata(eggoriaBirds);
    return;
  }
  if (action === "enable-minting") {
    await enableMinting(eggoriaBirds);
    return;
  }
  if (action === "enable-evolution-test-mode") {
    await enableEvolutionTestMode(eggoriaBirds);
    return;
  }
  if (action === "status") {
    await printContractStatus(eggoriaBirds);
    return;
  }

  throw new Error(
    `Unknown EGGORIA_ADMIN_ACTION "${action}". Use "configure-metadata", "configure-primary", "configure-intermediate", "enable-minting", "enable-evolution-test-mode", or "status".`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
