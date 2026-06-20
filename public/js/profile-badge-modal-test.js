(() => {
  const API = "https://api.tnx6.xyz";
  const $ = (id) => document.getElementById(id);
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

  let selected = [];
  let isOwner = false;
  let profileLogin = "";

  function getProfileLogin() {
    const handle = $("handle") || $("login") || $("username");
    const raw = clean(handle?.textContent || "");
    const fromHandle = raw.replace(/^@+/, "").toLowerCase();

    if (/^[a-z0-9_]{3,25}$/.test(fromHandle)) return fromHandle;

    const text = clean(document.body.innerText || "");
    const match = text.match(/@([a-zA-Z0-9_]{3,25})/);
    return match?.[1]?.toLowerCase() || "";
  }

  async function getMe() {
    try {
      const res = await fetch(API + "/api/me", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      return data?.authenticated ? data.user : null;
    } catch {
      return null;
    }
  }

  async function loadSaved(login) {
    try {
      const url = new URL(API + "/api/profile/featured-badges");
      url.searchParams.set("login", login);

      const res = await fetch(url.toString(), { credentials: "include", cache: "no-store" });
      const data = await res.json();

      return Array.isArray(data?.badges)
        ? data.badges.map(clean).filter(Boolean).slice(0, 3)
        : [];
    } catch {
      return [];
    }
  }

  function getInventory() {
    const box = $("badges");
    if (!box) return [];

    return Array.from(box.querySelectorAll(".badge"))
      .map((node) => {
        const name =
          clean(node.querySelector?.(".badge-name")?.textContent) ||
          clean(node.getAttribute?.("title")) ||
          clean(node.getAttribute?.("aria-label")) ||
          clean(node.textContent);

        const img = node.querySelector?.("img");

        return {
          key: name,
          name,
          img: img?.getAttribute("src") || "",
        };
      })
      .filter((b) => b.key && b.key !== "بادج");
  }

  function makeBadge(badge) {
    const el = document.createElement("span");
    el.className = "featured-mini-badge";
    el.setAttribute("data-tip", badge.name);
    el.setAttribute("aria-label", badge.name);

    if (badge.img) {
      const img = document.createElement("img");
      img.src = badge.img;
      img.alt = badge.name;
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.textContent = "✦";
      el.appendChild(span);
    }

    return el;
  }

  function makePlus() {
    const btn = document.createElement("button");
    btn.id = "featuredBadgePlusTest";
    btn.type = "button";
    btn.className = "featured-badge-plus-test";
    btn.textContent = "+";
    btn.style.display = "inline-grid";
    btn.style.opacity = "1";
    btn.style.visibility = "visible";
    btn.title = "اختيار البادجات";
    btn.addEventListener("click", openModal);
    return btn;
  }

  function forcePlusVisible() {
    const target = $("featuredBadges");
    if (!target || !isOwner) return;

    if (!$("featuredBadgePlusTest")) {
      target.appendChild(makePlus());
      target.classList.remove("hidden");
    }
  }

  function scheduleSavedRenderLock() {
    [250, 800, 1600, 3000, 5200, 8000].forEach((ms) => {
      setTimeout(() => {
        renderTop();
        forcePlusVisible();
      }, ms);
    });
  }

  function renderTop() {
    const target = $("featuredBadges");
    if (!target) return;

    const currentRoles = Array.from(target.querySelectorAll(".role-mod, .role-vip"))
      .map((node) => node.cloneNode(true));

    const inventory = getInventory();
    const map = new Map(inventory.map((b) => [b.key, b]));

    const chosen = selected
      .map((key) => map.get(key))
      .filter(Boolean)
      .slice(0, 3);

    target.innerHTML = "";

    chosen.forEach((badge) => target.appendChild(makeBadge(badge)));
    currentRoles.forEach((node) => target.appendChild(node));

    if (isOwner) target.appendChild(makePlus());

    target.classList.remove("hidden");
  }

  function ensureModal() {
    if ($("featuredBadgeModalTest")) return;

    const modal = document.createElement("div");
    modal.id = "featuredBadgeModalTest";
    modal.className = "featured-badge-modal-test hidden";

    modal.innerHTML = `
      <button class="featured-badge-modal-backdrop" type="button"></button>
      <div class="featured-badge-modal-panel" role="dialog" aria-modal="true">
        <div class="featured-badge-modal-head">
          <div>
            <h3>اختيار البادجات</h3>
            <p id="featuredBadgeModalState">اختر حتى 3 بادجات من مخزونك.</p>
          </div>
          <button class="featured-badge-modal-close" type="button">×</button>
        </div>

        <div id="featuredBadgeModalGrid" class="featured-badge-modal-grid"></div>

        <div class="featured-badge-modal-actions">
          <button id="featuredBadgeModalSave" class="featured-badge-modal-save" type="button">
            حفظ الاختيار
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".featured-badge-modal-backdrop")?.addEventListener("click", closeModal);
    modal.querySelector(".featured-badge-modal-close")?.addEventListener("click", closeModal);
    $("featuredBadgeModalSave")?.addEventListener("click", saveSelection);
  }

  function setState(text) {
    const state = $("featuredBadgeModalState");
    if (state) state.textContent = text;
  }

  function renderPicker() {
    const grid = $("featuredBadgeModalGrid");
    if (!grid) return;

    const badges = getInventory();
    grid.innerHTML = "";

    setState(`اختر حتى 3 بادجات من مخزونك. المختار: ${selected.length}/3`);

    badges.forEach((badge) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "featured-badge-option";
      btn.classList.toggle("selected", selected.includes(badge.key));

      btn.innerHTML = `
        <span class="featured-badge-option-icon">
          ${badge.img ? `<img src="${badge.img}" alt="${badge.name}" loading="lazy">` : "✦"}
        </span>
        <span class="featured-badge-option-label">${badge.name}</span>
      `;

      btn.addEventListener("click", () => {
        if (selected.includes(badge.key)) {
          selected = selected.filter((key) => key !== badge.key);
        } else {
          if (selected.length >= 3) {
            setState("تقدر تختار 3 بادجات فقط.");
            return;
          }
          selected.push(badge.key);
        }

        renderPicker();
      });

      grid.appendChild(btn);
    });
  }

  function openModal() {
    if (!isOwner) return;
    ensureModal();
    renderPicker();
    $("featuredBadgeModalTest")?.classList.remove("hidden");
  }

  function closeModal() {
    $("featuredBadgeModalTest")?.classList.add("hidden");
  }

  async function saveSelection() {
    const btn = $("featuredBadgeModalSave");

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "جاري الحفظ...";
      }

      const res = await fetch(API + "/api/me/featured-badges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badges: selected.slice(0, 3) }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) throw new Error("save_failed");

      selected = Array.isArray(data.badges) ? data.badges.map(clean).slice(0, 3) : selected.slice(0, 3);
      renderTop();
      scheduleSavedRenderLock();
      setState("تم حفظ الاختيار.");
      setTimeout(closeModal, 500);
    } catch {
      setState("فشل حفظ البادجات.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "حفظ الاختيار";
      }
    }
  }

  async function setup() {
    const me = await getMe();

    profileLogin = getProfileLogin() || String(me?.login || "").toLowerCase();
    isOwner = Boolean(me?.login && String(me.login).toLowerCase() === profileLogin);

    if (!profileLogin) return;

    selected = await loadSaved(profileLogin);

    console.log("[TNX Featured Badges]", {
      profileLogin,
      me: me?.login,
      isOwner,
      selected,
    });

    renderTop();
    scheduleSavedRenderLock();

    [500, 1200, 2500, 4500, 7000].forEach((ms) => {
      setTimeout(forcePlusVisible, ms);
    });
  }

  setTimeout(setup, 1600);
  setTimeout(setup, 3200);
})();
