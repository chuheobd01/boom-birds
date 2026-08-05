const $ = (selector) => document.querySelector(selector);
const loginCard = $("#login-card");
const loginForm = $("#login-form");
const loginError = $("#login-error");
const dashboard = $("#dashboard-content");
const signOut = $("#sign-out");
const search = $("#user-search");
const body = $("#users-body");
const empty = $("#empty-state");
let users = [];

const date = (value) => value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

const userRow = (user) => {
  const row = document.createElement("tr");
  const identity = document.createElement("td");
  const person = document.createElement("div");
  person.className = "person";
  const avatar = document.createElement(user.picture ? "img" : "span");
  avatar.className = "avatar";
  if (user.picture) { avatar.src = user.picture; avatar.alt = ""; avatar.referrerPolicy = "no-referrer"; }
  else avatar.textContent = (user.name || user.email)[0].toUpperCase();
  const text = document.createElement("div");
  const name = document.createElement("strong"); name.textContent = user.name;
  const email = document.createElement("small"); email.textContent = user.email;
  text.append(name, email); person.append(avatar, text); identity.append(person);
  const position = document.createElement("td"); position.innerHTML = `<b>#${Number(user.position || 0).toLocaleString("en-US")}</b><small>${user.publicId}</small>`;
  const referral = document.createElement("td"); referral.textContent = user.referredBy || "Direct";
  const connected = document.createElement("td"); connected.textContent = date(user.connectedAt);
  const lastSeen = document.createElement("td"); lastSeen.textContent = date(user.lastSeenAt);
  row.append(identity, position, referral, connected, lastSeen); return row;
};

const render = () => {
  const query = search.value.trim().toLowerCase();
  const filtered = users.filter((user) => [user.name, user.email, user.publicId, user.referredBy].some((value) => String(value || "").toLowerCase().includes(query)));
  body.replaceChildren(...filtered.map(userRow)); empty.hidden = filtered.length > 0;
};

const load = async (token) => {
  const response = await fetch("/api/admin-users", { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Dashboard could not be loaded.");
  sessionStorage.setItem("eggoriaAdminToken", token); users = data.users;
  $("#total-users").textContent = data.total.toLocaleString("en-US");
  $("#guaranteed-users").textContent = data.guaranteed.toLocaleString("en-US");
  $("#referred-users").textContent = data.referred.toLocaleString("en-US");
  loginCard.hidden = true; dashboard.hidden = false; signOut.hidden = false; render();
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const button = loginForm.querySelector("button"); loginError.textContent = ""; button.disabled = true;
  try { await load($("#admin-token").value.trim()); $("#admin-token").value = ""; }
  catch (error) { loginError.textContent = error.message; }
  finally { button.disabled = false; }
});
signOut.addEventListener("click", () => { sessionStorage.removeItem("eggoriaAdminToken"); dashboard.hidden = true; signOut.hidden = true; loginCard.hidden = false; });
search.addEventListener("input", render);
const savedToken = sessionStorage.getItem("eggoriaAdminToken");
if (savedToken) load(savedToken).catch(() => sessionStorage.removeItem("eggoriaAdminToken"));
