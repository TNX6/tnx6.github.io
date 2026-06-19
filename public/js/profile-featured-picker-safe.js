(() => {
  const KEY = "__tnxFeaturedPickerSafe";
  if (window[KEY]) window[KEY]();

  const API = "https://api.tnx6.xyz";
  const timers = [];
  const observers = [];

  let selected = [];
  let owner = false;
  let roles = { moderator: false, vip: false };

  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

  function getProfileLogin() {
    const candidates = [
      $("handle"),
      $("login"),
      $("username"),
      document.querySelector("[data-login]"),
      document.querySelector("[data-user-login]")
    ].filter(Boolean);

    for (const el of candidates) {
      const raw = clean(el.dataset?.login || el.dataset?.userLogin || el.textContent || "");
      const login = raw.replace(/^@+/, "").toLowerCase();
      if (/^[a-z0-9_]{3,25}$/.test(login)) return login;
    }

    const text = clean(document.querySelector("main")?.innerText || document.body?.innerText || "");
    const match = text.match(/@([a-zA-Z0-9_]{3,25})/);
    return match?.[1]?.toLowerCase() || "";
  }

  async function getMe() {
    try {
      const res = await fetch(API + "/api/me", { credentials: "include" });
      const data = await res.json();
      return data?.authenticated ? data.user : null;
    } catch {
      return null;
    }
  }

  async function getSavedBadges(login) {
    if (!login) return [];
    try {
      const url = new URL(API + "/api/profile/featured-badges");
      url.searchParams.set("login", login);
      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      return Array.isArray(data?.badges) ? data.badges.slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  async function getRoles(login) {
    if (!login) return { moderator: false, vip: false };
    try {
      const url = new URL(API + "/api/twitch/roles");
      url.searchParams.set("login", login);
      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();

      if (!data?.ok || !data?.available || !data?.roles) {
        return { moderator: false, vip: false };
      }

      return {
        moderator: Boolean(data.roles.moderator),
        vip: Boolean(data.roles.vip)
      };
    } catch {
      return { moderator: false, vip: false };
    }
  }

  function scoreBadge(name) {
    const text = String(name || "").toLowerCase();

    if (text.includes("king") || text.includes("ملك")) return 1000;
    if (text.includes("law") || text.includes("محامي") || text.includes("قانون")) return 900;
    if (text.includes("mythic")) return 850;
    if (text.includes("legendary")) return 800;
    if (text.includes("1000q") || text.includes("1000")) return 760;
    if (text.includes("1m") || text.includes("مليون")) return 740;
    if (text.includes("500k")) return 720;
    if (text.includes("250k")) return 700;
    if (text.includes("100k")) return 680;
    if (text.includes("600q") || text.includes("600")) return 660;
    if (text.includes("300q") || text.includes("300")) return 640;
    if (text.includes("150q") || text.includes("150")) return 620;
    if (text.includes("50q") || text.includes("50")) return 600;
    if (text.includes("60d") || text.includes("60")) return 560;
    if (text.includes("30d") || text.includes("30")) return 540;
    if (text.includes("15d") || text.includes("15")) return 520;

    return 100;
  }

  function extractBadge(node) {
    const name =
      clean(node.querySelector?.(".badge-name")?.textContent) ||
      clean(node.getAttribute?.("title")) ||
      clean(node.getAttribute?.("aria-label")) ||
      clean(node.textContent) ||
      "بادج";

    const img = node.querySelector?.("img");
    const icon = clean(node.querySelector?.(".badge-icon")?.textContent);

    return {
      type: "inventory",
      key: name,
      name,
      imgSrc: img?.getAttribute("src") || "",
      imgAlt: img?.getAttribute("alt") || name,
      icon: icon || "✦",
      score: scoreBadge(name),
      node
    };
  }

  function inventory() {
    const box = $("badges");
    if (!box) return [];

    return Array
      .from(box.querySelectorAll(".badge"))
      .map(extractBadge)
      .filter((b) => b.key && b.key !== "بادج");
  }

  function roleBadges() {
    const arr = [];

    if (roles.moderator) {
      arr.push({ type: "role", role: "mod", name: "Twitch Moderator", icon: "MOD" });
    }

    if (roles.vip) {
      arr.push({ type: "role", role: "vip", name: "Twitch VIP", icon: "VIP" });
    }

    return arr;
  }

  function makeMiniBadge(data) {
    const el = document.createElement("span");
    el.className = "featured-mini-badge" + (data.role ? " role-" + data.role : "");
    el.setAttribute("data-tip", data.name);
    el.setAttribute("aria-label", data.name);

    if (data.imgSrc && data.type === "inventory") {
      const img = document.createElement("img");
      img.src = data.imgSrc;
      img.alt = data.imgAlt || data.name;
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.textContent = data.icon || "✦";
      el.appendChild(span);
    }

    return el;
  }

  function renderPinned() {
    const target = $("featuredBadges");
    if (!target) return;

    const all = inventory();
    if (!all.length) return;

    const map = new Map(all.map((b) => [b.key, b]));

    const picked = selected.length
      ? selected.map((key) => map.get(key)).filter(Boolean).slice(0, 3)
      : all.sort((a, b) => b.score - a.score).slice(0, 3);

    const finalBadges = [...picked, ...roleBadges()];

    target.innerHTML = "";
    finalBadges.forEach((badge) => target.appendChild(makeMiniBadge(badge)));
    target.classList.remove("hidden");
  }

  function updateButtons() {
    if (!owner) return;

    inventory().forEach((badge) => {
      const node = badge.node;
      if (!node || node.dataset.safePinReady === "true") return;

      node.dataset.safePinReady = "true";
      node.classList.add("badge-pin-enabled");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "badge-pin-btn";
      btn.textContent = selected.includes(badge.key) ? "مثبت" : "تثبيت";

      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (selected.includes(badge.key)) {
          selected = selected.filter((key) => key !== badge.key);
        } else {
          if (selected.length >= 3) {
            alert("تقدر تثبت 3 بادجات فقط.");
            return;
          }

          selected.push(badge.key);
        }

        renderPinned();
        syncButtonState();
        await save();
      });

      node.appendChild(btn);
    });

    syncButtonState();
  }

  function syncButtonState() {
    inventory().forEach((badge) => {
      const active = selected.includes(badge.key);
      const btn = badge.node?.querySelector?.(".badge-pin-btn");

      badge.node?.classList.toggle("badge-pinned", active);

      if (btn) {
        btn.textContent = active ? "مثبت" : "تثبيت";
        btn.classList.toggle("active", active);
      }
    });
  }

  async function save() {
    try {
      await fetch(API + "/api/me/featured-badges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badges: selected.slice(0, 3) })
      });
    } catch {
      alert("ما قدرنا نحفظ البادجات.");
    }
  }

  async function boot() {
    const login = getProfileLogin();
    if (!login) return;

    const [me, saved, officialRoles] = await Promise.all([
      getMe(),
      getSavedBadges(login),
      getRoles(login)
    ]);

    owner = Boolean(me?.login && String(me.login).toLowerCase() === login);
    selected = saved.slice(0, 3);
    roles = officialRoles;

    renderPinned();
    updateButtons();
  }

  function setup() {
    boot();

    const box = $("badges");
    if (box && box.dataset.safePickerObserved !== "true") {
      box.dataset.safePickerObserved = "true";

      const obs = new MutationObserver(() => {
        renderPinned();
        updateButtons();
      });

      obs.observe(box, { childList: true, subtree: true });
      observers.push(obs);
    }
  }

  [300, 900, 1800, 3200, 5000].forEach((ms) => {
    timers.push(window.setTimeout(setup, ms));
  });

  window.addEventListener("pageshow", setup);
  document.addEventListener("astro:page-load", setup);
  document.addEventListener("astro:after-swap", setup);

  setup();

  window[KEY] = () => {
    timers.forEach((id) => window.clearTimeout(id));
    observers.forEach((obs) => obs.disconnect());
  };
})();
