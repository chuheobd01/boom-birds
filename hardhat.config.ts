import dotenv from "dotenv";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { configVariable, defineConfig } from "hardhat/config";

dotenv.config({ path: ".env.local" });
dotenv.config();

export default defineConfig({
  plugins: [hardhatEthers],

  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  paths: {
    artifacts: "./hardhat-artifacts",
    cache: "./hardhat-cache",
  },

  networks: {
    arcTestnet: {
      type: "http",
      chainType: "generic",
      chainId: 5_042_002,
      url: configVariable("ARC_TESTNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
