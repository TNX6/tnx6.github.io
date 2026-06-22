// Auto-generated from src/pages/badges.astro
// Do not edit manually. Edit badges.astro source blocks, then regenerate.

(function () {
  const BADGE_META = {
        king: { title: 'ملك القناة', category: 'status', how: 'يفتح من نظام King of Channel Points.', rarity: 'نادر جدًا', duration: 'دائم', difficulty: 'صعب' },
        king2: { title: 'ملك القناة', category: 'status', how: 'يفتح من نظام King of Channel Points.', rarity: 'نادر جدًا', duration: 'دائم', difficulty: 'صعب جدًا' },
        Vip: { title: 'VIP', category: 'status', how: 'منحة خاصة حسب تفاعل العضو ومكانته.', rarity: 'مميز', duration: 'قد يكون مؤقت أو دائم', difficulty: 'متوسط' },
        '15D': { title: 'حضور 15 يوم', category: 'attendance', how: 'سجّل حضورك اليومي حتى توصل 15 يوم.', rarity: 'أساسي', duration: 'دائم', difficulty: 'سهل' },
        '30D': { title: 'حضور 30 يوم', category: 'attendance', how: 'كمل تسجيل الحضور اليومي حتى توصل 30 يوم.', rarity: 'أساسي', duration: 'دائم', difficulty: 'سهل' },
        '60D': { title: 'حضور 60 يوم', category: 'attendance', how: 'استمر بالحضور حتى توصل 60 يوم.', rarity: 'متقدم', duration: 'دائم', difficulty: 'متوسط' },
        '100D': { title: 'حضور 100 يوم', category: 'attendance', how: 'استمر في تسجيل الحضور حتى توصل 100 يوم.', rarity: 'متقدم', duration: 'دائم', difficulty: 'متوسط' },
        '150D': { title: 'حضور 150 يوم', category: 'attendance', how: 'استمر في تسجيل الحضور حتى توصل 150 يوم.', rarity: 'نادر', duration: 'دائم', difficulty: 'صعب' },
        LAW: { title: 'رخصة محامي', category: 'law', how: 'تحصل عليه عند تفعيل دور المحامي.', rarity: 'مميز', duration: 'دائم', difficulty: 'صعب' },
        LAW2: { title: 'رخصة محامي', category: 'law', how: 'تحصل عليه عند تفعيل دور المحامي.', rarity: 'مميز', duration: 'دائم', difficulty: 'صعب' },
        '50Q': { title: '50 إجابة صحيحة', category: 'quiz', how: 'جاوب 50 سؤال كويز بشكل صحيح.', rarity: 'أساسي', duration: 'دائم', difficulty: 'سهل' },
        '150Q': { title: '150 إجابة صحيحة', category: 'quiz', how: 'جاوب 150 سؤال كويز بشكل صحيح.', rarity: 'أساسي', duration: 'دائم', difficulty: 'سهل' },
        '300Q': { title: '300 إجابة صحيحة', category: 'quiz', how: 'جاوب 300 سؤال كويز بشكل صحيح.', rarity: 'متقدم', duration: 'دائم', difficulty: 'سهل' },
        '600Q': { title: '600 إجابة صحيحة', category: 'quiz', how: 'جاوب 600 سؤال كويز بشكل صحيح.', rarity: 'مميز', duration: 'دائم', difficulty: 'صعب' },
        '1000Q': { title: '1000 إجابة صحيحة', category: 'quiz', how: 'جاوب 1000 سؤال كويز بشكل صحيح.', rarity: 'نادر جدًا', duration: 'دائم', difficulty: 'صعب' },
        '100K': { title: 'رصيد 100K', category: 'points', how: 'اجمع 100,000 نقطة من التفاعل في البث.', rarity: 'أساسي', duration: 'دائم', difficulty: 'سهل' },
        '250K': { title: 'رصيد 250K', category: 'points', how: 'اجمع 250,000 نقطة من التفاعل في البث.', rarity: 'متقدم', duration: 'دائم', difficulty: 'متوسط' },
        '500K': { title: 'رصيد 500K', category: 'points', how: 'اجمع 500,000 نقطة من التفاعل في البث.', rarity: 'متقدم', duration: 'دائم', difficulty: 'صعب' },
        '1M': { title: 'رصيد مليون', category: 'points', how: 'اجمع 1,000,000 نقطة من التفاعل في البث.', rarity: 'نادر', duration: 'دائم', difficulty: 'صعب جدًا' },
        '3M': { title: 'رصيد 3 مليون', category: 'points', how: 'اجمع 3,000,000 نقطة من التفاعل في البث.', rarity: 'نادر جدًا', duration: 'دائم', difficulty: 'مستحيل' },
        'BEST VIP': { title: 'أفضل VIP', category: 'awards', how: 'بادج تكريمي يُمنح ضمن جوائز المجتمع.', rarity: 'جائزة', duration: 'دائم', difficulty: 'خاص' },
        'BEST MOD': { title: 'أفضل مود', category: 'awards', how: 'بادج تكريمي لأفضل مود في جوائز المجتمع.', rarity: 'جائزة', duration: 'دائم', difficulty: 'خاص' },
        'BEST CHATER': { title: 'أفضل متفاعل', category: 'awards', how: 'بادج تكريمي لأفضل شخص متفاعل في الشات.', rarity: 'جائزة', duration: 'دائم', difficulty: 'خاص' },
        'BEST FOLLOWER': { title: 'أفضل متابع', category: 'awards', how: 'بادج تكريمي لأفضل متابع في المجتمع.', rarity: 'جائزة', duration: 'دائم', difficulty: 'خاص' },
        'BEST SUP': { title: 'أفضل داعم', category: 'awards', how: 'بادج تكريمي لأفضل داعم في المجتمع.', rarity: 'جائزة', duration: 'دائم', difficulty: 'خاص' },
        'Best Dessert': { title: 'أفضل Dessert', category: 'awards', how: 'بادج تكريمي لأفضل حلا.', rarity: 'جائزة', duration: 'دائم', difficulty: 'خاص' },
      }

  const BADGE_PATHS = [
        {
          key: 'points',
          title: 'مسار النقاط',
          unit: 'نقطة',
          metricKeys: ['points', 'totalPoints', 'score'],
          steps: [
            { name: '100K', value: 100000 },
            { name: '250K', value: 250000 },
            { name: '500K', value: 500000 },
            { name: '1M', value: 1000000 },
            { name: '3M', value: 3000000 },
          ],
        },
        {
          key: 'attendance',
          title: 'مسار الحضور',
          unit: 'يوم',
          metricKeys: ['checkins', 'checkIns', 'dailyCheckIns', 'attendanceDays', 'totalCheckins', 'totalCheckIns', 'streak'],
          steps: [
            { name: '15D', value: 15 },
            { name: '30D', value: 30 },
            { name: '60D', value: 60 },
            { name: '100D', value: 100 },
            { name: '150D', value: 150 },
          ],
        },
        {
          key: 'quiz',
          title: 'مسار الكويز',
          unit: 'إجابة',
          metricKeys: ['quizCorrect', 'quiz_correct', 'correctAnswers', 'quizCorrectAnswers', 'correctQuizAnswers', 'quizWins', 'answersCorrect'],
          steps: [
            { name: '50Q', value: 50 },
            { name: '150Q', value: 150 },
            { name: '300Q', value: 300 },
            { name: '600Q', value: 600 },
            { name: '1000Q', value: 1000 },
          ],
        },
      ]

      const JOB_ICONS = window.JOB_ICONS || {
        tier1_Citizen: 'mdi:account',
        tier3_Merchant: 'mdi:store',
      }

      window.JOB_ICONS = JOB_ICONS

      const state = {
        badges: [],
        users: [],
        filter: 'all',
        search: '',
        selectedBadgeName: '',
        currentUser: null,
        vaultPage: 1,
      }

      const badgeGrid = document.getElementById('badgeGrid')
      const badgeEmpty = document.getElementById('badgeEmpty')
      const badgeSearch = document.getElementById('badgeSearch')
      const clearBadgeSearch = document.getElementById('clearBadgeSearch')
      const badgeFocusPanel = document.getElementById('badgeFocusPanel')
      const filterButtons = Array.from(document.querySelectorAll('[data-badge-filter]'))
      const guideButtons = Array.from(document.querySelectorAll('[data-guide-filter]'))
      const backToTop = document.getElementById('backToTop')

      const statTotalBadges = document.getElementById('statTotalBadges')
      const statCategories = document.getElementById('statCategories')
      const statRareBadges = document.getElementById('statRareBadges')

      const userSearch = document.getElementById('userSearch')
      const clearUserSearch = document.getElementById('clearUserSearch')
      const userResults = document.getElementById('userResults')
      const userCardContainer = document.getElementById('userCardContainer')

      // تعريف تقنية الكشف عن النزول (Intersection Observer) مع تنظيفه عند التنقل بين الصفحات
      const revealTargets = Array.from(document.querySelectorAll('.tnx-reveal'))
      let revealObserver = null

      if ('IntersectionObserver' in window) {
        revealObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible')
              revealObserver?.unobserve(entry.target)
            }
          })
        }, { threshold: 0.1 })

        revealTargets.forEach((el) => revealObserver.observe(el))
        listeners.push(() => revealObserver?.disconnect())
      } else {
        revealTargets.forEach((el) => el.classList.add('is-visible'))
      }

      function esc(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')
      }

      function safeUrl(value) {
        const url = String(value || '').trim()
        if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return ''
        return url.replace(/["'()\\]/g, '')
      }

      function cssUrl(value) {
        const url = safeUrl(value)
        if (!url) return 'none'
        return `url('${url}')`
      }

      function safeColor(value, fallback = '#423fff') {
        const color = String(value || '').trim()
        return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
      }

      function normalize(value) {
        return String(value || '')
          .toLowerCase()
          .replace(/[ًٌٍَُِّْـ]/g, '')
          .replace(/[أإآ]/g, 'ا')
          .replace(/ة/g, 'ه')
          .replace(/ى/g, 'ي')
          .replace(/\s+/g, ' ')
          .trim()
      }

  function cleanBadgeName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function badgeKey(value) {
    return cleanBadgeName(value)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9\u0600-\u06ff]/g, "");
  }

  function badgeTitleKey(value) {
    const raw = cleanBadgeName(value);
    const first = raw.split(/\s*-\s*/)[0] || raw;
    return badgeKey(first);
  }

  function normalizeBadgeMeta(meta, fallbackName) {
    const title = cleanBadgeName(meta?.title || fallbackName || "بادج");
    return {
      title,
      category: meta?.category || "عام",
      how: meta?.how || "يتم الحصول عليه من التفاعل داخل المجتمع",
      rarity: meta?.rarity || "عادي",
      duration: meta?.duration || "",
      difficulty: meta?.difficulty || "",
      xp: meta?.xp || ""
    };
  }

  function getBadgeMetaShared(name) {
    const raw = cleanBadgeName(name);
    const directKey = badgeKey(raw);
    const titleKey = badgeTitleKey(raw);

    const meta =
      BADGE_META[directKey] ||
      BADGE_META[titleKey] ||
      BADGE_META[raw] ||
      BADGE_META[raw.toLowerCase()] ||
      null;

    return normalizeBadgeMeta(meta, raw.split(/\s*-\s*/)[0] || raw);
  }

  window.TNX_BADGE_META = BADGE_META;
  window.TNX_BADGE_PATHS = BADGE_PATHS;
  window.TNX_BADGE_KEY = badgeKey;
  window.TNX_BADGE_TITLE_KEY = badgeTitleKey;
  window.TNX_GET_BADGE_META = getBadgeMetaShared;
})();
