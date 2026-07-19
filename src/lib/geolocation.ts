import { COUNTRIES } from "../types.js";

const VALID_COUNTRY_CODES = new Set(COUNTRIES.map(c => c.code));
const FALLBACK_COUNTRY = "in";
const GEOLOCATION_TIMEOUT_MS = 5000;

/**
 * Detects a new user's default country from browser geolocation permission,
 * falling back to India if permission is denied, unavailable, or anything
 * fails. Never throws — always resolves to a valid country code.
 */
export async function detectPreferredCountry(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return FALLBACK_COUNTRY;
  }

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: 60 * 60 * 1000
      });
    });

    const { latitude, longitude } = position.coords;
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEOLOCATION_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return FALLBACK_COUNTRY;

    const data = await response.json();
    const countryCode = (data?.countryCode || "").toLowerCase();

    return VALID_COUNTRY_CODES.has(countryCode) ? countryCode : FALLBACK_COUNTRY;
  } catch {
    return FALLBACK_COUNTRY;
  }
}
