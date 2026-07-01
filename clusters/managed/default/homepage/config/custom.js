// Rotates the Homepage background through Boulder-themed images based on local solar phases.
(function manageBoulderWallpaper() {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const fallbackRefreshMs = 6 * hourMs;
  const fallbackImage = "https://images.unsplash.com/photo-1600104146011-ad1a8571f161";
  const timeZone = "America/Denver";
  const latitude = 40.0150;
  const longitude = -105.2705;
  let refreshTimer;
  let currentWallpaper;
  let observerStarted = false;
  let syncQueued = false;

  const wallpapers = {
    dawn: ["/images/homepage/dawn.webp", "/images/homepage/sunrise.webp", fallbackImage],
    morning: ["/images/homepage/morning.webp", "/images/homepage/sunrise.webp", fallbackImage],
    afternoon: ["/images/homepage/afternoon.webp", "/images/homepage/day.webp", fallbackImage],
    evening: ["/images/homepage/evening.webp", "/images/homepage/sunset.webp", fallbackImage],
    twilight: ["/images/homepage/twilight.webp", "/images/homepage/sunset.webp", fallbackImage],
    night: ["/images/homepage/night.webp", fallbackImage],
  };

  // Converts degrees to radians for the solar-position calculations.
  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  // Converts radians to degrees for the solar-position calculations.
  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  // Wraps an angle into the 0-360 degree range.
  function normalizeDegrees(value) {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  // Wraps an hour value into the 0-24 hour range.
  function normalizeHours(value) {
    const normalized = value % 24;
    return normalized < 0 ? normalized + 24 : normalized;
  }

  // Extracts calendar date parts for a Date in the configured time zone.
  function getZonedDateParts(date, zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);

    const values = {};
    // Copies only semantic date fields from Intl parts into a numeric lookup.
    parts.forEach((part) => {
      if (part.type !== "literal") {
        values[part.type] = Number(part.value);
      }
    });

    return {
      year: values.year,
      month: values.month,
      day: values.day,
    };
  }

  // Shifts a date-part object by the requested number of days.
  function addDays(parts, days) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  // Calculates the ordinal day number for solar-event formulas.
  function dayOfYear(parts) {
    return Math.floor((Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(parts.year, 0, 0)) / (24 * hourMs));
  }

  // Compares two date-part objects by their UTC calendar date.
  function compareDateParts(left, right) {
    const leftDate = Date.UTC(left.year, left.month - 1, left.day);
    const rightDate = Date.UTC(right.year, right.month - 1, right.day);
    return Math.sign(leftDate - rightDate);
  }

  // Adjusts a computed solar-event timestamp so it lands on the intended local date.
  function alignEventToZonedDate(timestamp, parts) {
    let aligned = timestamp;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const eventParts = getZonedDateParts(new Date(aligned), timeZone);
      const comparison = compareDateParts(eventParts, parts);

      if (comparison === 0) return aligned;
      aligned -= comparison * 24 * hourMs;
    }

    return aligned;
  }

  // Calculates either sunrise or sunset for the configured latitude and longitude.
  function calculateSolarEvent(parts, isSunrise) {
    const zenith = 90.8333;
    const lngHour = longitude / 15;
    const day = dayOfYear(parts);
    const timeOffset = isSunrise ? 6 : 18;
    const t = day + (timeOffset - lngHour) / 24;
    const meanAnomaly = 0.9856 * t - 3.289;

    let trueLongitude =
      meanAnomaly +
      1.916 * Math.sin(toRadians(meanAnomaly)) +
      0.020 * Math.sin(toRadians(2 * meanAnomaly)) +
      282.634;
    trueLongitude = normalizeDegrees(trueLongitude);

    let rightAscension = toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude))));
    rightAscension = normalizeDegrees(rightAscension);

    const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
    const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
    rightAscension = (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15;

    const sinDec = 0.39782 * Math.sin(toRadians(trueLongitude));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosHour =
      (Math.cos(toRadians(zenith)) - sinDec * Math.sin(toRadians(latitude))) /
      (cosDec * Math.cos(toRadians(latitude)));

    if (cosHour > 1 || cosHour < -1) {
      return null;
    }

    let hourAngle = isSunrise ? 360 - toDegrees(Math.acos(cosHour)) : toDegrees(Math.acos(cosHour));
    hourAngle /= 15;

    const localMeanTime = hourAngle + rightAscension - 0.06571 * t - 6.622;
    const universalTime = normalizeHours(localMeanTime - lngHour);
    const timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) + universalTime * hourMs;
    return alignEventToZonedDate(timestamp, parts);
  }

  // Calculates sunrise and sunset for today and tomorrow in the configured time zone.
  function getSolarTimes(now = new Date()) {
    const today = getZonedDateParts(now, timeZone);
    const tomorrow = addDays(today, 1);

    return {
      today: {
        sunrise: calculateSolarEvent(today, true),
        sunset: calculateSolarEvent(today, false),
      },
      tomorrow: {
        sunrise: calculateSolarEvent(tomorrow, true),
        sunset: calculateSolarEvent(tomorrow, false),
      },
    };
  }

  // Chooses the wallpaper phase for the current time relative to sunrise and sunset.
  function choosePhase(solarTimes) {
    if (!solarTimes?.today?.sunrise || !solarTimes?.today?.sunset) return null;

    const now = Date.now();
    const { sunrise, sunset } = solarTimes.today;

    if (now < sunrise - 60 * minuteMs) return "night";
    if (now < sunrise) return "dawn";
    if (now < sunrise + 3 * 60 * minuteMs) return "morning";
    if (now < sunset - 2 * 60 * minuteMs) return "afternoon";
    if (now < sunset) return "evening";
    if (now < sunset + 90 * minuteMs) return "twilight";
    return "night";
  }

  // Finds the next timestamp where the wallpaper phase should be recalculated.
  function getNextPhaseBoundary(solarTimes) {
    if (!solarTimes?.today?.sunrise || !solarTimes?.today?.sunset) return null;

    const now = Date.now();
    const boundaries = [
      solarTimes.today.sunrise - 60 * minuteMs,
      solarTimes.today.sunrise,
      solarTimes.today.sunrise + 3 * 60 * minuteMs,
      solarTimes.today.sunset - 2 * 60 * minuteMs,
      solarTimes.today.sunset,
      solarTimes.today.sunset + 90 * minuteMs,
      solarTimes.tomorrow?.sunrise ? solarTimes.tomorrow.sunrise - 60 * minuteMs : null,
      solarTimes.tomorrow?.sunrise,
      solarTimes.tomorrow?.sunrise ? solarTimes.tomorrow.sunrise + 3 * 60 * minuteMs : null,
    // Drops unavailable solar boundaries before selecting the next future one.
    ].filter((boundary) => Number.isFinite(boundary));

    // Returns the first phase boundary that is safely in the future.
    return boundaries.find((boundary) => boundary > now + 1000);
  }

  // Computes how long to wait before refreshing the selected wallpaper.
  function getNextRefreshDelay(solarTimes) {
    const now = Date.now();
    const phaseBoundary = getNextPhaseBoundary(solarTimes);
    const nextRunAt = Math.min(phaseBoundary || Infinity, now + fallbackRefreshMs);

    return Math.max(1000, nextRunAt - now);
  }

  // Schedules the next wallpaper refresh and replaces any prior timer.
  function scheduleNextRefresh(solarTimes) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(applyWallpaper, getNextRefreshDelay(solarTimes));
  }

  // Builds the CSS background stack with the current theme overlay and image URL.
  function buildBackgroundImage(image) {
    return `linear-gradient(rgb(var(--bg-color) / 0.5), rgb(var(--bg-color) / 0.5)), url('${image}')`;
  }

  // Applies the selected wallpaper to Homepage's background targets and metadata.
  function syncWallpaperTarget() {
    if (!currentWallpaper) return;

    const { image, phase } = currentWallpaper;
    const background = document.getElementById("background");
    const backgroundImage = buildBackgroundImage(image);

    document.documentElement.dataset.ocWallpaperPhase = phase || "unavailable";
    document.documentElement.dataset.ocWallpaperUpdatedAt = new Date().toISOString();
    document.documentElement.style.setProperty("--oc-wallpaper-image", `url('${image}')`);

    document.body.style.backgroundImage = backgroundImage;
    document.body.style.backgroundAttachment = "fixed";
    document.body.style.backgroundPosition = "center center";
    document.body.style.backgroundSize = "cover";

    if (background && background.style.backgroundImage !== backgroundImage) {
      background.style.backgroundImage = backgroundImage;
    }
  }

  // Debounces wallpaper reapplication onto the next animation frame.
  function queueWallpaperSync() {
    if (syncQueued) return;

    syncQueued = true;
    // Runs one wallpaper sync after Homepage finishes the current DOM/style mutation batch.
    window.requestAnimationFrame(() => {
      syncQueued = false;
      syncWallpaperTarget();
    });
  }

  // Watches Homepage DOM/style mutations that can overwrite the background.
  function observeWallpaperTarget() {
    if (observerStarted || !document.body) return;
    observerStarted = true;

    const observer = new MutationObserver(queueWallpaperSync);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true,
    });
  }

  // Stores the active wallpaper choice and immediately syncs it into the DOM.
  function applyWallpaperImage(image, phase) {
    currentWallpaper = { image, phase };
    syncWallpaperTarget();
  }

  // Preloads fallback images for smoother future phase changes.
  function warmImages(candidates) {
    // Starts browser image loads without adding the candidates to the document.
    candidates.forEach((candidate) => {
      if (!candidate) return;
      const image = new Image();
      image.src = candidate;
    });
  }

  // Selects the current wallpaper, warms alternates, and schedules the next refresh.
  function applyWallpaper() {
    const solarTimes = getSolarTimes();
    const phase = choosePhase(solarTimes);
    const candidates = phase ? wallpapers[phase] || [fallbackImage] : [fallbackImage];
    const image = candidates[0] || fallbackImage;

    applyWallpaperImage(image, phase);
    warmImages(candidates.slice(1));

    scheduleNextRefresh(solarTimes);
  }

  // Starts wallpaper observation, applies the initial image, and wires refresh triggers.
  const start = () => {
    observeWallpaperTarget();
    applyWallpaper();
    window.addEventListener("pageshow", applyWallpaper);
    window.addEventListener("focus", applyWallpaper);
    // Refreshes the wallpaper when the tab becomes visible again.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) applyWallpaper();
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

(function mountStatusBadges() {
  const badges = [
    {
      href: "https://github.com/nirmalhk7/operationscenter/tree/main/clusters/managed",
      src: "https://img.shields.io/github/actions/workflow/status/nirmalhk7/operationscenter/test-k8s.yaml?branch=main&label=GitOps&logo=fluxcd&logoColor=white",
      alt: "GitOps status",
    },
    {
      href: "https://github.com/nirmalhk7/operationscenter/releases?q=equity-research-v&expanded=true",
      src: "https://img.shields.io/github/v/release/nirmalhk7/operationscenter?filter=equity-research-v*&label=equity-research&display_name=tag&sort=semver&logo=npm&logoColor=white",
      alt: "Equity Research version",
    },
    {
      href: "https://github.com/nirmalhk7/operationscenter/releases?q=fix-that-thang-v&expanded=true",
      src: "https://img.shields.io/github/v/release/nirmalhk7/operationscenter?filter=fix-that-thang-v*&label=fix-that-thang&display_name=tag&sort=semver&logo=npm&logoColor=white",
      alt: "Fix That Thang version",
    },
  ];

  const render = () => {
    if (document.getElementById("oc-status-badges")) return;

    const anchor =
      document.querySelector("#information-widgets") ||
      document.querySelector("header") ||
      document.body;

    const container = document.createElement("div");
    container.id = "oc-status-badges";

    badges.forEach(({ href, src, alt }) => {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const image = document.createElement("img");
      image.src = src;
      image.alt = alt;
      image.loading = "lazy";

      link.appendChild(image);
      container.appendChild(link);
    });

    anchor.appendChild(container);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();

(function splitHomepageSections() {
  const railGroups = new Set(["Tools", "LLMs and AI"]);
  const mainGroupOrder = new Map([
    ["Observability", "10"],
    ["Networking", "20"],
    ["Multimedia and Entertainment", "30"],
    ["DevBench", "40"],
  ]);
  const railGroupOrder = new Map([
    ["Tools", "1"],
    ["LLMs and AI", "2"],
  ]);
  let queued = false;

  function findGroupRoot(heading) {
    let current = heading.parentElement;

    while (current && current !== document.body) {
      if (current.querySelector(".services-list")) return current;
      current = current.parentElement;
    }

    return null;
  }

  function tagSections() {
    const sections = [];

    Array.from(document.querySelectorAll("h2, h3")).forEach((heading) => {
      const groupName = heading.textContent.trim();
      const isRail = railGroups.has(groupName);
      const isMain = mainGroupOrder.has(groupName);
      if (!isRail && !isMain) return;

      const section = findGroupRoot(heading);
      if (!section) return;

      section.classList.toggle("oc-homepage-rail-section", isRail);
      section.classList.toggle("oc-homepage-main-section", isMain);
      section.dataset.ocHomepageGroup = groupName;
      section.style.order = isRail ? railGroupOrder.get(groupName) : mainGroupOrder.get(groupName);
      sections.push(section);
    });

    const parent = sections[0]?.parentElement;
    if (!parent) return;

    if (sections.every((section) => section.parentElement === parent)) {
      parent.classList.add("oc-homepage-split-grid");
    }
  }

  function scheduleTagging() {
    if (queued) return;

    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      tagSections();
    });
  }

  function start() {
    tagSections();

    const observer = new MutationObserver(scheduleTagging);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

(function filterLocalHomepage() {
  if (window.location.host !== "10.0.0.10") return;

  const render = () => {
    Array.from(document.querySelectorAll(".services-list")).forEach((list) => {
      Array.from(list.children).forEach((item) => {
        if (!item.id.startsWith("local-")) {
          item.remove();
        }
      });

      if (list.children.length === 0) {
        list?.parentElement?.parentElement?.remove();
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
