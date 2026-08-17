"use client";

/* eslint-disable @next/next/no-img-element -- exact Figma exports use native image crops */

import { useCallback, useEffect, useState } from "react";

type EggoriaUser = { id: string; name: string; position: number };
type GoogleCredential = { credential: string };

declare global {
  interface Window {
    google?: { accounts?: { id: {
      initialize(options: Record<string, unknown>): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
    } } };
  }
}

const asset = (name: string) => `/assets/landing/${name}`;
const navItems = [
  ["home", "Home"], ["how-it-works", "How It Works"], ["lands", "Lands"],
  ["rarity", "Rarity"], ["roadmap", "Roadmap"], ["faq", "FAQ"],
] as const;

export default function EggoriaLanding({ googleClientId }: { googleClientId: string }) {
  const [minted, setMinted] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [user, setUser] = useState<EggoriaUser | null>(null);
  const [notice, setNotice] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [activeNav, setActiveNav] = useState("home");

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
    if (!googleClientId) return;
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
  }, [connectGoogle, googleClientId]);

  const count = Math.min(minted, 500);
  const progress = Math.min(100, (count / 500) * 100);
  const connectionLabel = user ? "Connected" : "Connect Wallet";
  const unavailable = () => {
    if (!googleReady && googleClientId) setNotice("Google Sign-In is still loading.");
  };

  return (
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
          <button className="figma-button header-connect" type="button" onClick={unavailable}>
            <img src={asset("button.png")} alt="" /><span>{connectionLabel}</span>
            {!user && <span className="google-hitbox" data-google-button data-width="180" />}
          </button>
        </div>
      </header>

      <section className="hero-new" id="home">
        <div className="hero-copy" data-node-id="316:52">
          <h1>Hatch Your<br />Own Bird</h1>
          <p>Every Eggoria journey starts with a mystery egg. Connect your wallet, mint on ARC, and check in daily to help it hatch and evolve.</p>
          <div className={`mint-progress${statsLoading ? " is-loading" : ""}`} aria-busy={statsLoading}>
            <img className="progress-frame" src={asset("progress-frame.png")} alt="" />
            <div className="progress-content">
              <span className="mint-count"><img src={asset("user.svg")} alt="" />{statsLoading ? <span className="mint-count-skeleton" aria-label="Loading mint count" /> : `${count} / 500 eggs minted`}</span>
              <span className="progress-track">{statsLoading ? <span className="progress-skeleton" /> : <><i style={{ width: `${progress}%` }} /><b style={{ left: `${progress}%` }} /></>}</span>
            </div>
          </div>
          <div className="hero-connect-wrap">
            <button className="figma-button hero-connect" type="button" onClick={unavailable}>
              <img src={asset("button.png")} alt="" /><span>{connectionLabel}</span>
              {!user && <span className="google-hitbox" data-google-button data-width="350" />}
            </button>
            <p className="login-note"><img src={asset("lock.svg")} alt="" />{user ? `Keeper #${user.position.toLocaleString("en-US")}` : "Sign in with MetaMask or Google"}</p>
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
          <i className="light-spark light-spark-two">✦</i>
          <i className="light-spark light-spark-three">✦</i>
          <i className="light-spark light-spark-four">✦</i>
          <i className="light-spark light-spark-five">✦</i>
        </div>
        <img className="balloon balloon-one" src={asset("balloon.png")} alt="" />
        <img className="balloon balloon-two" src={asset("balloon.png")} alt="" />
        <img className="crystal crystal-one" src={asset("crystal.png")} alt="" />
        <img className="crystal crystal-two" src={asset("crystal.png")} alt="" />
        <img className="crystal crystal-three" src={asset("crystal.png")} alt="" />
        <span className="floating-petal floating-petal-one"><img src={asset("bird.png")} alt="" /></span>
        <span className="floating-petal floating-petal-two"><img src={asset("feather-b.png")} alt="" /></span>
        <span className="floating-petal floating-petal-three"><img src={asset("feather-a.png")} alt="" /></span>
      </section>
    </main>
  );
}
