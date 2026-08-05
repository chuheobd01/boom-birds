const rulesDialog = document.querySelector("#rules-dialog");
const rulesDialogScroll = rulesDialog.querySelector(".rules-dialog-scroll");
const googleButton = document.querySelector("#google-signin");
const toast = document.querySelector("#toast");
const stage = document.querySelector(".eggoria-stage");
const signinArea = document.querySelector(".signin-area");
const connectionsPanel = document.querySelector("#connections-panel");
const connectionsBody = document.querySelector("#connections-body");
const connectionsCount = document.querySelector("#connections-count");
const googleNativeButton = document.querySelector("#google-native-button");
const googleClientId = document.querySelector('meta[name="google-client-id"]')?.content || "";

let motionStarted = false;

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

const formatConnectionDate = (isoDate) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(isoDate),
  );

const renderConnections = (members, currentUser, total) => {
  const rows = members.map((member) =>
    member.id === currentUser.id
      ? { ...member, name: currentUser.name, picture: currentUser.picture, current: true }
      : member,
  );

  if (!rows.some((member) => member.id === currentUser.id)) {
    rows.unshift({ ...currentUser, current: true });
  }

  connectionsBody.replaceChildren();
  rows.slice(0, 6).forEach((member) => {
    const row = document.createElement("tr");
    if (member.current) row.classList.add("is-current");

    const explorerCell = document.createElement("td");
    const explorer = document.createElement("span");
    explorer.className = "connection-person";
    const avatar = document.createElement(member.picture ? "img" : "span");
    avatar.className = "connection-avatar";
    if (member.picture) {
      avatar.src = member.picture;
      avatar.alt = "";
      avatar.referrerPolicy = "no-referrer";
    } else {
      avatar.textContent = "✦";
    }
    const name = document.createElement("span");
    name.textContent = member.current ? `${member.name} (You)` : member.name;
    explorer.append(avatar, name);
    explorerCell.append(explorer);

    const statusCell = document.createElement("td");
    statusCell.innerHTML = '<span class="verified-status">✓ Verified</span>';
    const dateCell = document.createElement("td");
    dateCell.textContent = formatConnectionDate(member.connectedAt);
    row.append(explorerCell, statusCell, dateCell);
    connectionsBody.append(row);
  });

  connectionsCount.textContent = `${total} connected`;
  connectionsPanel.hidden = false;
  signinArea.classList.add("is-connected");
};

const handleGoogleCredential = async ({ credential }) => {
  setGoogleButtonState("Verifying account...", true);

  try {
    const response = await fetch("/.netlify/functions/google-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Google connection failed.");

    renderConnections(result.members, result.user, result.total);
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

document.querySelectorAll(".element-icon[data-land]").forEach((icon) => {
  icon.addEventListener("pointerenter", () => {
    stage.dataset.landFocus = icon.dataset.land;
  });

  icon.addEventListener("pointerleave", () => {
    delete stage.dataset.landFocus;
  });

});

const openRulesDialog = () => {
  if (rulesDialog.open) return;
  rulesDialog.classList.remove("is-closing");
  rulesDialog.showModal();
  rulesDialogScroll.scrollTop = 0;
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
      return;
    }

    trigger.setAttribute("aria-expanded", "false");
    accordion.classList.add("is-collapsing");
    accordion.collapseTimer = window.setTimeout(() => {
      accordion.classList.remove("is-open", "is-collapsing");
      panel.setAttribute("aria-hidden", "true");
    }, 100);
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
