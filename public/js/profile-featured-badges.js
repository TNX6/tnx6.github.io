(() => {
  const CLEANUP_KEY = "__tnxFeaturedBadgesSelectable";
  if (window[CLEANUP_KEY]) window[CLEANUP_KEY]();

  if (window.__tnxFeaturedMiniBadges) {
    try { window.__tnxFeaturedMiniBadges(); } catch {}
  }

  if (window.__tnxFeaturedBadgesFinal) {
    try { window.__tnxFeaturedBadgesFinal(); } catch {}
  }

  const API = "https://api.tnx6.xyz";
  const timers = [];
  const observers = [];

  let selected = [];
  let isOwner = false;
  let roles = { moderator: false, vip: false };
  let profileLoginValue = "";
  let loading = false;

  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

  function getProfileLogin() {
    const candidates = [
      $("handle"),
      $("login"),
      $("username"),
      document.querySelector("[data-login]"),
      document.querySelector("[data-user-login]"),
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

      if (data?.authenticated && data?.user) return data.user;
    } catch {}

    return null;
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
        vip: Boolean(data.roles.vip),
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
      node,
    };
  }

  function getInventory() {
    const box = $("badges");
    if (!box) return [];

    return Array
      .from(box.querySelectorAll(".badge"))
      .map(extractBadge)
      .filter((badge) => badge.key && badge.key !== "بادج");
  }

  function roleBadges() {
    const arr = [];

    if (roles.moderator) {
      arr.push({
        type: "role",
        role: "mod",
        key: "__mod",
        name: "Twitch Moderator",
        icon: "MOD",
      });
    }

    if (roles.vip) {
      arr.push({
        type: "role",
        role: "vip",
        key: "__vip",
        name: "Twitch VIP",
        icon: "VIP",
      });
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

  function renderFeatured() {
    const target = $("featuredBadges");
    if (!target) return;

    const inventory = getInventory();
    const map = new Map(inventory.map((badge) => [badge.key, badge]));

    const chosen = selected.length
      ? selected.map((key) => map.get(key)).filter(Boolean)
      : inventory.sort((a, b) => b.score - a.score).slice(0, 3);

    const finalBadges = [...chosen.slice(0, 3), ...roleBadges()];

    target.innerHTML = "";

    if (!finalBadges.length) {
      target.classList.add("hidden");
      return;
    }

    finalBadges.forEach((badge) => target.appendChild(makeMiniBadge(badge)));
    target.classList.remove("hidden");
  }

  function updatePinButtons() {
    if (!isOwner) return;

    getInventory().forEach((badge) => {
      const node = badge.node;
      if (!node || node.dataset.pinReady === "true") return;

      node.dataset.pinReady = "true";
      node.classList.add("badge-pin-enabled");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "badge-pin-btn";
      btn.setAttribute("aria-label", "تثبيت البادج");
      btn.textContent = "تثبيت";

      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const exists = selected.includes(badge.key);

        if (exists) {
          selected = selected.filter((key) => key !== badge.key);
        } else {
          if (selected.length >= 3) {
            alert("تقدر تثبت 3 بادجات فقط.");
            return;
          }

          selected.push(badge.key);
        }

        renderFeatured();
        updatePinVisuals();
        await saveSelected();
      });

      node.appendChild(btn);
    });

    updatePinVisuals();
  }

  function updatePinVisuals() {
    getInventory().forEach((badge) => {
      const active = selected.includes(badge.key);
      const btn = badge.node?.querySelector?.(".badge-pin-btn");

      badge.node?.classList.toggle("badge-pinned", active);

      if (btn) {
        btn.textContent = active ? "مثبت" : "تثبيت";
        btn.classList.toggle("active", active);
      }
    });
  }

  async function saveSelected() {
    try {
      await fetch(API + "/api/me/featured-badges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badges: selected.slice(0, 3) }),
      });
    } catch {
      alert("ما قدرنا نحفظ البادجات. جرّب تحدث الصفحة.");
    }
  }

  async function boot() {
    if (loading) return;
    loading = true;

    profileLoginValue = getProfileLogin();

    const [me, saved, officialRoles] = await Promise.all([
      getMe(),
      getSavedBadges(profileLoginValue),
      getRoles(profileLoginValue),
    ]);

    isOwner = Boolean(
      me?.login &&
      profileLoginValue &&
      String(me.login).toLowerCase() === profileLoginValue
    );

    selected = saved.slice(0, 3);
    roles = officialRoles;

    renderFeatured();
    updatePinButtons();

    loading = false;
  }

  function setup() {
    boot();

    const box = $("badges");
    if (box && box.dataset.selectableObserved !== "true") {
      box.dataset.selectableObserved = "true";

      const obs = new MutationObserver(() => {
        renderFeatured();
        updatePinButtons();
      });

      obs.observe(box, { childList: true, subtree: true });
      observers.push(obs);
    }
  }

  [100, 400, 900, 1600, 2600].forEach((ms) => {
    timers.push(window.setTimeout(setup, ms));
  });

  window.addEventListener("pageshow", setup);
  document.addEventListener("astro:page-load", setup);
  document.addEventListener("astro:after-swap", setup);

  setup();

  window[CLEANUP_KEY] = () => {
    timers.forEach((id) => window.clearTimeout(id));
    observers.forEach((obs) => obs.disconnect());
  };
})();
