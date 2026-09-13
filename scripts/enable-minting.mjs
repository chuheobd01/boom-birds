import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;

async function main() {
  const { ethers } = await network.connect();
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ARC Testnet chain ID ${ARC_TESTNET_CHAIN_ID}, ` +
      `received ${currentNetwork.chainId}. Minting was not enabled.`,
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

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer is configured for ARC Testnet.");
  }
  const deployerAddress = await deployer.getAddress();
  const eggoriaBirds = await ethers.getContractAt(
    "EggoriaBirds",
    contractAddress,
    deployer,
  );

  const defaultAdminRole = await eggoriaBirds.DEFAULT_ADMIN_ROLE();
  const hasDefaultAdminRole = await eggoriaBirds.hasRole(
    defaultAdminRole,
    deployerAddress,
  );

  if (!hasDefaultAdminRole) {
    throw new Error(
      `Signer ${deployerAddress} does not have DEFAULT_ADMIN_ROLE. Minting was not enabled.`,
    );
  }

  const transaction = await eggoriaBirds.setMintingEnabled(true);
  console.log("Transaction hash:", transaction.hash);

  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("setMintingEnabled(true) transaction failed.");
  }

  const mintingEnabled = await eggoriaBirds.mintingEnabled();
  console.log("Final mintingEnabled state:", mintingEnabled);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
