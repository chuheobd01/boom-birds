import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const CHECK_INS_BEFORE_INTERMEDIATE = 9;
const PRIMARY_METADATA_URIS = [
  "ipfs://bafkreigefspgbbhv6kithuavppytwd5xnuakfrlh3llnyakh76zcyajl4u",
  "ipfs://bafkreidmh5j63xef7ouy776vijt36tcqwgwt4uq47a5otiy7i72h6yz6ri",
  "ipfs://bafkreifllk3t6phkkuiuth7enzvaoh72t6tlmmun2x3znbufvs6x77ixsu",
  "ipfs://bafkreidaxorl5gpoagc22jydonc4ihir2ahz7irdi4uly3qklix2cpbgpa",
  "ipfs://bafkreigreiimilepwqsugpwzgv6ksheb4qmr2bjskru7dshuzpccpogha4",
];

async function confirm(label, transactionPromise) {
  const transaction = await transactionPromise;
  console.log(`${label}:`, transaction.hash);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed.`);
}

async function main() {
  const { ethers } = await network.connect();
  const currentNetwork = await ethers.provider.getNetwork();
  if (currentNetwork.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Expected ARC Testnet, received chain ${currentNetwork.chainId}.`);
  }

  const contractAddress = process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS;
  const recipient = process.env.EGGORIA_TEST_OWNER;
  const land = Number(process.env.EGGORIA_TEST_LAND ?? "1");
  if (!contractAddress || !ethers.isAddress(contractAddress)) throw new Error("Invalid contract address.");
  if (!recipient || !ethers.isAddress(recipient)) throw new Error("Set EGGORIA_TEST_OWNER to the NFT owner address.");
  if (!Number.isInteger(land) || land < 0 || land >= PRIMARY_METADATA_URIS.length) {
    throw new Error("EGGORIA_TEST_LAND must be an integer from 0 through 4.");
  }

  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error("No ARC Testnet admin signer is configured.");
  const birds = await ethers.getContractAt("EggoriaBirds", contractAddress, admin);
  const adminRole = await birds.DEFAULT_ADMIN_ROLE();
  if (!(await birds.hasRole(adminRole, await admin.getAddress()))) throw new Error("Signer is not the contract admin.");

  for (let land = 0; land < PRIMARY_METADATA_URIS.length; land += 1) {
    const uri = PRIMARY_METADATA_URIS[land];
    await confirm(`Set land ${land} Primary URI`, birds.setStageURI(land, 0, uri));
    await confirm(`Set land ${land} Intermediate URI`, birds.setStageURI(land, 1, uri));
  }

  if (!(await birds.mintingEnabled())) {
    await confirm("Enable minting", birds.setMintingEnabled(true));
  }
  if (!(await birds.evolutionTestMode())) {
    await confirm("Enable evolution test mode", birds.setEvolutionTestMode(true));
  }

  if (!(await birds.hasMinted(recipient))) {
    await confirm(
      `Seed land ${land} test bird at 9 check-ins`,
      birds.seedTestBird(recipient, land, CHECK_INS_BEFORE_INTERMEDIATE),
    );
  }

  const tokenId = await birds.mintedTokenOf(recipient);
  const state = await birds.tokenState(tokenId);
  console.log(JSON.stringify({
    contract: contractAddress,
    tokenId: tokenId.toString(),
    owner: state.owner,
    land: Number(state.land),
    stage: Number(state.stage),
    checkIns: Number(state.checkIns),
    lastCheckInDay: state.lastCheckInDay.toString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
