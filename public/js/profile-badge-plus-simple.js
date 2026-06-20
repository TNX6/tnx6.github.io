(() => {
  const API = "https://api.tnx6.xyz";
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
  const $ = (id) => document.getElementById(id);

  function getLogin() {
    const handle = $("handle") || $("login") || $("username");
    const raw = clean(handle?.textContent || "");
    const login = raw.replace(/^@+/, "").toLowerCase();

    if (/^[a-z0-9_]{3,25}$/.test(login)) return login;

    const text = clean(document.body.innerText || "");
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

  function getInventoryBadges() {
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

  function renderChosenWithRoles(target, chosen, plus) {
    const roleNodes = Array
      .from(target.querySelectorAll(".role-mod, .role-vip"))
      .map((el) => el.cloneNode(true));

    target.innerHTML = "";

    chosen.forEach((b) => target.appendChild(makeBadge(b)));
    roleNodes.forEach((el) => target.appendChild(el));
    target.appendChild(plus);
  }

  async function saveBadges(keys) {
    const res = await fetch(API + "/api/me/featured-badges", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badges: keys.slice(0, 3) }),
    });

    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data?.ok);
  }

  async function loadSaved(login) {
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

  async function setup() {
    const target = $("featuredBadges");
    const login = getLogin();
    const me = await getMe();

    if (!target || !login || !me?.login) return;

    const isOwner = String(me.login).toLowerCase() === login;
    if (!isOwner) return;

    if ($("badgePlusSimpleBtn")) return;

    const plus = document.createElement("button");
    plus.id = "badgePlusSimpleBtn";
    plus.type = "button";
    plus.className = "featured-badge-plus-simple";
    plus.textContent = "+";
    plus.title = "اختيار البادجات";

    plus.addEventListener("click", async () => {
      const badges = getInventoryBadges();

      if (!badges.length) {
        alert("ما عندك بادجات قابلة للاختيار.");
        return;
      }

      const list = badges
        .map((b, i) => `${i + 1}- ${b.name}`)
        .join("\n");

      const answer = prompt(
        "اكتب أرقام 3 بادجات تفصل بينها فاصلة:\n\n" + list,
        "1,2,3"
      );

      if (!answer) return;

      const indexes = answer
        .split(",")
        .map((x) => Number(x.trim()) - 1)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < badges.length);

      const chosen = [...new Set(indexes)]
        .slice(0, 3)
        .map((i) => badges[i]);

      if (!chosen.length) return;

      const ok = await saveBadges(chosen.map((b) => b.key));

      if (!ok) {
        alert("فشل حفظ البادجات.");
        return;
      }

      renderChosenWithRoles(target, chosen, plus);
    });

    target.appendChild(plus);

    const saved = await loadSaved(login);
    if (saved.length) {
      const badges = getInventoryBadges();
      const map = new Map(badges.map((b) => [b.key, b]));
      const chosen = saved.map((key) => map.get(key)).filter(Boolean);

      if (chosen.length) {
        target.innerHTML = "";
        chosen.forEach((b) => target.appendChild(makeBadge(b)));
        target.appendChild(plus);
      }
    }
  }

  setTimeout(setup, 1800);
  setTimeout(setup, 3500);
})();
