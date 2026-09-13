import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const TOKEN_ID = 1n;

const LAND_NAMES = ["Forest", "Wind/Pilot", "Wizard", "Artist", "King"];
const STAGE_NAMES = ["Primary", "Intermediate", "Advanced"];
const RARITY_NAMES = ["Common", "Rare", "Epic", "Legendary", "Mythic"];

function toIpfsGatewayUrl(uri) {
  if (!uri.startsWith("ipfs://")) return null;

  const ipfsPath = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  return `https://ipfs.io/ipfs/${ipfsPath}`;
}

function enumName(names, value) {
  const index = Number(value);
  return names[index] ?? `Unknown (${index})`;
}

async function main() {
  const { ethers } = await network.connect();
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ARC Testnet chain ID ${ARC_TESTNET_CHAIN_ID}, ` +
      `received ${currentNetwork.chainId}.`,
    );
  }

  const configuredAddress = process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS;
  if (!configuredAddress || !ethers.isAddress(configuredAddress)) {
    throw new Error(
      "NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS is missing or invalid in .env.local.",
    );
  }
  const contractAddress = ethers.getAddress(configuredAddress);

  const deployedCode = await ethers.provider.getCode(contractAddress);
  if (deployedCode === "0x") {
    throw new Error(`No deployed bytecode found at ${contractAddress}.`);
  }

  const eggoriaBirds = await ethers.getContractAt(
    "EggoriaBirds",
    contractAddress,
    ethers.provider,
  );

  const [owner, tokenUri, totalSupply, mintingEnabled] = await Promise.all([
    eggoriaBirds.ownerOf(TOKEN_ID),
    eggoriaBirds.tokenURI(TOKEN_ID),
    eggoriaBirds.totalSupply(),
    eggoriaBirds.mintingEnabled(),
  ]);

  let lastCheckInDay;
  let land;
  let checkIns;
  let stage;
  let rarity;
  let landAssigned = true;
  let rarityAssigned;

  try {
    const state = await eggoriaBirds.tokenState(TOKEN_ID);
    [, land, landAssigned, stage, rarity, rarityAssigned, checkIns, lastCheckInDay] = state;
  } catch {
    const legacyContract = new ethers.Contract(
      contractAddress,
      ["function birds(uint256) view returns (uint64,uint8,uint8,uint8,uint8,bool)"],
      ethers.provider,
    );
    [lastCheckInDay, land, checkIns, stage, rarity, rarityAssigned] =
      await legacyContract.birds(TOKEN_ID);
  }

  const ownerHasMinted = await eggoriaBirds.hasMinted(owner);
  const landMinted = landAssigned ? await eggoriaBirds.landMinted(land) : null;

  console.log("Chain ID:", currentNetwork.chainId.toString());
  console.log("Contract:", contractAddress);
  console.log("Token ID:", TOKEN_ID.toString());
  console.log("Owner:", owner);
  console.log("Owner has minted:", ownerHasMinted);
  console.log("Total supply:", totalSupply.toString());
  console.log("Minting enabled:", mintingEnabled);
  console.log("Land:", landAssigned ? `${enumName(LAND_NAMES, land)} (${land})` : "Pending");
  console.log("Land assigned:", landAssigned);
  console.log("Land minted count:", landMinted?.toString() ?? "Pending");
  console.log("Stage:", `${enumName(STAGE_NAMES, stage)} (${stage})`);
  console.log("Check-ins:", checkIns.toString());
  console.log("Last check-in day:", lastCheckInDay.toString());
  console.log(
    "Rarity:",
    rarityAssigned ? `${enumName(RARITY_NAMES, rarity)} (${rarity})` : "Not assigned",
  );
  console.log("Rarity assigned:", rarityAssigned);
  console.log("tokenURI:", tokenUri || "<empty>");

  const gatewayUrl = toIpfsGatewayUrl(tokenUri);
  if (gatewayUrl) {
    console.log("IPFS gateway URL:", gatewayUrl);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
