// Shared attendance-status display mapping — was previously duplicated
// separately in ResultScreen.jsx and MyAttendanceScreen.jsx with the same
// hex values, one edit away from drifting out of sync.
export const STATUS_LABEL = {
  VALID: 'On time',
  LATE: 'Late',
  EARLY_DEPARTURE: 'Left early',
  LOCATION_MISMATCH: 'Location issue',
  SPOOF_ATTEMPT: 'Verification failed',
};

// CSS custom property names, not literal hex — resolved via var() so this
// stays in sync with the token file instead of hardcoding colors again.
export const STATUS_COLOR_VAR = {
  VALID: 'var(--color-verify)',
  LATE: 'var(--color-warning)',
  EARLY_DEPARTURE: 'var(--color-warning)',
  LOCATION_MISMATCH: 'var(--color-danger)',
  SPOOF_ATTEMPT: 'var(--color-danger)',
};
