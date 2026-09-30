import { network } from "hardhat";

const EXPECTED_CHAIN_ID = 5_042_002n;
const tokenId = BigInt(process.env.NFT_TOKEN_ID ?? "9");
if (tokenId <= 0n) throw new Error("NFT_TOKEN_ID must be a positive integer.");

const { ethers } = await network.connect();
const { chainId } = await ethers.provider.getNetwork();
if (chainId !== EXPECTED_CHAIN_ID) {
  throw new Error(`Wrong network: expected ARC Testnet (${EXPECTED_CHAIN_ID}), got ${chainId}.`);
}

const address = process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS;
if (!address || !ethers.isAddress(address)) {
  throw new Error("NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS is missing or invalid.");
}

// The ABI comes from this project's compiled EggoriaBirds artifact.
const birds = await ethers.getContractAt("EggoriaBirds", address, ethers.provider);
const filter = birds.filters.Transfer(ethers.ZeroAddress, null, tokenId);
const latestBlock = await ethers.provider.getBlockNumber();
const blockWindow = 1_000;
let logs = [];
let searchedWindows = 0;
for (let end = latestBlock; end >= 0; end -= blockWindow) {
  const start = Math.max(0, end - blockWindow + 1);
  logs = await birds.queryFilter(filter, start, end);
  searchedWindows += 1;
  if (logs.length > 0) break;
}

console.log(`Network: ARC Testnet (${chainId})`);
console.log(`Contract: ${address}`);
console.log(`Token ID: ${tokenId}`);
console.log(`Searched block windows: ${searchedWindows}`);
console.log(`Mint Transfer events: ${logs.length}`);
for (const log of logs) {
  console.log(`Transfer from: ${log.args.from}`);
  console.log(`Transfer to: ${log.args.to}`);
  console.log(`Transfer token ID: ${log.args.tokenId}`);
  console.log(`Transaction hash: ${log.transactionHash}`);
  console.log(`Block number: ${log.blockNumber}`);
  const receipt = await ethers.provider.getTransactionReceipt(log.transactionHash);
  console.log(`Transaction status: ${receipt?.status === 1 ? "success" : "failed or unavailable"}`);
}

if (logs.length !== 1) process.exitCode = 1;
