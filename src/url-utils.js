(function exposeUrlUtils(root) {
  "use strict";

  const TWITTER_MEDIA_HOST = "pbs.twimg.com";
  const TWITTER_MEDIA_PATH_PREFIX = "/media/";
  const META_MEDIA_HOST_SUFFIXES = ["cdninstagram.com", "fbcdn.net"];
  const FALLBACK_EXTENSION = "jpg";
  const EXTENSIONS_BY_FORMAT = {
    jpg: "jpg",
    jpeg: "jpg",
    png: "png",
    webp: "webp",
    gif: "gif",
    avif: "avif"
  };

  function normalizeTwitterImageUrl(input) {
    if (!input) {
      throw new Error("No image URL was provided.");
    }

    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname !== TWITTER_MEDIA_HOST) {
      throw new Error("This is not an X media image URL.");
    }

    if (!url.pathname.startsWith(TWITTER_MEDIA_PATH_PREFIX)) {
      throw new Error("Only X photo media URLs are supported.");
    }

    const rawFormat = url.searchParams.get("format") || inferFormatFromPath(url.pathname);
    const format = normalizeFormat(rawFormat);
    url.searchParams.set("format", format);
    url.searchParams.set("name", "orig");

    return {
      url: url.toString(),
      mediaId: extractTwitterMediaId(url.pathname),
      extension: EXTENSIONS_BY_FORMAT[format] || FALLBACK_EXTENSION
    };
  }

  function normalizeMediaImageUrl(input, pageUrl) {
    if (!input) {
      throw new Error("No image URL was provided.");
    }

    const url = new URL(input);
    if (url.hostname === TWITTER_MEDIA_HOST) {
      return Object.assign({ platform: "x" }, normalizeTwitterImageUrl(input));
    }

    if (url.protocol !== "https:" || !isMetaMediaHost(url.hostname)) {
      throw new Error("This is not a supported social media image URL.");
    }

    const format = normalizeFormat(inferFormatFromPath(url.pathname));
    return {
      url: url.toString(),
      platform: getPlatformFromPageUrl(pageUrl) || "instagram",
      mediaId: extractMetaMediaId(url.pathname),
      extension: EXTENSIONS_BY_FORMAT[format] || FALLBACK_EXTENSION
    };
  }

  function makeImageFilename(parts) {
    const statusId = sanitizeFilenamePart(parts.statusId || "unknown-status");
    const mediaId = sanitizeFilenamePart(parts.mediaId || "image");
    const extension = sanitizeFilenamePart(parts.extension || FALLBACK_EXTENSION).toLowerCase();
    const platform = sanitizePlatform(parts.platform || "x");
    return `${platform}-${statusId}-${mediaId}.${extension}`;
  }

  function getMediaImageQualityScore(input) {
    try {
      const url = new URL(input);
      if (!isMetaMediaHost(url.hostname)) {
        return 0;
      }

      const transform = url.searchParams.get("stp") || "";
      const size = transform.match(/(?:^|_)[sp](\d+)x(\d+)(?:_|$)/i);
      if (!size) {
        return 1_000_000_000;
      }

      return Number(size[1]) * Number(size[2]);
    } catch (_error) {
      return 0;
    }
  }

  function sortMediaImageUrlsByQuality(urls) {
    return Array.from(urls || []).sort((left, right) => {
      return getMediaImageQualityScore(right) - getMediaImageQualityScore(left);
    });
  }

  function getStatusIdFromPageUrl(pageUrl) {
    return getPostIdFromPageUrl(pageUrl);
  }

  function getPostIdFromPageUrl(pageUrl) {
    if (!pageUrl) {
      return "";
    }

    try {
      const url = new URL(pageUrl);
      const patterns = [
        /\/status(?:es)?\/(\d+)/,
        /\/post\/([a-zA-Z0-9_-]+)/,
        /\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)/
      ];
      for (const pattern of patterns) {
        const match = url.pathname.match(pattern);
        if (match) {
          return match[1];
        }
      }
      return "";
    } catch (_error) {
      return "";
    }
  }

  function getPlatformFromPageUrl(pageUrl) {
    if (!pageUrl) {
      return "";
    }

    try {
      const hostname = new URL(pageUrl).hostname.toLowerCase();
      if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) {
        return "x";
      }
      if (hostname === "threads.com" || hostname.endsWith(".threads.com") || hostname === "threads.net" || hostname.endsWith(".threads.net")) {
        return "threads";
      }
      if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) {
        return "instagram";
      }
    } catch (_error) {
      return "";
    }
    return "";
  }

  function sanitizeFilenamePart(value) {
    return String(value)
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 120) || "image";
  }

  function inferFormatFromPath(pathname) {
    const extension = pathname.split(".").pop();
    if (!extension || extension.includes("/")) {
      return "";
    }
    return extension.toLowerCase();
  }

  function normalizeFormat(format) {
    const normalized = String(format || FALLBACK_EXTENSION).toLowerCase();
    return EXTENSIONS_BY_FORMAT[normalized] ? normalized : FALLBACK_EXTENSION;
  }

  function extractTwitterMediaId(pathname) {
    const raw = decodeURIComponent(pathname.slice(TWITTER_MEDIA_PATH_PREFIX.length));
    return sanitizeFilenamePart(raw.replace(/\.[a-zA-Z0-9]+$/, ""));
  }

  function extractMetaMediaId(pathname) {
    const filename = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "image");
    return sanitizeFilenamePart(filename.replace(/\.[a-zA-Z0-9]+$/, ""));
  }

  function isMetaMediaHost(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return META_MEDIA_HOST_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
  }

  function sanitizePlatform(platform) {
    const normalized = String(platform || "").toLowerCase();
    return ["x", "threads", "instagram"].includes(normalized) ? normalized : "social";
  }

  const api = {
    getPlatformFromPageUrl,
    getPostIdFromPageUrl,
    getStatusIdFromPageUrl,
    getMediaImageQualityScore,
    makeImageFilename,
    normalizeMediaImageUrl,
    normalizeTwitterImageUrl,
    sanitizeFilenamePart,
    sortMediaImageUrlsByQuality
  };

  root.XPhotoSaverUrlUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
