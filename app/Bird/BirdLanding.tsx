"use client";

/* eslint-disable @next/next/no-img-element -- exact Figma exports use native image crops */

import "./bird.css";

const asset = (name: string) => `/assets/landing/${name}`;

// ─── Progress bar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  minted: number;
  total: number;
}

function ProgressBar({ minted, total }: ProgressBarProps) {
  const pct = Math.min(100, Math.round((minted / total) * 100));
  return (
    <div className="bird-hero-progress-wrapper">
      <div className="bird-hero-progress-frame">
        <img
          src={asset("progress-frame.png")}
          alt=""
          className="bird-hero-progress-frame-img"
        />
        <div className="bird-hero-progress-content">
          <span className="bird-hero-progress-label">
            {minted.toLocaleString()} / {total.toLocaleString()} Eggs Minted
          </span>
        </div>
      </div>
      <div className="bird-hero-progress-bar-track">
        <div
          className="bird-hero-progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  onGetEgg: () => void;
}

function Header({ onGetEgg }: HeaderProps) {
  const navLinks = [
    { label: "Home", href: "#hero", active: true },
    { label: "How It Works", href: "#how-it-works", active: false },
    { label: "Lands", href: "#lands", active: false },
    { label: "Rarity", href: "#rarity", active: false },
    { label: "Roadmap", href: "#roadmap", active: false },
    { label: "FAQ", href: "#faq", active: false },
  ];

  return (
    <header className="bird-header">
      {/* Logo */}
      <a href="#hero" className="bird-header-logo">
        <img
          src={asset("logo.svg")}
          alt="Eggoria logo"
          className="bird-header-logo-img"
        />
        <span className="bird-header-logo-text">Eggoria</span>
      </a>

      {/* Nav */}
      <nav className="bird-header-nav">
        {navLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className={`bird-header-nav-link${link.active ? " active" : ""}`}
          >
            {link.label}
          </a>
        ))}
      </nav>

      {/* Right: social icons + CTA */}
      <div className="bird-header-right">
        <a
          href="https://twitter.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="bird-header-icon-btn"
          aria-label="Twitter"
        >
          <img src={asset("twitter.svg")} alt="Twitter" />
        </a>
        <a
          href="https://discord.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="bird-header-icon-btn"
          aria-label="Discord"
        >
          {/* Use wallet-google.svg as placeholder if discord svg not present */}
          <img src={asset("wallet-google.svg")} alt="Discord" />
        </a>
        <button className="bird-header-cta" onClick={onGetEgg}>
          Get Your Egg
        </button>
      </div>
    </header>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────

interface HeroProps {
  minted: number;
  total: number;
  onGetEgg: () => void;
}

const SPARKLE_POSITIONS: Array<{
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  cls: string;
}> = [
  { top: "18%", left: "12%", cls: "bird-sparkle-1" },
  { top: "28%", left: "6%", cls: "bird-sparkle-2" },
  { top: "55%", left: "20%", cls: "bird-sparkle-3" },
  { top: "70%", left: "8%", cls: "bird-sparkle-4" },
  { top: "15%", left: "52%", cls: "bird-sparkle-5" },
  { top: "40%", right: "10%", cls: "bird-sparkle-6" },
  { top: "22%", right: "18%", cls: "bird-sparkle-7" },
  { bottom: "20%", right: "6%", cls: "bird-sparkle-8" },
  { top: "60%", right: "30%", cls: "bird-sparkle-9" },
  { top: "8%", right: "40%", cls: "bird-sparkle-10" },
];

function Hero({ minted, total, onGetEgg }: HeroProps) {
  return (
    <section className="bird-hero" id="hero">
      {/* Background image */}
      <img
        src={asset("hero-background.png")}
        alt=""
        className="bird-hero-bg"
      />

      {/* Glow blobs (Figma Ellipses with blur) */}
      <div className="bird-hero-glow-left" />
      <div className="bird-hero-glow-right" />

      {/* Animated sparkle dots */}
      {SPARKLE_POSITIONS.map((pos, i) => (
        <img
          key={i}
          src={asset("wallet-spark.svg")}
          alt=""
          className={`bird-hero-sparkle ${pos.cls}`}
          style={{
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            right: pos.right,
          }}
        />
      ))}

      <div className="bird-hero-inner">
        {/* ── Left: text + CTA ── */}
        <div className="bird-hero-content">
          <h1 className="bird-hero-title">Hatch Your Own Bird</h1>
          <p className="bird-hero-desc">
            Mint a mysterious Egg for free, hatch your Bird, and help it evolve
            through daily check-ins.
          </p>

          <ProgressBar minted={minted} total={total} />

          <div className="bird-hero-btn-group">
            <button className="bird-hero-btn-primary" onClick={onGetEgg}>
              Get Your Egg
            </button>
            <p className="bird-hero-btn-secondary-text">
              Continue with Google or MetaMask
            </p>
          </div>
        </div>

        {/* ── Right: floating island + egg ── */}
        <div className="bird-hero-visual">
          {/* Hot-air balloons (decorative) */}
          <img
            src={asset("island-left.png")}
            alt=""
            className="bird-hero-balloon-left"
          />
          <img
            src={asset("island-right.png")}
            alt=""
            className="bird-hero-balloon-right"
          />

          {/* Floating island */}
          <img
            src={asset("island.png")}
            alt="Floating island"
            className="bird-hero-island"
          />

          {/* Egg on island */}
          <img
            src={asset("hatch-popup-wizard.png")}
            alt="Mystery egg"
            className="bird-hero-egg"
          />
        </div>
      </div>
    </section>
  );
}

// ─── How It Works Section ────────────────────────────────────────────────────

interface Step {
  number: number;
  title: string;
  description: string;
  islandImg: string;
}

const STEPS: Step[] = [
  {
    number: 1,
    title: "Start Your Journey",
    description: "Continue with Google for easy setup, or use your wallet.",
    islandImg: "icon-frame.png",
  },
  {
    number: 2,
    title: "Get Free Test Funds",
    description: "Claim free Test USDC to cover the small network fee.",
    islandImg: "funds-usdc-new.png",
  },
  {
    number: 3,
    title: "Mint Your Egg",
    description: "Mint one Mystery Egg and start your evolution journey.",
    islandImg: "hatch-token-icon.png",
  },
  {
    number: 4,
    title: "Check In & Evolve",
    description: "Come back regularly to help your Bird grow and evolve.",
    islandImg: "hatch-stage-icon.png",
  },
];

function HowItWorks() {
  return (
    <section className="bird-hiw" id="how-it-works">
      <img
        src={asset("how-it-works-background.png")}
        alt=""
        className="bird-hiw-bg"
      />

      <div className="bird-hiw-inner">
        <div className="bird-hiw-header">
          <h2 className="bird-hiw-title">How It Works</h2>
          <p className="bird-hiw-subtitle">
            From your first sign-in to your first Bird. Eggoria guides you
            through every step.
          </p>
        </div>

        <div className="bird-hiw-steps">
          {STEPS.map((step) => (
            <div className="bird-hiw-step" key={step.number}>
              {/* Island/icon image floats above card */}
              <img
                src={asset(step.islandImg)}
                alt={step.title}
                className="bird-hiw-step-visual"
              />

              {/* Card */}
              <div className="bird-hiw-step-card">
                {/* Number badge */}
                <div className="bird-hiw-step-number">{step.number}</div>
                <p className="bird-hiw-step-card-title">{step.title}</p>
                <p className="bird-hiw-step-card-desc">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Sky panorama ─────────────────────────────────────────────────────────────

function SkySeparator() {
  return (
    <div className="bird-sky">
      <img
        src={asset("hero-background.png")}
        alt="Sky panorama"
        className="bird-sky-img"
        style={{ objectPosition: "center 60%" }}
      />
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bird-footer">
      <div className="bird-footer-logo">
        <img src={asset("logo.svg")} alt="Eggoria" className="bird-footer-logo-img" />
        <span className="bird-footer-logo-text">Eggoria</span>
      </div>

      <p className="bird-footer-copy">
        © {new Date().getFullYear()} Eggoria. All rights reserved.
      </p>

      <div className="bird-footer-links">
        <a href="#" className="bird-footer-link">Privacy Policy</a>
        <a href="#" className="bird-footer-link">Terms of Use</a>
        <a href="#" className="bird-footer-link">Contact</a>
      </div>
    </footer>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function BirdLanding() {
  // In production these values come from the contract/API
  const MINTED = 100;
  const MAX_SUPPLY = 500;

  const handleGetEgg = () => {
    // Scroll to connect section or open wallet modal
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="bird-page">
      <Header onGetEgg={handleGetEgg} />
      <Hero minted={MINTED} total={MAX_SUPPLY} onGetEgg={handleGetEgg} />
      <HowItWorks />
      <SkySeparator />
      <Footer />
    </div>
  );
}

