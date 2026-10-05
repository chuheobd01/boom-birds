"use client";

/* eslint-disable @next/next/no-img-element -- exact Figma exports use native image crops */

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createThirdwebClient, defineChain, eth_estimateGas, eth_gasPrice, getContract, getRpcClient, prepareContractCall, readContract, sendTransaction, waitForReceipt } from "thirdweb";
import { AutoConnect, useActiveAccount, useActiveWallet, useConnect, useDisconnect, useIsAutoConnecting } from "thirdweb/react";
import { getUserEmail } from "thirdweb/wallets/in-app";
import { createWallet, getWalletBalance, inAppWallet, injectedProvider } from "thirdweb/wallets";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, isAddress, toHex } from "viem";

import { EGGORIA_MAX_SUPPLY, eggoriaBirdsAbi } from "@/lib/eggoria-birds";
import artistPrimaryMetadata from "@/metadata/artist-primary.json";
import forestPrimaryMetadata from "@/metadata/forest-primary.json";
import kingPrimaryMetadata from "@/metadata/king-primary.json";
import windPrimaryMetadata from "@/metadata/wind-primary.json";
import wizardPrimaryMetadata from "@/metadata/wizard-primary.json";

type EggoriaUser = { id: string; name: string; email?: string; picture?: string; position: number };
type GoogleCredential = { credential: string };
type WalletKind = "google" | "metamask" | "";
type WalletErrorKind = "missing-metamask" | "thirdweb-config" | "google-cancelled" | "google-popup-blocked" | "google-failed" | "metamask-closed" | "metamask-cancelled" | "metamask-pending" | "metamask-locked" | "metamask-failed" | "";
type NetworkDialog = "add" | "switch" | null;
type NetworkResumeAction = "hero" | "checkin" | "mint" | "evolve" | null;
type BalanceAlertKind = "low" | "out" | "cooldown";
type FundsPhase = "idle" | "signing" | "sending" | "updating";
type FundsErrorKind = "" | "cancelled" | "cooldown" | "empty" | "timeout" | "error";
type HatchPhase = "idle" | "charge" | "shake" | "reveal";
type MintPhase = "idle" | "checking" | "waiting" | "pending";
type CheckInPhase = "idle" | "saving" | "wallet";
type MintBlocker = "already" | "soldout" | "failed" | null;
type OwnedBird = {
  tokenId: bigint;
  owner: string;
  land: number;
  landAssigned: boolean;
  stage: number;
  rarity: number;
  rarityAssigned: boolean;
  checkIns: number;
  lastCheckInDay: bigint;
  lastCheckInAt: string;
  image: string;
};
type EthereumProvider = {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
  request(options: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

declare global {
  interface Window {
    google?: { accounts?: { id: {
      initialize(options: Record<string, unknown>): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
    } } };
    ethereum?: EthereumProvider;
  }
}

const asset = (name: string) => `/assets/landing/${name}`;
const subscribeToClient = () => () => undefined;
const ARC_TESTNET = defineChain({
  id: 5_042_002,
  name: "ARC Testnet",
  rpc: "https://rpc.testnet.arc.network",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  blockExplorers: [{ name: "ArcScan", url: "https://testnet.arcscan.app" }],
  testnet: true,
});
const ARC_CHAIN_ID_HEX = `0x${ARC_TESTNET.id.toString(16)}`;
const D20_VRF_COORDINATOR = "0xd20DA0FF9087d053f0291524Eac12abA1ADBd945" as const;
const D20_LAND_CALLBACK_GAS = 220_000;
const D20_RARITY_CALLBACK_GAS = 260_000;
const d20QuoteAbi = [{
  type: "function",
  name: "quoteFeeAt",
  stateMutability: "view",
  inputs: [{ name: "callbackGasLimit", type: "uint32" }, { name: "baseFee", type: "uint256" }],
  outputs: [{ name: "fee", type: "uint256" }],
}] as const;

type RpcRequester = (options: { method: string; params?: unknown[] }) => Promise<unknown>;
const quoteD20Payment = async (request: RpcRequester, callbackGasLimit: number) => {
  const block = await request({ method: "eth_getBlockByNumber", params: ["latest", false] }) as { baseFeePerGas?: string } | null;
  if (!block?.baseFeePerGas) throw new Error("ARC base fee is unavailable");
  const bufferedBaseFee = BigInt(block.baseFeePerGas) * BigInt(13) / BigInt(10);
  const data = encodeFunctionData({
    abi: d20QuoteAbi,
    functionName: "quoteFeeAt",
    args: [callbackGasLimit, bufferedBaseFee],
  });
  const result = await request({ method: "eth_call", params: [{ to: D20_VRF_COORDINATOR, data }, "latest"] });
  if (typeof result !== "string") throw new Error("VRF fee quote is unavailable");
  return decodeFunctionResult({ abi: d20QuoteAbi, functionName: "quoteFeeAt", data: result as `0x${string}` });
};
const ARC_NETWORK_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: "ARC Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};
const networkName = (chainId: number | null) => {
  if (chainId === null) return "Checking...";
  const names: Record<number, string> = {
    [ARC_TESTNET.id]: "ARC Testnet",
    1: "Ethereum",
    10: "Optimism",
    56: "BNB Chain",
    137: "Polygon",
    8453: "Base",
    42161: "Arbitrum One",
    11155111: "Sepolia",
  };
  return names[chainId] ?? `network (chain ID ${chainId})`;
};
const parseChainId = (value: unknown) => {
  const chainId = Number(value);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
};
const normalizeChainId = (value: unknown) => {
  const chainId = parseChainId(value);
  return chainId === null ? null : `0x${chainId.toString(16)}`.toLowerCase();
};
const isArcChainId = (value: unknown) => normalizeChainId(value) === ARC_CHAIN_ID_HEX.toLowerCase();
const googleInAppWallet = inAppWallet({ auth: { mode: "popup", options: ["google"] } });
const metaMaskWallet = createWallet("io.metamask");
const supportedWallets = [googleInAppWallet, metaMaskWallet];
const navItems = [
  ["home", "Home"], ["how-it-works", "How It Works"], ["lands", "Lands"],
  ["rarity", "Rarity"], ["roadmap", "Roadmap"], ["faq", "FAQ"],
] as const;
const landNames = ["Forest", "Wind", "Wizard", "Artist", "King"] as const;
const landBadgeNames = ["Land Forest", "Land Wind", "Land Wizard", "Land Artist", "Land King"] as const;
const landRevealIcons = ["hatch-land-forest.png", "hatch-land-wind.png", "hatch-land-wizard.png", "hatch-land-fire.png", "hatch-land-king.png"] as const;
const landClassNames = ["forest", "wind", "wizard", "artist", "king"] as const;
const landBirdAssets = ["forest-primary.png", "wind-primary.png", "wizard-primary.png", "artist-primary.png", "king-primary.png"] as const;
const landHatchlingHeroBirdAssets = ["forest-primary-facing-left.png", "wind-primary-facing-left.png", "wizard-primary-facing-left.png", "artist-primary-facing-left.png", "king-primary-facing-left.png"] as const;
const landIslandAssets = ["land-forest.png", "land-wind.png", "land-wizard.png", "land-artist.png", "land-king.png"] as const;
const landHatchPopupAssets = ["hatch-popup-forest.png", "hatch-popup-wind.png", "hatch-popup-wizard.png", "hatch-popup-artist.png", "hatch-popup-king.png"] as const;
const landEvolutionPopupAssets = ["evolution-popup-forest.png", "evolution-popup-wind.png", "evolution-popup-wizard.png", "evolution-popup-artist.png", "evolution-popup-king.png"] as const;
const landSoarlingResultAssets = ["soarling-result-forest.png", "soarling-result-wind.png", "soarling-result-wizard.png", "soarling-result-artist.png", "soarling-result-king.png"] as const;
const landCommonSoarlingResultAssets = ["soarling-common-forest.png", "soarling-common-wind.png", "soarling-common-wizard.png", "soarling-common-artist.png", "soarling-common-king.png"] as const;
const landRareSoarlingResultAssets = ["soarling-rare-forest.png", "soarling-rare-wind.png", "soarling-rare-wizard.png", "soarling-rare-artist.png", "soarling-rare-king.png"] as const;
const landCommonHeroBirdAssets = ["forest-common-layer-bird.png", "wind-common-layer-bird.png", "wizard-common-layer-bird.png", "artist-common-layer-bird.png", "king-common-layer-bird.png"] as const;
const landRareHeroBirdAssets = ["forest-rare-layer-bird.png", "wind-rare-layer-bird.png", "wizard-rare-layer-bird.png", "artist-rare-layer-bird.png", "king-rare-layer-bird.png"] as const;
const landEpicSoarlingResultAssets = ["soarling-epic-forest.png", "soarling-epic-wind.png", "soarling-epic-wizard.png", "soarling-epic-artist.png", "soarling-epic-king.png"] as const;
const landEpicHeroBirdAssets = ["forest-epic-layer-bird.png", "wind-epic-layer-bird.png", "wizard-epic-layer-bird.png", "artist-epic-layer-bird.png", "king-epic-layer-bird.png"] as const;
const landEpicHeroGlowAssets = ["forest-epic-layer-glow.png", "wind-epic-layer-glow.png", "wizard-epic-layer-glow.png", "artist-epic-layer-glow.png", "king-epic-layer-glow.png"] as const;
const landLegendarySoarlingResultAssets = ["soarling-legendary-forest.png", "soarling-legendary-wind.png", "soarling-legendary-wizard-v2.png", "soarling-legendary-artist.png", "soarling-legendary-king.png"] as const;
const landLegendaryHeroBirdAssets = ["forest-legendary-layer-bird.png", "wind-legendary-layer-bird.png", "wizard-legendary-layer-bird.png", "artist-legendary-layer-bird.png", "king-legendary-layer-bird.png"] as const;
const landMythicSoarlingResultAssets = ["soarling-mythic-forest.png", "soarling-mythic-wind.png", "soarling-mythic-wizard.png", "soarling-mythic-artist.png", "soarling-mythic-king.png"] as const;
const landMythicHeroAssets = ["soarling-mythic-hero-forest.png", "soarling-mythic-hero-wind.png", "soarling-mythic-hero-wizard.png", "soarling-mythic-hero-artist.png", "soarling-mythic-hero-king.png"] as const;
const windMythicHeroLayers = ["wind-mythic-layer-glow.png", "wind-mythic-layer-ring.png", "wind-mythic-layer-island.png", "wind-mythic-layer-bird.png", "wind-mythic-layer-badge.png"] as const;
const forestMythicHeroLayers = ["forest-mythic-layer-glow.png", "forest-mythic-layer-ring.png", "forest-mythic-layer-island.png", "forest-mythic-layer-bird.png", "forest-mythic-layer-leaf.png", "wind-mythic-layer-badge.png"] as const;
const landFinalStageAssets = [
  ["final-stage-forest-hatchling.png", "final-stage-forest-fledgling.png", "final-stage-forest-mythic.png"],
  ["final-stage-wind-hatchling.png", "final-stage-wind-fledgling.png", "final-stage-wind-mythic.png"],
  ["final-stage-wizard-hatchling.png", "final-stage-wizard-fledgling.png", "final-stage-wizard-mythic.png"],
  ["final-stage-artist-hatchling.png", "final-stage-artist-fledgling.png", "final-stage-artist-mythic.png"],
  ["final-stage-king-hatchling.png", "final-stage-king-fledgling.png", "final-stage-king-mythic.png"],
] as const;
const landEpicDetailAssets = [
  ["soarling-forest-leaf-left.png", "soarling-forest-leaf-right.png"],
  ["soarling-epic-item-wind.png", "soarling-epic-item-wind-right.png"],
  ["soarling-epic-item-wizard.png", "soarling-epic-item-wizard-right.png"],
  ["soarling-epic-item-artist.png", "soarling-epic-item-artist-right.png"],
  ["soarling-epic-item-king.png", "soarling-epic-item-king-right.png"],
] as const;
const landLegendaryDetailAssets = [
  ["soarling-forest-leaf-left.png", "soarling-forest-leaf-right.png"],
  ["soarling-epic-item-wind.png", "soarling-epic-item-wind-right.png"],
  ["soarling-epic-item-wizard.png", "soarling-epic-item-wizard-right.png"],
  ["soarling-epic-item-artist.png", "soarling-epic-item-artist-right.png"],
  ["soarling-epic-item-king.png", "soarling-epic-item-king-right.png"],
] as const;
const landSoarlingParticleAssets = ["land-particle-forest.png", "land-particle-wind.png", "land-particle-wizard.png", "land-particle-artist.png", "land-particle-king.png"] as const;
const stageNames = ["Hatchling", "Fledgling", "Soarling"] as const;
const rarityNames = ["Common", "Rare", "Epic", "Legendary", "Mythic"] as const;
const rarityStarAssets = ["rarity-common-star.png", "rarity-rare-star.png", "rarity-epic-star.png", "rarity-legendary-star.png", "rarity-mythic-star.png"] as const;
const MILLISECONDS_PER_DAY = 86_400_000;
type StoredCheckInProgress = { checkIns: number; lastCheckInDay: string; lastCheckInAt?: string };
type CheckInProgressResponse = { checkIns: number; lastCheckInDay: string; lastCheckInAt: string; retryAt?: string };
const checkInProgressKey = (contractAddress: string, owner: string, tokenId: bigint) =>
  `eggoria-checkins:${contractAddress.toLowerCase()}:${owner.toLowerCase()}:${tokenId.toString()}`;
const readStoredCheckInProgress = (contractAddress: string, owner: string, tokenId: bigint) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(checkInProgressKey(contractAddress, owner, tokenId));
    if (!raw) return null;
    const progress = JSON.parse(raw) as StoredCheckInProgress;
    if (!Number.isInteger(progress.checkIns) || progress.checkIns < 0 || progress.checkIns > 20 || !/^\d+$/.test(progress.lastCheckInDay)) return null;
    return { checkIns: progress.checkIns, lastCheckInDay: BigInt(progress.lastCheckInDay), lastCheckInAt: progress.lastCheckInAt || "" };
  } catch {
    return null;
  }
};
const saveStoredCheckInProgress = (contractAddress: string, owner: string, tokenId: bigint, checkIns: number, lastCheckInDay: bigint, lastCheckInAt = "") => {
  window.localStorage.setItem(
    checkInProgressKey(contractAddress, owner, tokenId),
    JSON.stringify({ checkIns, lastCheckInDay: lastCheckInDay.toString(), lastCheckInAt } satisfies StoredCheckInProgress),
  );
};
const readSavedCheckInProgress = async (owner: string, tokenId: bigint) => {
  const query = new URLSearchParams({ owner, tokenId: tokenId.toString() });
  const response = await fetch(`/api/check-ins?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Check-in progress is unavailable.");
  return response.json() as Promise<CheckInProgressResponse>;
};
const recordDailyCheckIn = async (owner: string, tokenId: bigint) => {
  const response = await fetch("/api/check-ins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, tokenId: tokenId.toString() }),
  });
  const result = await response.json() as CheckInProgressResponse & { message?: string };
  if (!response.ok) throw new Error(result.message || "Daily check-in could not be saved.");
  return result;
};
const FALLBACK_MINT_FEE_USDC = 0.01;
const MINT_FEE_BUFFER = 1.25;
const LOW_FUNDS_WARNING_USDC = 0.2;
const NATIVE_TOKEN_DECIMALS = BigInt(18);
const NETWORK_FEE_DISPLAY_DECIMALS = BigInt(9);
const NETWORK_FEE_REFRESH_MS = 1_500;
const HATCH_CHARGE_MIN_MS = 2_200;
const HATCH_SHAKE_MS = 1_400;
const HATCH_REVEAL_MS = 1_400;
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const formatNetworkFee = (feeWei: bigint) => {
  const displayUnit = BigInt(10) ** (NATIVE_TOKEN_DECIMALS - NETWORK_FEE_DISPLAY_DECIMALS);
  const roundedDisplayUnits = (feeWei + displayUnit / BigInt(2)) / displayUnit;
  if (feeWei > BigInt(0) && roundedDisplayUnits === BigInt(0)) return "<0.000000001";

  const displayBase = BigInt(10) ** NETWORK_FEE_DISPLAY_DECIMALS;
  const whole = roundedDisplayUnits / displayBase;
  const fraction = (roundedDisplayUnits % displayBase)
    .toString()
    .padStart(Number(NETWORK_FEE_DISPLAY_DECIMALS), "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
const toBrowserUri = (uri: string) => uri.startsWith("ipfs://")
  ? `https://gateway.pinata.cloud/ipfs/${uri.slice("ipfs://".length)}`
  : uri;
const primaryArtworkUris = [
  forestPrimaryMetadata.image,
  windPrimaryMetadata.image,
  wizardPrimaryMetadata.image,
  artistPrimaryMetadata.image,
  kingPrimaryMetadata.image,
].map(toBrowserUri);
const artworkDecodeCache = new Map<string, Promise<HTMLImageElement>>();
const decodeImage = async (src: string) => {
  const cachedDecode = artworkDecodeCache.get(src);
  if (cachedDecode) return cachedDecode;

  const decode = (async () => {
    const image = new Image();
    image.src = src;

    try {
      await image.decode();
    } catch {
      await new Promise<void>((resolve) => {
        if (image.complete) {
          resolve();
          return;
        }
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });
    }
    return image;
  })();

  artworkDecodeCache.set(src, decode);
  return decode;
};

const preloadPotentialHatchArtwork = () => Promise.all(primaryArtworkUris.map(decodeImage));

const getYoungHeroArtwork = (bird: OwnedBird) => bird.stage === 1
  ? asset(landFinalStageAssets[bird.land]?.[1] ?? landFinalStageAssets[2][1])
  : asset(landHatchlingHeroBirdAssets[bird.land] ?? landHatchlingHeroBirdAssets[2]);

const prepareBirdArtwork = async (bird: OwnedBird) => {
  await decodeImage(
    bird.stage < 2 ? getYoungHeroArtwork(bird) : bird.image || asset(getSoarlingResultAsset(bird)),
  );
  return bird;
};

const getSoarlingResultAsset = (bird: OwnedBird) => {
  if (bird.rarity === 0) {
    return landCommonSoarlingResultAssets[bird.land] ?? "soarling-common-wizard.png";
  }
  if (bird.rarity === 1) {
    return landRareSoarlingResultAssets[bird.land] ?? "soarling-rare-wizard.png";
  }
  if (bird.rarity === 2) {
    return landEpicSoarlingResultAssets[bird.land] ?? "soarling-epic-wizard.png";
  }
  if (bird.rarity === 3) {
    return landLegendarySoarlingResultAssets[bird.land] ?? "soarling-legendary-wizard-v2.png";
  }
  if (bird.rarity === 4) {
    return landMythicSoarlingResultAssets[bird.land] ?? "soarling-mythic-wizard.png";
  }
  return landSoarlingResultAssets[bird.land] ?? "soarling-result-wizard.png";
};

const YoungBirdHeroComposite = ({ bird, isReveal = false }: { bird: OwnedBird; isReveal?: boolean }) => {
  const landClass = landClassNames[bird.land] ?? "wizard";
  const stageClass = bird.stage === 1 ? "is-fledgling" : "is-hatchling";

  return <span
    key={`young-composite-${bird.tokenId}-${bird.stage}`}
    className={`young-hero-${landClass} ${stageClass}${isReveal ? " is-hatch-reveal" : ""}`}
    role="img"
    aria-label={`${landNames[bird.land]} ${stageNames[bird.stage] ?? "bird"} on its island`}
  >
    <span className="young-hero-core" aria-hidden="true">
      <img className="young-hero-island" src={asset(`${landClass}-mythic-layer-island.png`)} alt="" />
      <img className="young-hero-bird" src={getYoungHeroArtwork(bird)} alt="" />
    </span>
  </span>;
};

const LowerRarityHeroComposite = ({ bird }: { bird: OwnedBird }) => {
  const landClass = landClassNames[bird.land] ?? "wizard";
  const rarityClass = bird.rarity === 1 ? "rare" : "common";
  const birdAssets = bird.rarity === 1 ? landRareHeroBirdAssets : landCommonHeroBirdAssets;

  return <span
    key={`owned-composite-${bird.tokenId}-${bird.stage}-${bird.rarity}`}
    className={`${rarityClass}-hero-${landClass}`}
    role="img"
    aria-label={`${landNames[bird.land]} ${rarityNames[bird.rarity]} Soarling on its island`}
  >
    <span className="lower-rarity-hero-core" aria-hidden="true">
      <img className="lower-rarity-hero-island" src={asset(`${landClass}-mythic-layer-island.png`)} alt="" />
      <img className="lower-rarity-hero-bird" src={asset(birdAssets[bird.land] ?? birdAssets[2])} alt="" />
      <span className="lower-rarity-hero-badge"><img src={asset(`${rarityClass}-layer-badge.png`)} alt="" /></span>
    </span>
  </span>;
};

const EpicHeroComposite = ({ bird }: { bird: OwnedBird }) => {
  const landClass = landClassNames[bird.land] ?? "forest";
  const detailAssets = landEpicDetailAssets[bird.land] ?? landEpicDetailAssets[0];

  return <span
    key={`owned-composite-${bird.tokenId}-${bird.stage}-${bird.rarity}`}
    className={`epic-hero-${landClass}`}
    role="img"
    aria-label={`${landNames[bird.land]} Epic Soarling on its island`}
  >
    <span className="epic-hero-core" aria-hidden="true">
      <img className="epic-hero-island" src={asset(`${landClass}-mythic-layer-island.png`)} alt="" />
      <img className="epic-hero-glow" src={asset(landEpicHeroGlowAssets[bird.land] ?? landEpicHeroGlowAssets[0])} alt="" />
      <img className="epic-hero-bird" src={asset(landEpicHeroBirdAssets[bird.land] ?? landEpicHeroBirdAssets[0])} alt="" />
      <span className="epic-hero-details">
        <img src={asset(detailAssets[0])} alt="" />
        <img src={asset(detailAssets[1])} alt="" />
      </span>
      <span className="epic-hero-dots"><i /><i /><i /><i /><i /><i /></span>
      <span className="epic-hero-badge"><img src={asset("epic-layer-badge.png")} alt="" /></span>
    </span>
  </span>;
};

const LegendaryHeroComposite = ({ bird }: { bird: OwnedBird }) => {
  const landClass = landClassNames[bird.land] ?? "forest";
  const ringLayers = [
    "forest-legendary-layer-ring.png",
    "wind-legendary-layer-ring.png",
    "wizard-legendary-layer-ring.png",
    "artist-legendary-layer-ring.png",
    "king-legendary-layer-ring.png",
  ] as const;
  const detailLayers = [
    "forest-legendary-layer-feather.png",
    "wind-mythic-feather.png",
    "wizard-mythic-layer-crystal.png",
    "artist-mythic-layer-flame.png",
    "king-mythic-layer-feather.png",
  ] as const;
  const detailAsset = detailLayers[bird.land] ?? detailLayers[0];
  const ringAsset = ringLayers[bird.land] ?? ringLayers[0];

  return <span
    key={`owned-composite-${bird.tokenId}-${bird.stage}-${bird.rarity}`}
    className={`legendary-hero-${landClass}`}
    role="img"
    aria-label={`${landNames[bird.land]} Legendary Soarling on its island`}
  >
    <img className="legendary-hero-glow" src={asset(`${landClass}-mythic-layer-glow.png`)} alt="" />
    <img className="legendary-hero-ring" src={asset(ringAsset)} alt="" />
    <span className="legendary-hero-orbit-motes" aria-hidden="true"><i /><i /><i /></span>
    <span className="legendary-hero-core" aria-hidden="true">
      <img className="legendary-hero-island" src={asset(`${landClass}-mythic-layer-island.png`)} alt="" />
      <i className="legendary-hero-awakening" />
      <img className="legendary-hero-bird" src={asset(landLegendaryHeroBirdAssets[bird.land] ?? landLegendaryHeroBirdAssets[0])} alt="" />
      <span className="legendary-hero-details">
        <img src={asset(detailAsset)} alt="" />
        <img src={asset(detailAsset)} alt="" />
        <img src={asset(detailAsset)} alt="" />
      </span>
      <span className="legendary-hero-badge"><img src={asset("forest-legendary-layer-badge.png")} alt="" /></span>
    </span>
  </span>;
};

const getOwnedHeroArtwork = (bird: OwnedBird) => bird.stage === 2 && bird.rarity === 4
  ? asset(landMythicHeroAssets[bird.land] ?? "soarling-mythic-hero-wizard.png")
  : bird.image || asset(getSoarlingResultAsset(bird));

const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
const formatUsdcBalance = (value: string | number) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
};
const formatCooldown = (retryAt: string, now = Date.now()) => {
  const seconds = Math.max(0, Math.ceil((new Date(retryAt).getTime() - now) / 1_000));
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.ceil((seconds % 3_600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${seconds}s`;
};

const readFaucetRetryAt = async (address: string) => {
  try {
    const response = await fetch(`/api/faucet?address=${encodeURIComponent(address)}`, { cache: "no-store" });
    if (!response.ok) return "";
    const result: { retryAt?: unknown } = await response.json();
    return typeof result.retryAt === "string" && new Date(result.retryAt).getTime() > Date.now() ? result.retryAt : "";
  } catch {
    return "";
  }
};

const readNftImage = async (tokenUri: string) => {
  if (!tokenUri) return "";

  let metadata: unknown;
  if (tokenUri.startsWith("data:application/json")) {
    const separator = tokenUri.indexOf(",");
    if (separator === -1) return "";
    const header = tokenUri.slice(0, separator);
    const payload = tokenUri.slice(separator + 1);
    metadata = JSON.parse(header.includes(";base64") ? window.atob(payload) : decodeURIComponent(payload));
  } else {
    const response = await fetch(toBrowserUri(tokenUri));
    if (!response.ok) return "";
    metadata = await response.json();
  }

  if (!metadata || typeof metadata !== "object" || !("image" in metadata) || typeof metadata.image !== "string") return "";
  return toBrowserUri(metadata.image);
};

const readProviderErrorCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "number") return error.code;
  if ("cause" in error) return readProviderErrorCode(error.cause);
  return undefined;
};

const readMintError = (error: unknown) => {
  if (readProviderErrorCode(error) === 4001) return "Transaction cancelled.";
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.toLowerCase();
  if (message.includes("walletalreadyminted") || (message.includes("already") && (message.includes("claim") || message.includes("mint")))) {
    return "You have already claimed your Egg.";
  }
  if (message.includes("insufficient") || message.includes("funds")) {
    return "Not enough test USDC to cover the network fee.";
  }
  if (message.includes("mintingdisabled")) return "Egg minting is not available yet.";
  return "Your egg could not be minted. Please try again.";
};

export default function EggoriaLanding({
  googleClientId,
  thirdwebClientId,
  eggoriaBirdsAddress,
}: {
  googleClientId: string;
  thirdwebClientId: string;
  eggoriaBirdsAddress: string;
}) {
  const [minted, setMinted] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [user, setUser] = useState<EggoriaUser | null>(null);
  const [notice, setNotice] = useState("");
  const [, setGoogleReady] = useState(false);
  const [activeNav, setActiveNav] = useState("home");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [networkDialog, setNetworkDialog] = useState<NetworkDialog>(null);
  const [lastNetworkDialog, setLastNetworkDialog] = useState<Exclude<NetworkDialog, null>>("switch");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkFeedback, setNetworkFeedback] = useState<"" | "error">("");
  const [metaMaskChainId, setMetaMaskChainId] = useState<number | null>(null);
  const [arcNetworkMissing, setArcNetworkMissing] = useState(false);
  const [networkCtaOverride, setNetworkCtaOverride] = useState(false);
  const [networkResumeAction, setNetworkResumeAction] = useState<NetworkResumeAction>(null);
  const [toast, setToast] = useState("");
  const [fundsModalOpen, setFundsModalOpen] = useState(false);
  const [balanceAlertKind, setBalanceAlertKind] = useState<BalanceAlertKind>("low");
  const [balanceAlertBalance, setBalanceAlertBalance] = useState(0);
  const [balanceAlertOpen, setBalanceAlertOpen] = useState(false);
  const [heroChecking, setHeroChecking] = useState(false);
  const [faucetRetryAt, setFaucetRetryAt] = useState("");
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [mintPhase, setMintPhase] = useState<MintPhase>("idle");
  const [mintRetry, setMintRetry] = useState(false);
  const [mintBlocker, setMintBlocker] = useState<MintBlocker>(null);
  const [mintRecoveryNonce, setMintRecoveryNonce] = useState(0);
  const [hatchPhase, setHatchPhase] = useState<HatchPhase>("idle");
  const [hatchingBird, setHatchingBird] = useState<OwnedBird | null>(null);
  const [hatchResult, setHatchResult] = useState<{ bird: OwnedBird; address: string; transactionHash: string } | null>(null);
  const [evolutionResult, setEvolutionResult] = useState<OwnedBird | null>(null);
  const [evolutionTransactionHash, setEvolutionTransactionHash] = useState("");
  const [soarlingResult, setSoarlingResult] = useState<OwnedBird | null>(null);
  const [soarlingTransactionHash, setSoarlingTransactionHash] = useState("");
  const [evolutionCheckInOpen, setEvolutionCheckInOpen] = useState(false);
  const [evolutionTargetStage, setEvolutionTargetStage] = useState<1 | 2>(1);
  const [evolutionNetworkFee, setEvolutionNetworkFee] = useState("Estimating...");
  const [evolutionVrfFee, setEvolutionVrfFee] = useState("Estimating...");
  const [postHatchOwnedAddress, setPostHatchOwnedAddress] = useState("");
  const [walletAlreadyMinted, setWalletAlreadyMinted] = useState(false);
  const [ownedBird, setOwnedBird] = useState<OwnedBird | null>(null);
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [checkInPhase, setCheckInPhase] = useState<CheckInPhase>("idle");
  const [checkInSyncPending, setCheckInSyncPending] = useState<{ address: string; tokenId: string; expected: number; stageBefore: number; transactionHash: string } | null>(null);
  const [celebratedCheckIn, setCelebratedCheckIn] = useState<number | null>(null);
  const [checkInError, setCheckInError] = useState("");
  const [, setNetworkFee] = useState("Estimating...");
  const [mintVrfFee, setMintVrfFee] = useState("Estimating...");
  const [walletKind, setWalletKind] = useState<WalletKind>("");
  const [fundsError, setFundsError] = useState("");
  const [fundsSending, setFundsSending] = useState(false);
  const [fundsPhase, setFundsPhase] = useState<FundsPhase>("idle");
  const [fundsErrorKind, setFundsErrorKind] = useState<FundsErrorKind>("");
  const [fundsSuccess, setFundsSuccess] = useState<{ amount: number; balance: string; address: string } | null>(null);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletAddressCopied, setWalletAddressCopied] = useState(false);
  const [walletEmail, setWalletEmail] = useState("");
  const [fundsGuideOpen, setFundsGuideOpen] = useState(false);
  const [arcBalance, setArcBalance] = useState("0.00");
  const [requiredMintBalance, setRequiredMintBalance] = useState(FALLBACK_MINT_FEE_USDC);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [eggoriaStateAddress, setEggoriaStateAddress] = useState("");
  const [balanceStateAddress, setBalanceStateAddress] = useState("");
  const [walletError, setWalletError] = useState<WalletErrorKind>("");
  const [metaMaskInstalled, setMetaMaskInstalled] = useState(false);
  const [mobileWalletBrowser, setMobileWalletBrowser] = useState(false);
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [walletLinkCopied, setWalletLinkCopied] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<WalletKind>("");
  const [metaMaskWaitLong, setMetaMaskWaitLong] = useState(false);
  const portalReady = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const closeWalletRef = useRef<HTMLButtonElement>(null);
  const hatchCompleteCloseRef = useRef<HTMLButtonElement>(null);
  const evolutionCheckInCloseRef = useRef<HTMLButtonElement>(null);
  const walletMenuAnchorRef = useRef<HTMLDivElement>(null);
  const heroEggRef = useRef<HTMLImageElement>(null);
  const activeGuideRef = useRef<HTMLElement>(null);
  const autoShownGuideStepsRef = useRef(new Set<string>());
  const lastNetworkFeeRef = useRef("");
  const fundsDismissedDuringSendRef = useRef(false);
  const heroCheckingRef = useRef(false);
  const mintSubmittingRef = useRef(false);
  const checkInSubmittingRef = useRef(false);
  const mintModalDismissedRef = useRef(false);
  const closeBalanceAlert = useCallback(() => setBalanceAlertOpen(false), []);
  const showBalanceAlert = useCallback((kind: BalanceAlertKind, balance?: number) => {
    setFundsGuideOpen(false);
    setBalanceAlertKind(kind);
    if (balance !== undefined) setBalanceAlertBalance(balance);
    setBalanceAlertOpen(true);
  }, []);
  const showNetworkDialog = useCallback((dialog: Exclude<NetworkDialog, null>) => {
    setLastNetworkDialog(dialog);
    setNetworkDialog(dialog);
  }, []);
  const hideNetworkDialog = useCallback(() => {
    setNetworkDialog(null);
  }, []);
  const dismissNetworkDialog = useCallback(() => {
    setNetworkResumeAction(null);
    setNetworkCtaOverride(true);
    hideNetworkDialog();
  }, [hideNetworkDialog]);
  const thirdwebClient = useMemo(
    () => thirdwebClientId ? createThirdwebClient({ clientId: thirdwebClientId }) : null,
    [thirdwebClientId],
  );
  const eggoriaContract = useMemo(
    () => thirdwebClient && isAddress(eggoriaBirdsAddress)
      ? getContract({ client: thirdwebClient, chain: ARC_TESTNET, address: eggoriaBirdsAddress, abi: eggoriaBirdsAbi })
      : null,
    [eggoriaBirdsAddress, thirdwebClient],
  );
  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();
  // Only the embedded Google wallet is exempt; an unidentified connected wallet
  // must never bypass the network guard while its type is still resolving.
  const isMetaMaskWallet = Boolean(activeAccount) && (activeWallet ? activeWallet.id !== "inApp" : walletKind !== "google");
  const isAutoConnecting = useIsAutoConnecting();
  const { connect, isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const closeFundsModal = useCallback(() => {
    if (fundsSending) fundsDismissedDuringSendRef.current = true;
    if (fundsSuccess && activeAccount?.address.toLowerCase() === fundsSuccess.address.toLowerCase()) {
      setArcBalance(fundsSuccess.balance);
      setToast("Test USDC added. Next: mint your Egg.");
    }
    if (fundsSuccess) setFundsSuccess(null);
    setFundsModalOpen(false);
  }, [activeAccount?.address, fundsSending, fundsSuccess]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), toast === "MetaMask window closed" || toast.startsWith("Check-in") || toast.startsWith("Checked in") || toast.startsWith("Evolve request") ? 3_000 : 5_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!balanceAlertOpen || balanceAlertKind !== "cooldown" || !faucetRetryAt) return;
    const remaining = new Date(faucetRetryAt).getTime() - Date.now();
    const timeout = window.setTimeout(() => setCurrentTimeMs(Date.now()), Math.max(0, remaining));
    return () => window.clearTimeout(timeout);
  }, [balanceAlertKind, balanceAlertOpen, faucetRetryAt]);

  useEffect(() => {
    if (celebratedCheckIn === null) return;
    const timeout = window.setTimeout(() => setCelebratedCheckIn(null), 1_000);
    return () => window.clearTimeout(timeout);
  }, [celebratedCheckIn]);

  useEffect(() => {
    if (connectingProvider !== "metamask") return;
    const timeout = window.setTimeout(() => setMetaMaskWaitLong(true), 8_000);
    return () => window.clearTimeout(timeout);
  }, [connectingProvider]);

  const completeHatch = useCallback(() => {
    if (!hatchResult) return;
    const checkInGuideKey = `${hatchResult.address}:check-in`;
    autoShownGuideStepsRef.current.add(checkInGuideKey);
    window.localStorage.setItem(`eggoria-guide-seen:${checkInGuideKey}`, "1");
    setFundsGuideOpen(true);
    setPostHatchOwnedAddress(hatchResult.address);
    setOwnedBird(hatchResult.bird);
    setHatchingBird(null);
    setHatchPhase("idle");
    setHatchResult(null);
  }, [hatchResult]);

  const completeEvolution = useCallback(() => {
    if (!evolutionResult) return;
    setOwnedBird(evolutionResult);
    setEvolutionResult(null);
    setEvolutionTransactionHash("");
  }, [evolutionResult]);

  const completeSoarlingEvolution = useCallback(() => {
    if (!soarlingResult) return;
    setOwnedBird(soarlingResult);
    setSoarlingResult(null);
    setSoarlingTransactionHash("");
  }, [soarlingResult]);

  const connectGoogle = useCallback(async ({ credential }: GoogleCredential) => {
    setNotice("Verifying your account…");
    try {
      const response = await fetch("/api/google-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential,
          referralCode: new URLSearchParams(window.location.search).get("ref") || "",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setUser(result.user);
      setNotice(`Welcome to Eggoria, ${result.user.name}.`);
      setWalletModalOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Google connection failed. Please try again.");
    }
  }, []);

  useEffect(() => {
    fetch("/api/session", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => result?.user && setUser(result.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!googleClientId || !portalReady) return;
    let attempts = 0;
    const boot = () => {
      const identity = window.google?.accounts?.id;
      if (!identity) {
        attempts += 1;
        if (attempts < 50) window.setTimeout(boot, 120);
        return;
      }
      identity.initialize({
        client_id: googleClientId,
        callback: connectGoogle,
        auto_select: false,
        cancel_on_tap_outside: false,
        use_fedcm_for_prompt: true,
      });
      document.querySelectorAll<HTMLElement>("[data-google-button]").forEach((node) => {
        node.replaceChildren();
        identity.renderButton(node, {
          type: "standard", theme: "outline", size: "large",
          text: "continue_with", shape: "pill", width: node.dataset.width || "350",
        });
      });
      setGoogleReady(true);
    };
    boot();
  }, [connectGoogle, googleClientId, portalReady]);

  useEffect(() => {
    if (!walletModalOpen && !networkDialog && !fundsModalOpen && !balanceAlertOpen && !mintBlocker && !claimModalOpen && !evolutionCheckInOpen && !hatchResult && !evolutionResult && !soarlingResult) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (hatchResult || evolutionResult || soarlingResult) hatchCompleteCloseRef.current?.focus();
    else if (evolutionCheckInOpen) evolutionCheckInCloseRef.current?.focus();
    else closeWalletRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (hatchResult) {
          completeHatch();
          return;
        }
        if (evolutionResult) {
          completeEvolution();
          return;
        }
        if (soarlingResult) {
          completeSoarlingEvolution();
          return;
        }
        if (evolutionCheckInOpen) {
          if (!checkInSubmitting) setEvolutionCheckInOpen(false);
          return;
        }
        if (networkDialog) {
          if (!networkBusy) dismissNetworkDialog();
          return;
        }
        closeBalanceAlert();
        setMintBlocker(null);
        setWalletModalOpen(false);
        closeFundsModal();
        mintModalDismissedRef.current = true;
        setClaimModalOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [balanceAlertOpen, mintBlocker, claimModalOpen, checkInSubmitting, closeBalanceAlert, closeFundsModal, completeEvolution, completeHatch, completeSoarlingEvolution, dismissNetworkDialog, evolutionCheckInOpen, evolutionResult, fundsModalOpen, hatchResult, networkBusy, networkDialog, soarlingResult, walletModalOpen]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!walletMenuAnchorRef.current?.contains(event.target as Node)) setWalletMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [walletMenuOpen]);

  const connectGoogleWallet = async () => {
    if (!thirdwebClient) {
      setWalletError("thirdweb-config");
      return;
    }
    setWalletError("");
    setConnectingProvider("google");
    try {
      await connect(async () => {
        await googleInAppWallet.connect({ client: thirdwebClient, chain: ARC_TESTNET, strategy: "google" });
        return googleInAppWallet;
      });
      window.localStorage.setItem("eggoria-wallet-kind", "google");
      setWalletKind("google");
      setWalletModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      setWalletError(readProviderErrorCode(error) === 4001 || /cancel|reject|closed|dismiss|denied/i.test(message) ? "google-cancelled" : /pop.?up.*block|block.*pop.?up/i.test(message) ? "google-popup-blocked" : "google-failed");
    } finally {
      setConnectingProvider("");
    }
  };

  const getMetaMaskProvider = useCallback(() => {
    // thirdweb connects io.metamask through this EIP-6963 provider. window.ethereum
    // may point to a different installed wallet (and therefore a different chain).
    const connectedProvider = injectedProvider("io.metamask");
    if (connectedProvider) return connectedProvider as EthereumProvider;
    const injected = window.ethereum;
    if (!injected) return undefined;
    return injected.providers?.find((provider) => provider.isMetaMask)
      ?? (injected.isMetaMask ? injected : undefined);
  }, []);

  useEffect(() => {
    if (!walletModalOpen) return;
    const checkMetaMask = () => setMetaMaskInstalled(Boolean(getMetaMaskProvider()));
    window.addEventListener("focus", checkMetaMask);
    window.addEventListener("ethereum#initialized", checkMetaMask);
    return () => {
      window.removeEventListener("focus", checkMetaMask);
      window.removeEventListener("ethereum#initialized", checkMetaMask);
    };
  }, [getMetaMaskProvider, walletModalOpen]);

  const checkArcNetwork = useCallback(async () => {
    const provider = getMetaMaskProvider();
    if (!provider) {
      setMetaMaskChainId(null);
      return null;
    }
    const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
    setMetaMaskChainId(chainId);
    return isArcChainId(chainId);
  }, [getMetaMaskProvider]);

  const requireArcNetwork = useCallback(async (resumeAction: NetworkResumeAction = null) => {
    if (!isMetaMaskWallet) return true;
    try {
      if (await checkArcNetwork() === true) return true;
    } catch {
      // Treat an unreadable chain as unsafe until the wallet is checked again.
    }
    setNetworkFeedback("");
    setFundsModalOpen(false);
    closeBalanceAlert();
    setClaimModalOpen(false);
    setEvolutionCheckInOpen(false);
    if (resumeAction) setNetworkResumeAction(resumeAction);
    showNetworkDialog(arcNetworkMissing ? "add" : "switch");
    return false;
  }, [arcNetworkMissing, checkArcNetwork, closeBalanceAlert, isMetaMaskWallet, showNetworkDialog]);

  const requestArcNetwork = async () => {
    if (!networkDialog || networkBusy) return;
    const provider = getMetaMaskProvider();
    if (!provider) {
      setNetworkFeedback("error");
      return;
    }
    setNetworkBusy(true);
    setNetworkFeedback("");
    try {
      if (!await checkArcNetwork()) {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
        } catch (error) {
          if (readProviderErrorCode(error) !== 4902) throw error;
          setArcNetworkMissing(true);
          showNetworkDialog("add");
          await provider.request({ method: "wallet_addEthereumChain", params: [ARC_NETWORK_PARAMS] });
          if (!await checkArcNetwork()) {
            await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
          }
        }
      }
      if (!await checkArcNetwork()) throw new Error("ARC Testnet is not active yet.");
      setArcNetworkMissing(false);
      setNetworkCtaOverride(false);
      hideNetworkDialog();
      setToast("You're on ARC Testnet.");
    } catch (error) {
      const code = readProviderErrorCode(error);
      if (code === 4001) {
        dismissNetworkDialog();
        setToast("You closed the MetaMask window.");
      } else setNetworkFeedback("error");
    } finally {
      setNetworkBusy(false);
    }
  };

  const count = Math.min(minted, EGGORIA_MAX_SUPPLY);
  const progress = Math.min(100, (count / EGGORIA_MAX_SUPPLY) * 100);
  const walletAddress = activeAccount?.address ?? "";
  const normalizedWalletAddress = walletAddress.toLowerCase();
  const connectionLabel = walletAddress ? shortAddress(walletAddress) : "Get Your Egg";
  const hasTestFunds = Boolean(walletAddress) && Number(arcBalance) >= requiredMintBalance;
  const wrongMetaMaskNetwork = Boolean(walletAddress && isMetaMaskWallet && !isArcChainId(metaMaskChainId));
  const walletNetworkName = isMetaMaskWallet ? networkName(metaMaskChainId) : ARC_TESTNET.name;
  const faucetCooldownActive = Boolean(faucetRetryAt && new Date(faucetRetryAt).getTime() > currentTimeMs);
  const eggoriaStateLoading = Boolean(walletAddress) && eggoriaStateAddress !== normalizedWalletAddress;
  const balanceStateLoading = Boolean(walletAddress) && balanceStateAddress !== normalizedWalletAddress;
  const walletViewLoading = isAutoConnecting || eggoriaStateLoading || (!ownedBird && balanceStateLoading);
  const activeGuideStep = !walletAddress || walletViewLoading || mintPhase !== "idle" ? "" : ownedBird ? "check-in" : hasTestFunds ? "mint" : "funds";

  useEffect(() => {
    if (!walletAddress || !isMetaMaskWallet) {
      Promise.resolve().then(() => {
        setMetaMaskChainId(null);
        setArcNetworkMissing(false);
        setNetworkCtaOverride(false);
        setNetworkResumeAction(null);
        hideNetworkDialog();
        closeBalanceAlert();
      });
      return;
    }
    const provider = getMetaMaskProvider();
    if (!provider) return;
    let active = true;
    let revision = 0;
    const updateNetwork = async (reportedChainId?: unknown) => {
      const currentRevision = ++revision;
      try {
        const chainId = reportedChainId === undefined
          ? parseChainId(await provider.request({ method: "eth_chainId" }))
          : parseChainId(reportedChainId);
        if (!active || currentRevision !== revision) return;
        setMetaMaskChainId(chainId);
        const ready = isArcChainId(chainId);
        if (!ready) {
          setFundsModalOpen(false);
          closeBalanceAlert();
          setClaimModalOpen(false);
          setEvolutionCheckInOpen(false);
          setNetworkFeedback("");
          if (claimModalOpen || evolutionCheckInOpen) {
            setNetworkResumeAction(claimModalOpen ? "mint" : "evolve");
            showNetworkDialog(arcNetworkMissing ? "add" : "switch");
          }
        } else {
          setArcNetworkMissing(false);
          setNetworkCtaOverride(false);
          if (!networkBusy) hideNetworkDialog();
        }
      } catch {
        if (!active || currentRevision !== revision) return;
        setMetaMaskChainId(null);
        setFundsModalOpen(false);
        setClaimModalOpen(false);
        setEvolutionCheckInOpen(false);
        if (claimModalOpen || evolutionCheckInOpen) {
          setNetworkResumeAction(claimModalOpen ? "mint" : "evolve");
          showNetworkDialog(arcNetworkMissing ? "add" : "switch");
        }
      }
    };
    void updateNetwork();
    const onChainChanged = (chainId: unknown) => { void updateNetwork(chainId); };
    const onFocus = () => { void updateNetwork(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void updateNetwork();
    };
    provider.on?.("chainChanged", onChainChanged);
    const unsubscribeWallet = activeWallet?.id === "io.metamask"
      ? activeWallet.subscribe("chainChanged", (chain) => { void updateNetwork(chain.id); })
      : undefined;
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      provider.removeListener?.("chainChanged", onChainChanged);
      unsubscribeWallet?.();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeWallet, arcNetworkMissing, claimModalOpen, closeBalanceAlert, evolutionCheckInOpen, getMetaMaskProvider, hideNetworkDialog, isMetaMaskWallet, networkBusy, showNetworkDialog, walletAddress]);

  const findOwnedTokenId = useCallback(async (address: string, supply: number) => {
    if (!eggoriaContract || !isAddress(address)) return null;

    try {
      const tokenId = await readContract({
        contract: eggoriaContract,
        method: "mintedTokenOf",
        params: [address],
      });
      if (tokenId > BigInt(0)) {
        const owner = await readContract({ contract: eggoriaContract, method: "ownerOf", params: [tokenId] });
        if (owner.toLowerCase() === address.toLowerCase()) return tokenId;
      }
    } catch {
      // Older deployments do not expose mintedTokenOf; scan their small supply below.
    }

    for (let start = 1; start <= supply; start += 25) {
      const end = Math.min(supply, start + 24);
      const owners = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, offset) => {
          const tokenId = BigInt(start + offset);
          return readContract({
            contract: eggoriaContract,
            method: "ownerOf",
            params: [tokenId],
          }).then((owner) => ({ owner, tokenId })).catch(() => null);
        }),
      );
      const match = owners.find((entry) => entry?.owner.toLowerCase() === address.toLowerCase());
      if (match) return match.tokenId;
    }

    return null;
  }, [eggoriaContract]);

  const readOwnedBird = useCallback(async (tokenId: bigint): Promise<OwnedBird | null> => {
    if (!eggoriaContract) return null;

    let owner = "";
    let land = 0;
    let landAssigned = true;
    let stage = 0;
    let rarity = 0;
    let rarityAssigned = false;
    let checkIns = 0;
    let lastCheckInDay = BigInt(0);
    let lastCheckInAt = "";

    try {
      const state = await readContract({
        contract: eggoriaContract,
        method: "tokenState",
        params: [tokenId],
      });
      [owner, land, landAssigned, stage, rarity, rarityAssigned, checkIns, lastCheckInDay] = [
        state[0], Number(state[1]), state[2], Number(state[3]), Number(state[4]),
        state[5], Number(state[6]), state[7],
      ];
    } catch {
      owner = await readContract({ contract: eggoriaContract, method: "ownerOf", params: [tokenId] });
      const legacyState = await readContract({
        contract: eggoriaContract,
        method: "birds",
        params: [tokenId],
      });
      lastCheckInDay = legacyState[0];
      land = Number(legacyState[1]);
      checkIns = Number(legacyState[2]);
      stage = Number(legacyState[3]);
      rarity = Number(legacyState[4]);
      rarityAssigned = legacyState[5];
    }

    let image = "";
    if (landAssigned) {
      try {
        const tokenUri = await readContract({ contract: eggoriaContract, method: "tokenURI", params: [tokenId] });
        image = await readNftImage(tokenUri);
      } catch {
        // The owner view remains available while an IPFS gateway is unavailable.
      }
    }

    const remoteProgress = await readSavedCheckInProgress(owner, tokenId).then((progress) => ({
      checkIns: progress.checkIns,
      lastCheckInDay: BigInt(progress.lastCheckInDay),
      lastCheckInAt: progress.lastCheckInAt,
    })).catch(() => null);
    const storedProgress = remoteProgress ?? readStoredCheckInProgress(eggoriaBirdsAddress, owner, tokenId);
    const nextOnChainCheckpoint = Math.min(20, checkIns + 10);
    if (storedProgress && storedProgress.checkIns >= checkIns && storedProgress.checkIns < nextOnChainCheckpoint) {
      checkIns = storedProgress.checkIns;
      lastCheckInDay = storedProgress.lastCheckInDay;
      lastCheckInAt = storedProgress.lastCheckInAt;
    } else if (storedProgress && storedProgress.checkIns === checkIns && storedProgress.lastCheckInDay > lastCheckInDay) {
      lastCheckInDay = storedProgress.lastCheckInDay;
      lastCheckInAt = storedProgress.lastCheckInAt;
    } else if (storedProgress?.lastCheckInAt) {
      lastCheckInAt = storedProgress.lastCheckInAt;
    }

    return { tokenId, owner, land, landAssigned, stage, rarity, rarityAssigned, checkIns, lastCheckInDay, lastCheckInAt, image };
  }, [eggoriaBirdsAddress, eggoriaContract]);

  const readEggoriaState = useCallback(async (address = walletAddress) => {
    if (!eggoriaContract) throw new Error("Eggoria Birds contract is not configured.");
    const accountAddress = isAddress(address) ? address : null;
    const [supply, alreadyMinted] = await Promise.all([
      readContract({ contract: eggoriaContract, method: "totalSupply" }),
      accountAddress
        ? readContract({ contract: eggoriaContract, method: "hasMinted", params: [accountAddress] })
        : Promise.resolve(false),
    ]);
    const totalSupply = Number(supply);
    const tokenId = accountAddress && alreadyMinted
      ? await findOwnedTokenId(accountAddress, totalSupply)
      : null;
    const bird = tokenId ? await readOwnedBird(tokenId) : null;
    return { totalSupply, alreadyMinted, bird };
  }, [eggoriaContract, findOwnedTokenId, readOwnedBird, walletAddress]);

  const refreshEggoriaState = useCallback(async (address = walletAddress) => {
    const state = await readEggoriaState(address);
    setMinted(state.totalSupply);
    setWalletAlreadyMinted(state.alreadyMinted);
    setOwnedBird(state.bird);
    return state;
  }, [readEggoriaState, walletAddress]);

  useEffect(() => {
    if (!walletAddress || !thirdwebClient) return;
    const key = `eggoria-mint-pending:${eggoriaBirdsAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
    const transactionHash = window.localStorage.getItem(key);
    if (!transactionHash || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return;
    let active = true;
    Promise.resolve().then(() => { if (active) setMintPhase("pending"); });
    const recoverMint = async () => {
      try {
        const receipt = await waitForReceipt({ client: thirdwebClient, chain: ARC_TESTNET, transactionHash: transactionHash as `0x${string}` });
        if (!active) return;
        if (receipt.status !== "success") {
          window.localStorage.removeItem(key);
          setMintPhase("idle");
          setMintBlocker("failed");
          return;
        }
        for (let attempt = 0; attempt < 30 && active; attempt += 1) {
          const state = await readEggoriaState(walletAddress).catch(() => null);
          if (!active) return;
          if (state) {
            setMinted(state.totalSupply);
            setWalletAlreadyMinted(state.alreadyMinted);
          }
          if (state?.bird?.landAssigned) {
            window.localStorage.removeItem(key);
            setMintPhase("idle");
            setHatchResult({ bird: state.bird, address: walletAddress.toLowerCase(), transactionHash });
            return;
          }
          await wait(2_000);
        }
        if (active) {
          await wait(5_000);
          if (active) void recoverMint();
        }
      } catch {
        // Keep the hash and pending banner if the RPC cannot confirm the transaction yet.
        if (active) {
          await wait(5_000);
          if (active) void recoverMint();
        }
      }
    };
    void recoverMint();
    return () => { active = false; };
  }, [eggoriaBirdsAddress, mintRecoveryNonce, readEggoriaState, thirdwebClient, walletAddress]);

  useEffect(() => {
    let active = true;
    const requestedAddress = walletAddress.toLowerCase();

    readEggoriaState(walletAddress)
      .then((state) => {
        if (!active) return;
        setMinted(state.totalSupply);
        setWalletAlreadyMinted(state.alreadyMinted);
        const pendingKey = `eggoria-mint-pending:${eggoriaBirdsAddress.toLowerCase()}:${requestedAddress}`;
        if (!window.localStorage.getItem(pendingKey)) setOwnedBird(state.bird);
      })
      .catch(() => {
        if (!active) return;
        setMinted(0);
        setWalletAlreadyMinted(false);
        setOwnedBird(null);
      })
      .finally(() => {
        if (active) {
          setStatsLoading(false);
          setEggoriaStateAddress(requestedAddress);
        }
      });

    return () => { active = false; };
  }, [eggoriaBirdsAddress, readEggoriaState, walletAddress]);

  useEffect(() => {
    if (!checkInSyncPending || !walletAddress) return;
    if (checkInSyncPending.address !== walletAddress.toLowerCase()) {
      Promise.resolve().then(() => setCheckInSyncPending(null));
      return;
    }
    let active = true;
    let reading = false;
    const pollCheckIn = async () => {
      if (reading) return;
      reading = true;
      try {
        const state = await readEggoriaState(walletAddress);
        const bird = state.bird;
        if (!active || !bird || bird.tokenId.toString() !== checkInSyncPending.tokenId
          || bird.checkIns < checkInSyncPending.expected
          || (checkInSyncPending.stageBefore === 1 && bird.stage !== 2)) return;
        setMinted(state.totalSupply);
        setWalletAlreadyMinted(state.alreadyMinted);
        setCurrentTimeMs(Date.now());
        const checkpointProgress = await recordDailyCheckIn(bird.owner, bird.tokenId).catch(() => null);
        saveStoredCheckInProgress(
          eggoriaBirdsAddress,
          bird.owner,
          bird.tokenId,
          checkpointProgress?.checkIns ?? bird.checkIns,
          checkpointProgress ? BigInt(checkpointProgress.lastCheckInDay) : bird.lastCheckInDay,
          checkpointProgress?.lastCheckInAt ?? bird.lastCheckInAt,
        );
        if (checkpointProgress) {
          bird.lastCheckInAt = checkpointProgress.lastCheckInAt;
          bird.lastCheckInDay = BigInt(checkpointProgress.lastCheckInDay);
        }
        if (checkInSyncPending.stageBefore === 0 && bird.stage === 1) {
          setEvolutionTransactionHash(checkInSyncPending.transactionHash);
          setEvolutionResult(bird);
          setEvolutionCheckInOpen(false);
        } else if (checkInSyncPending.stageBefore === 1 && bird.stage === 2) {
          setSoarlingTransactionHash(checkInSyncPending.transactionHash);
          setSoarlingResult(bird);
          setEvolutionCheckInOpen(false);
        } else {
          setOwnedBird(bird);
          setCelebratedCheckIn((bird.checkIns - 1) % 10);
          setToast("Checked in! Come back tomorrow.");
        }
        setCheckInSyncPending(null);
      } catch {
        // Keep the button locked until the confirmed on-chain check-in is readable.
      } finally {
        reading = false;
      }
    };
    void pollCheckIn();
    const interval = window.setInterval(() => { void pollCheckIn(); }, 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [checkInSyncPending, eggoriaBirdsAddress, readEggoriaState, walletAddress]);

  useEffect(() => {
    if (!walletAddress || ownedBird?.landAssigned !== false) return;

    const interval = window.setInterval(() => {
      refreshEggoriaState(walletAddress).catch(() => undefined);
    }, 4_000);

    return () => window.clearInterval(interval);
  }, [ownedBird?.landAssigned, refreshEggoriaState, walletAddress]);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTimeMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!walletAddress || !activeGuideStep) {
      Promise.resolve().then(() => setFundsGuideOpen(false));
      return;
    }

    const guideKey = `${walletAddress.toLowerCase()}:${activeGuideStep}`;
    if (autoShownGuideStepsRef.current.has(guideKey)) return;
    autoShownGuideStepsRef.current.add(guideKey);

    const storageKey = `eggoria-guide-seen:${guideKey}`;
    if (window.localStorage.getItem(storageKey) === "1") return;
    window.localStorage.setItem(storageKey, "1");
    Promise.resolve().then(() => setFundsGuideOpen(true));
  }, [activeGuideStep, walletAddress]);

  useEffect(() => {
    if (!fundsGuideOpen) return;

    const closeGuideOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && activeGuideRef.current?.contains(event.target)) return;
      setFundsGuideOpen(false);
    };
    const closeGuideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFundsGuideOpen(false);
    };

    document.addEventListener("pointerdown", closeGuideOnOutside);
    window.addEventListener("keydown", closeGuideOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeGuideOnOutside);
      window.removeEventListener("keydown", closeGuideOnEscape);
    };
  }, [fundsGuideOpen]);

  useEffect(() => {
    if (!walletAddress) {
      Promise.resolve().then(() => setWalletKind(""));
      return;
    }
    const storedKind = window.localStorage.getItem("eggoria-wallet-kind");
    Promise.resolve().then(() => setWalletKind(storedKind === "google" || storedKind === "metamask" ? storedKind : ""));
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || walletKind !== "google" || !thirdwebClient) return;
    let active = true;
    getUserEmail({ client: thirdwebClient })
      .then((email) => {
        if (active) setWalletEmail(email ?? "");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [thirdwebClient, walletAddress, walletKind]);

  useEffect(() => {
    if (!walletAddress || !thirdwebClient) return;
    let active = true;
    const requestedAddress = walletAddress.toLowerCase();
    const rpcRequest = getRpcClient({ client: thirdwebClient, chain: ARC_TESTNET });
    const mintData = encodeFunctionData({ abi: eggoriaBirdsAbi, functionName: "mint", args: [] });
    getWalletBalance({ client: thirdwebClient, chain: ARC_TESTNET, address: walletAddress })
      .then((balance) => {
        if (active) setArcBalance(Number(balance.displayValue).toFixed(6));
      })
      .catch(() => {
        if (active) setArcBalance("0.00");
      })
      .finally(() => {
        if (active) setBalanceStateAddress(requestedAddress);
      });

    quoteD20Payment(rpcRequest as RpcRequester, D20_LAND_CALLBACK_GAS)
      .then(async (vrfPayment) => {
        const [gasLimit, gasPrice] = await Promise.all([
          eth_estimateGas(rpcRequest, {
            from: walletAddress as `0x${string}`,
            to: eggoriaBirdsAddress as `0x${string}`,
            data: mintData,
            value: toHex(vrfPayment),
          }),
          eth_gasPrice(rpcRequest),
        ]);
        return Number(gasLimit * gasPrice + vrfPayment) / 1e18 * MINT_FEE_BUFFER;
      })
      .then((bufferedMintCost) => {
        if (active) setRequiredMintBalance(Math.max(bufferedMintCost, Number.EPSILON));
      })
      .catch(() => {
        if (active) setRequiredMintBalance(FALLBACK_MINT_FEE_USDC);
      });

    return () => { active = false; };
  }, [eggoriaBirdsAddress, thirdwebClient, walletAddress]);

  useEffect(() => {
    if (!claimModalOpen || !walletAddress || !isAddress(eggoriaBirdsAddress)) return;
    let active = true;
    let requestInFlight = false;

    const updateNetworkFee = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      const provider = isMetaMaskWallet ? getMetaMaskProvider() : undefined;
      if (isMetaMaskWallet && !provider) {
        if (active && !lastNetworkFeeRef.current) setNetworkFee("Unavailable");
        if (active) setMintVrfFee("Unavailable");
        requestInFlight = false;
        return;
      }

      try {
        const rpcRequest = thirdwebClient ? getRpcClient({ client: thirdwebClient, chain: ARC_TESTNET }) : null;
        if (!provider && !rpcRequest) throw new Error("Network fee estimate is unavailable");
        if (provider && !isArcChainId(await provider.request({ method: "eth_chainId" }))) {
          throw new Error("MetaMask is not connected to ARC Testnet");
        }
        const request = (provider?.request.bind(provider) ?? rpcRequest!) as RpcRequester;
        const vrfPayment = await quoteD20Payment(request, D20_LAND_CALLBACK_GAS);
        if (active) setMintVrfFee(formatNetworkFee(vrfPayment));
        const data = encodeFunctionData({ abi: eggoriaBirdsAbi, functionName: "mint", args: [] });
        const transaction = { from: walletAddress as `0x${string}`, to: eggoriaBirdsAddress, data, value: toHex(vrfPayment) };
        const [gasLimitResult, gasPriceResult] = provider ? await Promise.all([
          provider.request({ method: "eth_estimateGas", params: [transaction] }),
          provider.request({ method: "eth_gasPrice" }),
        ]) : await Promise.all([
          rpcRequest!({ method: "eth_estimateGas", params: [transaction] }),
          rpcRequest!({ method: "eth_gasPrice" }),
        ]);
        if (typeof gasLimitResult !== "string" || typeof gasPriceResult !== "string") {
          throw new Error("MetaMask fee estimate is unavailable");
        }

        // Read both values from the connected MetaMask provider. This is the
        // same live chain source MetaMask uses when it prepares its fee panel.
        const feeWei = BigInt(gasLimitResult) * BigInt(gasPriceResult);
        const formattedFee = formatNetworkFee(feeWei);
        lastNetworkFeeRef.current = formattedFee;
        if (active) {
          setNetworkFee(formattedFee);
          setRequiredMintBalance(Math.max(Number(feeWei + vrfPayment) / 1e18 * MINT_FEE_BUFFER, Number.EPSILON));
        }
      } catch {
        // MetaMask can temporarily reject parallel RPC requests while its
        // transaction confirmation window is open. Keep the last valid live
        // estimate instead of replacing it with a misleading error state.
        if (active && !lastNetworkFeeRef.current) setNetworkFee("Unavailable");
        if (active && mintVrfFee === "Estimating...") setMintVrfFee("Unavailable");
      } finally {
        requestInFlight = false;
      }
    };

    void updateNetworkFee();
    // Keep refreshing while MetaMask's confirmation window is open. Previously
    // claimSubmitting stopped this effect and left the modal showing a stale fee.
    const interval = window.setInterval(updateNetworkFee, NETWORK_FEE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [claimModalOpen, eggoriaBirdsAddress, getMetaMaskProvider, isMetaMaskWallet, mintVrfFee, thirdwebClient, walletAddress]);

  useEffect(() => {
    if (!evolutionCheckInOpen || !ownedBird || !walletAddress || !thirdwebClient || !isAddress(eggoriaBirdsAddress)) return;
    let active = true;
    let hasEstimate = false;
    let requestInFlight = false;

    const updateEvolutionNetworkFee = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const provider = isMetaMaskWallet ? getMetaMaskProvider() : undefined;
        if (provider && !isArcChainId(await provider.request({ method: "eth_chainId" }))) {
          throw new Error("MetaMask is not connected to ARC Testnet");
        }
        const data = encodeFunctionData({
          abi: eggoriaBirdsAbi,
          functionName: "checkIn",
          args: [ownedBird.tokenId],
        });
        const rpcRequest = getRpcClient({ client: thirdwebClient, chain: ARC_TESTNET });
        const request = (provider?.request.bind(provider) ?? rpcRequest) as RpcRequester;
        const vrfPayment = ownedBird.stage === 1
          ? await quoteD20Payment(request, D20_RARITY_CALLBACK_GAS)
          : BigInt(0);
        if (active) setEvolutionVrfFee(formatNetworkFee(vrfPayment));
        const transaction = {
          from: walletAddress as `0x${string}`,
          to: eggoriaBirdsAddress as `0x${string}`,
          data,
          value: toHex(vrfPayment),
        };
        const [gasLimitResult, gasPriceResult] = provider ? await Promise.all([
          provider.request({ method: "eth_estimateGas", params: [transaction] }),
          provider.request({ method: "eth_gasPrice" }),
        ]) : await Promise.all([
          rpcRequest({ method: "eth_estimateGas", params: [transaction] }),
          rpcRequest({ method: "eth_gasPrice" }),
        ]);
        if (typeof gasLimitResult !== "string" || typeof gasPriceResult !== "string") {
          throw new Error("Network fee estimate is unavailable");
        }

        const formattedFee = formatNetworkFee(BigInt(gasLimitResult) * BigInt(gasPriceResult));
        hasEstimate = true;
        if (active) setEvolutionNetworkFee(formattedFee);
      } catch {
        if (active && !hasEstimate) setEvolutionNetworkFee("Unavailable");
        if (active) setEvolutionVrfFee("Unavailable");
      } finally {
        requestInFlight = false;
      }
    };

    void updateEvolutionNetworkFee();
    const interval = window.setInterval(updateEvolutionNetworkFee, NETWORK_FEE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [eggoriaBirdsAddress, evolutionCheckInOpen, getMetaMaskProvider, isMetaMaskWallet, ownedBird, thirdwebClient, walletAddress]);
  const openWallet = () => {
    if (walletAddress) {
      setWalletMenuOpen((open) => !open);
      return;
    }
    setWalletError("");
    setMetaMaskInstalled(Boolean(getMetaMaskProvider()));
    setMobileWalletBrowser(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    setInAppBrowser(/FBAN|FBAV|Instagram|Telegram|Zalo|Line\//i.test(navigator.userAgent));
    setWalletLinkCopied(false);
    setWalletModalOpen(true);
  };

  const copySignInLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setWalletLinkCopied(true);
    } catch {
      setWalletLinkCopied(false);
    }
  };

  const copyWalletAddress = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setWalletAddressCopied(true);
      window.setTimeout(() => setWalletAddressCopied(false), 1_500);
    } catch {
      setWalletAddressCopied(false);
    }
  };

  const connectMetaMask = async () => {
    const provider = getMetaMaskProvider();
    if (!provider) {
      setMetaMaskInstalled(false);
      setWalletError("missing-metamask");
      return;
    }
    if (!thirdwebClient) {
      setWalletError("thirdweb-config");
      return;
    }
    setWalletError("");
    setMetaMaskWaitLong(false);
    setConnectingProvider("metamask");
    try {
      await provider.request({ method: "eth_requestAccounts" });
      await connect(async () => {
        await metaMaskWallet.connect({ client: thirdwebClient });
        return metaMaskWallet;
      });
      window.localStorage.setItem("eggoria-wallet-kind", "metamask");
      setWalletKind("metamask");
      setWalletEmail("");
      setNotice("");
      setWalletModalOpen(false);
    } catch (error) {
      const code = readProviderErrorCode(error);
      const message = error instanceof Error ? error.message : String(error ?? "");
      setWalletError(code === 4001
        ? /closed|dismiss/i.test(message) ? "metamask-closed" : "metamask-cancelled"
        : code === -32002 ? "metamask-pending"
          : /unlock|locked/i.test(message) ? "metamask-locked" : /closed|dismiss/i.test(message) ? "metamask-closed" : "metamask-failed");
    } finally {
      setConnectingProvider("");
    }
  };

  const disconnectWallet = () => {
    if (activeWallet) disconnect(activeWallet);
    window.localStorage.removeItem("eggoria-wallet-kind");
    autoShownGuideStepsRef.current.clear();
    setWalletKind("");
    setArcBalance("0.00");
    setRequiredMintBalance(FALLBACK_MINT_FEE_USDC);
    setEggoriaStateAddress("");
    setBalanceStateAddress("");
    setWalletMenuOpen(false);
    setWalletAddressCopied(false);
    setWalletEmail("");
    setFundsGuideOpen(false);
    setEvolutionCheckInOpen(false);
    setEvolutionResult(null);
    setEvolutionTransactionHash("");
    setSoarlingResult(null);
    setSoarlingTransactionHash("");
    setOwnedBird(null);
    setPostHatchOwnedAddress("");
    setNotice("");
  };

  const openFaucetModal = () => {
    setFundsGuideOpen(false);
    setFundsError("");
    setFundsErrorKind("");
    setFundsPhase("idle");
    setFundsSuccess(null);
    setFundsModalOpen(true);
  };

  const openMintModal = async () => {
    if (!await requireArcNetwork("mint")) return;
    if (walletAlreadyMinted) {
      setMintBlocker("already");
      return;
    }
    if (minted >= EGGORIA_MAX_SUPPLY) {
      setMintBlocker("soldout");
      return;
    }
    setMintRetry(false);
    setClaimError("");
    mintModalDismissedRef.current = false;
    lastNetworkFeeRef.current = "";
    setNetworkFee("Estimating...");
    setClaimModalOpen(true);
  };

  const dismissMintModal = () => {
    mintModalDismissedRef.current = true;
    setClaimModalOpen(false);
  };

  const getCurrentArcBalance = async () => {
    if (!thirdwebClient || !walletAddress) return Number(arcBalance) || 0;
    try {
      const balance = await getWalletBalance({ client: thirdwebClient, chain: ARC_TESTNET, address: walletAddress });
      const amount = Number(balance.displayValue);
      if (Number.isFinite(amount)) {
        setArcBalance(amount.toFixed(6));
        return amount;
      }
    } catch {
      // Keep the last known balance when the read-only RPC is temporarily unavailable.
    }
    return Number(arcBalance) || 0;
  };

  const getBalanceAlertKind = (balance: number): BalanceAlertKind | null => {
    if (balance < requiredMintBalance) return "out";
    return balance > 0 && balance <= LOW_FUNDS_WARNING_USDC ? "low" : null;
  };

  const handleHeroAction = async () => {
    if (heroCheckingRef.current) return;
    if (!walletAddress) {
      openWallet();
      return;
    }
    if (networkCtaOverride && wrongMetaMaskNetwork) {
      await requireArcNetwork("hero");
      return;
    }
    heroCheckingRef.current = true;
    setHeroChecking(true);
    try {
      if (!await requireArcNetwork("hero")) return;
      if (!hasTestFunds) {
        const retryAt = await readFaucetRetryAt(walletAddress);
        setFaucetRetryAt(retryAt);
        if (retryAt) showBalanceAlert("cooldown");
        else openFaucetModal();
        return;
      }
      const balance = await getCurrentArcBalance();
      const alertKind = getBalanceAlertKind(balance);
      if (alertKind) {
        showBalanceAlert(alertKind, balance);
        return;
      }
      void openMintModal();
    } finally {
      heroCheckingRef.current = false;
      setHeroChecking(false);
    }
  };

  const handleBalanceAlertAction = async () => {
    if (!walletAddress || !await requireArcNetwork("hero")) return;
    if (balanceAlertKind === "cooldown") {
      if (faucetCooldownActive) return;
      const balance = await getCurrentArcBalance();
      if (balance >= requiredMintBalance) {
        closeBalanceAlert();
        void openMintModal();
        return;
      }
      const retryAt = await readFaucetRetryAt(walletAddress);
      setFaucetRetryAt(retryAt);
      if (retryAt) {
        setToast(`You can claim again in ${formatCooldown(retryAt)}.`);
        return;
      }
    } else {
      const retryAt = await readFaucetRetryAt(walletAddress);
      if (retryAt) {
        setFaucetRetryAt(retryAt);
        showBalanceAlert("cooldown");
        return;
      }
    }
    closeBalanceAlert();
    openFaucetModal();
  };

  const claimTestFunds = async () => {
    if (!activeAccount || !walletAddress || fundsSending) return;
    setFundsError("");
    setFundsErrorKind("");
    setFundsSuccess(null);
    fundsDismissedDuringSendRef.current = false;
    setFundsSending(true);
    setFundsPhase("signing");
    try {
      if (!await requireArcNetwork("hero")) return;
      const message = `Eggoria ARC Testnet Faucet\nAddress: ${walletAddress}\nTimestamp: ${Date.now()}`;
      const signature = await activeAccount.signMessage({ message });
      setFundsPhase("sending");
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: walletAddress, message, signature }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 429 && result.retryAt) {
          setFaucetRetryAt(result.retryAt);
          if (Number(arcBalance) <= Math.max(LOW_FUNDS_WARNING_USDC, requiredMintBalance)) {
            setFundsModalOpen(false);
            showBalanceAlert("cooldown");
            return;
          }
          setFundsErrorKind("cooldown");
          throw new Error(`You can claim again in ${formatCooldown(result.retryAt)}.`);
        }
        if (/faucet does not have enough/i.test(String(result.message))) {
          setFundsErrorKind("empty");
          throw new Error("The faucet is empty right now. Try again later.");
        }
        setFundsErrorKind("error");
        throw new Error("This is taking longer than usual. Check your balance before trying again.");
      }
      const sentFunds = {
        amount: Number(result.amount) || 1,
        balance: String(result.balance || arcBalance),
        address: walletAddress,
      };
      setFundsPhase("updating");
      setArcBalance(sentFunds.balance);
      if (typeof result.retryAt === "string") setFaucetRetryAt(result.retryAt);
      setToast("Test USDC added. Next: mint your Egg.");
      if (fundsDismissedDuringSendRef.current) {
        setFundsSuccess(sentFunds);
        setFundsModalOpen(true);
      } else {
        setFundsModalOpen(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (readProviderErrorCode(error) === 4001 || /cancel|reject|closed|denied/i.test(message)) {
        setFundsErrorKind("cancelled");
        setFundsError("You closed the MetaMask window.");
      } else if (/timeout|network|fetch failed/i.test(message) && !/faucet|ARC Testnet/i.test(message)) {
        setFundsErrorKind("timeout");
        setFundsError("This is taking longer than usual. Check your balance before trying again.");
      } else {
        setFundsError((current) => current || message || "This is taking longer than usual. Check your balance before trying again.");
        setFundsErrorKind((current) => current || "error");
      }
      if (!fundsDismissedDuringSendRef.current) setFundsModalOpen(true);
    } finally {
      setFundsSending(false);
      setFundsPhase("idle");
    }
  };

  const mintEgg = async () => {
    if (mintSubmittingRef.current || claimSubmitting || mintPhase === "pending" || hatchPhase !== "idle") return;
    if (!activeAccount || !walletAddress) {
      setClaimError("Connect your wallet before minting.");
      return;
    }
    if (!eggoriaContract) {
      setClaimError("Eggoria Birds contract is not configured.");
      return;
    }
    mintSubmittingRef.current = true;
    setClaimSubmitting(true);
    setMintPhase("checking");
    setClaimError("");
    setPostHatchOwnedAddress("");
    let confirmedOnChain = false;
    let keepPending = false;
    let revertedOnChain = false;
    let pendingHash = "";
    const pendingKey = `eggoria-mint-pending:${eggoriaBirdsAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;
    try {
      const contractState = await refreshEggoriaState(walletAddress);
      if (mintModalDismissedRef.current) return;
      if (contractState.alreadyMinted) {
        setClaimModalOpen(false);
        setMintBlocker("already");
        return;
      }
      if (contractState.totalSupply >= EGGORIA_MAX_SUPPLY) {
        setClaimModalOpen(false);
        setMintBlocker("soldout");
        return;
      }

      if (!await requireArcNetwork("mint")) return;
      const mintBalance = await getCurrentArcBalance();
      if (mintModalDismissedRef.current) return;
      if (mintBalance < requiredMintBalance) {
        setClaimModalOpen(false);
        showBalanceAlert("out");
        return;
      }
      const mintRpcRequest = getRpcClient({ client: thirdwebClient!, chain: ARC_TESTNET });
      const mintProvider = isMetaMaskWallet ? getMetaMaskProvider() : undefined;
      const mintRequest = (mintProvider?.request.bind(mintProvider) ?? mintRpcRequest) as RpcRequester;
      const vrfPayment = await quoteD20Payment(mintRequest, D20_LAND_CALLBACK_GAS);
      const transaction = prepareContractCall({
        contract: eggoriaContract,
        method: "mint",
        params: [],
        value: vrfPayment,
      });
      if (!await requireArcNetwork("mint")) return;
      if (mintModalDismissedRef.current) return;
      setMintPhase("waiting");
      const transactionResult = await sendTransaction({ transaction, account: activeAccount });
      pendingHash = transactionResult.transactionHash;
      keepPending = true;
      window.localStorage.setItem(pendingKey, pendingHash);
      setMintPhase("pending");
      setClaimModalOpen(false);
      setHatchPhase("charge");
      // The random land is not known yet, so warm all five Primary images while
      // the receipt and oracle assignment are still being confirmed.
      void preloadPotentialHatchArtwork();
      const receipt = await waitForReceipt(transactionResult);
      if (receipt.status !== "success") {
        revertedOnChain = true;
        keepPending = false;
        window.localStorage.removeItem(pendingKey);
        throw new Error("The mint transaction was reverted on-chain.");
      }
      confirmedOnChain = true;

      let tokenId: bigint | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== eggoriaBirdsAddress.toLowerCase()) continue;
        try {
          const event = decodeEventLog({ abi: eggoriaBirdsAbi, data: log.data, topics: log.topics });
          if ((event.eventName === "BirdMinted" || event.eventName === "LandRequested")
            && event.args.owner.toLowerCase() === walletAddress.toLowerCase()) {
            tokenId = event.args.tokenId;
            break;
          }
        } catch {
          // Ignore unrelated logs emitted during the mint transaction.
        }
      }

      setClaimModalOpen(false);
      heroEggRef.current?.focus({ preventScroll: true });
      setHatchPhase("charge");
      const minimumChargePromise = wait(HATCH_CHARGE_MIN_MS);

      let refreshedState: Awaited<ReturnType<typeof readEggoriaState>> | null = null;

      const assignedBirdPromise = (async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          try {
            refreshedState = await readEggoriaState(walletAddress);
            tokenId ??= refreshedState.bird?.tokenId ?? BigInt(refreshedState.totalSupply);
            setMinted(refreshedState.totalSupply);
            setWalletAlreadyMinted(refreshedState.alreadyMinted);
            setHatchingBird(refreshedState.bird);
            if (refreshedState.bird?.landAssigned) {
              return prepareBirdArtwork(refreshedState.bird);
            }
          } catch {
            if (tokenId && tokenId > BigInt(0)) {
              const bird = await readOwnedBird(tokenId).catch(() => null);
              if (bird) {
                setHatchingBird(bird);
                if (bird.landAssigned) return prepareBirdArtwork(bird);
              }
            }
          }
          await wait(500);
        }
        return refreshedState?.bird ?? null;
      })();

      const [mintedBird] = await Promise.all([assignedBirdPromise, minimumChargePromise]);
      if (!mintedBird?.landAssigned) {
        setHatchingBird(null);
        setHatchPhase("idle");
        setNotice("Your Egg is confirmed. Its land is still being assigned on-chain.");
        setMintRecoveryNonce((nonce) => nonce + 1);
        return;
      }

      // Pulse for as long as data needs, then run the fixed shake and reveal.
      await prepareBirdArtwork(mintedBird);
      setHatchingBird(mintedBird);
      setHatchPhase("shake");
      await wait(HATCH_SHAKE_MS);
      setHatchPhase("reveal");
      await wait(HATCH_REVEAL_MS);
      setHatchingBird(null);
      setHatchPhase("idle");
      window.localStorage.removeItem(pendingKey);
      keepPending = false;
      setHatchResult({ bird: mintedBird, address: walletAddress.toLowerCase(), transactionHash: transactionResult.transactionHash });
    } catch (error) {
      if (pendingHash && !revertedOnChain && !confirmedOnChain) {
        setClaimModalOpen(false);
        setHatchPhase("idle");
        setMintPhase("pending");
        setMintRecoveryNonce((nonce) => nonce + 1);
        return;
      }
      const rawError = error instanceof Error ? error.message : String(error);
      if (!pendingHash && (readProviderErrorCode(error) === 4001 || /cancel|reject|closed|denied/i.test(rawError))) {
        setMintRetry(true);
        setToast("MetaMask window closed");
        if (!mintModalDismissedRef.current) setClaimModalOpen(true);
        return;
      }
      if (revertedOnChain) {
        setClaimModalOpen(false);
        setHatchPhase("idle");
        setMintBlocker("failed");
        return;
      }
      let message = readMintError(error);
      try {
        const state = await refreshEggoriaState(walletAddress);
        if (state.alreadyMinted) {
          message = "You have already claimed your Egg.";
        } else if (state.totalSupply >= EGGORIA_MAX_SUPPLY) {
          message = "All available eggs have already been claimed.";
        }
      } catch {
        // Preserve the transaction error when the follow-up contract read is unavailable.
      }
      if (confirmedOnChain) {
        setClaimModalOpen(false);
        setNotice("Your Egg was confirmed on-chain. Refreshing its metadata now.");
        setMintRecoveryNonce((nonce) => nonce + 1);
      } else {
        setClaimError("");
        if (/insufficient|funds/i.test(rawError)) {
          setClaimModalOpen(false);
          showBalanceAlert("out");
        } else if (message === "You have already claimed your Egg.") {
          setClaimModalOpen(false);
          setMintBlocker("already");
        } else if (message === "All available eggs have already been claimed.") {
          setClaimModalOpen(false);
          setMintBlocker("soldout");
        } else {
          setClaimModalOpen(false);
          setMintBlocker("failed");
        }
      }
      setHatchingBird(null);
      setHatchPhase("idle");
    } finally {
      mintSubmittingRef.current = false;
      setClaimSubmitting(false);
      if (!keepPending) setMintPhase("idle");
    }
  };

  const lastCheckInAtMs = ownedBird?.lastCheckInAt ? new Date(ownedBird.lastCheckInAt).getTime() : 0;
  const fallbackNextCheckInAtMs = ownedBird && ownedBird.lastCheckInDay > BigInt(0)
    ? (Number(ownedBird.lastCheckInDay) + 1) * MILLISECONDS_PER_DAY
    : 0;
  const nextCheckInAtMs = lastCheckInAtMs ? lastCheckInAtMs + MILLISECONDS_PER_DAY : fallbackNextCheckInAtMs;
  const checkedInToday = Boolean(nextCheckInAtMs > currentTimeMs);
  const checkInLocked = checkedInToday || checkInSyncPending !== null;
  const nextCheckInTime = nextCheckInAtMs ? formatCooldown(new Date(nextCheckInAtMs).toISOString(), currentTimeMs) : "";

  const checkInBird = async () => {
    if (!activeAccount || !eggoriaContract || !ownedBird || checkInSubmittingRef.current || checkInSubmitting || checkInLocked) return false;
    if (!ownedBird.landAssigned) {
      setCheckInError("Your land is still being assigned.");
      return false;
    }

    checkInSubmittingRef.current = true;
    setCheckInSubmitting(true);
    setCheckInPhase("saving");
    setCheckInError("");
    const stageBeforeCheckIn = ownedBird.stage;
    const expectedCheckIns = ownedBird.checkIns + 1;
    const isOnChainCheckpoint = expectedCheckIns === 10 || expectedCheckIns === 20;
    let confirmedOnChain = false;
    let transactionHash = "";
    try {
      if (!isOnChainCheckpoint) {
        const savedProgress = await recordDailyCheckIn(ownedBird.owner, ownedBird.tokenId);
        if (savedProgress.checkIns < expectedCheckIns) throw new Error("Check-in already saved today.");
        const savedDay = BigInt(savedProgress.lastCheckInDay);
        saveStoredCheckInProgress(
          eggoriaBirdsAddress,
          ownedBird.owner,
          ownedBird.tokenId,
          savedProgress.checkIns,
          savedDay,
          savedProgress.lastCheckInAt,
        );
        setOwnedBird({ ...ownedBird, checkIns: savedProgress.checkIns, lastCheckInDay: savedDay, lastCheckInAt: savedProgress.lastCheckInAt });
        setCurrentTimeMs(Date.now());
        setCelebratedCheckIn((savedProgress.checkIns - 1) % 10);
        setToast("Checked in! Saved off-chain. Come back tomorrow.");
        return true;
      }
      if (!await requireArcNetwork(evolutionCheckInOpen ? "evolve" : "checkin")) return false;
      const balance = await getCurrentArcBalance();
      const alertKind = getBalanceAlertKind(balance);
      if (alertKind === "out") {
        setEvolutionCheckInOpen(false);
        showBalanceAlert("out");
        return false;
      }
      if (alertKind === "low") setToast(`You're Almost Out — you have ${Number(balance.toFixed(2))} Test USDC left.`);
      const checkInRpcRequest = getRpcClient({ client: thirdwebClient!, chain: ARC_TESTNET });
      const checkInProvider = isMetaMaskWallet ? getMetaMaskProvider() : undefined;
      const checkInRequest = (checkInProvider?.request.bind(checkInProvider) ?? checkInRpcRequest) as RpcRequester;
      const vrfPayment = ownedBird.stage === 1
        ? await quoteD20Payment(checkInRequest, D20_RARITY_CALLBACK_GAS)
        : BigInt(0);
      const transaction = prepareContractCall({
        contract: eggoriaContract,
        method: "checkIn",
        params: [ownedBird.tokenId],
        value: vrfPayment,
      });
      if (!await requireArcNetwork(evolutionCheckInOpen ? "evolve" : "checkin")) return false;
      setCheckInPhase("wallet");
      const result = await sendTransaction({ transaction, account: activeAccount });
      setCheckInPhase("saving");
      transactionHash = result.transactionHash;
      const receipt = await waitForReceipt(result);
      if (receipt.status !== "success") throw new Error("Check-in transaction reverted.");
      confirmedOnChain = true;
      let refreshedState: Awaited<ReturnType<typeof readEggoriaState>> | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        refreshedState = await readEggoriaState(walletAddress).catch(() => null);
        const refreshedBird = refreshedState?.bird;
        const stageReady = stageBeforeCheckIn !== 1 || refreshedBird?.stage === 2;
        if (refreshedBird?.tokenId === ownedBird.tokenId && refreshedBird.checkIns >= expectedCheckIns && stageReady) break;
        await wait(500);
      }
      if (!refreshedState?.bird || refreshedState.bird.checkIns < expectedCheckIns
        || (stageBeforeCheckIn === 1 && refreshedState.bird.stage !== 2)) {
        setCheckInSyncPending({ address: walletAddress.toLowerCase(), tokenId: ownedBird.tokenId.toString(), expected: expectedCheckIns, stageBefore: stageBeforeCheckIn, transactionHash });
        return true;
      }
      setMinted(refreshedState.totalSupply);
      setWalletAlreadyMinted(refreshedState.alreadyMinted);
      setCurrentTimeMs(Date.now());
      const evolvedBird = refreshedState.bird;
      const checkpointProgress = await recordDailyCheckIn(evolvedBird.owner, evolvedBird.tokenId).catch(() => null);
      const persistedCheckIns = checkpointProgress?.checkIns ?? evolvedBird.checkIns;
      const persistedLastDay = checkpointProgress ? BigInt(checkpointProgress.lastCheckInDay) : evolvedBird.lastCheckInDay;
      saveStoredCheckInProgress(
        eggoriaBirdsAddress,
        evolvedBird.owner,
        evolvedBird.tokenId,
        persistedCheckIns,
        persistedLastDay,
        checkpointProgress?.lastCheckInAt ?? evolvedBird.lastCheckInAt,
      );
      if (checkpointProgress) {
        evolvedBird.lastCheckInAt = checkpointProgress.lastCheckInAt;
        evolvedBird.lastCheckInDay = BigInt(checkpointProgress.lastCheckInDay);
      }
      if (stageBeforeCheckIn === 0 && evolvedBird?.stage === 1) {
        const popupArtwork = asset(landEvolutionPopupAssets[evolvedBird.land] ?? "evolution-popup-wizard.png");
        const heroArtwork = getYoungHeroArtwork(evolvedBird);
        const islandArtwork = asset(`${landClassNames[evolvedBird.land] ?? "wizard"}-mythic-layer-island.png`);
        await Promise.all([decodeImage(heroArtwork), decodeImage(islandArtwork), decodeImage(popupArtwork)]);
        setEvolutionTransactionHash(result.transactionHash);
        setEvolutionResult(evolvedBird);
      } else if (stageBeforeCheckIn === 1 && evolvedBird?.stage === 2) {
        const popupArtwork = asset(getSoarlingResultAsset(evolvedBird));
        const heroArtwork = evolvedBird.rarity === 4 ? getOwnedHeroArtwork(evolvedBird) : evolvedBird.image || popupArtwork;
        const lowerRarityBirdAssets = evolvedBird.rarity === 1 ? landRareHeroBirdAssets : landCommonHeroBirdAssets;
        const heroArtworkSources = evolvedBird.rarity <= 1
          ? [
            asset(lowerRarityBirdAssets[evolvedBird.land] ?? lowerRarityBirdAssets[2]),
            asset(`${landClassNames[evolvedBird.land] ?? "wizard"}-mythic-layer-island.png`),
            asset(`${evolvedBird.rarity === 1 ? "rare" : "common"}-layer-badge.png`),
          ]
          : evolvedBird.rarity === 4 && evolvedBird.land === 0
          ? forestMythicHeroLayers.map((layer) => asset(layer))
          : evolvedBird.rarity === 4 && evolvedBird.land === 1
            ? windMythicHeroLayers.map((layer) => asset(layer))
            : [heroArtwork];
        await Promise.all([...heroArtworkSources.map(decodeImage), decodeImage(popupArtwork)]);
        setSoarlingTransactionHash(result.transactionHash);
        setSoarlingResult(evolvedBird);
      } else {
        setOwnedBird(evolvedBird);
        setCelebratedCheckIn((evolvedBird.checkIns - 1) % 10);
        setToast("Checked in! Come back tomorrow.");
      }
      return true;
    } catch (error) {
      if (confirmedOnChain) {
        setCheckInSyncPending({ address: walletAddress.toLowerCase(), tokenId: ownedBird.tokenId.toString(), expected: expectedCheckIns, stageBefore: stageBeforeCheckIn, transactionHash });
        return true;
      }
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      setCheckInError(message.includes("alreadycheckedintoday") || message.includes("already checked")
        ? "Your next check-in is not ready yet."
        : "Couldn't save. Your progress is safe, try again.");
      setToast(message.includes("alreadycheckedintoday") || message.includes("already checked")
        ? "Check-in already saved today. Come back tomorrow."
        : evolutionCheckInOpen
          ? "Evolve request cancelled. Try again."
          : "Check-in didn't save. Try again.");
      if (message.includes("alreadycheckedintoday") || message.includes("already checked")) void refreshEggoriaState(walletAddress).catch(() => undefined);
      return false;
    } finally {
      checkInSubmittingRef.current = false;
      setCheckInSubmitting(false);
      setCheckInPhase("idle");
    }
  };

  const handleCheckInClick = async () => {
    if (checkInSubmitting || checkInSyncPending || checkInLocked) return;
    const isFledglingCheckpoint = ownedBird?.stage === 0 && ownedBird.checkIns === 9;
    const isSoarlingCheckpoint = ownedBird?.stage === 1 && ownedBird.checkIns === 19;
    if (isFledglingCheckpoint || isSoarlingCheckpoint) {
      if (!await requireArcNetwork("checkin")) return;
      setCheckInError("");
      setEvolutionTargetStage(isSoarlingCheckpoint ? 2 : 1);
      setEvolutionNetworkFee("Estimating...");
      setEvolutionCheckInOpen(true);
      return;
    }
    void checkInBird();
  };

  const confirmEvolutionCheckIn = async () => {
    const completed = await checkInBird();
    if (completed) setEvolutionCheckInOpen(false);
  };

  const resumeNetworkFlow = useEffectEvent((action: Exclude<NetworkResumeAction, null>) => {
    if (action === "hero") void handleHeroAction();
    if (action === "checkin" || action === "evolve") void handleCheckInClick();
    if (action === "mint") void openMintModal();
  });

  useEffect(() => {
    if (!networkResumeAction || !isMetaMaskWallet || !isArcChainId(metaMaskChainId) || networkDialog || networkBusy) return;
    const action = networkResumeAction;
    queueMicrotask(() => {
      setNetworkResumeAction(null);
      resumeNetworkFlow(action);
    });
  }, [isMetaMaskWallet, metaMaskChainId, networkBusy, networkDialog, networkResumeAction]);

  const currentStage = ownedBird ? stageNames[ownedBird.stage] ?? "Unknown" : "";
  const nextStage = !ownedBird || ownedBird.stage === 0
    ? "Fledgling"
    : ownedBird.stage === 1
      ? "Soarling"
      : ownedBird.rarityAssigned
        ? rarityNames[ownedBird.rarity] ?? "Complete"
        : "Rarity pending";
  const stageProgress = ownedBird
    ? ownedBird.stage === 0
      ? Math.min(10, ownedBird.checkIns)
      : ownedBird.stage === 1
        ? Math.min(10, ownedBird.checkIns - 10)
        : 10
    : 0;
  const checkInsRemaining = Math.max(0, 10 - stageProgress);
  const evolutionCheckInReady = Boolean(ownedBird && (ownedBird.checkIns === 9 || ownedBird.checkIns === 19));
  const checkInBusy = checkInSubmitting || checkInSyncPending !== null;
  const checkInButtonLabel = networkCtaOverride && wrongMetaMaskNetwork
    ? arcNetworkMissing ? "Add network" : "Switch network"
    : !ownedBird?.landAssigned
      ? "Assigning Land..."
      : ownedBird.stage >= 2
        ? "Evolution Complete"
        : checkInPhase === "wallet"
          ? "Waiting for MetaMask..."
          : checkInBusy
            ? "Checking in..."
            : checkedInToday
              ? "Checked In"
              : checkInError
                ? "Try again"
                : evolutionCheckInReady
                  ? "Check In & Evolve"
                  : "Check In";
  const checkInHelperText = !ownedBird?.landAssigned
    ? "Your bird will appear as soon as randomness is fulfilled."
    : ownedBird.stage >= 2
      ? "Your Bird has completed its evolution."
      : checkInPhase === "wallet"
        ? "Confirm in your wallet to evolve."
        : checkInBusy
          ? "Saving your check-in..."
          : checkedInToday
            ? `Your Bird is resting. Next check-in in ${nextCheckInTime}`
            : checkInError
              ? "Couldn't save. Your progress is safe, try again."
              : evolutionCheckInReady
                ? "Your Bird is ready to evolve!"
                : "Your Bird is waiting for you.";
  const ownedLandClass = ownedBird?.landAssigned
    ? landClassNames[ownedBird.land] ?? "wizard"
    : "pending";
  const isHatching = hatchPhase !== "idle";
  const postHatchOwned = Boolean(walletAddress && postHatchOwnedAddress === walletAddress.toLowerCase());
  const hatchLandClass = hatchingBird?.landAssigned
    ? landClassNames[hatchingBird.land] ?? "wizard"
    : "pending";
  const hatchRarityClass = hatchingBird?.rarityAssigned
    ? ` rarity-${rarityNames[hatchingBird.rarity]?.toLowerCase() ?? "common"}`
    : "";
  // Assigned birds use the local land-specific artwork so Hatchling, Fledgling and
  // Soarling stay aligned with the same island system throughout the journey.
  const compositeBird = ownedBird?.landAssigned ? ownedBird : null;

  return (
    <>
    {thirdwebClient && <AutoConnect client={thirdwebClient} wallets={supportedWallets} />}
    <main className="landing" data-node-id="316:5">
      <header className="landing-header" data-node-id="316:63">
        <a className="brand-new" href="#home" aria-label="Eggoria home">
          <img src={asset("logo.svg")} alt="" /><span>Eggoria</span>
        </a>
        <nav className="main-nav" aria-label="Primary navigation">
          <img src={asset("nav-frame.png")} alt="" />
          <div>
            {navItems.map(([id, label]) => (
              <a key={id} className={activeNav === id ? "is-active" : ""} href={`#${id}`} onClick={() => setActiveNav(id)}>
                {activeNav === id && <img className="nav-active-top" src={asset("nav-active-top.svg")} alt="" />}
                {label}
                {activeNav === id && <img className="nav-active-bottom" src={asset("nav-active-bottom.svg")} alt="" />}
              </a>
            ))}
          </div>
        </nav>
        <div ref={walletMenuAnchorRef} className="header-actions">
          <div className="social-links">
            <a href="#" aria-label="Eggoria on X"><img className="social-frame" src={asset("icon-frame.png")} alt="" /><img className="social-glyph" src={asset("twitter.svg")} alt="" /></a>
            <a href="#" aria-label="Eggoria on Discord"><img className="social-frame" src={asset("icon-frame.png")} alt="" /><img className="social-glyph" src={asset("discord.svg")} alt="" /></a>
          </div>
          <button className={`figma-button header-connect${walletAddress ? " is-connected" : ""}`} type="button" onClick={openWallet}>
            <img src={asset("button.png")} alt="" />
            <span className="header-connect-label">{connectionLabel}{walletAddress && <img className="wallet-chevron" src={asset("wallet-chevron.svg")} alt="" />}</span>
          </button>
          {walletAddress && walletMenuOpen && <div className="wallet-nav-menu" role="dialog" aria-label="Connected wallet details">
            <div className="wallet-menu-profile">
              <img className="wallet-menu-avatar" src={asset("wallet-menu-avatar.png")} alt="" />
              <div className="wallet-menu-identity">
                <strong>{walletKind === "google" ? walletEmail || user?.email || "Google Wallet" : walletKind === "metamask" ? "MetaMask Wallet" : user?.email ?? "Connected Wallet"}</strong>
                <span>{shortAddress(walletAddress)}</span>
              </div>
              <button className="wallet-menu-copy" type="button" aria-label={walletAddressCopied ? "Wallet address copied" : "Copy wallet address"} title={walletAddressCopied ? "Copied" : "Copy address"} onClick={() => void copyWalletAddress()}>
                <img src={asset("wallet-menu-copy.png")} alt="" />
              </button>
            </div>
            <div className="wallet-menu-divider" />
            <div className="wallet-menu-row"><span><img src={asset("claim-wallet.png")} alt="" />Balance</span><strong>{formatUsdcBalance(arcBalance)} Test USDC</strong></div>
            <div className="wallet-menu-row"><span><img src={asset("claim-network.png")} alt="" />Network</span><strong>{walletNetworkName}</strong></div>
            <div className="wallet-menu-divider" />
            {ownedBird
              ? <a className="wallet-menu-row wallet-menu-link wallet-menu-bird-link" href={`https://testnet.arcscan.app/token/${eggoriaBirdsAddress}/instance/${ownedBird.tokenId.toString()}`} target="_blank" rel="noreferrer"><span><img src={asset("evolution-bird.png")} alt="" />My Bird</span><strong>{ownedBird.landAssigned ? `${currentStage}: ${stageProgress}/10` : "Assigning Land"}</strong></a>
              : <div className="wallet-menu-row"><span><img src={asset("evolution-bird.png")} alt="" />My Bird</span><strong>No NFT</strong></div>}
            <a className="wallet-menu-row wallet-menu-link" href={`https://testnet.arcscan.app/address/${walletAddress}`} target="_blank" rel="noreferrer"><span><img src={asset("wallet-menu-external.png")} alt="" />View on Explorer</span></a>
            <div className="wallet-menu-divider" />
            <button className="wallet-menu-logout" type="button" onClick={disconnectWallet}><img src={asset("wallet-menu-logout.png")} alt="" />Log out</button>
          </div>}
        </div>
      </header>

      <section className={`hero-new${isHatching ? " is-hatching" : ""}${postHatchOwned ? " is-post-hatch" : ""}${ownedBird?.landAssigned && ownedBird.stage >= 2 ? " is-final-form" : ""}`} id="home">
        <div className="hero-copy" data-node-id="316:52">
          <h1>{ownedBird?.landAssigned && ownedBird.stage >= 2 ? <>Your {landNames[ownedBird.land]} Bird<br />Has Reached Its<br />Final Form</> : <>Hatch Your<br />Own Bird</>}</h1>
          {!(ownedBird?.landAssigned && ownedBird.stage >= 2) && <><p>Mint a mysterious Egg for free, hatch your Bird,<br />and help it evolve through daily check-ins.</p>
          <div className={`mint-progress${statsLoading ? " is-loading" : ""}`} aria-busy={statsLoading}>
            <img className="progress-frame" src={asset("progress-frame.png")} alt="" />
            <div className="progress-content">
              <span className="mint-count">{statsLoading ? <span className="mint-count-skeleton" aria-label="Loading mint count" /> : `${count} / ${EGGORIA_MAX_SUPPLY} Eggs Minted`}</span>
              <span className="progress-track">{statsLoading ? <span className="progress-skeleton" /> : <><i style={{ width: `${progress}%` }} /><b style={{ left: `${progress}%` }} /></>}</span>
            </div>
          </div></>}
          {walletViewLoading ? <div className="hero-wallet-state-loading" aria-label="Loading your Eggoria progress" aria-busy="true" /> : ownedBird?.landAssigned && ownedBird.stage >= 2 ? <div className="final-form-panel">
            <div className={`final-stage-card land-${ownedLandClass}`} aria-label={`${landNames[ownedBird.land]} bird evolution: Hatchling, Fledgling, Soarling`}>
              <img className="final-stage-frame" src={asset("checkin-frame.png")} alt="" />
              <div className="final-stage-journey">
                <div className="final-stage-item"><span className="final-stage-picture"><img src={asset(landFinalStageAssets[ownedBird.land]?.[0] ?? landFinalStageAssets[2][0])} alt="" /></span><span>Hatchling</span></div>
                <span className="final-stage-connector" aria-hidden="true"><img src={asset("final-stage-light.png")} alt="" /></span>
                <div className="final-stage-item"><span className="final-stage-picture"><img className="final-stage-fledgling" src={asset(landFinalStageAssets[ownedBird.land]?.[1] ?? landFinalStageAssets[2][1])} alt="" /></span><span>Fledgling</span></div>
                <span className="final-stage-connector" aria-hidden="true"><img src={asset("final-stage-light.png")} alt="" /></span>
                <div className="final-stage-item"><span className="final-stage-picture"><img src={ownedBird.rarity === 4 ? asset(landFinalStageAssets[ownedBird.land]?.[2] ?? landFinalStageAssets[2][2]) : ownedBird.rarity === 3 ? asset(landLegendaryHeroBirdAssets[ownedBird.land] ?? landLegendaryHeroBirdAssets[2]) : ownedBird.rarity === 2 ? asset(landEpicHeroBirdAssets[ownedBird.land] ?? landEpicHeroBirdAssets[2]) : ownedBird.rarity === 1 ? asset(landRareHeroBirdAssets[ownedBird.land] ?? landRareHeroBirdAssets[2]) : asset(landCommonHeroBirdAssets[ownedBird.land] ?? landCommonHeroBirdAssets[2])} alt="" /></span><span>Soarling</span></div>
              </div>
            </div>
            <div className="final-form-actions">
              <a className="figma-button final-form-action" href={`https://testnet.arcscan.app/token/${eggoriaBirdsAddress}/instance/${ownedBird.tokenId.toString()}`} target="_blank" rel="noreferrer"><img src={asset("button.png")} alt="" /><span>View My Bird</span></a>
              <a className="figma-button final-form-action final-form-action-secondary" href="#roadmap" onClick={() => setActiveNav("roadmap")}><img src={asset("wallet-google-button.png")} alt="" /><span>View Roadmap</span></a>
            </div>
            <p className="final-form-note">Your journey is complete. PvP &amp; PvE arrive in Q2.</p>
          </div> : ownedBird ? <div className="bird-owner-wrap">
            <section className={`bird-evolution-card land-${ownedLandClass}`} aria-label={`Evolution progress for Eggoria Bird #${ownedBird.tokenId}`}>
              <img className="bird-evolution-frame" src={asset("checkin-frame.png")} alt="" />
              <div className="bird-evolution-content">
                <div className="bird-stage-heading">
                  <div><strong>{ownedBird.landAssigned ? currentStage : "Mystery Egg"}</strong><span>Current Stage</span></div>
                  <div><strong>{ownedBird.landAssigned ? nextStage : "Land reveal"}</strong><span>Next Stage</span></div>
                </div>
                <div className="bird-checkin-track" aria-label={`${stageProgress} of 10 check-ins completed in this stage`}>
                  {Array.from({ length: 10 }, (_, index) => <span className={`bird-checkin-step${index === 0 ? " is-first" : ""}${index === celebratedCheckIn ? " is-newly-complete" : ""}`} key={index}>
                    {index > 0 && <img className="bird-checkin-line" src={asset(index < stageProgress ? "checkin-line-complete.png" : "checkin-line-pending.png")} alt="" />}
                    <img className="bird-checkin-marker" src={asset(index < stageProgress ? "checkin-complete.png" : "checkin-pending.png")} alt="" />
                  </span>)}
                </div>
                <div className="bird-checkin-message">
                  <img src={asset("checkin-helper.png")} alt="" />
                  <p>{ownedBird.landAssigned
                    ? ownedBird.stage >= 2
                      ? `${rarityNames[ownedBird.rarity] ?? "Soarling"} evolution complete.`
                      : `${checkInsRemaining} more check-in${checkInsRemaining === 1 ? "" : "s"} to reach ${nextStage}.`
                    : "Your land is being assigned securely."}</p>
                </div>
              </div>
            </section>
            <button
              className={`figma-button hero-connect bird-checkin-button${checkedInToday && !checkInSubmitting && !checkInSyncPending ? " is-countdown" : ""}`}
              type="button"
              onClick={handleCheckInClick}
              disabled={checkInSubmitting || checkInLocked || !ownedBird.landAssigned || ownedBird.stage >= 2}
              aria-busy={checkInSubmitting || checkInSyncPending !== null}
            >
              <img src={asset("button.png")} alt="" />
              <span>{checkInBusy && <i className="claim-button-spinner" aria-hidden="true" />}{checkInButtonLabel}</span>
            </button>
            <button
              className={`funds-guide-backdrop${fundsGuideOpen ? " is-open" : ""}`}
              type="button"
              tabIndex={-1}
              aria-label="Close check-in guide"
              onClick={() => setFundsGuideOpen(false)}
            />
            <aside ref={activeGuideRef} id="bird-guide" className={`funds-guide bird-checkin-guide${fundsGuideOpen ? " is-open" : ""}`} aria-label="Daily check-in guide" aria-hidden={!fundsGuideOpen}>
              <i className="funds-guide-pointer" aria-hidden="true" />
              <div className="funds-guide-header">
                <span>Step 3 of 3</span>
                <button type="button" aria-label="Close check-in guide" onClick={() => setFundsGuideOpen(false)} />
              </div>
              <h2>Daily Check-ins</h2>
              <p>Tap once every 24 hours. Your 10th check-in evolves your Bird.</p>
            </aside>
            <p key={`checkin-helper-${ownedBird.tokenId}`} className="login-note bird-checkin-helper hero-state-helper">
              <span className="funds-note-content">
                <span>{checkInHelperText}</span>
                <button
                  className="funds-guide-help"
                  type="button"
                  aria-label="Show check-in guide"
                  aria-controls="bird-guide"
                  aria-expanded={fundsGuideOpen}
                  onClick={() => setFundsGuideOpen(true)}
                >?</button>
              </span>
            </p>
            {notice && <p className="connection-notice" role="status">{notice}</p>}
          </div> : <div className="hero-connect-wrap">
            <button className="figma-button hero-connect hero-mint-button" type="button" onClick={handleHeroAction} disabled={claimSubmitting || mintPhase === "pending" || isHatching || heroChecking} aria-busy={claimSubmitting || mintPhase === "pending" || isHatching || heroChecking}>
              <img src={asset("button.png")} alt="" /><span>{(heroChecking || mintPhase !== "idle" || isHatching) && <i className="claim-button-spinner" aria-hidden="true" />}{mintPhase === "pending" || isHatching ? "Hatching..." : mintPhase === "waiting" ? "Waiting..." : mintPhase === "checking" || heroChecking ? "Checking..." : networkCtaOverride && wrongMetaMaskNetwork ? arcNetworkMissing ? "Add network" : "Switch network" : !walletAddress ? "Get Your Egg" : hasTestFunds ? "Mint Your Egg" : "Get Free Test Funds"}</span>
            </button>
            {walletAddress && <button
              className={`funds-guide-backdrop${fundsGuideOpen ? " is-open" : ""}`}
              type="button"
              tabIndex={-1}
              aria-label="Close test funds guide"
              onClick={() => setFundsGuideOpen(false)}
            />}
            {walletAddress && <aside ref={activeGuideRef} id="funds-guide" className={`funds-guide${fundsGuideOpen ? " is-open" : ""}`} aria-label={hasTestFunds ? "Mint your Egg guide" : "Get free test funds guide"} aria-hidden={!fundsGuideOpen}>
              <i className="funds-guide-pointer" aria-hidden="true" />
              <div className="funds-guide-header">
                <span>Step {hasTestFunds ? 2 : 1} of 3</span>
                <button type="button" aria-label="Close test funds guide" onClick={() => setFundsGuideOpen(false)} />
              </div>
              <h2>{hasTestFunds ? "Mint Your Egg" : "Get Free Test Funds"}</h2>
              {hasTestFunds
                ? <p>You&apos;ll confirm a small network fee (covered by<br />your Test USDC) and receive 1 Mystery Egg.</p>
                : <p>You need free test funds to create your Egg.<br />They only work here for testing.</p>}
            </aside>}
            {hasTestFunds ? <p key="mint-helper" className="login-note funds-note mint-helper hero-state-helper">
              <span className="funds-note-content">
                <span>You&apos;re ready to mint. One Egg per wallet.</span>
                <button
                  className="funds-guide-help"
                  type="button"
                  aria-label="Show mint guide"
                  aria-controls="funds-guide"
                  aria-expanded={fundsGuideOpen}
                  onClick={() => setFundsGuideOpen(true)}
                >?</button>
              </span>
            </p> : walletAddress ? <>
              <p key="funds-helper" className="login-note funds-note hero-state-helper">
                <span className="funds-note-content">
                  <span>This free test balance is used to create your Egg.</span>
                  <button
                    className="funds-guide-help"
                    type="button"
                    aria-label="Show test funds guide"
                    aria-controls="funds-guide"
                    aria-expanded={fundsGuideOpen}
                    onClick={() => setFundsGuideOpen(true)}
                  >?</button>
                </span>
              </p>
              <div className="wallet-balance-card">
                <img src={asset("funds-balance-frame.png")} alt="" />
                <span>You have {formatUsdcBalance(arcBalance)} Test USDC. You&apos;ll need this to create your Egg</span>
              </div>
            </> : <p key="connect-helper" className="login-note hero-state-helper">{user ? `Keeper #${user.position.toLocaleString("en-US")}` : "Continue with Google or MetaMask"}</p>}
            {notice && <p className="connection-notice" role="status">{notice}</p>}
          </div>}
        </div>
        {ownedBird?.landAssigned && ownedBird.stage >= 2 && ownedBird.rarityAssigned && <span className={`final-form-rarity rarity-${rarityNames[ownedBird.rarity]?.toLowerCase() ?? "common"}`} aria-label={`${rarityNames[ownedBird.rarity] ?? "Common"} rarity`}>✦ {rarityNames[ownedBird.rarity] ?? "Common"} ✦</span>}
        <div className={`hero-art${walletViewLoading ? " is-state-loading" : ownedBird ? ` bird-owned land-${ownedLandClass}${ownedBird.stage === 2 ? " is-soarling" : ""}${ownedBird.stage === 2 && ownedBird.rarity === 0 ? " is-common" : ownedBird.stage === 2 && ownedBird.rarity === 1 ? " is-rare" : ownedBird.stage === 2 && ownedBird.rarity === 2 ? " is-epic" : ownedBird.stage === 2 && ownedBird.rarity === 3 ? " is-legendary" : ownedBird.stage === 2 && ownedBird.rarity === 4 ? " is-mythic" : ""}${postHatchOwned ? " is-post-hatch" : ""}` : isHatching ? ` is-hatching hatch-${hatchPhase} land-${hatchLandClass}${hatchRarityClass}` : ""}`} aria-label={!walletViewLoading && ownedBird?.landAssigned ? `${landNames[ownedBird.land]} bird on its island` : isHatching ? "Your Egg is hatching" : undefined} aria-hidden={!walletViewLoading && (ownedBird || isHatching) ? undefined : "true"}>
          <span className="egg-glow-new">
            <img src={asset("glow.svg")} alt="" />
          </span>
          {compositeBird?.stage === 2 && <>
            <span className="owned-soarling-sparks" aria-hidden="true"><i /><i /><i /></span>
          </>}
          {compositeBird && (compositeBird.stage < 2
            ? <YoungBirdHeroComposite bird={compositeBird} isReveal={postHatchOwned} />
            : compositeBird.stage === 2 && compositeBird.rarity <= 1
            ? <LowerRarityHeroComposite bird={compositeBird} />
            : compositeBird.stage === 2 && compositeBird.rarity === 2
            ? <EpicHeroComposite bird={compositeBird} />
            : compositeBird.stage === 2 && compositeBird.rarity === 3
            ? <LegendaryHeroComposite bird={compositeBird} />
            : compositeBird.stage === 2 && compositeBird.rarity === 4 && compositeBird.land === 0
            ? <span
              key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
              className="bird-land-composite forest-mythic-composite"
              role="img"
              aria-label="Forest Soarling on its island"
            >
              <img className="forest-mythic-glow" src={asset("forest-mythic-layer-glow.png")} alt="" />
              <img className="forest-mythic-ring" src={asset("forest-mythic-layer-ring.png")} alt="" />
              <span className="forest-mythic-orbit-motes" aria-hidden="true"><i /><i /><i /></span>
              <span className="forest-mythic-core" aria-hidden="true">
                <img className="forest-mythic-island" src={asset("forest-mythic-layer-island.png")} alt="" />
                <i className="forest-mythic-awakening" />
                <img className="forest-mythic-bird" src={asset("forest-mythic-layer-bird.png")} alt="" />
                <span className="forest-mythic-leaves">
                  <img src={asset("forest-mythic-layer-leaf.png")} alt="" />
                  <img src={asset("forest-mythic-layer-leaf.png")} alt="" />
                  <img src={asset("forest-mythic-layer-leaf.png")} alt="" />
                </span>
                <span className="forest-mythic-badge"><img src={asset("wind-mythic-layer-badge.png")} alt="" /></span>
              </span>
            </span>
            : compositeBird.stage === 2 && compositeBird.rarity === 4 && compositeBird.land === 1
            ? <span
              key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
              className="bird-land-composite wind-mythic-composite"
              role="img"
              aria-label="Wind Soarling on its island"
            >
              <img className="wind-mythic-glow" src={asset("wind-mythic-layer-glow.png")} alt="" />
              <img className="wind-mythic-ring" src={asset("wind-mythic-layer-ring.png")} alt="" />
              <span className="wind-mythic-orbit-motes" aria-hidden="true"><i /><i /><i /></span>
              <span className="wind-mythic-core" aria-hidden="true">
                <img className="wind-mythic-island" src={asset("wind-mythic-layer-island.png")} alt="" />
                <i className="wind-mythic-awakening" />
                <img className="wind-mythic-bird" src={asset("wind-mythic-layer-bird.png")} alt="" />
                <span className="wind-mythic-feathers">
                  <img src={asset("wind-mythic-feather.png")} alt="" />
                  <img src={asset("wind-mythic-feather.png")} alt="" />
                  <img src={asset("wind-mythic-feather.png")} alt="" />
                </span>
                <span className="wind-mythic-badge"><img src={asset("wind-mythic-layer-badge.png")} alt="" /></span>
              </span>
            </span>
            : compositeBird.stage === 2 && compositeBird.rarity === 4 && compositeBird.land === 2
            ? <span
              key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
              className="bird-land-composite wizard-mythic-composite"
              role="img"
              aria-label="Wizard Soarling on its island"
            >
              <img className="wizard-mythic-glow" src={asset("wizard-mythic-layer-glow.png")} alt="" />
              <img className="wizard-mythic-ring" src={asset("wizard-mythic-layer-ring.png")} alt="" />
              <span className="wizard-mythic-orbit-motes" aria-hidden="true"><i /><i /><i /></span>
              <span className="wizard-mythic-core" aria-hidden="true">
                <img className="wizard-mythic-island" src={asset("wizard-mythic-layer-island.png")} alt="" />
                <i className="wizard-mythic-awakening" />
                <img className="wizard-mythic-bird" src={asset("wizard-mythic-layer-bird.png")} alt="" />
                <span className="wizard-mythic-crystals">
                  <img src={asset("wizard-mythic-layer-crystal.png")} alt="" />
                  <img src={asset("wizard-mythic-layer-crystal.png")} alt="" />
                  <img src={asset("wizard-mythic-layer-crystal.png")} alt="" />
                </span>
                <span className="wizard-mythic-badge"><img src={asset("wind-mythic-layer-badge.png")} alt="" /></span>
              </span>
            </span>
            : compositeBird.stage === 2 && compositeBird.rarity === 4 && compositeBird.land === 3
            ? <span
              key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
              className="bird-land-composite artist-mythic-composite"
              role="img"
              aria-label="Artist Soarling on its island"
            >
              <img className="artist-mythic-glow" src={asset("artist-mythic-layer-glow.png")} alt="" />
              <img className="artist-mythic-ring" src={asset("artist-mythic-layer-ring.png")} alt="" />
              <span className="artist-mythic-orbit-motes" aria-hidden="true"><i /><i /><i /></span>
              <span className="artist-mythic-core" aria-hidden="true">
                <img className="artist-mythic-island" src={asset("artist-mythic-layer-island.png")} alt="" />
                <i className="artist-mythic-awakening" />
                <img className="artist-mythic-bird" src={asset("artist-mythic-layer-bird.png")} alt="" />
                <span className="artist-mythic-flames">
                  <img src={asset("artist-mythic-layer-flame.png")} alt="" />
                  <img src={asset("artist-mythic-layer-flame.png")} alt="" />
                  <img src={asset("artist-mythic-layer-flame.png")} alt="" />
                </span>
                <span className="artist-mythic-badge"><img src={asset("wind-mythic-layer-badge.png")} alt="" /></span>
              </span>
            </span>
            : compositeBird.stage === 2 && compositeBird.rarity === 4 && compositeBird.land === 4
            ? <span
              key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
              className="bird-land-composite king-mythic-composite"
              role="img"
              aria-label="King Soarling on its island"
            >
              <img className="king-mythic-glow" src={asset("king-mythic-layer-glow.png")} alt="" />
              <img className="king-mythic-ring" src={asset("king-mythic-layer-ring.png")} alt="" />
              <span className="king-mythic-orbit-motes" aria-hidden="true"><i /><i /><i /></span>
              <span className="king-mythic-core" aria-hidden="true">
                <img className="king-mythic-island" src={asset("king-mythic-layer-island.png")} alt="" />
                <i className="king-mythic-awakening" />
                <img className="king-mythic-bird" src={asset("king-mythic-layer-bird.png")} alt="" />
                <span className="king-mythic-feathers">
                  <img src={asset("king-mythic-layer-feather.png")} alt="" />
                  <img src={asset("king-mythic-layer-feather.png")} alt="" />
                  <img src={asset("king-mythic-layer-feather.png")} alt="" />
                </span>
                <span className="king-mythic-badge"><img src={asset("wind-mythic-layer-badge.png")} alt="" /></span>
              </span>
            </span>
            : <img
              key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
              className={`bird-land-composite${!ownedBird ? " is-hatch-reveal" : ""}`}
              src={getOwnedHeroArtwork(compositeBird)}
              alt={`${landNames[compositeBird.land]} ${stageNames[compositeBird.stage] ?? "bird"} on its island`}
            />)}
          {ownedBird?.landAssigned
            ? null
            : <>
              <img className="island-new" src={ownedBird?.landAssigned ? asset(landIslandAssets[ownedBird.land] ?? "land-wizard.png") : asset("island.png")} alt="" />
              {ownedBird
                ? <img className={`bird-new${ownedBird.landAssigned ? "" : " is-metadata-pending"}`} src={ownedBird.landAssigned ? ownedBird.image || asset(landBirdAssets[ownedBird.land] ?? "wizard-primary.png") : asset("claim-egg.png")} alt={ownedBird.landAssigned ? `${landNames[ownedBird.land]} bird` : "Mystery Egg awaiting land assignment"} />
                : isHatching ? <>
                  <img ref={heroEggRef} className="egg-new hatch-egg-main" src={asset("egg.png")} alt="Your Egg is hatching" tabIndex={-1} />
                  <span className="hatch-aura" aria-hidden="true" />
                  <span className="hatch-flash" aria-hidden="true" />
                  <span className="hatch-status" role="status" aria-live="polite">{hatchPhase === "charge" ? "Your Egg is gathering magic" : hatchPhase === "shake" ? "Your Bird is ready to hatch" : "Your Bird has hatched"}</span>
                </> : <img ref={heroEggRef} className="egg-new" src={asset("egg.png")} alt="" tabIndex={-1} />}
            </>}
          <span className="egg-burst-field">
            <i className="egg-burst egg-burst-one">✦</i>
            <i className="egg-burst egg-burst-two">✦</i>
            <i className="egg-burst egg-burst-three">✦</i>
            <i className="egg-burst egg-burst-four">✦</i>
            <i className="egg-burst egg-burst-five">✦</i>
            <i className="egg-burst egg-burst-six">✦</i>
          </span>
        </div>
        <div className="spark-field" aria-hidden="true">
          <img className="orbit-spark orbit-spark-crystal orbit-spark-crystal-left" src={asset("crystal.png")} alt="" />
          <img className="orbit-spark orbit-spark-crystal orbit-spark-crystal-right" src={asset("crystal.png")} alt="" />
          <img className="orbit-spark orbit-spark-feather orbit-spark-feather-left" src={asset("feather-a.png")} alt="" />
          <img className="orbit-spark orbit-spark-feather orbit-spark-feather-right" src={asset("feather-b.png")} alt="" />
          <img className="orbit-spark orbit-spark-bird" src={asset("bird.png")} alt="" />
          <i className="orbit-spark orbit-spark-star orbit-spark-star-left">✦</i>
          <i className="orbit-spark orbit-spark-star orbit-spark-star-top">✦</i>
          <i className="light-spark light-spark-two">✦</i>
          <i className="light-spark light-spark-three">✦</i>
        </div>
        <img className="distant-island distant-island-left" src={asset("island-left.png")} alt="" />
        <img className="distant-island distant-island-right" src={asset("island-right.png")} alt="" />
        <img className="balloon balloon-one" src={asset("balloon.png")} alt="" />
      </section>
    </main>

      {portalReady && createPortal(<div
        className={`wallet-modal-layer${walletModalOpen ? " is-open" : ""}`}
        aria-hidden={!walletModalOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setWalletModalOpen(false);
        }}
      >
        <section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
          <img className="wallet-modal-frame" src={asset("wallet-modal-frame.png")} alt="" />
          <button ref={closeWalletRef} className="wallet-modal-close" type="button" aria-label="Close wallet options" onClick={() => setWalletModalOpen(false)}>
            <img src={asset("wallet-close.svg")} alt="" />
          </button>
          <header className="wallet-modal-heading">
            <h2 id="wallet-modal-title">Begin Your Journey</h2>
            <p>Sign in to claim your free Egg.</p>
          </header>
          <div className="wallet-options">
            {inAppBrowser && <p className="wallet-info" role="status">This browser can&apos;t sign you in. Open the link in Chrome or Safari. <button type="button" onClick={copySignInLink}>{walletLinkCopied ? "Copied" : "Copy link"}</button></p>}
            <div className="wallet-option">
              <button className="wallet-provider wallet-provider-google" type="button" onClick={connectGoogleWallet} disabled={isConnecting || Boolean(connectingProvider)} aria-busy={connectingProvider === "google"}>
                <img className="wallet-provider-frame" src={asset("wallet-metamask-button.png")} alt="" />
                <span className="wallet-provider-content">
                  <img src={asset("wallet-google.svg")} alt="" />
                  <strong>{connectingProvider === "google" ? "Signing in with Google..." : "Continue with Google"}</strong>
                  <small>Easiest</small>
                </span>
              </button>
              <p>We&apos;ll set up a free wallet for you. Nothing to download.</p>
              {walletError.startsWith("google-") && <div className={`wallet-feedback${walletError === "google-cancelled" ? " is-info" : ""}`} role="status">
                <p>{walletError === "google-cancelled" ? "You closed the Google window." : walletError === "google-popup-blocked" ? "Your browser blocked the Google window. Allow pop-ups for this site, then try again." : "Google sign-in didn't work. Check your connection and try again."} <button type="button" onClick={connectGoogleWallet}>{walletError === "google-cancelled" ? "Sign in again" : "Try again"}</button></p>
              </div>}
            </div>
            <div className="wallet-divider" aria-hidden="true">
              <span className="wallet-divider-side"><i /><img src={asset("wallet-spark.svg")} alt="" /></span>
              <b>OR</b>
              <span className="wallet-divider-side"><i /><img src={asset("wallet-spark.svg")} alt="" /></span>
            </div>
            <div className="wallet-option">
              {metaMaskInstalled ? <button className="wallet-provider wallet-provider-metamask" type="button" onClick={connectMetaMask} disabled={isConnecting || Boolean(connectingProvider)} aria-busy={connectingProvider === "metamask"}>
                <img className="wallet-provider-frame" src={asset("wallet-google-button.png")} alt="" />
                <span className="wallet-provider-content">
                  <img src={asset("wallet-metamask.svg")} alt="" />
                  <strong>{connectingProvider === "metamask" ? "Check MetaMask to continue..." : "Continue with MetaMask"}</strong>
                </span>
              </button> : <a className="wallet-provider wallet-provider-metamask" href={mobileWalletBrowser ? `https://metamask.app.link/dapp/${window.location.href.replace(/^https?:\/\//, "")}` : "https://metamask.io/download/"} target="_blank" rel="noopener noreferrer">
                <img className="wallet-provider-frame" src={asset("wallet-google-button.png")} alt="" />
                <span className="wallet-provider-content">
                  <img src={asset("wallet-metamask.svg")} alt="" />
                  <strong>{mobileWalletBrowser ? "Open in MetaMask app ↗" : "Install MetaMask"}</strong>
                </span>
              </a>}
              <p>Already have a crypto wallet? Use it here.</p>
              {!metaMaskInstalled && <div className="wallet-feedback is-info" role="status">
                <p>{mobileWalletBrowser ? "Tap to open this page inside the MetaMask app." : "You don't have MetaMask yet."}</p>
                {!mobileWalletBrowser && <p>Already installed it? <button type="button" onClick={() => window.location.reload()}>Refresh page</button></p>}
              </div>}
              {connectingProvider === "metamask" && <div className="wallet-feedback is-info" role="status"><p>{metaMaskWaitLong ? "Still waiting? Approve the connection request in the MetaMask panel on the right." : "A MetaMask panel opened on the right. Approve the request to connect."}</p></div>}
              {metaMaskInstalled && walletError.startsWith("metamask-") && <div className={`wallet-feedback${walletError === "metamask-closed" || walletError === "metamask-cancelled" || walletError === "metamask-pending" || walletError === "metamask-locked" ? " is-info" : ""}`} role="status">
                <p>{walletError === "metamask-closed" ? "You closed the MetaMask window." : walletError === "metamask-cancelled" ? "You declined in MetaMask." : walletError === "metamask-pending" ? "A MetaMask request is already open. Approve it in the panel on the right." : walletError === "metamask-locked" ? "MetaMask is locked. Unlock it, then connect again." : "Something went wrong connecting to MetaMask."}
                  {walletError !== "metamask-pending" && <> <button type="button" onClick={connectMetaMask}>{walletError === "metamask-locked" || walletError === "metamask-closed" || walletError === "metamask-cancelled" ? "Connect again" : "Try again"}</button></>}
                </p>
              </div>}
            </div>
          </div>
          {walletError === "thirdweb-config" && <p className="wallet-config-error" role="alert">Wallet login is not configured yet. Please try again later.</p>}
        </section>
      </div>, document.body)}

      {portalReady && createPortal(<div
        className={`wallet-modal-layer arc-network-layer${networkDialog ? " is-open" : ""}`}
        aria-hidden={!networkDialog}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !networkBusy) dismissNetworkDialog();
        }}
      >
        <section className="funds-modal arc-network-modal" role="dialog" aria-modal="true" aria-labelledby="arc-network-title">
          <img className="funds-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="funds-modal-close" type="button" aria-label="Close ARC Testnet setup" onClick={dismissNetworkDialog} disabled={networkBusy}>
            <img src={asset("wallet-close.svg")} alt="" />
          </button>
          <img className="arc-network-icon" src={asset("arc-testnet-icon.png")} alt="" />
          <div className="funds-modal-copy arc-network-copy">
            <h2 id="arc-network-title">{(networkDialog ?? lastNetworkDialog) === "add" ? "One quick setup" : "Wrong network"}</h2>
            <p>{(networkDialog ?? lastNetworkDialog) === "add"
              ? "Eggoria runs on ARC Testnet, a free practice network. MetaMask will ask you to approve it."
              : `Your wallet is on ${walletNetworkName === "Checking..." ? "another network" : walletNetworkName}. Switch to ARC Testnet to keep going.`}</p>
          </div>
          {networkFeedback === "error" && <p className="arc-network-feedback is-error" role="alert">MetaMask couldn&apos;t {(networkDialog ?? lastNetworkDialog) === "add" ? "add" : "switch"} the network. Try again, or do it manually.</p>}
          <div className="funds-modal-actions arc-network-actions">
            <button className="funds-cancel" type="button" onClick={dismissNetworkDialog} disabled={networkBusy}>Not now</button>
            <button className="figma-button funds-confirm" type="button" onClick={requestArcNetwork} disabled={networkBusy} aria-busy={networkBusy}>
              <img src={asset("button.png")} alt="" /><span>{networkBusy && <i className="claim-button-spinner" aria-hidden="true" />}{networkBusy ? "Waiting for MetaMask..." : networkFeedback === "error" ? "Try again" : (networkDialog ?? lastNetworkDialog) === "add" ? "Add network" : "Switch network"}</span>
            </button>
          </div>
        </section>
      </div>, document.body)}

      {portalReady && createPortal(<div
        className={`wallet-modal-layer${balanceAlertOpen ? " is-open" : ""}`}
        aria-hidden={!balanceAlertOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeBalanceAlert();
        }}
      >
        <section className="funds-modal balance-alert-modal" role="dialog" aria-modal="true" aria-labelledby="balance-alert-title">
          <img className="funds-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="funds-modal-close" type="button" aria-label="Close balance notice" onClick={closeBalanceAlert}>
            <img src={asset("wallet-close.svg")} alt="" />
          </button>
          <img className="balance-alert-icon" src={asset(balanceAlertKind === "low" ? "low-usdc-warning.png" : balanceAlertKind === "out" ? "out-of-funds.png" : "faucet-cooldown.png")} alt="" />
          <div className="funds-modal-copy balance-alert-copy">
            <h2 id="balance-alert-title">{balanceAlertKind === "low" ? "You're Almost Out" : balanceAlertKind === "out" ? "You're Out Of Funds" : "Come Back Soon"}</h2>
            <p>{balanceAlertKind === "low"
              ? `You have ${Number(balanceAlertBalance.toFixed(2))} Test USDC left. Top up now so you don't get stuck mid-action.`
              : balanceAlertKind === "out"
                ? "You don't have enough Test USDC to cover this. Get more to continue."
                : faucetCooldownActive
                  ? `You're out of Test USDC and the faucet is on cooldown. Try again in ${formatCooldown(faucetRetryAt, currentTimeMs)}.`
                  : "The faucet is ready again. Claim test USDC to continue."}</p>
          </div>
          <div className="funds-modal-actions balance-alert-actions">
            {balanceAlertKind !== "out" && <button className="funds-cancel" type="button" onClick={() => {
              closeBalanceAlert();
               if (balanceAlertKind === "low") void openMintModal();
            }}>{balanceAlertKind === "low" ? "Not Now" : "Close"}</button>}
            <button className="figma-button funds-confirm" type="button" onClick={handleBalanceAlertAction} disabled={balanceAlertKind === "cooldown" && faucetCooldownActive}>
              <img src={asset("button.png")} alt="" /><span>{balanceAlertKind === "low" ? "Get More USDC" : balanceAlertKind === "out" ? "Get Test USDC" : "Claim"}</span>
            </button>
          </div>
        </section>
      </div>, document.body)}

      {portalReady && toast && createPortal(<div className="arc-flow-toast" role="status">{toast}</div>, document.body)}

      {portalReady && createPortal(<div className={`wallet-modal-layer${mintBlocker ? " is-open" : ""}`} aria-hidden={!mintBlocker} onMouseDown={(event) => {
        if (event.target === event.currentTarget) setMintBlocker(null);
      }}>
        <section className="funds-modal balance-alert-modal" role="dialog" aria-modal="true" aria-labelledby="mint-blocker-title">
          <img className="funds-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="funds-modal-close" type="button" aria-label="Close mint notice" onClick={() => setMintBlocker(null)}><img src={asset("wallet-close.svg")} alt="" /></button>
          <img className="balance-alert-icon" src={asset("claim-egg.png")} alt="" />
          <div className="funds-modal-copy balance-alert-copy">
            <h2 id="mint-blocker-title">{mintBlocker === "already" ? "You already have an Egg" : mintBlocker === "soldout" ? "All Eggs are claimed" : "Mint didn't go through"}</h2>
            <p>{mintBlocker === "already" ? "Each wallet can mint one Egg. Yours is hatching below." : mintBlocker === "soldout" ? "All 500 Eggs have been minted. Check back for future drops." : "Something went wrong on the network. Your Egg was not minted; network fees may still apply."}</p>
          </div>
          <div className="funds-modal-actions balance-alert-actions">
            <button className="funds-cancel" type="button" onClick={() => setMintBlocker(null)}>Close</button>
            {mintBlocker !== "soldout" && <button className="figma-button funds-confirm" type="button" onClick={() => {
              const action = mintBlocker;
              setMintBlocker(null);
              if (action === "already") {
                void refreshEggoriaState(walletAddress).catch(() => undefined);
                document.getElementById("home")?.scrollIntoView({ behavior: "smooth" });
               } else void openMintModal();
            }}><img src={asset("button.png")} alt="" /><span>{mintBlocker === "already" ? "View My Egg" : "Try Again"}</span></button>}
          </div>
        </section>
      </div>, document.body)}

      {portalReady && createPortal(<div
        className={`wallet-modal-layer${fundsModalOpen ? " is-open" : ""}`}
        aria-hidden={!fundsModalOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeFundsModal();
        }}
      >
        <section className="funds-modal" role="dialog" aria-modal="true" aria-labelledby="funds-modal-title">
          <img className="funds-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="funds-modal-close" type="button" aria-label="Close test funds confirmation" onClick={closeFundsModal}>
            <img src={asset("wallet-close.svg")} alt="" />
          </button>
          {fundsSuccess ? <>
            <span className="funds-success-icon"><img src={asset("funds-success-new.png")} alt="Success" /></span>
            <div className="funds-modal-copy">
              <h2 id="funds-modal-title">Test USDC Sent</h2>
              <p>{fundsSuccess.amount} test USDC has been sent to your wallet.<br />Your balance will update shortly.</p>
            </div>
            <div className="funds-modal-actions funds-success-action">
              <button className="figma-button funds-done" type="button" onClick={closeFundsModal}>
                <img src={asset("button.png")} alt="" /><span>Done</span>
              </button>
            </div>
          </> : <>
            <img className="funds-usdc-icon" src={asset("funds-usdc-new.png")} alt="USDC" />
            <div className="funds-modal-copy funds-faucet-copy">
              <h2 id="funds-modal-title">Get Free Test USDC</h2>
              <p>{fundsErrorKind === "empty"
                ? "The faucet is empty right now. Try again later."
                : fundsErrorKind === "cooldown"
                  ? fundsError
                  : "Get 1 free test USDC to cover network fees. It's play money, not real currency."}</p>
            </div>
            <div className="funds-modal-actions">
              {(!fundsSending || fundsPhase === "signing") && <button className="funds-cancel" type="button" onClick={closeFundsModal}>{fundsErrorKind === "cooldown" ? "Close" : "Not Now"}</button>}
              {fundsErrorKind !== "cooldown" && <button className="figma-button funds-confirm" type="button" onClick={fundsErrorKind === "empty" ? closeFundsModal : claimTestFunds} disabled={fundsSending} aria-busy={fundsSending}>
                <img src={asset("button.png")} alt="" /><span>{fundsSending && <i className="funds-button-spinner" aria-hidden="true" />}{fundsSending ? fundsPhase === "signing" ? "Waiting..." : fundsPhase === "updating" ? "Updating..." : "Sending..." : fundsErrorKind === "empty" ? "Try Later" : fundsErrorKind === "cancelled" || fundsErrorKind === "timeout" || fundsErrorKind === "error" ? "Try Again" : "Get Test USDC"}</span>
              </button>}
            </div>
          </>}
        </section>
      </div>, document.body)}

      {portalReady && createPortal(<div
        className={`wallet-modal-layer${claimModalOpen ? " is-open" : ""}`}
        aria-hidden={!claimModalOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) dismissMintModal();
        }}
      >
        <section className="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-modal-title">
          <img className="claim-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="claim-modal-close" type="button" aria-label="Close egg claim" onClick={dismissMintModal}>
            <img src={asset("claim-close.svg")} alt="" />
          </button>
          <span className="claim-egg"><img src={asset("claim-egg.png")} alt="" /></span>
          <header className="claim-modal-heading">
            <h2 id="claim-modal-title">Claim Your Egg</h2>
            <p>Your Eggoria journey begins here.</p>
          </header>
          <div className="claim-panel">
            <dl className="claim-details">
              <div><dt><img src={asset("claim-wallet.png")} alt="" />Wallet</dt><dd>{shortAddress(walletAddress)}</dd></div>
              <div><dt><img src={asset("claim-network.png")} alt="" />Network</dt><dd>{walletNetworkName}</dd></div>
              <div><dt><img src={asset("claim-price.png")} alt="" />Mint price</dt><dd>Free</dd></div>
              <div><dt><img src={asset("claim-receive.png")} alt="" />You receive</dt><dd>1 Mystery Egg</dd></div>
              <div><dt><img src={asset("claim-network-fee.png")} alt="" />Network fee</dt><dd>{mintVrfFee === "Unavailable" || mintVrfFee === "Estimating..." ? mintVrfFee : `~${mintVrfFee} Test USDC`}</dd></div>
            </dl>
            <p className="claim-price-note">Free to mint. You only pay the network fee below.</p>
            <div className="claim-actions">
              {mintPhase !== "pending" && <button className="funds-cancel claim-cancel" type="button" onClick={dismissMintModal}>Not Now</button>}
              <button className="figma-button claim-confirm" type="button" onClick={mintEgg} disabled={claimSubmitting || wrongMetaMaskNetwork}>
                <img src={asset("button.png")} alt="" /><span>{claimSubmitting && <i className="claim-button-spinner" aria-hidden="true" />}{mintPhase === "waiting" ? "Waiting..." : mintPhase === "pending" ? "Minting..." : mintPhase === "checking" ? "Checking..." : mintRetry ? "Try Again" : "Mint Egg"}</span>
              </button>
            </div>
          </div>
          {claimError && <p className="claim-error" role="alert">{claimError}</p>}
        </section>
      </div>, document.body)}

      {portalReady && ownedBird && createPortal(<div
        className={`wallet-modal-layer evolution-checkin-layer${evolutionCheckInOpen ? " is-open" : ""}`}
        aria-hidden={!evolutionCheckInOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !checkInSubmitting) setEvolutionCheckInOpen(false);
        }}
      >
        <section className="claim-modal evolution-checkin-modal" role="dialog" aria-modal="true" aria-labelledby="evolution-checkin-title">
          <img className="claim-modal-frame evolution-checkin-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button
            ref={evolutionCheckInCloseRef}
            className="claim-modal-close evolution-checkin-close"
            type="button"
            aria-label="Close evolution check-in"
            onClick={() => setEvolutionCheckInOpen(false)}
            disabled={checkInSubmitting}
          >
            <img src={asset("claim-close.svg")} alt="" />
          </button>
          <img className="evolution-checkin-icon" src={asset("evolution-checkin-icon.png")} alt="" />
          <header className="claim-modal-heading evolution-checkin-heading">
            <h2 id="evolution-checkin-title">Ready To Evolve!</h2>
            <p>{evolutionTargetStage === 2
              ? "One final check-in to become a Soarling and reveal Rarity."
              : "One final check-in to become a Fledgling."}</p>
          </header>
          <div className="claim-panel evolution-checkin-panel">
            <dl className="claim-details evolution-checkin-details">
              <div><dt><img src={asset("claim-wallet.png")} alt="" />Wallet</dt><dd>{shortAddress(walletAddress)}</dd></div>
              <div><dt><img src={asset("claim-network.png")} alt="" />Network</dt><dd>{walletNetworkName}</dd></div>
              <div><dt><img src={asset("evolution-arrow.png")} alt="" />Evolves to</dt><dd>{evolutionTargetStage === 2 ? "Soarling" : "Fledgling"}</dd></div>
              <div><dt><img src={asset("evolution-bird.png")} alt="" />Bird</dt><dd>#{ownedBird.tokenId.toString()} - {landBadgeNames[ownedBird.land] ?? "Land Wizard"}</dd></div>
              <div><dt><img src={asset("claim-network-fee.png")} alt="" />Network fee</dt><dd>{evolutionTargetStage === 2
                ? evolutionVrfFee === "Unavailable" || evolutionVrfFee === "Estimating..." ? evolutionVrfFee : `~${evolutionVrfFee} Test USDC`
                : evolutionNetworkFee === "Unavailable" || evolutionNetworkFee === "Estimating..." ? evolutionNetworkFee : `~${evolutionNetworkFee} Test USDC`}</dd></div>
            </dl>
            <div className="claim-actions evolution-checkin-actions">
              <button className="funds-cancel claim-cancel evolution-checkin-cancel" type="button" onClick={() => setEvolutionCheckInOpen(false)} disabled={checkInSubmitting}>Not Now</button>
              <button className="figma-button claim-confirm evolution-checkin-confirm" type="button" onClick={() => void confirmEvolutionCheckIn()} disabled={checkInSubmitting || checkInSyncPending !== null || wrongMetaMaskNetwork} aria-busy={checkInSubmitting || checkInSyncPending !== null}>
                <img src={asset("button.png")} alt="" />
                <span>{checkInBusy && <i className="claim-button-spinner" aria-hidden="true" />}{checkInPhase === "wallet" ? "Waiting for MetaMask..." : checkInBusy ? "Checking in..." : "Evolve Now"}</span>
              </button>
            </div>
          </div>
          {checkInError && <p className="claim-error evolution-checkin-error" role="alert">{checkInError}</p>}
        </section>
      </div>, document.body)}

      {portalReady && hatchResult && createPortal(<div
        className="wallet-modal-layer hatch-complete-layer is-open"
        aria-hidden="false"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) completeHatch();
        }}
      >
        <section
          className={`hatch-complete-modal land-${landClassNames[hatchResult.bird.land] ?? "wizard"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="hatch-complete-title"
        >
          <img className="hatch-complete-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button ref={hatchCompleteCloseRef} className="hatch-complete-close" type="button" aria-label="Close hatch result" onClick={completeHatch}>
            <img src={asset("claim-close.svg")} alt="" />
          </button>
          <header className="hatch-complete-heading">
            <h2 id="hatch-complete-title">Hatch Complete</h2>
            <p>Your Mystery Egg has hatched into a new bird!</p>
          </header>
          <div className="hatch-complete-artwork">
            <img
              src={asset(landHatchPopupAssets[hatchResult.bird.land] ?? "hatch-popup-wizard.png")}
              alt={`${landNames[hatchResult.bird.land]} bird on its island`}
            />
            <span className="hatch-land-badge">
              <img src={asset(landRevealIcons[hatchResult.bird.land] ?? "hatch-land-wizard.png")} alt="" />
              {landBadgeNames[hatchResult.bird.land] ?? "Land Wizard"}
            </span>
          </div>
          <dl className="hatch-complete-details">
            <div><dt>Bird ID</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Your bird's unique number.\nIt stays the same forever."} tabIndex={0} aria-label="Your bird's unique number. It stays the same forever."><img src={asset("hatch-token-icon.png")} alt="" /></span>#{hatchResult.bird.tokenId.toString()}</dd></div>
            <div><dt>Stage</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Your bird's growth stage:\nHatchling → Fledgling → Soarling."} tabIndex={0} aria-label="Your bird's growth stage: Hatchling, Fledgling, then Soarling."><img src={asset("hatch-stage-icon.png")} alt="" /></span>Hatchling</dd></div>
            <div><dt>Rarity</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Revealed when your bird\nevolves into Soarling."} tabIndex={0} aria-label="Rarity is revealed when your bird evolves into Soarling."><img src={asset("hatch-lock-icon.png")} alt="" /></span>{hatchResult.bird.rarityAssigned ? rarityNames[hatchResult.bird.rarity] ?? "Assigned" : "???"}</dd></div>
          </dl>
          <p className="hatch-complete-tip"><strong>10</strong> daily check-ins to evolve into a Fledgling</p>
          <button className="figma-button hatch-complete-action" type="button" onClick={completeHatch}>
            <img src={asset("button.png")} alt="" /><span>Check In Day 1</span>
          </button>
          <a className="evolution-transaction-link" href={`https://testnet.arcscan.app/tx/${hatchResult.transactionHash}`} target="_blank" rel="noreferrer">View Transaction</a>
        </section>
      </div>, document.body)}

      {portalReady && evolutionResult && createPortal(<div
        className="wallet-modal-layer hatch-complete-layer is-open"
        aria-hidden="false"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) completeEvolution();
        }}
      >
        <section
          className={`hatch-complete-modal evolution-complete-modal land-${landClassNames[evolutionResult.land] ?? "wizard"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="evolution-complete-title"
        >
          <img className="hatch-complete-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button ref={hatchCompleteCloseRef} className="hatch-complete-close" type="button" aria-label="Close evolution result" onClick={completeEvolution}>
            <img src={asset("claim-close.svg")} alt="" />
          </button>
          <header className="hatch-complete-heading">
            <h2 id="evolution-complete-title">Your Bird Has Evolved!</h2>
            <p>Congratulations, your bird is now a Fledgling.</p>
          </header>
          <div className="hatch-complete-artwork">
            <img
              src={asset(landEvolutionPopupAssets[evolutionResult.land] ?? "evolution-popup-wizard.png")}
              alt={`${landNames[evolutionResult.land]} Fledgling bird on its island`}
            />
            <span className="hatch-land-badge">
              <img src={asset(landRevealIcons[evolutionResult.land] ?? "hatch-land-wizard.png")} alt="" />
              {landBadgeNames[evolutionResult.land] ?? "Land Wizard"}
            </span>
          </div>
          <dl className="hatch-complete-details">
            <div><dt>Bird ID</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Your bird's unique number.\nIt stays the same forever."} tabIndex={0} aria-label="Your bird's unique number. It stays the same forever."><img src={asset("hatch-token-icon.png")} alt="" /></span>#{evolutionResult.tokenId.toString()}</dd></div>
            <div><dt>Stage</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Your bird's growth stage:\nHatchling → Fledgling → Soarling."} tabIndex={0} aria-label="Your bird's growth stage: Hatchling, Fledgling, then Soarling."><img src={asset("hatch-stage-icon.png")} alt="" /></span>Fledgling</dd></div>
            <div><dt>Rarity</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Revealed when your bird\nevolves into Soarling."} tabIndex={0} aria-label="Rarity is revealed when your bird evolves into Soarling."><img src={asset("hatch-lock-icon.png")} alt="" /></span>{evolutionResult.rarityAssigned ? rarityNames[evolutionResult.rarity] ?? "Assigned" : "???"}</dd></div>
          </dl>
          <p className="hatch-complete-tip"><strong>10</strong> daily check-ins to evolve into a <strong>Soarling</strong> and reveal <strong>Rarity</strong></p>
          <button className="figma-button hatch-complete-action" type="button" onClick={completeEvolution}>
            <img src={asset("button.png")} alt="" /><span>Continue</span>
          </button>
          {evolutionTransactionHash && <a className="evolution-transaction-link" href={`https://testnet.arcscan.app/tx/${evolutionTransactionHash}`} target="_blank" rel="noreferrer">View Transaction</a>}
        </section>
      </div>, document.body)}

      {portalReady && soarlingResult && createPortal(<div
        className="wallet-modal-layer hatch-complete-layer is-open"
        aria-hidden="false"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) completeSoarlingEvolution();
        }}
      >
        <section
          className={`hatch-complete-modal evolution-complete-modal land-${landClassNames[soarlingResult.land] ?? "wizard"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="soarling-complete-title"
        >
          <img className="hatch-complete-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button ref={hatchCompleteCloseRef} className="hatch-complete-close" type="button" aria-label="Close Soarling result" onClick={completeSoarlingEvolution}>
            <img src={asset("claim-close.svg")} alt="" />
          </button>
          <header className="hatch-complete-heading">
            <h2 id="soarling-complete-title">Your Bird Has Evolved!</h2>
            <p>Congratulations, your bird is now a Soarling.</p>
          </header>
          <div className={`hatch-complete-artwork soarling-result-artwork${soarlingResult.rarity === 2 ? " has-epic-magic" : soarlingResult.rarity === 3 ? " has-legendary-magic" : soarlingResult.rarity === 4 ? " has-mythic-magic" : ""}`}>
            <span className="soarling-artwork-glow" aria-hidden="true" />
            {soarlingResult.rarity === 4 && soarlingResult.land === 0 && <span className="mythic-forest-leaves" aria-hidden="true">
              <img className="mythic-forest-leaf mythic-forest-leaf-left" src={asset("soarling-mythic-forest-leaf-left.png")} alt="" />
              <img className="mythic-forest-leaf mythic-forest-leaf-right" src={asset("soarling-mythic-forest-leaf-right.png")} alt="" />
            </span>}
            {soarlingResult.rarity === 4 && soarlingResult.land === 1 && <span className="mythic-wind-feathers" aria-hidden="true">
              <img className="mythic-wind-feather mythic-wind-feather-left" src={asset("soarling-mythic-wind-feather-left.png")} alt="" />
              <img className="mythic-wind-feather mythic-wind-feather-right" src={asset("soarling-mythic-wind-feather-right.png")} alt="" />
            </span>}
            {soarlingResult.rarity === 4 && <span className="mythic-magic-dots" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></span>}
            {soarlingResult.rarity === 2 && <>
              <span className="epic-magic-feathers" aria-hidden="true">
                <img className="epic-magic-feather epic-magic-feather-left" src={asset(landEpicDetailAssets[soarlingResult.land]?.[0] ?? landEpicDetailAssets[0][0])} alt="" />
                <img className="epic-magic-feather epic-magic-feather-right" src={asset(landEpicDetailAssets[soarlingResult.land]?.[1] ?? landEpicDetailAssets[0][1])} alt="" />
              </span>
              <span className="epic-magic-dots" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
            </>}
            {soarlingResult.rarity === 3 && <>
              <span className="legendary-magic-items" aria-hidden="true">
                <img className="legendary-magic-item legendary-magic-item-left" src={asset(landLegendaryDetailAssets[soarlingResult.land]?.[0] ?? landLegendaryDetailAssets[0][0])} alt="" />
                <img className="legendary-magic-item legendary-magic-item-right" src={asset(landLegendaryDetailAssets[soarlingResult.land]?.[1] ?? landLegendaryDetailAssets[0][1])} alt="" />
              </span>
              <span className="legendary-magic-dots" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
            </>}
            <span className="soarling-artwork-sparks" aria-hidden="true">
              {[0, 1, 2].map((particle) => (
                <img
                  key={particle}
                  src={asset(landSoarlingParticleAssets[soarlingResult.land] ?? "land-particle-wizard.png")}
                  alt=""
                />
              ))}
            </span>
            <img
              className="soarling-result-image"
              src={asset(getSoarlingResultAsset(soarlingResult))}
              alt={`${landNames[soarlingResult.land]} Soarling bird on its island`}
            />
            <span className="hatch-land-badge">
              <img src={asset(landRevealIcons[soarlingResult.land] ?? "hatch-land-wizard.png")} alt="" />
              {landBadgeNames[soarlingResult.land] ?? "Land Wizard"}
            </span>
          </div>
          <dl className="hatch-complete-details">
            <div><dt>Bird ID</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Your bird's unique number.\nIt stays the same forever."} tabIndex={0} aria-label="Your bird's unique number. It stays the same forever."><img src={asset("hatch-token-icon.png")} alt="" /></span>#{soarlingResult.tokenId.toString()}</dd></div>
            <div><dt>Stage</dt><dd><span className="hatch-detail-tooltip" data-tooltip={"Your bird's growth stage:\nHatchling → Fledgling → Soarling."} tabIndex={0} aria-label="Your bird's growth stage: Hatchling, Fledgling, then Soarling."><img src={asset("hatch-stage-icon.png")} alt="" /></span>Soarling</dd></div>
            <div><dt>Rarity</dt><dd><span className="hatch-detail-tooltip" data-tooltip="Your bird's final rarity." tabIndex={0} aria-label="Your bird's final rarity."><img className="soarling-rarity-star" src={asset(rarityStarAssets[soarlingResult.rarity] ?? "rarity-common-star.png")} alt="" /></span><span className={`soarling-rarity-value rarity-${rarityNames[soarlingResult.rarity]?.toLowerCase() ?? "common"}`}>{rarityNames[soarlingResult.rarity] ?? "Common"}</span></dd></div>
          </dl>
          <p className="hatch-complete-tip">Your journey is complete. PvP &amp; PvE arrive in Q2.</p>
          <button className="figma-button hatch-complete-action" type="button" onClick={completeSoarlingEvolution}>
            <img src={asset("button.png")} alt="" /><span>View Roadmap</span>
          </button>
          {soarlingTransactionHash && <a className="evolution-transaction-link" href={`https://testnet.arcscan.app/tx/${soarlingTransactionHash}`} target="_blank" rel="noreferrer">View Transaction</a>}
        </section>
      </div>, document.body)}

    </>
  );
}
