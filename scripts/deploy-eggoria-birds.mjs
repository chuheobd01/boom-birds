import { network } from "hardhat";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const ARC_TESTNET_D20_VRF_COORDINATOR = "0xd20DA0FF9087d053f0291524Eac12abA1ADBd945";
const ARC_TESTNET_D20_REGISTRY = "0xD20Da00B47A7cD2211dC4683E306913b05903756";
const ARC_TESTNET_D20_BEACON_VERIFIER = "0xd20dA01Aa16AeD6b77Cd8DDb869151802599100a";
const EXPECTED_COORDINATOR_IMPLEMENTATION = "0xD20da000125643B4db5A6A36A3b853c17745DF44";
const EXPECTED_REGISTRY_IMPLEMENTATION = "0xD20dA0853a6f894c0cdc9018fD4F8F67Eac15704";
const EXPECTED_COORDINATOR_CODE_HASH = "0x3dda400d8360d7e03b8dacd8ba1ffad7ad672e07628bee7de4542d754dd5348c";
const EXPECTED_REGISTRY_CODE_HASH = "0xb5e125e3b0f63ffe516d781266c1cbacebe3d131148b69f8736d3ca78bcddb12";
const EXPECTED_BEACON_CODE_HASH = "0x4388250d26298224c4a39d030263550655390ca831ab44c4124f8b0be1f65351";
const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function verifyProxy(ethers, provider, label, proxy, expectedImplementation, expectedCodeHash) {
  const stored = await provider.getStorage(proxy, ERC1967_IMPLEMENTATION_SLOT);
  const implementation = ethers.getAddress(`0x${stored.slice(-40)}`);
  const codeHash = ethers.keccak256(await provider.getCode(implementation));
  if (implementation !== ethers.getAddress(expectedImplementation) || codeHash !== expectedCodeHash) {
    throw new Error(`${label} no longer matches the reviewed D20 deployment manifest. Deployment stopped.`);
  }
}

async function verifyD20Deployment(ethers, provider) {
  await verifyProxy(ethers, provider, "D20 coordinator", ARC_TESTNET_D20_VRF_COORDINATOR,
    EXPECTED_COORDINATOR_IMPLEMENTATION, EXPECTED_COORDINATOR_CODE_HASH);
  await verifyProxy(ethers, provider, "D20 registry", ARC_TESTNET_D20_REGISTRY,
    EXPECTED_REGISTRY_IMPLEMENTATION, EXPECTED_REGISTRY_CODE_HASH);
  const beaconCodeHash = ethers.keccak256(await provider.getCode(ARC_TESTNET_D20_BEACON_VERIFIER));
  if (beaconCodeHash !== EXPECTED_BEACON_CODE_HASH) {
    throw new Error("D20 beacon verifier no longer matches the reviewed deployment manifest. Deployment stopped.");
  }
}

async function main() {
  const { ethers } = await network.connect();
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ARC Testnet chain ID ${ARC_TESTNET_CHAIN_ID}, ` +
      `received ${currentNetwork.chainId}. Deployment stopped.`,
    );
  }

  await verifyD20Deployment(ethers, ethers.provider);
  console.log("D20 VRF coordinator, registry and beacon verifier match the pinned ARC Testnet manifest.");

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
    [deployerAddress, ARC_TESTNET_D20_VRF_COORDINATOR],
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
