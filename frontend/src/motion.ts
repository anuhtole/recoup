// Every animation the user touches is a critically damped spring (no overshoot).
// Sheets travel further, so they get a little longer.
export const SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const;
export const SHEET_SPRING = { type: "spring", bounce: 0, duration: 0.5 } as const;
