(function manageBoulderWallpaper() {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const fallbackRefreshMs = 6 * hourMs;
  const fallbackImage = "https://images.unsplash.com/photo-1600104146011-ad1a8571f161";
  const timeZone = "America/Denver";
  const latitude = 40.0150;
  const longitude = -105.2705;
  let refreshTimer;

  const wallpapers = {
    dawn: ["/images/homepage/dawn.webp", "/images/homepage/sunrise.webp", fallbackImage],
    morning: ["/images/homepage/morning.webp", "/images/homepage/sunrise.webp", fallbackImage],
    afternoon: ["/images/homepage/afternoon.webp", "/images/homepage/day.webp", fallbackImage],
    evening: ["/images/homepage/evening.webp", "/images/homepage/sunset.webp", fallbackImage],
    twilight: ["/images/homepage/twilight.webp", "/images/homepage/sunset.webp", fallbackImage],
    night: ["/images/homepage/night.webp", fallbackImage],
  };

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  function normalizeDegrees(value) {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function normalizeHours(value) {
    const normalized = value % 24;
    return normalized < 0 ? normalized + 24 : normalized;
  }

  function getZonedDateParts(date, zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);

    const values = {};
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

  function addDays(parts, days) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  function dayOfYear(parts) {
    return Math.floor((Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(parts.year, 0, 0)) / (24 * hourMs));
  }

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
    return Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) + universalTime * hourMs;
  }

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
    ].filter((boundary) => Number.isFinite(boundary));

    return boundaries.find((boundary) => boundary > now + 1000);
  }

  function getNextRefreshDelay(solarTimes) {
    const now = Date.now();
    const phaseBoundary = getNextPhaseBoundary(solarTimes);
    const nextRunAt = Math.min(phaseBoundary || Infinity, now + fallbackRefreshMs);

    return Math.max(1000, nextRunAt - now);
  }

  function scheduleNextRefresh(solarTimes) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(applyWallpaper, getNextRefreshDelay(solarTimes));
  }

  function applyWallpaperImage(image, phase) {
    const background = document.getElementById("background");
    const backgroundImage = `linear-gradient(rgb(var(--bg-color) / 0.5), rgb(var(--bg-color) / 0.5)), url('${image}')`;

    document.documentElement.dataset.ocWallpaperPhase = phase || "unavailable";
    document.documentElement.style.setProperty("--oc-wallpaper-image", `url('${image}')`);

    if (background) {
      background.style.backgroundImage = backgroundImage;
    } else {
      document.body.style.backgroundImage = backgroundImage;
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.backgroundPosition = "center center";
      document.body.style.backgroundSize = "cover";
    }
  }

  function warmImages(candidates) {
    candidates.forEach((candidate) => {
      if (!candidate) return;
      const image = new Image();
      image.src = candidate;
    });
  }

  function applyWallpaper() {
    const solarTimes = getSolarTimes();
    const phase = choosePhase(solarTimes);
    const candidates = phase ? wallpapers[phase] || [fallbackImage] : [fallbackImage];
    const image = candidates[0] || fallbackImage;

    applyWallpaperImage(image, phase);
    warmImages(candidates.slice(1));

    scheduleNextRefresh(solarTimes);
  }

  const start = () => {
    applyWallpaper();
    window.addEventListener("focus", applyWallpaper);
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
      href: "https://github.com/nirmalhk7/operationscenter/actions",
      src: "https://img.shields.io/github/checks-status/nirmalhk7/operationscenter/main?label=CI&logo=githubactions&logoColor=white",
      alt: "CI status",
    },
    {
      href: "https://github.com/nirmalhk7/operationscenter/tree/main/clusters/managed",
      src: "https://img.shields.io/github/actions/workflow/status/nirmalhk7/operationscenter/test-k8s.yaml?branch=main&label=GitOps&logo=fluxcd&logoColor=white",
      alt: "GitOps status",
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
