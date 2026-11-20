/**
 * Haversine distance and transit time calculations
 */

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
