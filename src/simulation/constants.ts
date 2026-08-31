export const AMBIENT_TEMPERATURE = 20
export const MINIMUM_TEMPERATURE = -200
export const MAXIMUM_TEMPERATURE = 2_000
export const THERMAL_INTERVAL = 2
export const MOISTURE_INTERVAL = 6
// Energy is stored as 10 kJ/m³. Real-world material values are rounded at this scale.
export const THERMAL_ENERGY_UNIT_J_M3 = 10_000
// Spatial scale and elapsed physical time are gameplay-accelerated, while Q = m·c·ΔT remains intact.
export const THERMAL_CONDUCTANCE_SCALE = 12
export const MAXIMUM_PAIR_EXCHANGE_FRACTION = 0.12
export const AIR_AMBIENT_EXCHANGE_FRACTION = 0.08
