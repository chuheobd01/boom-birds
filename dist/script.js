const rulesDialog = document.querySelector("#rules-dialog");
const googleButton = document.querySelector("#google-signin");
const toast = document.querySelector("#toast");
const stage = document.querySelector(".eggoria-stage");
const signinArea = document.querySelector(".signin-area");
const connectionsPanel = document.querySelector("#connections-panel");
const connectionsBody = document.querySelector("#connections-body");
const connectionsCount = document.querySelector("#connections-count");
const googleClientId = document.querySelector('meta[name="google-client-id"]')?.content || "";

let motionStarted = false;

const startMotion = () => {
  if (motionStarted) return;
  motionStarted = true;
  document.documentElement.classList.replace("motion-pending", "motion-ready");
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
  googleInitialized = true;
  return true;
};

updateStageScale();
window.addEventListener("resize", updateStageScale);

window.addEventListener("load", startMotion, { once: true });
window.setTimeout(startMotion, 80);

document.querySelectorAll(".element-icon[data-land]").forEach((icon) => {
  icon.addEventListener("pointerenter", () => {
    stage.dataset.landFocus = icon.dataset.land;
  });

  icon.addEventListener("pointerleave", () => {
    delete stage.dataset.landFocus;
  });

});

document.querySelector("[data-open-rules]").addEventListener("click", () => {
  rulesDialog.showModal();
});

document.querySelectorAll("[data-close-rules]").forEach((button) => {
  button.addEventListener("click", () => rulesDialog.close());
});

rulesDialog.addEventListener("click", (event) => {
  const bounds = rulesDialog.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (clickedOutside) rulesDialog.close();
});

googleButton.addEventListener("click", () => {
  if (!initializeGoogle()) {
    showToast("Add GOOGLE_CLIENT_ID in Netlify before using Google Sign-In.");
    return;
  }

  setGoogleButtonState("Choose a Google account...");
  window.google.accounts.id.prompt((notification) => {
    const unavailable = notification.isNotDisplayed?.() || notification.isSkippedMoment?.();
    const dismissed = notification.isDismissedMoment?.();
    if (unavailable || dismissed) {
      setGoogleButtonState("Sign in with Google");
      if (unavailable) showToast("Google Sign-In is unavailable in this browser. Please try Chrome.");
    }
  });
});
