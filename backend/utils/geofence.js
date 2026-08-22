/**
 * Haversine formula optimized for V8 engine execution speed.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const toRad = Math.PI / 180;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const deltaPhi = (lat2 - lat1) * toRad;
    const deltaLambda = (lon2 - lon1) * toRad;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

function isWithinGeofence(employeeLat, employeeLon, locationData) {
    // Explicit null/undefined/NaN checks, not truthiness — a falsy check
    // here would wrongly treat a valid `0` (equator or prime meridian,
    // both in-range per the WorkLocation schema) as "missing."
    const missing = (v) => v === null || v === undefined || Number.isNaN(v);
    if (missing(employeeLat) || missing(employeeLon) || missing(locationData.latitude) || missing(locationData.longitude)) {
        return { within: false, distanceMeters: null, error: "Missing coordinates" };
    }

    const distance = calculateDistance(
        employeeLat, 
        employeeLon, 
        locationData.latitude, 
        locationData.longitude
    );
    
    return {
        within: distance <= locationData.radiusMeters,
        distanceMeters: Math.round(distance)
    };
}

module.exports = { calculateDistance, isWithinGeofence };