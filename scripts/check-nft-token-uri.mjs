import { network } from "hardhat";

const EXPECTED_CHAIN_ID = 5_042_002n;
const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const tokenId = BigInt(process.env.NFT_TOKEN_ID ?? "9");

function toHttpUrl(uri) {
  if (uri.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}${uri.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  }
  if (uri.startsWith("https://")) return uri;
  throw new Error(`Unsupported URI scheme: ${uri || "<empty>"}`);
}

async function fetchResource(url) {
  return fetch(url, { signal: AbortSignal.timeout(30_000) });
}

if (tokenId <= 0n) {
  throw new Error("NFT_TOKEN_ID must be a positive integer.");
}

const { ethers } = await network.connect();
const { chainId } = await ethers.provider.getNetwork();
if (chainId !== EXPECTED_CHAIN_ID) {
  throw new Error(`Wrong network: expected ARC Testnet (${EXPECTED_CHAIN_ID}), got ${chainId}.`);
}

const address = process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS;
if (!address || !ethers.isAddress(address)) {
  throw new Error("NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS is missing or invalid.");
}

// getContractAt loads the EggoriaBirds ABI from this project's compiled artifact.
const birds = await ethers.getContractAt("EggoriaBirds", address, ethers.provider);
const uri = await birds.tokenURI(tokenId);
const scheme = uri.startsWith("ipfs://") ? "ipfs://"
  : uri.startsWith("https://") ? "https://"
    : uri === "" ? "empty" : "other";

console.log(`Network: ARC Testnet (${chainId})`);
console.log(`Contract: ${address}`);
console.log(`Token ID: ${tokenId}`);
console.log(`tokenURI: ${uri || "<empty>"}`);
console.log(`URI type: ${scheme}`);

const metadataUrl = toHttpUrl(uri);
console.log(`Metadata HTTP URL: ${metadataUrl}`);
const metadataResponse = await fetchResource(metadataUrl);
console.log(`Metadata HTTP status: ${metadataResponse.status}`);
if (metadataResponse.status !== 200) {
  throw new Error(`Metadata returned HTTP ${metadataResponse.status}.`);
}

const metadata = await metadataResponse.json();
console.log("Metadata JSON:");
console.log(JSON.stringify(metadata, null, 2));

const fields = {
  name: typeof metadata.name === "string",
  description: typeof metadata.description === "string",
  image: typeof metadata.image === "string" && metadata.image.trim().length > 0,
  attributes: Array.isArray(metadata.attributes),
};
for (const [field, valid] of Object.entries(fields)) {
  console.log(`Field ${field}: ${valid ? "valid" : "INVALID"}`);
}
console.log(`Metadata valid: ${Object.values(fields).every(Boolean)}`);
if (!fields.image) throw new Error("Cannot fetch image: metadata.image is missing or empty.");

console.log(`Original image URI: ${metadata.image}`);
const imageUrl = toHttpUrl(metadata.image);
console.log(`Image HTTP URL: ${imageUrl}`);
const imageResponse = await fetchResource(imageUrl);
const imageContentType = imageResponse.headers.get("content-type") ?? "<missing>";
const imageBytes = await imageResponse.arrayBuffer();
console.log(`Image HTTP status: ${imageResponse.status}`);
console.log(`Image Content-Type: ${imageContentType}`);
console.log(`Image size: ${imageBytes.byteLength} bytes`);
console.log(`Image load valid: ${imageResponse.status === 200 && imageContentType.toLowerCase().startsWith("image/") && imageBytes.byteLength > 0}`);
