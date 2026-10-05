import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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
    primary: "ipfs://bafkreic6vwjfdq2mnbmubmlnnbxigtx2bcprurtb64ffoxg7hwsrq6zkbu",
    intermediate: "ipfs://bafkreigd4xthjlzfe3xdasnwkan4cc654zwxeki6qm2f5w5hd4k2hx234m",
    soarling: {
      Common: "ipfs://bafkreifni5edf357ux6goe3imtnsist4335heno7lujakuxahbnncptau4",
      Rare: "ipfs://bafkreiejnjxijbhjqb63qvizw76zid75aqtv7lhx5xeuwz4fpdxy6okzha",
      Epic: "ipfs://bafkreie2hbbds4chuzpxeudaowpfwcatp3yaotaev7aztl6cxytkwswz5e",
      Legendary: "ipfs://bafkreihdwhbodzptnjlk4nx6iegcuzmva3smirkep6qa43vikqbse2ue64",
      Mythic: "ipfs://bafkreiaatwtu7g5pylt7mqsu26dgoaai7wjmp7cd7egynzpen5ynixwajm",
    },
  },
  {
    index: 1,
    name: "Wind",
    primary: "ipfs://bafkreifefqbul56z2b47jef4c42hmllhvmvjfnpkqnu77xgwksvmptcitu",
    intermediate: "ipfs://bafkreiajfuka4ymxcjgx3fm2vp4z6g4jdaxstlbliyhyhtvfitrzijxley",
    soarling: {
      Common: "ipfs://bafkreie43pwnsjqmknxapdtavvjnb57h5kgdl5xuqpm5jby6k7tw4fckbi",
      Rare: "ipfs://bafkreid6mpqqqi2ax7ukv2nt2cxotiul6ortqoqjdhxdslc3gqsartodi4",
      Epic: "ipfs://bafkreih7fxfqudpzepbp2rswpso5kckmgla334v4ve4ayrtgqja56ni3eq",
      Legendary: "ipfs://bafkreihdyxzxbe3325b7re54om5lrbnm5lvefvg6xvxedpc36uegjqyt7m",
      Mythic: "ipfs://bafkreidzvlxfop2qrzc2enyqjeabytflrd6ebbh4dm3lnaeh67ss5ulihy",
    },
  },
  {
    index: 2,
    name: "Wizard",
    primary: "ipfs://bafkreifs4i4fsc6ocricyhhd2zl2dho6vyt3cn7vtnxioonp22f6u6dx5i",
    intermediate: "ipfs://bafkreiczysbbypse4tu63plhq5jpwr2xoxwxctmvowun4jov62s7kn7quy",
    soarling: {
      Common: "ipfs://bafkreibelm3urvspamuha62etyxbeo3i6sokpovbdin2cqas33uvequczi",
      Rare: "ipfs://bafkreierokyy2zoe5jzx6r4utxfinndj5gkazemaldwer4gtjoosdauqcu",
      Epic: "ipfs://bafkreicvq6jwahvdbwwxvthl674hzwf7dnlikh7t6jnn4sgmvpsjpwjjle",
      Legendary: "ipfs://bafkreihw426grb2rvwgxxhmyee5uxk6pfh276inlzgwjydgwp5svb4hv4a",
      Mythic: "ipfs://bafkreia4gozxiut7euro76ibwqqgyom2b43wlxn74bkrsw657solbkweaa",
    },
  },
  {
    index: 3,
    name: "Artist",
    primary: "ipfs://bafkreigq2qmmypkuvhp2olj6ljeulntzmiuvfilrnao54lfikpuqgk7l44",
    intermediate: "ipfs://bafkreicodanbkmxg2dif5pcl5qqo7tmq6wzo2lfsp3fuq3sq7ga4t5h2za",
    soarling: {
      Common: "ipfs://bafkreifr4tb2p32sxnuiv3pocobxmtqlr2sjllrnxjkjf6wjhmhacdhs2m",
      Rare: "ipfs://bafkreigaz57wlxfbnz44ldlgqaypf73o7r6ec2l4lt7gprd7njmxx7yv6a",
      Epic: "ipfs://bafkreidloj6az6cofmwoqakpkw76tbvrmnr3r6ppdu2hxntjznglvoq6pa",
      Legendary: "ipfs://bafkreieuwmni7zv5xowqjvxmb3ll37j2hrgups2jsu5jnmnabrgwlicoke",
      Mythic: "ipfs://bafkreiez2ju7de7fkzim6hbabmtxx5ay7irotagpsmlq4wq3eesvmcv7yi",
    },
  },
  {
    index: 4,
    name: "King",
    primary: "ipfs://bafkreibrrsgpo7f5umxmzio37ulahtbf5kyxhzuxpxyyanzs7k3rk2fkly",
    intermediate: "ipfs://bafkreib35wbd37ynpthq444eh67i5lbytoeebapo6swcmyz5xhbx4uqdeq",
    soarling: {
      Common: "ipfs://bafkreici3ohmt66diufqkqybhc4xtu6jikcgg3qj7u77f5ls4ntj66w5ji",
      Rare: "ipfs://bafkreicleeyas2vhexwlbhuzekpv2naznzlpcydmabeekesewlvs54z5k4",
      Epic: "ipfs://bafkreigxrmzvuvjkpecg2jtggvnojgryg4shbaphcnmva4tk3xc6i3bcmm",
      Legendary: "ipfs://bafkreidksvijoccsynks3ktkssunm5o4di2zrcoezlssiv4k5cmt7yquxy",
      Mythic: "ipfs://bafkreidco6ldsuppszh2puckjq3axbu4owf6wz2w33qf6mydqu727klmw4",
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
    for (const [rarity, uri] of Object.entries(land.soarling)) {
      inspect(`${land.name}.soarling.${rarity}`, uri);
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

async function verifyShowcaseMetadata() {
  const showcase = [
    [METADATA_BY_LAND[1], "Epic"],
    [METADATA_BY_LAND[2], "Legendary"],
    [METADATA_BY_LAND[3], "Legendary"],
    [METADATA_BY_LAND[4], "Legendary"],
  ];
  await Promise.all(showcase.map(async ([land, rarity]) => {
    const label = `${land.name} Soarling ${rarity}`;
    const local = JSON.parse(await readFile(
      new URL(`../metadata/${land.name.toLowerCase()}-soarling-${rarity.toLowerCase()}.json`, import.meta.url),
      "utf8",
    ));
    await validateMetadataDocument(label, land.soarling[rarity], local.image);
    if (land.name === "Wizard") {
      const [remoteImage, localImage] = await Promise.all([
        fetchMetadataResource(local.image),
        readFile(new URL("../public/assets/landing/soarling-legendary-wizard-v2.png", import.meta.url)),
      ]);
      if (!remoteImage.ok) throw new Error(`Wizard Legendary image returned HTTP ${remoteImage.status}.`);
      const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
      const remoteHash = hash(Buffer.from(await remoteImage.arrayBuffer()));
      if (remoteHash !== hash(localImage)) {
        console.warn("Wizard Legendary metadata image is a separately exported variant of the new local artwork.");
      } else {
        console.log("Wizard Legendary metadata image matches the new local artwork byte-for-byte.");
      }
    }
  }));
}

async function verifyPairMetadata() {
  const required = [
    ...METADATA_BY_LAND.map((land) => [land, "Mythic"]),
    [METADATA_BY_LAND[3], "Legendary"],
  ];
  await Promise.all(required.map(async ([land, rarity]) => {
    const label = `${land.name} Soarling ${rarity}`;
    const local = JSON.parse(await readFile(
      new URL(`../metadata/${land.name.toLowerCase()}-soarling-${rarity.toLowerCase()}.json`, import.meta.url),
      "utf8",
    ));
    await validateMetadataDocument(label, land.soarling[rarity], local.image);
  }));
}

async function updateWizardMythicMetadata(eggoriaBirds) {
  if (process.env.CONFIRM_UPDATE_WIZARD_MYTHIC_URI !== "YES") {
    throw new Error("Set CONFIRM_UPDATE_WIZARD_MYTHIC_URI=YES to update the existing contract.");
  }

  const wizard = METADATA_BY_LAND[2];
  const local = JSON.parse(await readFile(
    new URL("../metadata/wizard-soarling-mythic.json", import.meta.url),
    "utf8",
  ));
  const nextUri = wizard.soarling.Mythic;
  await validateMetadataDocument("Wizard Soarling Mythic", nextUri, local.image);

  const state = await eggoriaBirds.tokenState(5);
  if (Number(state.land) !== wizard.index || Number(state.stage) !== 2 || Number(state.rarity) !== RARITY.Mythic) {
    throw new Error("Token #5 is not an evolved Wizard Mythic; refusing to update an unverified contract.");
  }
  const previousUri = await eggoriaBirds.tokenURI(5);
  if (previousUri === nextUri) {
    console.log("Wizard Mythic already points to:", nextUri);
    return;
  }
  const expectedPreviousUri = "ipfs://bafkreicwudamjrys7zmubkzmnz3beg4fzdmsssskbft2lmqumy7bweauau";
  if (previousUri !== expectedPreviousUri) {
    throw new Error(`Unexpected Wizard Mythic URI ${previousUri}; no transaction was sent.`);
  }

  console.log("Wizard Mythic previous URI:", previousUri);
  console.log("Wizard Mythic new URI:", nextUri);
  await sendAndConfirm("Update Wizard Mythic metadata", eggoriaBirds.setAdvancedURI(wizard.index, RARITY.Mythic, nextUri));
  const confirmedUri = await eggoriaBirds.tokenURI(5);
  if (confirmedUri !== nextUri) throw new Error(`Token #5 still points to ${confirmedUri}.`);
  console.log("Token #5 on-chain URI confirmed:", confirmedUri);
}

async function updateWindMythicMetadata(eggoriaBirds) {
  if (process.env.CONFIRM_UPDATE_WIND_MYTHIC_URI !== "YES") {
    throw new Error("Set CONFIRM_UPDATE_WIND_MYTHIC_URI=YES to update the existing contract.");
  }

  const wind = METADATA_BY_LAND[1];
  const local = JSON.parse(await readFile(
    new URL("../metadata/wind-soarling-mythic.json", import.meta.url),
    "utf8",
  ));
  const nextUri = wind.soarling.Mythic;
  await validateMetadataDocument("Wind Soarling Mythic", nextUri, local.image);

  const state = await eggoriaBirds.tokenState(13);
  if (Number(state.land) !== wind.index || Number(state.stage) !== 2 || Number(state.rarity) !== RARITY.Mythic) {
    throw new Error("Token #13 is not an evolved Wind Mythic; refusing to update an unverified contract.");
  }
  const previousUri = await eggoriaBirds.tokenURI(13);
  if (previousUri === nextUri) {
    console.log("Wind Mythic already points to:", nextUri);
    return;
  }
  const expectedPreviousUri = "ipfs://bafkreifpk67eb2eylty522rfp4lwrynkp6hfdoc7jwwu3nul3l24ighm6e";
  if (previousUri !== expectedPreviousUri) {
    throw new Error(`Unexpected Wind Mythic URI ${previousUri}; no transaction was sent.`);
  }

  console.log("Wind Mythic previous URI:", previousUri);
  console.log("Wind Mythic new URI:", nextUri);
  await sendAndConfirm("Update Wind Mythic metadata", eggoriaBirds.setAdvancedURI(wind.index, RARITY.Mythic, nextUri));
  const confirmedUri = await eggoriaBirds.tokenURI(13);
  if (confirmedUri !== nextUri) throw new Error(`Token #13 still points to ${confirmedUri}.`);
  console.log("Token #13 on-chain URI confirmed:", confirmedUri);
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

  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is missing for ARC Testnet.");
  }
  const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);
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
  // ARC's public RPC can reject rapid consecutive transaction-preflight calls.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

async function configureMetadata(eggoriaBirds) {
  assertMetadataIsReady();
  const startLand = Number(process.env.EGGORIA_METADATA_START_LAND ?? 0);
  if (!Number.isInteger(startLand) || startLand < 0 || startLand >= METADATA_BY_LAND.length) {
    throw new Error("EGGORIA_METADATA_START_LAND must be an index from 0 (Forest) to 4 (King).");
  }
  const endLand = Number(process.env.EGGORIA_METADATA_END_LAND ?? METADATA_BY_LAND.length - 1);
  if (!Number.isInteger(endLand) || endLand < startLand || endLand >= METADATA_BY_LAND.length) {
    throw new Error("EGGORIA_METADATA_END_LAND must be at least START_LAND and no greater than 4 (King).");
  }
  const skipStages = process.env.EGGORIA_METADATA_SKIP_STAGES === "YES";
  const skipPrimary = skipStages || process.env.EGGORIA_METADATA_SKIP_PRIMARY === "YES";
  const skipIntermediate = skipStages || process.env.EGGORIA_METADATA_SKIP_INTERMEDIATE === "YES";
  const skipRarities = process.env.EGGORIA_METADATA_SKIP_RARITIES === "YES";
  const startRarity = Number(process.env.EGGORIA_METADATA_START_RARITY ?? 0);
  if (!Number.isInteger(startRarity) || startRarity < 0 || startRarity >= Object.keys(RARITY).length) {
    throw new Error("EGGORIA_METADATA_START_RARITY must be an index from 0 (Common) to 4 (Mythic).");
  }
  const endRarity = Number(process.env.EGGORIA_METADATA_END_RARITY ?? Object.keys(RARITY).length - 1);
  if (!Number.isInteger(endRarity) || endRarity < startRarity || endRarity >= Object.keys(RARITY).length) {
    throw new Error("EGGORIA_METADATA_END_RARITY must be at least START_RARITY and no greater than 4 (Mythic).");
  }

  for (const land of METADATA_BY_LAND.slice(startLand, endLand + 1)) {
    if ((!skipPrimary || land.index !== startLand) && !skipStages) {
      await sendAndConfirm(
        `${land.name} Primary`,
        eggoriaBirds.setStageURI(land.index, STAGE.Primary, land.primary),
      );
    }
    if ((!skipIntermediate || land.index !== startLand) && !skipStages) {
      await sendAndConfirm(
        `${land.name} Intermediate`,
        eggoriaBirds.setStageURI(land.index, STAGE.Intermediate, land.intermediate),
      );
    }
    const rarities = Object.entries(RARITY);
    const selectedRarities = land.index === startLand && land.index === endLand
      ? rarities.slice(startRarity, endRarity + 1)
      : land.index === startLand
        ? rarities.slice(startRarity)
        : land.index === endLand
          ? rarities.slice(0, endRarity + 1)
          : rarities;
    if (!skipRarities) {
      for (const [rarityName, rarityIndex] of selectedRarities) {
        await sendAndConfirm(
          `${land.name} Soarling ${rarityName}`,
          eggoriaBirds.setAdvancedURI(land.index, rarityIndex, land.soarling[rarityName]),
        );
      }
    }
  }

  console.log(`NFT metadata configured from ${METADATA_BY_LAND[startLand].name} through ${METADATA_BY_LAND[endLand].name}.`);
  console.log("Minting remains disabled.");
}

async function configurePrimaryMetadata(eggoriaBirds) {
  const startLand = Number(process.env.EGGORIA_METADATA_START_LAND ?? 0);
  const endLand = Number(process.env.EGGORIA_METADATA_END_LAND ?? METADATA_BY_LAND.length - 1);
  if (!Number.isInteger(startLand) || !Number.isInteger(endLand) || startLand < 0 || endLand < startLand || endLand >= METADATA_BY_LAND.length) {
    throw new Error("Primary metadata land range must be between Forest (0) and King (4).");
  }
  for (const land of METADATA_BY_LAND.slice(startLand, endLand + 1)) {
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
  const startLand = Number(process.env.EGGORIA_METADATA_START_LAND ?? 0);
  const endLand = Number(process.env.EGGORIA_METADATA_END_LAND ?? METADATA_BY_LAND.length - 1);
  if (!Number.isInteger(startLand) || !Number.isInteger(endLand) || startLand < 0 || endLand < startLand || endLand >= METADATA_BY_LAND.length) {
    throw new Error("Intermediate metadata land range must be between Forest (0) and King (4).");
  }
  for (const land of METADATA_BY_LAND.slice(startLand, endLand + 1)) {
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
  console.log("Evolution test mode is enabled. New mints start at 0/10 check-ins.");
}

async function enableEvolutionShowcaseMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_SHOWCASE_MODE !== "YES") {
    throw new Error("Set CONFIRM_ENABLE_EVOLUTION_SHOWCASE_MODE=YES to enable the 12-mint QA showcase.");
  }
  if (await eggoriaBirds.totalSupply() !== 0n) {
    throw new Error("The 12-mint QA showcase must start on a fresh contract.");
  }
  if (!await eggoriaBirds.evolutionTestMode()) {
    throw new Error("Enable evolution test mode before the 12-mint QA showcase.");
  }
  await sendAndConfirm("Enable 12-mint QA showcase", eggoriaBirds.setEvolutionShowcaseMode(true));
  console.log("Mints 1-3: Wind Epic; 4-6: Wizard Legendary; 7-9: Artist Legendary; 10-12: King Legendary.");
}

async function enableEvolutionPairRotationMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_PAIR_ROTATION_MODE !== "YES") {
    throw new Error("Set CONFIRM_ENABLE_EVOLUTION_PAIR_ROTATION_MODE=YES to enable the two-mints-per-land QA rotation.");
  }
  if (await eggoriaBirds.totalSupply() !== 0n) {
    throw new Error("The two-mints-per-land QA rotation must start on a fresh contract.");
  }
  if (!await eggoriaBirds.evolutionTestMode()) {
    throw new Error("Enable evolution test mode before the two-mints-per-land QA rotation.");
  }
  await sendAndConfirm("Enable two-mints-per-land QA rotation", eggoriaBirds.setEvolutionPairRotationMode(true));
  console.log("Land order repeats: Forest x2, Wind x2, Wizard x2, Artist x2, King x2.");
  console.log("Rarity repeats: Mythic x2 for Forest/Wind/Wizard/King; Artist Mythic then Legendary. QA does not consume production rarity quotas.");
}

async function enableEvolutionLegendaryRotationMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_LEGENDARY_ROTATION_MODE !== "YES") {
    throw new Error("Set CONFIRM_ENABLE_EVOLUTION_LEGENDARY_ROTATION_MODE=YES to enable the repeating five-land Legendary QA rotation.");
  }
  if (await eggoriaBirds.totalSupply() !== 0n) {
    throw new Error("The repeating five-land Legendary QA rotation must start on a fresh contract.");
  }
  if (!await eggoriaBirds.evolutionTestMode()) {
    throw new Error("Enable evolution test mode before the Legendary rotation.");
  }
  await sendAndConfirm(
    "Enable repeating five-land Legendary QA rotation",
    eggoriaBirds.setEvolutionLegendaryRotationMode(true),
  );
  console.log("Land order repeats: Forest, Wind, Wizard, Artist, King.");
  console.log("Every test evolution receives Legendary without consuming production rarity quotas.");
}

async function enableEvolutionEpicRotationMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_EPIC_ROTATION_MODE !== "YES") {
    throw new Error("Set CONFIRM_ENABLE_EVOLUTION_EPIC_ROTATION_MODE=YES to enable the repeating five-land Epic QA rotation.");
  }
  if (await eggoriaBirds.totalSupply() !== 0n) {
    throw new Error("The repeating five-land Epic QA rotation must start on a fresh contract.");
  }
  if (!await eggoriaBirds.evolutionTestMode()) {
    throw new Error("Enable evolution test mode before the Epic rotation.");
  }
  await sendAndConfirm(
    "Enable repeating five-land Epic QA rotation",
    eggoriaBirds.setEvolutionEpicRotationMode(true),
  );
  console.log("Land order repeats: Forest, Wind, Wizard, Artist, King.");
  console.log("Every test evolution receives Epic without consuming production rarity quotas.");
}

async function enableEvolutionRareCommonRotationMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_RARE_COMMON_ROTATION_MODE !== "YES") {
    throw new Error("Set CONFIRM_ENABLE_EVOLUTION_RARE_COMMON_ROTATION_MODE=YES to enable the repeating Rare/Common QA rotation.");
  }
  if (await eggoriaBirds.totalSupply() !== 0n) {
    throw new Error("The repeating Rare/Common rotation must start on a fresh contract.");
  }
  if (!await eggoriaBirds.evolutionTestMode()) {
    throw new Error("Enable evolution test mode before the Rare/Common rotation.");
  }
  await sendAndConfirm(
    "Enable repeating Rare/Common QA rotation",
    eggoriaBirds.setEvolutionRareCommonRotationMode(true),
  );
  console.log("Land order repeats: Forest, Wind, Wizard, Artist, King.");
  console.log("Rarity order repeats: Rare x5, then Common x5. QA does not consume production rarity quotas.");
}

async function enableEvolutionAllRarityRotationMode(eggoriaBirds) {
  if (process.env.CONFIRM_ENABLE_EVOLUTION_ALL_RARITY_ROTATION_MODE !== "YES") {
    throw new Error("Set CONFIRM_ENABLE_EVOLUTION_ALL_RARITY_ROTATION_MODE=YES to enable the all-rarity QA rotation.");
  }
  if (await eggoriaBirds.totalSupply() !== 0n) {
    throw new Error("The all-rarity rotation must start on a fresh contract.");
  }
  if (!await eggoriaBirds.evolutionTestMode()) {
    throw new Error("Enable evolution test mode before the all-rarity rotation.");
  }
  await sendAndConfirm(
    "Enable Common-to-Mythic QA rotation",
    eggoriaBirds.setEvolutionAllRarityRotationMode(true),
  );
  console.log("Each rarity uses land order: Forest, Wind, Wizard, Artist, King.");
  console.log("Rarity order repeats: Common, Rare, Epic, Legendary, Mythic.");
}

async function setEvolutionTestLand(eggoriaBirds) {
  const land = Number(process.env.EGGORIA_TEST_LAND);
  if (!Number.isInteger(land) || land < 0 || land >= METADATA_BY_LAND.length) {
    throw new Error("EGGORIA_TEST_LAND must be an index from 0 (Forest) to 4 (King).");
  }
  await sendAndConfirm(
    `Set evolution test rotation start to ${METADATA_BY_LAND[land].name}`,
    eggoriaBirds.setEvolutionTestLand(land),
  );
  console.log(`Each five-mint land rotation will start with ${METADATA_BY_LAND[land].name}.`);
}

async function setEvolutionTestRarity(eggoriaBirds) {
  const rarityName = process.env.EGGORIA_TEST_RARITY;
  if (!rarityName || !Object.hasOwn(RARITY, rarityName)) {
    throw new Error("EGGORIA_TEST_RARITY must be Common, Rare, Epic, Legendary, or Mythic.");
  }
  await sendAndConfirm(
    `Set evolution test rarity to ${rarityName}`,
    eggoriaBirds.setEvolutionTestRarity(RARITY[rarityName]),
  );
  console.log(`New test evolutions will prefer ${rarityName} while its quota remains.`);
}

async function printContractStatus(eggoriaBirds) {
  const [totalSupply, mintingEnabled, evolutionTestMode, evolutionShowcaseMode, evolutionPairRotationMode, evolutionLegendaryRotationMode, evolutionEpicRotationMode, evolutionRareCommonRotationMode, evolutionAllRarityRotationMode, evolutionTestLand, evolutionTestRarity] = await Promise.all([
    eggoriaBirds.totalSupply(),
    eggoriaBirds.mintingEnabled(),
    eggoriaBirds.evolutionTestMode(),
    eggoriaBirds.evolutionShowcaseMode(),
    eggoriaBirds.evolutionPairRotationMode(),
    eggoriaBirds.evolutionLegendaryRotationMode(),
    eggoriaBirds.evolutionEpicRotationMode(),
    eggoriaBirds.evolutionRareCommonRotationMode(),
    eggoriaBirds.evolutionAllRarityRotationMode(),
    eggoriaBirds.evolutionTestLand(),
    eggoriaBirds.evolutionTestRarity(),
  ]);
  console.log("Total supply:", totalSupply.toString());
  console.log("Minting enabled:", mintingEnabled);
  console.log("Evolution test mode:", evolutionTestMode);
  console.log("12-mint QA showcase mode:", evolutionShowcaseMode);
  console.log("Two-mints-per-land QA rotation mode:", evolutionPairRotationMode);
  console.log("Repeating five-land Legendary QA rotation mode:", evolutionLegendaryRotationMode);
  console.log("Repeating five-land Epic QA rotation mode:", evolutionEpicRotationMode);
  console.log("Repeating Rare/Common QA rotation mode:", evolutionRareCommonRotationMode);
  console.log("Repeating Common-to-Mythic QA rotation mode:", evolutionAllRarityRotationMode);
  console.log("Evolution test rotation starts at:", METADATA_BY_LAND[Number(evolutionTestLand)].name);
  console.log("Evolution test preferred rarity:", Object.keys(RARITY)[Number(evolutionTestRarity)]);
  const rarityNames = Object.keys(RARITY);
  for (const land of METADATA_BY_LAND) {
    const quota = await Promise.all(
      rarityNames.map((rarity) => eggoriaBirds.landRarityRemaining(land.index, RARITY[rarity])),
    );
    console.log(
      `${land.name} rarity remaining:`,
      rarityNames.map((rarity, index) => `${rarity}=${quota[index]}`).join(", "),
    );
  }
}

async function main() {
  const action = process.env.EGGORIA_ADMIN_ACTION ?? "configure-metadata";
  if (action === "verify-showcase-metadata") {
    await verifyShowcaseMetadata();
    return;
  }
  if (action === "verify-pair-metadata") {
    await verifyPairMetadata();
    return;
  }
  const { eggoriaBirds } = await verifyAdminContext();

  if (action === "configure-metadata") {
    await configureMetadata(eggoriaBirds);
    return;
  }
  if (action === "update-wizard-mythic-metadata") {
    await updateWizardMythicMetadata(eggoriaBirds);
    return;
  }
  if (action === "update-wind-mythic-metadata") {
    await updateWindMythicMetadata(eggoriaBirds);
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
  if (action === "enable-evolution-showcase-mode") {
    await enableEvolutionShowcaseMode(eggoriaBirds);
    return;
  }
  if (action === "enable-evolution-pair-rotation-mode") {
    await enableEvolutionPairRotationMode(eggoriaBirds);
    return;
  }
  if (action === "enable-evolution-legendary-rotation-mode") {
    await enableEvolutionLegendaryRotationMode(eggoriaBirds);
    return;
  }
  if (action === "enable-evolution-epic-rotation-mode") {
    await enableEvolutionEpicRotationMode(eggoriaBirds);
    return;
  }
  if (action === "enable-evolution-rare-common-rotation-mode") {
    await enableEvolutionRareCommonRotationMode(eggoriaBirds);
    return;
  }
  if (action === "enable-evolution-all-rarity-rotation-mode") {
    await enableEvolutionAllRarityRotationMode(eggoriaBirds);
    return;
  }
  if (action === "set-evolution-test-land") {
    await setEvolutionTestLand(eggoriaBirds);
    return;
  }
  if (action === "set-evolution-test-rarity") {
    await setEvolutionTestRarity(eggoriaBirds);
    return;
  }
  if (action === "status") {
    await printContractStatus(eggoriaBirds);
    return;
  }

  throw new Error(
    `Unknown EGGORIA_ADMIN_ACTION "${action}". Use "verify-showcase-metadata", "verify-pair-metadata", "configure-metadata", "update-wizard-mythic-metadata", "update-wind-mythic-metadata", "configure-primary", "configure-intermediate", "enable-minting", "enable-evolution-test-mode", "enable-evolution-showcase-mode", "enable-evolution-pair-rotation-mode", "enable-evolution-legendary-rotation-mode", "enable-evolution-epic-rotation-mode", "enable-evolution-rare-common-rotation-mode", "enable-evolution-all-rarity-rotation-mode", "set-evolution-test-land", "set-evolution-test-rarity", or "status".`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
