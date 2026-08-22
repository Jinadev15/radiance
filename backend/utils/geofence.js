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
    if (!employeeLat || !employeeLon || !locationData.latitude || !locationData.longitude) {
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