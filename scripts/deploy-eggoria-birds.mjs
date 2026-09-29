import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;

async function main() {
  const { ethers } = await network.connect();
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ARC Testnet chain ID ${ARC_TESTNET_CHAIN_ID}, ` +
      `received ${currentNetwork.chainId}. Deployment stopped.`,
    );
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account is configured for this network.");
  }

  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);
  if (deployerBalance === 0n) {
    throw new Error(`Deployer ${deployerAddress} has no ARC Testnet gas balance. Deployment stopped.`);
  }

  console.log("Deployer address:", deployerAddress);
  console.log("Network chain ID:", currentNetwork.chainId.toString());
  console.log("Deployer gas balance:", ethers.formatEther(deployerBalance), "native tokens");

  const eggoriaBirds = await ethers.deployContract(
    "EggoriaBirds",
    [deployerAddress],
    deployer,
  );
  const deploymentTransaction = eggoriaBirds.deploymentTransaction();

  if (!deploymentTransaction) {
    throw new Error("Deployment transaction was not created.");
  }

  console.log("Deployment transaction hash:", deploymentTransaction.hash);

  await eggoriaBirds.waitForDeployment();

  console.log("EggoriaBirds contract address:", await eggoriaBirds.getAddress());
  console.log("Minting remains disabled.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
