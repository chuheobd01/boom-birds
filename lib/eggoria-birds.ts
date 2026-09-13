export const EGGORIA_MAX_SUPPLY = 500;

export const eggoriaBirdsAbi = [
  {
    type: "error",
    name: "MaxSupplyReached",
    inputs: [],
  },
  {
    type: "error",
    name: "MintingDisabled",
    inputs: [],
  },
  {
    type: "error",
    name: "WalletAlreadyMinted",
    inputs: [],
  },
  {
    type: "event",
    name: "BirdMinted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "land", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "hasMinted",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "minted", type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
