const form = document.querySelector("#waitlist-form");
const emailInput = document.querySelector("#email");
const message = document.querySelector("#form-message");
const rulesDialog = document.querySelector("#rules-dialog");

const updateStageScale = () => {
  const scale = Math.min(window.innerWidth / 1440, window.innerHeight / 1024);
  document.documentElement.style.setProperty("--stage-scale", scale);
};

updateStageScale();
window.addEventListener("resize", updateStageScale);

const isGmailAddress = (value) => /^[^\s@]+@gmail\.com$/i.test(value.trim());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.classList.remove("success", "error");

  const email = emailInput.value.trim();
  const submitButton = form.querySelector("button[type='submit']");

  if (!isGmailAddress(email)) {
    message.textContent = "Please enter a valid Gmail address.";
    message.classList.add("error");
    emailInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Sending...";
  message.textContent = "";

  try {
    const response = await fetch("/.netlify/functions/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Unable to send the confirmation email.");
    }

    message.textContent = "Success! Please check your Gmail for confirmation.";
    message.classList.add("success");
    form.reset();
  } catch (error) {
    const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    message.textContent = isLocalPreview
      ? "Email sending is available after deploying to Netlify."
      : error.message;
    message.classList.add("error");
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = "Reserve My Egg";
  }
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
