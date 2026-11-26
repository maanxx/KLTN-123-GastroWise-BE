/**
 * Haversine distance, transit time, and strict GeoJSON coordinate utilities
 */

export interface GeoCoordinates {
  lat: number;
  lon: number;
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

function parseFiniteCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'boolean') {
    return null;
  }
  const normalized =
    typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * Validates and parses a latitude / longitude pair.
 * Rejects NaN, out-of-range coordinates, incomplete pairs, and [0, 0] Null Island.
 */
export function parseValidCoordinatePair(
  latInput: unknown,
  lonInput: unknown,
): GeoCoordinates | null {
  const lat = parseFiniteCoord(latInput);
  const lon = parseFiniteCoord(lonInput);

  if (lat === null || lon === null) {
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  if (lat === 0 && lon === 0) {
    return null;
  }
  return { lat, lon };
}

/**
 * Builds a strict GeoJSON Point ([longitude, latitude]) or returns null if invalid/missing.
 */
export function toGeoJsonPoint(
  latInput: unknown,
  lonInput: unknown,
): GeoJsonPoint | null {
  const pair = parseValidCoordinatePair(latInput, lonInput);
  if (!pair) {
    return null;
  }
  return {
    type: 'Point',
    coordinates: [pair.lon, pair.lat],
  };
}

/**
 * Extracts validated coordinates from a GeoJSON Point `location` (preferred) or flat `lat`/`lon`/`lng` fields.
 * Never fabricates fallback coordinates such as [106.7009, 10.7769].
 */
export function extractValidGeoPoint(doc: unknown): GeoCoordinates | null {
  if (!doc || typeof doc !== 'object') {
    return null;
  }

  const record = doc as {
    location?: { type?: unknown; coordinates?: unknown };
    lat?: unknown;
    lon?: unknown;
    lng?: unknown;
  };

  const coords = record.location?.coordinates;
  if (
    record.location?.type === 'Point' &&
    Array.isArray(coords) &&
    coords.length === 2
  ) {
    const fromGeoJson = parseValidCoordinatePair(coords[1], coords[0]);
    if (fromGeoJson) {
      return fromGeoJson;
    }
  }

  const flatLon = record.lon !== undefined ? record.lon : record.lng;
  return parseValidCoordinatePair(record.lat, flatLon);
}

/**
 * Checks whether a GeoJSON Point payload satisfies type, bounds, and non-[0,0] invariants.
 */
export function isValidGeoJsonPoint(
  location: unknown,
): location is GeoJsonPoint {
  if (!location || typeof location !== 'object') {
    return false;
  }
  const loc = location as { type?: unknown; coordinates?: unknown };
  if (
    loc.type !== 'Point' ||
    !Array.isArray(loc.coordinates) ||
    loc.coordinates.length !== 2
  ) {
    return false;
  }
  return (
    parseValidCoordinatePair(loc.coordinates[1], loc.coordinates[0]) !== null
  );
}

export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function estimateTransitTimeMinutes(
  distanceKm: number,
  mode: 'walking' | 'driving' | 'transit' | 'motorbike' = 'motorbike',
): number {
  // Average speeds in urban city (km/h)
  const speeds: Record<string, number> = {
    walking: 4.5,
    motorbike: 25,
    driving: 20,
    transit: 15,
  };
  const speed = speeds[mode] || 25;
  const hours = distanceKm / speed;
  const minutes = Math.round(hours * 60);
  return Math.max(minutes, 3); // minimum 3 mins transit
}
