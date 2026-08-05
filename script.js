const rulesDialog = document.querySelector("#rules-dialog");
const rulesModalContent = rulesDialog.querySelector(".rules-modal-content");
const rulesTabs = [...rulesDialog.querySelectorAll("[data-rules-tab]")];
const rulesPanels = [...rulesDialog.querySelectorAll("[data-rules-panel]")];
const faqScrollList = rulesDialog.querySelector(".rules-faq-list");
const faqScrollThumb = rulesDialog.querySelector(".faq-scroll-thumb");
const googleButton = document.querySelector("#google-signin");
const toast = document.querySelector("#toast");
const stage = document.querySelector(".eggoria-stage");
const signinArea = document.querySelector(".signin-area");
const keeperCard = document.querySelector("#keeper-card");
const keeperPosition = document.querySelector("#keeper-position");
const keeperGuarantee = document.querySelector("#keeper-guarantee");
const referralProgress = document.querySelector("#referral-progress");
const referralReward = document.querySelector("#referral-reward");
const copyInviteButton = document.querySelector("#copy-invite");
const googleNativeButton = document.querySelector("#google-native-button");
const googleClientId = document.querySelector('meta[name="google-client-id"]')?.content || "";
const intentCount = document.querySelector(".intent-count");

let motionStarted = false;

const loadPublicStats = async () => {
  try {
    const response = await fetch("/api/public-stats");
    if (!response.ok) return;
    const result = await response.json();
    intentCount.textContent = Number(result.total || 0).toLocaleString("en-US");
  } catch {
    // Keep the last known value when stats are temporarily unavailable.
  }
};

const startMotion = () => {
  if (motionStarted) return;
  motionStarted = true;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.documentElement.classList.replace("motion-pending", "motion-ready");
    });
  });
};

const decodeImage = (image) => {
  if (image.complete && image.naturalWidth > 0) {
    return image.decode?.().catch(() => undefined) || Promise.resolve();
  }

  if (image.complete) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      const decoded = image.decode?.();
      if (decoded) decoded.catch(() => undefined).finally(resolve);
      else resolve();
    };

    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  });
};

const prepareScene = async () => {
  const background = new Image();
  background.src = "assets/eggoria/background.png";

  const sceneImages = [...document.querySelectorAll(".eggoria-stage img")];
  const assetsReady = Promise.all([
    decodeImage(background),
    ...sceneImages.map(decodeImage),
    document.fonts?.ready || Promise.resolve(),
  ]);
  const loadingFallback = new Promise((resolve) => window.setTimeout(resolve, 4500));

  await Promise.race([assetsReady, loadingFallback]);
  startMotion();
};

const updateStageScale = () => {
  const scale = Math.min(window.innerWidth / 1440, window.innerHeight / 1024);
  const visibleStageWidth = window.innerWidth / scale;
  const horizontalGutter = Math.max(0, (visibleStageWidth - 1440) / 2);

  document.documentElement.style.setProperty("--stage-scale", scale);
  document.documentElement.style.setProperty("--stage-gutter", `${horizontalGutter}px`);
  document.documentElement.style.setProperty("--gutter-90", `${horizontalGutter * 0.9}px`);
  document.documentElement.style.setProperty("--gutter-70", `${horizontalGutter * 0.7}px`);
  document.documentElement.style.setProperty("--gutter-45", `${horizontalGutter * 0.45}px`);
  document.documentElement.style.setProperty("--gutter-35", `${horizontalGutter * 0.35}px`);
  document.documentElement.style.setProperty("--gutter-175", `${horizontalGutter * 0.175}px`);
};

const showToast = (text) => {
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => toast.classList.remove("show"), 3200);
};

const setGoogleButtonState = (text, disabled = false) => {
  googleButton.disabled = disabled;
  googleButton.querySelector("span").textContent = text;
};

let inviteLink = "";

const renderKeeperCard = (user) => {
  const position = Number(user.position) || 1;
  const referrals = Number(user.referrals) || 0;
  const remaining = Math.max(0, 5 - referrals);

  keeperPosition.textContent = `#${position.toLocaleString("en-US")}`;
  keeperGuarantee.textContent = position <= 5555
    ? "You’re within the first 5,555 — your egg is guaranteed."
    : "You’re on standby and first in line for the next Season.";
  referralProgress.textContent = `${Math.min(referrals, 5)}/5 invited`;
  referralReward.textContent = remaining > 0
    ? ` — ${remaining} more unlock${remaining === 1 ? "s" : ""} Tier 1 (1.5% → 2% Mythic)`
    : " — Tier 1 unlocked! (2% Mythic)";

  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("ref", user.id);
  inviteLink = url.toString();

  keeperCard.hidden = false;
  signinArea.classList.add("is-connected");
};

const restoreSession = async () => {
  signinArea.classList.add("is-checking-session");
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (!response.ok) return;
    const result = await response.json();
    if (result.authenticated && result.user) renderKeeperCard(result.user);
  } catch {
    // The Google button remains available when session restore is unavailable.
  } finally {
    signinArea.classList.remove("is-checking-session");
  }
};

copyInviteButton.addEventListener("click", async () => {
  if (!inviteLink) return;
  try {
    await navigator.clipboard.writeText(inviteLink);
    copyInviteButton.querySelector("span:last-child").textContent = "Invite link copied!";
    showToast("Invite link copied to your clipboard.");
    window.setTimeout(() => {
      copyInviteButton.querySelector("span:last-child").textContent = "Copy invite link";
    }, 2200);
  } catch {
    window.prompt("Copy your invite link:", inviteLink);
  }
});

const handleGoogleCredential = async ({ credential }) => {
  setGoogleButtonState("Verifying account...", true);

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
    if (!response.ok) throw new Error(result.message || "Google connection failed.");

    renderKeeperCard(result.user);
    loadPublicStats();
    setGoogleButtonState("Google Connected");
    showToast(`Welcome to Eggoria, ${result.user.name}.`);
  } catch (error) {
    setGoogleButtonState("Sign in with Google");
    showToast(error.message || "Google connection failed. Please try again.");
  }
};

let googleInitialized = false;
const initializeGoogle = () => {
  if (googleInitialized) return true;
  if (!window.google?.accounts?.id) return false;
  if (!googleClientId || googleClientId.includes("__GOOGLE_CLIENT_ID__")) return false;

  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
  });
  window.google.accounts.id.renderButton(googleNativeButton, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
    width: 400,
  });
  googleInitialized = true;
  signinArea.classList.add("google-ready");
  return true;
};

let googleBootAttempts = 0;
const bootGoogleButton = () => {
  if (initializeGoogle()) return;
  if (googleClientId.includes("__GOOGLE_CLIENT_ID__")) return;
  googleBootAttempts += 1;
  if (googleBootAttempts < 40) window.setTimeout(bootGoogleButton, 150);
};

updateStageScale();
window.addEventListener("resize", updateStageScale);

window.addEventListener("load", bootGoogleButton, { once: true });
prepareScene();
loadPublicStats();
restoreSession();

document.querySelectorAll(".element-icon[data-land]").forEach((icon) => {
  icon.addEventListener("pointerenter", () => {
    stage.dataset.landFocus = icon.dataset.land;
  });

  icon.addEventListener("pointerleave", () => {
    delete stage.dataset.landFocus;
  });

});

const activateRulesTab = (tabName, moveFocus = false) => {
  rulesDialog.classList.toggle("is-faq-view", tabName === "faq");
  rulesTabs.forEach((tab) => {
    const isActive = tab.dataset.rulesTab === tabName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive && moveFocus) tab.focus();
  });

  rulesPanels.forEach((panel) => {
    const isActive = panel.dataset.rulesPanel === tabName;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  rulesModalContent.scrollTop = 0;
  if (tabName === "faq") {
    window.requestAnimationFrame(() => {
      faqScrollList.scrollTop = 0;
      faqScrollList.dispatchEvent(new Event("scroll"));
    });
  }
};

rulesTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateRulesTab(tab.dataset.rulesTab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = rulesTabs[(index + direction + rulesTabs.length) % rulesTabs.length];
    activateRulesTab(nextTab.dataset.rulesTab, true);
  });
});

const getFaqScrollMetrics = () => {
  const thumbInset = Number.parseFloat(window.getComputedStyle(faqScrollThumb).top) || 0;
  return {
    maxScroll: Math.max(0, faqScrollList.scrollHeight - faqScrollList.clientHeight),
    thumbInset,
    trackTravel: Math.max(0, faqScrollThumb.parentElement.clientHeight - faqScrollThumb.offsetHeight - thumbInset * 2),
  };
};

const syncFaqScrollThumb = () => {
  const { maxScroll, trackTravel } = getFaqScrollMetrics();
  const progress = maxScroll > 0 ? faqScrollList.scrollTop / maxScroll : 0;
  faqScrollThumb.style.transform = `translateY(${trackTravel * progress}px)`;
};

faqScrollList.addEventListener("scroll", syncFaqScrollThumb, { passive: true });
window.addEventListener("resize", syncFaqScrollThumb);

let faqThumbDrag = null;

faqScrollThumb.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  faqThumbDrag = { pointerY: event.clientY, scrollTop: faqScrollList.scrollTop };
  faqScrollThumb.setPointerCapture(event.pointerId);
  faqScrollThumb.classList.add("is-dragging");
});

faqScrollThumb.addEventListener("pointermove", (event) => {
  if (!faqThumbDrag) return;
  const { maxScroll, trackTravel } = getFaqScrollMetrics();
  if (maxScroll <= 0 || trackTravel <= 0) return;
  faqScrollList.scrollTop = faqThumbDrag.scrollTop + (event.clientY - faqThumbDrag.pointerY) * (maxScroll / trackTravel);
});

const stopFaqThumbDrag = (event) => {
  if (!faqThumbDrag) return;
  faqThumbDrag = null;
  faqScrollThumb.classList.remove("is-dragging");
  if (faqScrollThumb.hasPointerCapture(event.pointerId)) faqScrollThumb.releasePointerCapture(event.pointerId);
};

faqScrollThumb.addEventListener("pointerup", stopFaqThumbDrag);
faqScrollThumb.addEventListener("pointercancel", stopFaqThumbDrag);

faqScrollThumb.parentElement.addEventListener("pointerdown", (event) => {
  if (event.target === faqScrollThumb) return;
  const track = faqScrollThumb.parentElement;
  const bounds = track.getBoundingClientRect();
  const { maxScroll, thumbInset, trackTravel } = getFaqScrollMetrics();
  if (trackTravel <= 0 || maxScroll <= 0) return;
  const targetY = Math.min(trackTravel, Math.max(0, event.clientY - bounds.top - thumbInset - faqScrollThumb.offsetHeight / 2));
  faqScrollList.scrollTop = (targetY / trackTravel) * maxScroll;
});

const openRulesDialog = () => {
  if (rulesDialog.open) return;
  activateRulesTab("rules");
  rulesDialog.classList.remove("is-closing");
  rulesDialog.showModal();
  rulesModalContent.scrollTop = 0;
};

const closeRulesDialog = () => {
  if (!rulesDialog.open || rulesDialog.classList.contains("is-closing")) return;
  rulesDialog.classList.add("is-closing");
  window.setTimeout(() => {
    rulesDialog.close();
    rulesDialog.classList.remove("is-closing");
  }, 180);
};

document.querySelector("[data-open-rules]").addEventListener("click", openRulesDialog);

document.querySelectorAll("[data-close-rules]").forEach((button) => {
  button.addEventListener("click", closeRulesDialog);
});

document.querySelectorAll(".accordion-trigger").forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const accordion = trigger.closest(".rules-accordion");
    const panel = document.getElementById(trigger.getAttribute("aria-controls"));
    const isOpen = trigger.getAttribute("aria-expanded") === "true";

    window.clearTimeout(accordion.collapseTimer);

    if (!isOpen) {
      accordion.classList.remove("is-collapsing");
      accordion.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      panel.setAttribute("aria-hidden", "false");
      window.setTimeout(() => {
        const itemTop = accordion.offsetTop;
        const itemBottom = itemTop + accordion.offsetHeight;
        const visibleTop = faqScrollList.scrollTop;
        const visibleBottom = visibleTop + faqScrollList.clientHeight;

        if (itemBottom > visibleBottom) {
          faqScrollList.scrollTo({
            top: itemBottom - faqScrollList.clientHeight + 8,
            behavior: "smooth",
          });
        } else if (itemTop < visibleTop) {
          faqScrollList.scrollTo({ top: itemTop, behavior: "smooth" });
        }

        syncFaqScrollThumb();
      }, 340);
      return;
    }

    trigger.setAttribute("aria-expanded", "false");
    accordion.classList.remove("is-open");
    accordion.classList.add("is-collapsing");
    accordion.collapseTimer = window.setTimeout(() => {
      accordion.classList.remove("is-collapsing");
      panel.setAttribute("aria-hidden", "true");
      syncFaqScrollThumb();
    }, 290);
  });
});

rulesDialog.addEventListener("click", (event) => {
  const bounds = rulesDialog.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (clickedOutside) closeRulesDialog();
});

rulesDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeRulesDialog();
});

googleButton.addEventListener("click", () => {
  if (!initializeGoogle()) {
    showToast("Add GOOGLE_CLIENT_ID in Netlify before using Google Sign-In.");
  }
});
