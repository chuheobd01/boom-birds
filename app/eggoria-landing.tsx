"use client";

/* eslint-disable @next/next/no-img-element -- exact Figma exports use native image crops */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createThirdwebClient, defineChain, getContract, readContract, sendTransaction, waitForReceipt } from "thirdweb";
import { claimTo } from "thirdweb/extensions/erc721";
import { AutoConnect, useActiveAccount, useActiveWallet, useConnect, useDisconnect } from "thirdweb/react";
import { createWallet, getWalletBalance, inAppWallet } from "thirdweb/wallets";

type EggoriaUser = { id: string; name: string; position: number };
type GoogleCredential = { credential: string };
type WalletKind = "google" | "metamask" | "";
type MintPhase = "submitting" | "confirming" | "success" | "error";
type EthereumProvider = {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
  request(options: { method: string; params?: unknown[] }): Promise<unknown>;
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
const EGGORIA_CONTRACT_ADDRESS = "0x0Dda12D074D42D0B0728fed721eE7548C8cAa501";
const ARC_TESTNET = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  rpc: "https://rpc.testnet.arc.network",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  blockExplorers: [{ name: "ArcScan", url: "https://testnet.arcscan.app" }],
  testnet: true,
});
const googleInAppWallet = inAppWallet({ auth: { mode: "popup", options: ["google"] } });
const metaMaskWallet = createWallet("io.metamask");
const supportedWallets = [googleInAppWallet, metaMaskWallet];
const navItems = [
  ["home", "Home"], ["how-it-works", "How It Works"], ["lands", "Lands"],
  ["rarity", "Rarity"], ["roadmap", "Roadmap"], ["faq", "FAQ"],
] as const;

const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
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
  if (message.includes("already") && (message.includes("claim") || message.includes("mint"))) {
    return "This wallet has already claimed its egg.";
  }
  if (message.includes("insufficient") || message.includes("funds")) {
    return "Not enough test USDC to cover the network fee.";
  }
  if (message.includes("claimcondition") || message.includes("no active claim") || message.includes("not started")) {
    return "Egg claiming is not available yet.";
  }
  if (message.includes("max supply") || message.includes("maxsupply") || message.includes("not enough minted")) {
    return "All available eggs have already been claimed.";
  }
  return "Your egg could not be minted. Please try again.";
};

export default function EggoriaLanding({ googleClientId, thirdwebClientId }: { googleClientId: string; thirdwebClientId: string }) {
  const [minted, setMinted] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [user, setUser] = useState<EggoriaUser | null>(null);
  const [notice, setNotice] = useState("");
  const [, setGoogleReady] = useState(false);
  const [activeNav, setActiveNav] = useState("home");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [fundsModalOpen, setFundsModalOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [mintingModalOpen, setMintingModalOpen] = useState(false);
  const [mintPhase, setMintPhase] = useState<MintPhase>("submitting");
  const [mintError, setMintError] = useState("");
  const [mintTransactionHash, setMintTransactionHash] = useState("");
  const [networkFee, setNetworkFee] = useState("Estimating...");
  const [walletKind, setWalletKind] = useState<WalletKind>("");
  const [fundsError, setFundsError] = useState("");
  const [fundsSending, setFundsSending] = useState(false);
  const [fundsSuccess, setFundsSuccess] = useState<{ amount: number; balance: string; address: string } | null>(null);
  const [mintReadyAddress, setMintReadyAddress] = useState("");
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [fundsGuideOpen, setFundsGuideOpen] = useState(false);
  const [arcBalance, setArcBalance] = useState("0.00");
  const [walletError, setWalletError] = useState<"missing-metamask" | "thirdweb-config" | "">("");
  const portalReady = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const closeWalletRef = useRef<HTMLButtonElement>(null);
  const thirdwebClient = useMemo(
    () => thirdwebClientId ? createThirdwebClient({ clientId: thirdwebClientId }) : null,
    [thirdwebClientId],
  );
  const eggoriaContract = useMemo(
    () => thirdwebClient ? getContract({ client: thirdwebClient, chain: ARC_TESTNET, address: EGGORIA_CONTRACT_ADDRESS }) : null,
    [thirdwebClient],
  );
  const activeAccount = useActiveAccount();
  const activeWallet = useActiveWallet();
  const { connect, isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const closeFundsModal = useCallback(() => {
    if (fundsSuccess && activeAccount?.address.toLowerCase() === fundsSuccess.address.toLowerCase()) {
      setArcBalance(fundsSuccess.balance);
      setMintReadyAddress(fundsSuccess.address);
    }
    setFundsModalOpen(false);
  }, [activeAccount?.address, fundsSuccess]);

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
      setMinted((value) => Math.max(value, Number(result.user.position) || 0));
      setNotice(`Welcome to Eggoria, ${result.user.name}.`);
      setWalletModalOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Google connection failed. Please try again.");
    }
  }, []);

  useEffect(() => {
    const statsRequest = fetch("/api/public-stats")
      .then((response) => response.json())
      .then((result) => setMinted(Number(result.total) || 0))
      .catch(() => setMinted(0));
    Promise.allSettled([
      statsRequest,
      new Promise((resolve) => window.setTimeout(resolve, 400)),
    ]).then(() => setStatsLoading(false));
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
    if (!walletModalOpen && !fundsModalOpen && !claimModalOpen && !mintingModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeWalletRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWalletModalOpen(false);
        closeFundsModal();
        setClaimModalOpen(false);
        setMintingModalOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [claimModalOpen, closeFundsModal, fundsModalOpen, mintingModalOpen, walletModalOpen]);

  const connectGoogleWallet = async () => {
    if (!thirdwebClient) {
      setWalletError("thirdweb-config");
      return;
    }
    setWalletError("");
    try {
      await connect(async () => {
        await googleInAppWallet.connect({ client: thirdwebClient, chain: ARC_TESTNET, strategy: "google" });
        return googleInAppWallet;
      });
      window.localStorage.setItem("eggoria-wallet-kind", "google");
      setWalletKind("google");
      setWalletModalOpen(false);
    } catch {
      // OAuth cancellation intentionally leaves the chooser open for another attempt.
    }
  };

  const getMetaMaskProvider = () => {
    const injected = window.ethereum;
    if (!injected) return undefined;
    return injected.providers?.find((provider) => provider.isMetaMask)
      ?? (injected.isMetaMask ? injected : undefined);
  };

  const ensureArcTestnet = async (provider: EthereumProvider) => {
    const targetChainId = "0x4cef52";
    if (await provider.request({ method: "eth_chainId" }) === targetChainId) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
    } catch (error) {
      if (readProviderErrorCode(error) !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: targetChainId, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"], blockExplorerUrls: ["https://testnet.arcscan.app"] }],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
    }
  };

  const count = Math.min(minted, 500);
  const progress = Math.min(100, (count / 500) * 100);
  const walletAddress = activeAccount?.address ?? "";
  const connectionLabel = walletAddress ? shortAddress(walletAddress) : "Get Your Egg";
  const hasTestFunds = Boolean(walletAddress) && (Number(arcBalance) >= 1 || mintReadyAddress.toLowerCase() === walletAddress.toLowerCase());

  useEffect(() => {
    Promise.resolve().then(() => setFundsGuideOpen(Boolean(walletAddress) && !hasTestFunds));
  }, [hasTestFunds, walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      Promise.resolve().then(() => setWalletKind(""));
      return;
    }
    const storedKind = window.localStorage.getItem("eggoria-wallet-kind");
    Promise.resolve().then(() => setWalletKind(storedKind === "google" || storedKind === "metamask" ? storedKind : ""));
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || !thirdwebClient) return;
    let active = true;
    getWalletBalance({ client: thirdwebClient, chain: ARC_TESTNET, address: walletAddress })
      .then((balance) => {
        if (active) setArcBalance(Number(balance.displayValue).toFixed(2));
      })
      .catch(() => {
        if (active) setArcBalance("0.00");
      });
    return () => { active = false; };
  }, [thirdwebClient, walletAddress]);

  useEffect(() => {
    if (!claimModalOpen || !walletAddress) return;
    const controller = new AbortController();
    fetch(ARC_TESTNET.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("RPC unavailable")))
      .then((result: { result?: string }) => {
        if (!result.result) throw new Error("Gas price unavailable");
        // Until the mint contract is wired, use a representative 1,000,000 gas mint.
        const weiPerUsdc = BigInt("1000000000000000000");
        const feeWei = BigInt(result.result) * BigInt("1000000");
        const whole = feeWei / weiPerUsdc;
        const fraction = feeWei % weiPerUsdc;
        const fee = Number(whole) + Number(fraction) / 1e18;
        setNetworkFee(fee < 0.01 ? fee.toFixed(4) : fee.toFixed(2));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setNetworkFee("Unavailable");
      });
    return () => controller.abort();
  }, [claimModalOpen, walletAddress]);
  const openWallet = () => {
    if (walletAddress) {
      setWalletMenuOpen((open) => !open);
      return;
    }
    setWalletError("");
    setWalletModalOpen(true);
  };
  const connectMetaMask = async () => {
    const provider = getMetaMaskProvider();
    if (!provider) {
      setWalletError("missing-metamask");
      return;
    }
    if (!thirdwebClient) {
      setWalletError("thirdweb-config");
      return;
    }
    setWalletError("");
    try {
      await provider.request({ method: "eth_requestAccounts" });
      await ensureArcTestnet(provider);
      await connect(async () => {
        await metaMaskWallet.connect({ client: thirdwebClient, chain: ARC_TESTNET });
        return metaMaskWallet;
      });
      window.localStorage.setItem("eggoria-wallet-kind", "metamask");
      setWalletKind("metamask");
      setNotice("");
      setWalletModalOpen(false);
    } catch (error) {
      setWalletModalOpen(false);
      if (readProviderErrorCode(error) === 4001) {
        setWalletError("");
        return;
      }
      setNotice("MetaMask could not connect. Please try again.");
    }
  };

  const disconnectWallet = () => {
    if (activeWallet) disconnect(activeWallet);
    window.localStorage.removeItem("eggoria-wallet-kind");
    setWalletKind("");
    setMintReadyAddress("");
    setWalletMenuOpen(false);
    setFundsGuideOpen(false);
    setNotice("");
  };

  const handleHeroAction = () => {
    if (!walletAddress) {
      openWallet();
      return;
    }
    if (hasTestFunds) {
      if (walletKind === "google") {
        setClaimError("");
        setNetworkFee("Estimating...");
        setClaimModalOpen(true);
      } else {
        setNotice("Egg minting will be available in the next step.");
      }
      return;
    }
    setFundsGuideOpen(false);
    setFundsError("");
    setFundsSuccess(null);
    setFundsModalOpen(true);
  };

  const claimTestFunds = async () => {
    if (!activeAccount || !walletAddress || fundsSending) return;
    setFundsError("");
    setFundsSuccess(null);
    setFundsSending(true);
    try {
      const message = `Eggoria ARC Testnet Faucet\nAddress: ${walletAddress}\nTimestamp: ${Date.now()}`;
      const signature = await activeAccount.signMessage({ message });
      const response = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: walletAddress, message, signature }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 429 && result.retryAt) {
          const retryAt = new Date(result.retryAt).toLocaleString();
          throw new Error(`Already claimed. Try again after ${retryAt}.`);
        }
        throw new Error(result.message || "Test USDC could not be sent.");
      }
      setFundsSuccess({
        amount: Number(result.amount) || 1,
        balance: String(result.balance || arcBalance),
        address: walletAddress,
      });
    } catch (error) {
      setFundsError(error instanceof Error ? error.message : "Test USDC could not be sent.");
    } finally {
      setFundsSending(false);
    }
  };

  const mintEgg = async () => {
    if (!activeAccount || !walletAddress || !eggoriaContract || claimSubmitting) return;
    setClaimSubmitting(true);
    setClaimError("");
    setMintError("");
    setMintTransactionHash("");
    let submitted = false;
    try {
      const [nextTokenIdToClaim, nextTokenIdToMint] = await Promise.all([
        readContract({ contract: eggoriaContract, method: "function nextTokenIdToClaim() view returns (uint256)" }),
        readContract({ contract: eggoriaContract, method: "function nextTokenIdToMint() view returns (uint256)" }),
      ]);
      if (nextTokenIdToClaim >= nextTokenIdToMint) {
        setClaimError("All available eggs have already been claimed.");
        return;
      }
      const transaction = claimTo({
        contract: eggoriaContract,
        to: walletAddress,
        from: walletAddress,
        quantity: BigInt(1),
      });
      const transactionResult = await sendTransaction({ transaction, account: activeAccount });
      submitted = true;
      setMintTransactionHash(transactionResult.transactionHash);
      setMintPhase("submitting");
      setClaimModalOpen(false);
      setMintingModalOpen(true);
      setClaimSubmitting(false);

      const receiptPromise = waitForReceipt(transactionResult);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setMintPhase("confirming");
      await receiptPromise;
      setMintPhase("success");
      setMinted((value) => Math.min(500, value + 1));
    } catch (error) {
      const message = readMintError(error);
      if (submitted) {
        setMintError(message);
        setMintPhase("error");
        setMintingModalOpen(true);
      } else {
        setClaimError(message);
      }
    } finally {
      setClaimSubmitting(false);
    }
  };

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
        <div className="header-actions">
          <div className="social-links">
            <a href="#" aria-label="Eggoria on X"><img className="social-frame" src={asset("icon-frame.png")} alt="" /><img className="social-glyph" src={asset("twitter.svg")} alt="" /></a>
            <a href="#" aria-label="Eggoria on Discord"><img className="social-frame" src={asset("icon-frame.png")} alt="" /><img className="social-glyph" src={asset("discord.svg")} alt="" /></a>
          </div>
          <button className={`figma-button header-connect${walletAddress ? " is-connected" : ""}`} type="button" onClick={openWallet}>
            <img src={asset("button.png")} alt="" />
            <span className="header-connect-label">{connectionLabel}{walletAddress && <img className="wallet-chevron" src={asset("wallet-chevron.svg")} alt="" />}</span>
          </button>
          {walletAddress && walletMenuOpen && <div className="wallet-nav-menu">
            <a href={`https://testnet.arcscan.app/address/${walletAddress}`} target="_blank" rel="noreferrer">View on ArcScan</a>
            <button type="button" onClick={disconnectWallet}>Disconnect</button>
          </div>}
        </div>
      </header>

      <section className="hero-new" id="home">
        <div className="hero-copy" data-node-id="316:52">
          <h1>Hatch Your<br />Own Bird</h1>
          <p>Mint a mysterious Egg for free, hatch your Bird,<br />and help it evolve through daily check-ins.</p>
          <div className={`mint-progress${statsLoading ? " is-loading" : ""}`} aria-busy={statsLoading}>
            <img className="progress-frame" src={asset("progress-frame.png")} alt="" />
            <div className="progress-content">
              <span className="mint-count">{statsLoading ? <span className="mint-count-skeleton" aria-label="Loading mint count" /> : `${count} / 500 Eggs Minted`}</span>
              <span className="progress-track">{statsLoading ? <span className="progress-skeleton" /> : <><i style={{ width: `${progress}%` }} /><b style={{ left: `${progress}%` }} /></>}</span>
            </div>
          </div>
          <div className="hero-connect-wrap">
            <button className="figma-button hero-connect" type="button" onClick={handleHeroAction}>
              <img src={asset("button.png")} alt="" /><span>{!walletAddress ? "Get Your Egg" : hasTestFunds ? "Mint Your Egg" : "Get Free Test Funds"}</span>
            </button>
            {walletAddress && !hasTestFunds && fundsGuideOpen && <aside className="funds-guide" aria-label="Get free test funds guide">
              <i className="funds-guide-pointer" aria-hidden="true" />
              <div className="funds-guide-header">
                <span>Step 1 of 3</span>
                <button type="button" aria-label="Close test funds guide" onClick={() => setFundsGuideOpen(false)}>{"\u00D7"}</button>
              </div>
              <h2>Get Free Test Funds</h2>
              <p>You need free test funds to create your Egg.<br />They only work here for testing.</p>
            </aside>}
            {hasTestFunds ? <p className="login-note funds-note mint-helper"><img src={asset("funds-shield.svg")} alt="" />One egg per wallet. Fee covered by your test funds</p> : walletAddress ? <>
              <p className="login-note funds-note">This free test balance is used to create your Egg.</p>
              <div className="wallet-balance-card">
                <img src={asset("funds-balance-frame.png")} alt="" />
                <span>You have {arcBalance} Test USDC. You&apos;ll need this to create your Egg</span>
              </div>
            </> : <p className="login-note">{user ? `Keeper #${user.position.toLocaleString("en-US")}` : "Continue with Google or MetaMask"}</p>}
            {notice && <p className="connection-notice" role="status">{notice}</p>}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="egg-glow-new">
            <img src={asset("glow.svg")} alt="" />
          </span>
          <img className="island-new" src={asset("island.png")} alt="" />
          <img className="egg-new" src={asset("egg.png")} alt="" />
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
            <p>Choose how you’d like to enter Eggoria</p>
          </header>
          <div className="wallet-options">
            <div className="wallet-option">
              <button className="wallet-provider wallet-provider-google" type="button" onClick={connectGoogleWallet} disabled={isConnecting}>
                <img className="wallet-provider-frame" src={asset("wallet-metamask-button.png")} alt="" />
                <span className="wallet-provider-content">
                  <img src={asset("wallet-google.svg")} alt="" />
                  <strong>Continue with Google</strong>
                  <small>Recommended</small>
                </span>
              </button>
              <p>Fast, secure, and no wallet setup required.</p>
            </div>
            <div className="wallet-divider" aria-hidden="true">
              <span className="wallet-divider-side"><i /><img src={asset("wallet-spark.svg")} alt="" /></span>
              <b>OR</b>
              <span className="wallet-divider-side"><i /><img src={asset("wallet-spark.svg")} alt="" /></span>
            </div>
            <div className="wallet-option">
              <button className="wallet-provider wallet-provider-metamask" type="button" onClick={connectMetaMask} disabled={isConnecting}>
                <img className="wallet-provider-frame" src={asset("wallet-google-button.png")} alt="" />
                <span className="wallet-provider-content">
                  <img src={asset("wallet-metamask.svg")} alt="" />
                  <strong>Continue with MetaMask</strong>
                </span>
              </button>
              <p>Use your existing Web3 wallet.</p>
              {walletError === "missing-metamask" && <p className="wallet-error">MetaMask not found. <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install extension</a></p>}
            </div>
          </div>
          {walletError === "thirdweb-config" && <p className="wallet-config-error" role="alert">Wallet login is not configured yet.</p>}
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
            <span className="funds-success-icon"><img src={asset("funds-success.png")} alt="Success" /></span>
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
            <img className="funds-usdc-icon" src={asset("usdc.svg")} alt="USDC" />
            <div className="funds-modal-copy">
              <h2 id="funds-modal-title">Get Free Test USDC</h2>
              <p>You&apos;ll receive 1 test USDC. This is testnet<br />money, not real currency</p>
            </div>
            <div className="funds-modal-actions">
              <button className="funds-cancel" type="button" onClick={closeFundsModal}>Cancel</button>
              <button className="figma-button funds-confirm" type="button" onClick={claimTestFunds} disabled={fundsSending}>
                <img src={asset("button.png")} alt="" /><span>{fundsSending ? "Sending..." : "Confirm"}</span>
              </button>
            </div>
            {fundsError && <p className="funds-modal-error" role="alert">{fundsError}</p>}
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
            <h2 id="claim-modal-title">Claim You Egg</h2>
            <p>Your Eggoria journey begins here.</p>
          </header>
          <dl className="claim-details">
            <div><dt><img src={asset("claim-wallet.svg")} alt="" />Wallet</dt><dd>{shortAddress(walletAddress)}</dd></div>
            <div><dt><img src={asset("claim-network.svg")} alt="" />Network</dt><dd>{ARC_TESTNET.name}</dd></div>
            <div><dt><img src={asset("claim-price.svg")} alt="" />Mint price</dt><dd>Free</dd></div>
            <div><dt><img src={asset("claim-fee.svg")} alt="" />Network fee</dt><dd>{networkFee === "Unavailable" || networkFee === "Estimating..." ? networkFee : `~${networkFee} USDC`}</dd></div>
          </dl>
          <p className="claim-limit"><img src={asset("claim-shield.svg")} alt="" />Each wallet can claim one egg only</p>
          <div className="claim-actions">
            <button className="funds-cancel claim-cancel" type="button" onClick={() => setClaimModalOpen(false)} disabled={claimSubmitting}>Close</button>
            <button className="figma-button claim-confirm" type="button" onClick={mintEgg} disabled={claimSubmitting}>
              <img src={asset("button.png")} alt="" /><span>{claimSubmitting && <i className="claim-button-spinner" aria-hidden="true" />}{claimSubmitting ? "Minting..." : "Confirm"}</span>
            </button>
          </div>
          {claimError && <p className="claim-error" role="alert">{claimError}</p>}
        </section>
      </div>, document.body)}

      {portalReady && createPortal(<div
        className={`wallet-modal-layer${mintingModalOpen ? " is-open" : ""}`}
        aria-hidden={!mintingModalOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMintingModalOpen(false);
        }}
      >
        <section className="minting-modal" role="dialog" aria-modal="true" aria-labelledby="minting-modal-title">
          <img className="claim-modal-frame" src={asset("funds-modal-frame.png")} alt="" />
          <button className="claim-modal-close" type="button" aria-label="Close minting status" onClick={() => setMintingModalOpen(false)}>
            <img src={asset("claim-close.svg")} alt="" />
          </button>
          <div className={`minting-egg-orbit phase-${mintPhase}`} aria-hidden="true">
            <span><img src={asset("claim-egg.png")} alt="" /></span>
            <i /><i />
          </div>
          <header className="minting-heading">
            <h2 id="minting-modal-title">{mintPhase === "success" ? "Your Egg Is Ready" : mintPhase === "error" ? "Minting Failed" : "Minting Your Egg"}</h2>
            <p>{mintPhase === "success" ? "Your Eggoria journey has begun." : mintPhase === "error" ? "The transaction could not be confirmed." : "Sitting tight. Your egg is being minted on ARC Testnet."}</p>
          </header>
          <div className={`minting-status phase-${mintPhase}`} aria-live="polite">
            {mintPhase === "success" ? <span className="minting-check">✓</span> : mintPhase === "error" ? <span className="minting-fail">!</span> : <span className="minting-spinner" aria-hidden="true" />}
            <p>Status: <strong>{mintPhase === "submitting" ? "Submitting..." : mintPhase === "confirming" ? "Confirming on-chain..." : mintPhase === "success" ? "Minted successfully" : "Transaction failed"}</strong></p>
          </div>
          <div className="minting-divider" aria-hidden="true"><span /><i>✦</i><span /></div>
          {mintTransactionHash && <a className="minting-explorer" href={`https://testnet.arcscan.app/tx/${mintTransactionHash}`} target="_blank" rel="noreferrer">View on Explorer</a>}
          {!mintTransactionHash && mintPhase !== "error" && <p className="minting-helper">Almost there. Just a few more seconds.</p>}
          {mintPhase === "error" && <p className="minting-error" role="alert">{mintError}</p>}
        </section>
      </div>, document.body)}
    </>
  );
}
