import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const PLACEHOLDER_PREFIX = "REPLACE_WITH_";

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
    primary: "ipfs://bafkreigefspgbbhv6kithuavppytwd5xnuakfrlh3llnyakh76zcyajl4u",
    intermediate: "REPLACE_WITH_FOREST_INTERMEDIATE_METADATA_URI",
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
    name: "Wind/Pilot",
    primary: "ipfs://bafkreidmh5j63xef7ouy776vijt36tcqwgwt4uq47a5otiy7i72h6yz6ri",
    intermediate: "REPLACE_WITH_WIND_PILOT_INTERMEDIATE_METADATA_URI",
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
    primary: "ipfs://bafkreifllk3t6phkkuiuth7enzvaoh72t6tlmmun2x3znbufvs6x77ixsu",
    intermediate: "REPLACE_WITH_WIZARD_INTERMEDIATE_METADATA_URI",
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
    primary: "ipfs://bafkreidaxorl5gpoagc22jydonc4ihir2ahz7irdi4uly3qklix2cpbgpa",
    intermediate: "REPLACE_WITH_ARTIST_INTERMEDIATE_METADATA_URI",
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
    primary: "ipfs://bafkreigreiimilepwqsugpwzgv6ksheb4qmr2bjskru7dshuzpccpogha4",
    intermediate: "REPLACE_WITH_KING_INTERMEDIATE_METADATA_URI",
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

async function enableMinting(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EGGORIA_MINTING !== "YES") {
    throw new Error(
      "Minting was not enabled. Set CONFIRM_ENABLE_EGGORIA_MINTING=YES only when metadata has been verified.",
    );
  }
  await sendAndConfirm("Enable minting", eggoriaBirds.setMintingEnabled(true));
  console.log("Minting is enabled.");
}

async function main() {
  const action = process.env.EGGORIA_ADMIN_ACTION ?? "configure-metadata";
  const { eggoriaBirds } = await verifyAdminContext();

  if (action === "configure-metadata") {
    await configureMetadata(eggoriaBirds);
    return;
  }
  if (action === "enable-minting") {
    await enableMinting(eggoriaBirds);
    return;
  }

  throw new Error(
    `Unknown EGGORIA_ADMIN_ACTION "${action}". Use "configure-metadata" or "enable-minting".`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
