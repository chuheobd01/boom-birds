"use client";

/* eslint-disable @next/next/no-img-element -- exact Figma exports use native image crops */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createThirdwebClient, defineChain, eth_estimateGas, eth_gasPrice, eth_getBlockByNumber, getContract, getContractEvents, getRpcClient, prepareContractCall, prepareEvent, readContract, sendTransaction, waitForReceipt } from "thirdweb";
import { AutoConnect, useActiveAccount, useActiveWallet, useConnect, useDisconnect, useIsAutoConnecting } from "thirdweb/react";
import { getUserEmail } from "thirdweb/wallets/in-app";
import { createWallet, getWalletBalance, inAppWallet } from "thirdweb/wallets";
import { decodeEventLog, encodeFunctionData, isAddress } from "viem";

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
type FundsPhase = "idle" | "signing" | "sending" | "updating";
type FundsErrorKind = "" | "cancelled" | "cooldown" | "empty" | "timeout" | "error";
type HatchPhase = "idle" | "charge" | "shake" | "reveal";
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
  lastCheckInAtMs: number | null;
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
const ARC_CHAIN_ID_HEX = "0x4cef52";
const ARC_NETWORK_PARAMS = {
  chainId: ARC_CHAIN_ID_HEX,
  chainName: "ARC Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};
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
const landIslandAssets = ["land-forest.png", "land-wind.png", "land-wizard.png", "land-artist.png", "land-king.png"] as const;
const landHatchlingAssets = ["hatchling-forest.png", "hatchling-wind.png", "hatchling-wizard.png", "hatchling-artist.png", "hatchling-king.png"] as const;
const landHatchPopupAssets = ["hatch-popup-forest.png", "hatch-popup-wind.png", "hatch-popup-wizard.png", "hatch-popup-artist.png", "hatch-popup-king.png"] as const;
const landEvolutionPopupAssets = ["evolution-popup-forest.png", "evolution-popup-wind.png", "evolution-popup-wizard.png", "evolution-popup-artist.png", "evolution-popup-king.png"] as const;
const landSoarlingResultAssets = ["soarling-result-forest.png", "soarling-result-wind.png", "soarling-result-wizard.png", "soarling-result-artist.png", "soarling-result-king.png"] as const;
const landCommonSoarlingResultAssets = ["soarling-common-forest.png", "soarling-common-wind.png", "soarling-common-wizard.png", "soarling-common-artist.png", "soarling-common-king.png"] as const;
const landRareSoarlingResultAssets = ["soarling-rare-forest.png", "soarling-rare-wind.png", "soarling-rare-wizard.png", "soarling-rare-artist.png", "soarling-rare-king.png"] as const;
const landEpicSoarlingResultAssets = ["soarling-epic-forest.png", "soarling-epic-wind.png", "soarling-epic-wizard.png", "soarling-epic-artist.png", "soarling-epic-king.png"] as const;
const landLegendarySoarlingResultAssets = ["soarling-legendary-forest.png", "soarling-legendary-wind.png", "soarling-legendary-wizard-v2.png", "soarling-legendary-artist.png", "soarling-legendary-king.png"] as const;
const landMythicSoarlingResultAssets = ["soarling-mythic-forest.png", "soarling-mythic-wind.png", "soarling-mythic-wizard.png", "soarling-mythic-artist.png", "soarling-mythic-king.png"] as const;
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
const FALLBACK_MINT_FEE_USDC = 0.01;
const MINT_FEE_BUFFER = 1.25;
const HATCH_CHARGE_MIN_MS = 2_200;
const HATCH_SHAKE_MS = 1_400;
const HATCH_REVEAL_MS = 1_400;
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

const prepareBirdArtwork = async (bird: OwnedBird) => {
  await decodeImage(
    bird.image || asset(landHatchlingAssets[bird.land] ?? "hatchling-wizard.png"),
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

const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
const formatUsdcBalance = (value: string | number) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
};
const formatCooldown = (retryAt: string) => {
  const minutes = Math.max(1, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  const [toast, setToast] = useState("");
  const [fundsModalOpen, setFundsModalOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
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
  const [postHatchOwnedAddress, setPostHatchOwnedAddress] = useState("");
  const [walletAlreadyMinted, setWalletAlreadyMinted] = useState(false);
  const [ownedBird, setOwnedBird] = useState<OwnedBird | null>(null);
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const [networkFee, setNetworkFee] = useState("Estimating...");
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
  const networkFeeRequestRef = useRef(false);
  const fundsDismissedDuringSendRef = useRef(false);
  const networkWasWrongRef = useRef(false);
  const networkDialogRef = useRef<NetworkDialog>(null);
  const showNetworkDialog = useCallback((dialog: Exclude<NetworkDialog, null>) => {
    networkDialogRef.current = dialog;
    setLastNetworkDialog(dialog);
    setNetworkDialog(dialog);
  }, []);
  const hideNetworkDialog = useCallback(() => {
    networkDialogRef.current = null;
    setNetworkDialog(null);
  }, []);
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
  const readLastCheckInAt = useCallback(async (tokenId: bigint) => {
    if (!eggoriaContract || !thirdwebClient) return null;
    const storageKey = `eggoria-last-check-in:${eggoriaBirdsAddress.toLowerCase()}:${tokenId}`;
    const cachedTimestamp = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(cachedTimestamp) && cachedTimestamp > 0) return cachedTimestamp;

    try {
      const checkInEvent = prepareEvent({
        signature: "event BirdCheckedIn(uint256 indexed tokenId, uint8 checkIns, uint64 day)",
        filters: { tokenId },
      });
      const events = await getContractEvents({
        contract: eggoriaContract,
        events: [checkInEvent],
        fromBlock: BigInt(0),
        toBlock: "latest",
        useIndexer: false,
      });
      const latestEvent = events.at(-1);
      if (!latestEvent?.blockNumber) return null;
      const block = await eth_getBlockByNumber(getRpcClient({ client: thirdwebClient, chain: ARC_TESTNET }), {
        blockNumber: latestEvent.blockNumber,
      });
      const timestamp = Number(block.timestamp) * 1_000;
      window.localStorage.setItem(storageKey, String(timestamp));
      return timestamp;
    } catch {
      return null;
    }
  }, [eggoriaBirdsAddress, eggoriaContract, thirdwebClient]);
  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();
  const isMetaMaskWallet = walletKind === "metamask" || activeWallet?.id === "io.metamask";
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
    const timeout = window.setTimeout(() => setToast(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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
    if (!walletModalOpen && !networkDialog && !fundsModalOpen && !claimModalOpen && !evolutionCheckInOpen && !hatchResult && !evolutionResult && !soarlingResult) return;
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
        hideNetworkDialog();
        setWalletModalOpen(false);
        closeFundsModal();
        setClaimModalOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [claimModalOpen, checkInSubmitting, closeFundsModal, completeEvolution, completeHatch, completeSoarlingEvolution, evolutionCheckInOpen, evolutionResult, fundsModalOpen, hatchResult, hideNetworkDialog, networkDialog, soarlingResult, walletModalOpen]);

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
    if (!provider) return null;
    const chainId = await provider.request({ method: "eth_chainId" });
    return Number(chainId) === ARC_TESTNET.id;
  }, [getMetaMaskProvider]);

  const requireArcNetwork = useCallback(async () => {
    if (!isMetaMaskWallet) return true;
    try {
      if (await checkArcNetwork() === true) return true;
    } catch {
      // Treat an unreadable chain as unsafe until the wallet is checked again.
    }
    setNetworkFeedback("");
    setFundsModalOpen(false);
    setClaimModalOpen(false);
    showNetworkDialog("switch");
    return false;
  }, [checkArcNetwork, isMetaMaskWallet, showNetworkDialog]);

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
      if (networkDialog === "add") {
        await provider.request({ method: "wallet_addEthereumChain", params: [ARC_NETWORK_PARAMS] });
      }
      if (!await checkArcNetwork()) {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
      }
      if (!await checkArcNetwork()) throw new Error("ARC Testnet is not active yet.");
      hideNetworkDialog();
      setToast("You're on ARC Testnet.");
    } catch (error) {
      if (networkDialog === "switch" && readProviderErrorCode(error) === 4902) {
        showNetworkDialog("add");
      } else {
        const code = readProviderErrorCode(error);
        setNetworkFeedback(code === 4001 || code === -32002 ? "" : "error");
      }
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
  const eggoriaStateLoading = Boolean(walletAddress) && eggoriaStateAddress !== normalizedWalletAddress;
  const balanceStateLoading = Boolean(walletAddress) && balanceStateAddress !== normalizedWalletAddress;
  const walletViewLoading = isAutoConnecting || eggoriaStateLoading || (!ownedBird && balanceStateLoading);
  const activeGuideStep = !walletAddress || walletViewLoading ? "" : ownedBird ? "check-in" : hasTestFunds ? "mint" : "funds";

  useEffect(() => {
    if (!walletAddress || !isMetaMaskWallet) {
      networkWasWrongRef.current = false;
      Promise.resolve().then(() => {
        hideNetworkDialog();
      });
      return;
    }
    const provider = getMetaMaskProvider();
    if (!provider) return;
    let active = true;
    const updateNetwork = async () => {
      try {
        const ready = await checkArcNetwork();
        if (!active || ready === null) return;
        if (!ready) {
          networkWasWrongRef.current = true;
          setFundsModalOpen(false);
          setClaimModalOpen(false);
          setNetworkFeedback("");
          if (!networkDialogRef.current) showNetworkDialog("switch");
        } else {
          hideNetworkDialog();
          if (networkWasWrongRef.current) setToast("You're on ARC Testnet.");
          networkWasWrongRef.current = false;
        }
      } catch {
        // The next action rechecks the network directly from MetaMask.
      }
    };
    void updateNetwork();
    const onChainChanged = () => { void updateNetwork(); };
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      active = false;
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [checkArcNetwork, getMetaMaskProvider, hideNetworkDialog, isMetaMaskWallet, showNetworkDialog, walletAddress]);

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

    const lastCheckInAtMs = lastCheckInDay > BigInt(0) ? await readLastCheckInAt(tokenId) : null;
    let image = "";
    if (landAssigned) {
      try {
        const tokenUri = await readContract({ contract: eggoriaContract, method: "tokenURI", params: [tokenId] });
        image = await readNftImage(tokenUri);
      } catch {
        // The owner view remains available while an IPFS gateway is unavailable.
      }
    }

    return { tokenId, owner, land, landAssigned, stage, rarity, rarityAssigned, checkIns, lastCheckInDay, lastCheckInAtMs, image };
  }, [eggoriaContract, readLastCheckInAt]);

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
    let active = true;
    const requestedAddress = walletAddress.toLowerCase();

    readEggoriaState(walletAddress)
      .then((state) => {
        if (!active) return;
        setMinted(state.totalSupply);
        setWalletAlreadyMinted(state.alreadyMinted);
        setOwnedBird(state.bird);
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
  }, [readEggoriaState, walletAddress]);

  useEffect(() => {
    if (!walletAddress || ownedBird?.landAssigned !== false) return;

    const interval = window.setInterval(() => {
      refreshEggoriaState(walletAddress).catch(() => undefined);
    }, 4_000);

    return () => window.clearInterval(interval);
  }, [ownedBird?.landAssigned, refreshEggoriaState, walletAddress]);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTimeMs(Date.now()), 30_000);
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

    Promise.all([
      eth_estimateGas(rpcRequest, {
        from: walletAddress as `0x${string}`,
        to: eggoriaBirdsAddress as `0x${string}`,
        data: mintData,
      }),
      eth_gasPrice(rpcRequest),
    ])
      .then(([gasLimit, gasPrice]) => Number(gasLimit * gasPrice) / 1e18 * MINT_FEE_BUFFER)
      .then((bufferedMintFee) => {
        if (active) setRequiredMintBalance(Math.max(bufferedMintFee, Number.EPSILON));
      })
      .catch(() => {
        if (active) setRequiredMintBalance(FALLBACK_MINT_FEE_USDC);
      });

    return () => { active = false; };
  }, [eggoriaBirdsAddress, thirdwebClient, walletAddress]);

  useEffect(() => {
    if (!claimModalOpen || claimSubmitting || !walletAddress || !isAddress(eggoriaBirdsAddress)) return;
    let active = true;

    const updateNetworkFee = async () => {
      if (networkFeeRequestRef.current) return;
      networkFeeRequestRef.current = true;
      const provider = getMetaMaskProvider();
      if (!provider) {
        if (active && !lastNetworkFeeRef.current) setNetworkFee("Unavailable");
        networkFeeRequestRef.current = false;
        return;
      }

      try {
        const chainId = await provider.request({ method: "eth_chainId" });
        if (chainId !== "0x4cef52") throw new Error("MetaMask is not connected to ARC Testnet");

        const data = encodeFunctionData({ abi: eggoriaBirdsAbi, functionName: "mint", args: [] });
        const transaction = { from: walletAddress, to: eggoriaBirdsAddress, data };
        const [gasLimitResult, gasPriceResult] = await Promise.all([
          provider.request({ method: "eth_estimateGas", params: [transaction] }),
          provider.request({ method: "eth_gasPrice" }),
        ]);
        if (typeof gasLimitResult !== "string" || typeof gasPriceResult !== "string") {
          throw new Error("MetaMask fee estimate is unavailable");
        }

        const fee = Number(BigInt(gasLimitResult) * BigInt(gasPriceResult)) / 1e18;
        const formattedFee = fee < 0.0001
          ? fee.toFixed(6)
          : fee < 0.01
            ? fee.toFixed(4)
            : fee.toFixed(2);
        lastNetworkFeeRef.current = formattedFee;
        if (active) setNetworkFee(formattedFee);
      } catch {
        // MetaMask can temporarily reject parallel RPC requests while its
        // transaction confirmation window is open. Keep the last valid live
        // estimate instead of replacing it with a misleading error state.
        if (active && !lastNetworkFeeRef.current) setNetworkFee("Unavailable");
      } finally {
        networkFeeRequestRef.current = false;
      }
    };

    void updateNetworkFee();
    const interval = window.setInterval(updateNetworkFee, 3_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [claimModalOpen, claimSubmitting, eggoriaBirdsAddress, getMetaMaskProvider, walletAddress]);

  useEffect(() => {
    if (!evolutionCheckInOpen || !ownedBird || !walletAddress || !thirdwebClient || !isAddress(eggoriaBirdsAddress)) return;
    let active = true;

    const rpcRequest = getRpcClient({ client: thirdwebClient, chain: ARC_TESTNET });
    const data = encodeFunctionData({
      abi: eggoriaBirdsAbi,
      functionName: "checkIn",
      args: [ownedBird.tokenId],
    });

    Promise.all([
      eth_estimateGas(rpcRequest, {
        from: walletAddress as `0x${string}`,
        to: eggoriaBirdsAddress as `0x${string}`,
        data,
      }),
      eth_gasPrice(rpcRequest),
    ])
      .then(([gasLimit, gasPrice]) => Number(gasLimit * gasPrice) / 1e18)
      .then((fee) => {
        if (!active) return;
        setEvolutionNetworkFee(fee < 0.0001 ? fee.toFixed(6) : fee < 0.01 ? fee.toFixed(4) : fee.toFixed(2));
      })
      .catch(() => {
        if (active) setEvolutionNetworkFee("Unavailable");
      });

    return () => { active = false; };
  }, [eggoriaBirdsAddress, evolutionCheckInOpen, ownedBird, thirdwebClient, walletAddress]);
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

  const handleHeroAction = async () => {
    if (!walletAddress) {
      openWallet();
      return;
    }
    if (!await requireArcNetwork()) return;
    let readyToMint = hasTestFunds;
    if (!readyToMint && thirdwebClient) {
      try {
        const balance = await getWalletBalance({ client: thirdwebClient, chain: ARC_TESTNET, address: walletAddress });
        const freshBalance = Number(balance.displayValue);
        if (Number.isFinite(freshBalance)) {
          setArcBalance(freshBalance.toFixed(6));
          readyToMint = freshBalance >= requiredMintBalance;
        }
      } catch {
        // Keep the last known balance when the read-only RPC is temporarily unavailable.
      }
    }
    if (readyToMint) {
      if (!hasTestFunds) setToast("You already have test USDC. Ready to mint!");
      setClaimError(
        minted >= EGGORIA_MAX_SUPPLY
          ? "All available eggs have already been claimed."
          : walletAlreadyMinted
            ? "You have already claimed your Egg."
            : "",
      );
      lastNetworkFeeRef.current = "";
      setNetworkFee("Estimating...");
      setClaimModalOpen(true);
      return;
    }
    setFundsGuideOpen(false);
    setFundsError("");
    setFundsErrorKind("");
    setFundsPhase("idle");
    setFundsSuccess(null);
    setFundsModalOpen(true);
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
      if (!await requireArcNetwork()) return;
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
          setFundsErrorKind("cooldown");
          throw new Error(`You can claim again in ${formatCooldown(result.retryAt)}.`);
        }
        if (/faucet does not have enough/i.test(String(result.message))) {
          setFundsErrorKind("empty");
          throw new Error("The faucet is empty right now. Try again later, or ask us on Discord.");
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
    if (claimSubmitting || hatchPhase !== "idle") return;
    if (!activeAccount || !walletAddress) {
      setClaimError("Connect your wallet before minting.");
      return;
    }
    if (!eggoriaContract) {
      setClaimError("Eggoria Birds contract is not configured.");
      return;
    }
    setClaimSubmitting(true);
    setClaimError("");
    setPostHatchOwnedAddress("");
    let confirmedOnChain = false;
    try {
      const contractState = await refreshEggoriaState(walletAddress);
      if (contractState.totalSupply >= EGGORIA_MAX_SUPPLY) {
        setClaimError("All available eggs have already been claimed.");
        return;
      }
      if (contractState.alreadyMinted) {
        setClaimError("You have already claimed your Egg.");
        return;
      }

      if (!await requireArcNetwork()) return;

      const transaction = prepareContractCall({
        contract: eggoriaContract,
        method: "mint",
        params: [],
      });
      const transactionResult = await sendTransaction({ transaction, account: activeAccount });
      // The random land is not known yet, so warm all five Primary images while
      // the receipt and oracle assignment are still being confirmed.
      void preloadPotentialHatchArtwork();
      const receipt = await waitForReceipt(transactionResult);
      if (receipt.status !== "success") throw new Error("The mint transaction was reverted on-chain.");
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
        setOwnedBird(mintedBird);
        setHatchingBird(null);
        setHatchPhase("idle");
        setNotice("Your Egg is confirmed. Its land is still being assigned on-chain.");
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
      setHatchResult({ bird: mintedBird, address: walletAddress.toLowerCase(), transactionHash: transactionResult.transactionHash });
    } catch (error) {
      let message = readMintError(error);
      try {
        const state = await refreshEggoriaState(walletAddress);
        if (state.totalSupply >= EGGORIA_MAX_SUPPLY) {
          message = "All available eggs have already been claimed.";
        } else if (state.alreadyMinted) {
          message = "You have already claimed your Egg.";
        }
      } catch {
        // Preserve the transaction error when the follow-up contract read is unavailable.
      }
      if (confirmedOnChain) {
        setClaimModalOpen(false);
        setNotice("Your Egg was confirmed on-chain. Refreshing its metadata now.");
        refreshEggoriaState(walletAddress).catch(() => undefined);
      } else {
        setClaimError(message);
        setClaimModalOpen(true);
      }
      setHatchingBird(null);
      setHatchPhase("idle");
    } finally {
      setClaimSubmitting(false);
    }
  };

  const checkInBird = async () => {
    if (!activeAccount || !eggoriaContract || !ownedBird || checkInSubmitting || checkInLocked) return false;
    if (!ownedBird.landAssigned) {
      setCheckInError("Your land is still being assigned.");
      return false;
    }

    setCheckInSubmitting(true);
    setCheckInError("");
    const stageBeforeCheckIn = ownedBird.stage;
    try {
      const transaction = prepareContractCall({
        contract: eggoriaContract,
        method: "checkIn",
        params: [ownedBird.tokenId],
      });
      const result = await sendTransaction({ transaction, account: activeAccount });
      const receipt = await waitForReceipt(result);
      if (thirdwebClient) {
        try {
          const block = await eth_getBlockByNumber(getRpcClient({ client: thirdwebClient, chain: ARC_TESTNET }), {
            blockNumber: receipt.blockNumber,
          });
          const storageKey = `eggoria-last-check-in:${eggoriaBirdsAddress.toLowerCase()}:${ownedBird.tokenId}`;
          window.localStorage.setItem(storageKey, String(Number(block.timestamp) * 1_000));
        } catch {
          // lastCheckInDay still keeps the button disabled if timestamp lookup is unavailable.
        }
      }
      const refreshedState = await readEggoriaState(walletAddress);
      setMinted(refreshedState.totalSupply);
      setWalletAlreadyMinted(refreshedState.alreadyMinted);
      const evolvedBird = refreshedState.bird;
      if (stageBeforeCheckIn === 0 && evolvedBird?.stage === 1) {
        const popupArtwork = asset(landEvolutionPopupAssets[evolvedBird.land] ?? "evolution-popup-wizard.png");
        const heroArtwork = evolvedBird.image || asset(landHatchlingAssets[evolvedBird.land] ?? "hatchling-wizard.png");
        await Promise.all([decodeImage(heroArtwork), decodeImage(popupArtwork)]);
        setEvolutionTransactionHash(result.transactionHash);
        setEvolutionResult(evolvedBird);
      } else if (stageBeforeCheckIn === 1 && evolvedBird?.stage === 2) {
        const popupArtwork = asset(getSoarlingResultAsset(evolvedBird));
        const heroArtwork = evolvedBird.image || popupArtwork;
        await Promise.all([decodeImage(heroArtwork), decodeImage(popupArtwork)]);
        setSoarlingTransactionHash(result.transactionHash);
        setSoarlingResult(evolvedBird);
      } else {
        setOwnedBird(evolvedBird);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      setCheckInError(
        message.includes("alreadycheckedintoday") || message.includes("already checked")
          ? "You have already checked in today. Come back tomorrow."
          : "Check-in could not be completed. Please try again.",
      );
      return false;
    } finally {
      setCheckInSubmitting(false);
    }
  };

  const handleCheckInClick = () => {
    const isFledglingCheckpoint = ownedBird?.stage === 0 && ownedBird.checkIns === 9;
    const isSoarlingCheckpoint = ownedBird?.stage === 1 && ownedBird.checkIns === 19;
    if (isFledglingCheckpoint || isSoarlingCheckpoint) {
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
  const currentUtcDay = BigInt(Math.floor(currentTimeMs / MILLISECONDS_PER_DAY));
  const checkedInToday = Boolean(ownedBird && ownedBird.lastCheckInDay > BigInt(0) && ownedBird.lastCheckInDay === currentUtcDay);
  const nextCheckInAtMs = ownedBird?.lastCheckInAtMs ? ownedBird.lastCheckInAtMs + MILLISECONDS_PER_DAY : null;
  const checkInLocked = checkedInToday || Boolean(nextCheckInAtMs && currentTimeMs < nextCheckInAtMs);
  const nextCheckInTime = nextCheckInAtMs
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(nextCheckInAtMs))
    : "the same time";
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
  // Every assigned-stage metadata image is a complete bird + island composition.
  // Render Soarlings through the same full-size path as Fledglings so the metadata
  // artwork is not shrunk into the standalone-bird slot or layered over a second island.
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
            <div className="wallet-menu-row"><span><img src={asset("claim-network.png")} alt="" />Network</span><strong>{ARC_TESTNET.name}</strong></div>
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

      <section className={`hero-new${isHatching ? " is-hatching" : ""}${postHatchOwned ? " is-post-hatch" : ""}`} id="home">
        <div className="hero-copy" data-node-id="316:52">
          <h1>Hatch Your<br />Own Bird</h1>
          <p>Mint a mysterious Egg for free, hatch your Bird,<br />and help it evolve through daily check-ins.</p>
          <div className={`mint-progress${statsLoading ? " is-loading" : ""}`} aria-busy={statsLoading}>
            <img className="progress-frame" src={asset("progress-frame.png")} alt="" />
            <div className="progress-content">
              <span className="mint-count">{statsLoading ? <span className="mint-count-skeleton" aria-label="Loading mint count" /> : `${count} / ${EGGORIA_MAX_SUPPLY} Eggs Minted`}</span>
              <span className="progress-track">{statsLoading ? <span className="progress-skeleton" /> : <><i style={{ width: `${progress}%` }} /><b style={{ left: `${progress}%` }} /></>}</span>
            </div>
          </div>
          {walletViewLoading ? <div className="hero-wallet-state-loading" aria-label="Loading your Eggoria progress" aria-busy="true" /> : ownedBird ? <div className="bird-owner-wrap">
            <section className={`bird-evolution-card land-${ownedLandClass}`} aria-label={`Evolution progress for Eggoria Bird #${ownedBird.tokenId}`}>
              <img className="bird-evolution-frame" src={asset("checkin-frame.png")} alt="" />
              <div className="bird-evolution-content">
                <div className="bird-stage-heading">
                  <div><strong>{ownedBird.landAssigned ? currentStage : "Mystery Egg"}</strong><span>Current Stage</span></div>
                  <div><strong>{ownedBird.landAssigned ? nextStage : "Land reveal"}</strong><span>Next Stage</span></div>
                </div>
                <div className="bird-checkin-track" aria-label={`${stageProgress} of 10 check-ins completed in this stage`}>
                  {Array.from({ length: 10 }, (_, index) => <span className={`bird-checkin-step${index === 0 ? " is-first" : ""}`} key={index}>
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
              className="figma-button hero-connect bird-checkin-button"
              type="button"
              onClick={handleCheckInClick}
              disabled={checkInSubmitting || checkInLocked || !ownedBird.landAssigned || ownedBird.stage >= 2}
            >
              <img src={asset("button.png")} alt="" />
              <span>{checkInSubmitting ? "Checking In..." : !ownedBird.landAssigned ? "Assigning Land..." : ownedBird.stage >= 2 ? "Evolution Complete" : "Check In"}</span>
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
              <p>Check in once each day. Your bird evolves after every 10 successful check-ins.</p>
            </aside>
            <p key={`checkin-helper-${ownedBird.tokenId}`} className="login-note bird-checkin-helper hero-state-helper">
              <span className="funds-note-content">
                <span>{ownedBird.landAssigned
                  ? checkInLocked
                    ? `Come back at ${nextCheckInTime} tomorrow.`
                    : `Come back daily to help your ${landNames[ownedBird.land] ?? "Eggoria"} bird evolve.`
                  : "Your bird will appear as soon as randomness is fulfilled."}</span>
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
            {checkInError && <p className="bird-checkin-error" role="alert">{checkInError}</p>}
            {notice && <p className="connection-notice" role="status">{notice}</p>}
          </div> : <div className="hero-connect-wrap">
            <button className="figma-button hero-connect hero-mint-button" type="button" onClick={handleHeroAction} disabled={claimSubmitting || isHatching} aria-busy={claimSubmitting || isHatching}>
              <img src={asset("button.png")} alt="" /><span>{!walletAddress ? "Get Your Egg" : hasTestFunds ? "Mint Your Egg" : "Get Free Test Funds"}</span>
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
        <div className={`hero-art${walletViewLoading ? " is-state-loading" : ownedBird ? ` bird-owned land-${ownedLandClass}${ownedBird.stage === 2 ? " is-soarling" : ""}${ownedBird.stage === 2 && ownedBird.rarity === 3 ? " is-legendary" : ownedBird.stage === 2 && ownedBird.rarity === 4 ? " is-mythic" : ""}${postHatchOwned ? " is-post-hatch" : ""}` : isHatching ? ` is-hatching hatch-${hatchPhase} land-${hatchLandClass}${hatchRarityClass}` : ""}`} aria-label={!walletViewLoading && ownedBird?.landAssigned ? `${landNames[ownedBird.land]} bird on its island` : isHatching ? "Your Egg is hatching" : undefined} aria-hidden={!walletViewLoading && (ownedBird || isHatching) ? undefined : "true"}>
          <span className="egg-glow-new">
            <img src={asset("glow.svg")} alt="" />
          </span>
          {compositeBird?.stage === 2 && <>
            <span className="owned-soarling-sparks" aria-hidden="true"><i /><i /><i /></span>
          </>}
          {compositeBird?.stage === 2 && compositeBird.rarity === 2 && (
            <span className="owned-epic-land-details" aria-hidden="true">
              <img className="owned-epic-land-item owned-epic-land-item-left" src={asset(landEpicDetailAssets[compositeBird.land]?.[0] ?? landEpicDetailAssets[0][0])} alt="" />
              <img className="owned-epic-land-item owned-epic-land-item-right" src={asset(landEpicDetailAssets[compositeBird.land]?.[1] ?? landEpicDetailAssets[0][1])} alt="" />
              <i className="owned-epic-land-light owned-epic-land-light-left" />
              <i className="owned-epic-land-light owned-epic-land-light-right" />
            </span>
          )}
          {compositeBird?.stage === 2 && compositeBird.rarity === 3 && (
            <span className="owned-legendary-land-details" aria-hidden="true">
              <img className="owned-legendary-land-item owned-legendary-land-item-left" src={asset(landLegendaryDetailAssets[compositeBird.land]?.[0] ?? landLegendaryDetailAssets[0][0])} alt="" />
              <img className="owned-legendary-land-item owned-legendary-land-item-right" src={asset(landLegendaryDetailAssets[compositeBird.land]?.[1] ?? landLegendaryDetailAssets[0][1])} alt="" />
              <i className="owned-legendary-land-light owned-legendary-land-light-left" />
              <i className="owned-legendary-land-light owned-legendary-land-light-right" />
            </span>
          )}
          {compositeBird && <img
            key={`owned-composite-${compositeBird.tokenId}-${compositeBird.stage}-${compositeBird.rarity}`}
            className={`bird-land-composite${!ownedBird ? " is-hatch-reveal" : ""}`}
            src={compositeBird.image || asset(landHatchlingAssets[compositeBird.land] ?? "hatchling-wizard.png")}
            alt={`${landNames[compositeBird.land]} ${stageNames[compositeBird.stage] ?? "bird"} on its island`}
          />}
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
              {connectingProvider === "metamask" && <div className="wallet-feedback is-info" role="status"><p>{metaMaskWaitLong ? "Still there? Click the fox icon at the top of your browser." : "A window opened on the right. Approve it to connect."}</p></div>}
              {metaMaskInstalled && walletError.startsWith("metamask-") && <div className={`wallet-feedback${walletError === "metamask-closed" || walletError === "metamask-cancelled" || walletError === "metamask-pending" || walletError === "metamask-locked" ? " is-info" : ""}`} role="status">
                <p>{walletError === "metamask-closed" ? "You closed the MetaMask window." : walletError === "metamask-cancelled" ? "You declined in MetaMask." : walletError === "metamask-pending" ? "A MetaMask window is already open. Click the fox icon to find it." : walletError === "metamask-locked" ? "MetaMask is locked. Unlock it, then connect again." : "Something went wrong connecting to MetaMask."}
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
          if (event.target === event.currentTarget && !networkBusy) hideNetworkDialog();
        }}
      >
        <section className="funds-modal arc-network-modal" role="dialog" aria-modal="true" aria-labelledby="arc-network-title">
          <img className="funds-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="funds-modal-close" type="button" aria-label="Close ARC Testnet setup" onClick={hideNetworkDialog}>
            <img src={asset("wallet-close.svg")} alt="" />
          </button>
          <img className="arc-network-icon" src={asset("arc-testnet-icon.png")} alt="" />
          <div className="funds-modal-copy arc-network-copy">
            <h2 id="arc-network-title">{(networkDialog ?? lastNetworkDialog) === "add" ? "One Quick Setup" : "Wrong Network"}</h2>
            <p>{(networkDialog ?? lastNetworkDialog) === "add"
              ? "Eggoria runs on ARC Testnet, a free practice network. MetaMask will ask you to approve it."
              : "Your wallet is on another network. Switch to ARC Testnet to keep going."}</p>
          </div>
          {networkFeedback === "error" && <p className="arc-network-feedback is-error" role="alert">MetaMask couldn&apos;t {(networkDialog ?? lastNetworkDialog) === "add" ? "add" : "switch"} the network. Try again, or do it manually.</p>}
          <div className="funds-modal-actions arc-network-actions">
            <button className="funds-cancel" type="button" onClick={hideNetworkDialog} disabled={networkBusy}>Not Now</button>
            <button className="figma-button funds-confirm" type="button" onClick={requestArcNetwork} disabled={networkBusy} aria-busy={networkBusy}>
              <img src={asset("button.png")} alt="" /><span>{networkBusy ? "Waiting..." : networkFeedback === "error" ? "Try again" : (networkDialog ?? lastNetworkDialog) === "add" ? "Add Network" : "Switch Network"}</span>
            </button>
          </div>
        </section>
      </div>, document.body)}

      {portalReady && toast && createPortal(<div className="arc-flow-toast" role="status">{toast}</div>, document.body)}

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
            <div className="funds-modal-copy">
              <h2 id="funds-modal-title">Get Free Test USDC</h2>
              <p>You&apos;ll receive 1 test USDC. This is testnet<br />money, not real currency</p>
            </div>
            {fundsSending && <p className="funds-flow-feedback" role="status">{fundsPhase === "signing"
              ? "Check MetaMask to sign. Can't see it? Click the fox icon at the top of your browser."
              : fundsPhase === "updating"
                ? "Updating your balance..."
                : "Sending your test USDC. This usually takes a few seconds."}</p>}
            {fundsError && <p className={`funds-flow-feedback${fundsErrorKind === "cancelled" || fundsErrorKind === "cooldown" ? " is-neutral" : " is-error"}`} role={fundsErrorKind === "cancelled" || fundsErrorKind === "cooldown" ? "status" : "alert"}>{fundsError}</p>}
            <div className="funds-modal-actions">
              <button className="funds-cancel" type="button" onClick={closeFundsModal}>{fundsErrorKind === "cooldown" ? "Close" : "Cancel"}</button>
              {fundsErrorKind !== "cooldown" && <button className="figma-button funds-confirm" type="button" onClick={claimTestFunds} disabled={fundsSending} aria-busy={fundsSending}>
                <img src={asset("button.png")} alt="" /><span>{fundsSending ? fundsPhase === "signing" ? "Waiting..." : fundsPhase === "updating" ? "Updating..." : "Sending..." : fundsErrorKind === "empty" || fundsErrorKind === "timeout" || fundsErrorKind === "error" ? "Try again" : fundsErrorKind === "cancelled" ? "Get test USDC" : "Confirm"}</span>
              </button>}
            </div>
          </>}
        </section>
      </div>, document.body)}

      {portalReady && createPortal(<div
        className={`wallet-modal-layer${claimModalOpen ? " is-open" : ""}`}
        aria-hidden={!claimModalOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setClaimModalOpen(false);
        }}
      >
        <section className="claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-modal-title">
          <img className="claim-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="claim-modal-close" type="button" aria-label="Close egg claim" onClick={() => setClaimModalOpen(false)} disabled={claimSubmitting}>
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
              <div><dt><img src={asset("claim-network.png")} alt="" />Network</dt><dd>{ARC_TESTNET.name}</dd></div>
              <div><dt><img src={asset("claim-price.png")} alt="" />Mint price</dt><dd>Free</dd></div>
              <div><dt><img src={asset("claim-receive.png")} alt="" />You receive</dt><dd>1 Mystery Egg</dd></div>
              <div><dt><img src={asset("claim-network-fee.png")} alt="" />Network fee</dt><dd>{networkFee === "Unavailable" || networkFee === "Estimating..." ? networkFee : `~${networkFee} Test USDC`}</dd></div>
            </dl>
            <div className="claim-actions">
              <button className="funds-cancel claim-cancel" type="button" onClick={() => setClaimModalOpen(false)} disabled={claimSubmitting}>Close</button>
              <button className="figma-button claim-confirm" type="button" onClick={mintEgg} disabled={claimSubmitting}>
                <img src={asset("button.png")} alt="" /><span>{claimSubmitting && <i className="claim-button-spinner" aria-hidden="true" />}{claimSubmitting ? "Minting..." : "Confirm"}</span>
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
            <h2 id="evolution-checkin-title">{evolutionTargetStage === 2 ? "Ready To Evolve!" : "Evolution Check-In"}</h2>
            <p>{evolutionTargetStage === 2
              ? "One final check-in to become a Soarling and reveal Rarity"
              : "This check-in will evolve your Bird to Fledgling."}</p>
          </header>
          <div className="claim-panel evolution-checkin-panel">
            <dl className="claim-details evolution-checkin-details">
              <div><dt><img src={asset("claim-wallet.png")} alt="" />Wallet</dt><dd>{shortAddress(walletAddress)}</dd></div>
              <div><dt><img src={asset("claim-network.png")} alt="" />Network</dt><dd>{ARC_TESTNET.name}</dd></div>
              <div><dt><img src={asset("evolution-arrow.png")} alt="" />Evolves to</dt><dd>{evolutionTargetStage === 2 ? "Soarling" : "Fledgling"}</dd></div>
              <div><dt><img src={asset("evolution-bird.png")} alt="" />Bird</dt><dd>#{ownedBird.tokenId.toString()} - {landBadgeNames[ownedBird.land] ?? "Land Wizard"}</dd></div>
              <div><dt><img src={asset("claim-network-fee.png")} alt="" />Network fee</dt><dd>{evolutionNetworkFee === "Unavailable" || evolutionNetworkFee === "Estimating..." ? evolutionNetworkFee : `~${evolutionNetworkFee} Test USDC`}</dd></div>
            </dl>
            <div className="claim-actions evolution-checkin-actions">
              <button className="funds-cancel claim-cancel evolution-checkin-cancel" type="button" onClick={() => setEvolutionCheckInOpen(false)} disabled={checkInSubmitting}>Not Now</button>
              <button className="figma-button claim-confirm evolution-checkin-confirm" type="button" onClick={() => void confirmEvolutionCheckIn()} disabled={checkInSubmitting} aria-busy={checkInSubmitting}>
                <img src={asset("button.png")} alt="" />
                <span>{checkInSubmitting && <i className="claim-button-spinner" aria-hidden="true" />}{checkInSubmitting ? "Evolving..." : "Evolve Now"}</span>
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
