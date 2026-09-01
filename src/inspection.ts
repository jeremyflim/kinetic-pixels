import {
  isAqueousLiquid,
  MATERIAL_BY_ID,
  MaterialId,
  SOURCE_EMISSION_INTERVAL,
  solutionConcentration,
  StatusFlag,
} from './simulation/materials'
import type { CellInspection, MaterialProperties } from './simulation/types'

export interface InspectionRow {
  label: string
  value: string
}

export interface InspectionSection {
  label: 'Live' | 'Material'
  rows: readonly InspectionRow[]
}

function percent(value: number, maximum: number): number {
  return maximum <= 0 ? 0 : Math.max(0, Math.min(100, Math.round(value / maximum * 100)))
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function materialForm(properties: MaterialProperties): string {
  const mobility = {
    none: 'still',
    immovable: 'fixed',
    powder: 'falling',
    fluid: 'flowing',
    rising: 'rising',
  }[properties.mobility]
  return `${properties.phase} / ${mobility}`
}

function conditions(inspection: CellInspection): string {
  const values = [
    inspection.status & StatusFlag.Burning ? 'Burning' : '',
    inspection.moisture > 0 ? 'Wet' : '',
    inspection.status & StatusFlag.Charged ? 'Charged' : '',
  ].filter(Boolean)
  return values.join(', ') || 'Stable'
}

function transientRows(inspection: CellInspection): InspectionRow[] {
  const rows: InspectionRow[] = []
  if (inspection.materialId === MaterialId.Source) {
    const programmed = inspection.state > 0 ? MATERIAL_BY_ID.get(inspection.state)?.label : undefined
    rows.push({ label: 'Source program', value: programmed ?? 'Touch material' })
  }
  if (inspection.materialId === MaterialId.Fire || inspection.materialId === MaterialId.Smoke || inspection.materialId === MaterialId.Spark) {
    rows.push({ label: 'Time left', value: `${(inspection.state / 60).toFixed(1)} s` })
  }
  if (inspection.materialId === MaterialId.Plant) {
    rows.push({ label: 'Growth', value: `${percent(inspection.state, 120)}%` })
  }
  return rows
}

function activePhaseRow(inspection: CellInspection): InspectionRow | undefined {
  if (inspection.phaseProgress <= 0) return undefined
  const transition = inspection.phaseTransitions.find((candidate) => candidate.direction === 'above'
    ? inspection.temperature >= candidate.temperature
    : inspection.temperature <= candidate.temperature)
  if (!transition) return undefined
  const product = MATERIAL_BY_ID.get(transition.product)?.label ?? 'new phase'
  return { label: 'Phase change', value: `${percent(inspection.phaseProgress, transition.latentHeat)}% → ${product}` }
}

function liveRows(inspection: CellInspection, properties: MaterialProperties): InspectionRow[] {
  const material = MATERIAL_BY_ID.get(inspection.materialId)
  const rows: InspectionRow[] = [
    { label: 'Material', value: inspection.materialId === MaterialId.Empty ? 'Air' : material?.label ?? 'Unknown' },
    { label: 'Temperature', value: `${inspection.temperature} °C` },
    { label: 'Condition', value: conditions(inspection) },
    ...transientRows(inspection),
  ]

  if (properties.moistureCapacity > 0) rows.push({ label: 'Moisture', value: `${percent(inspection.moisture, properties.moistureCapacity)}%` })
  if (properties.fuel > 0) {
    rows.push({ label: 'Fuel', value: `${percent(inspection.fuel, properties.fuel)}%` })
    const saturation = properties.moistureCapacity > 0 ? inspection.moisture / properties.moistureCapacity : 0
    rows.push({
      label: 'Ignition point',
      value: saturation >= 0.35
        ? 'Blocked — too wet'
        : `${(properties.ignitionTemperature ?? 0) + Math.round(saturation * 250)} °C`,
    })
  }
  if (isAqueousLiquid(inspection.materialId) && inspection.materialId !== MaterialId.Water) {
    rows.push({ label: 'Solution strength', value: `${percent(solutionConcentration(inspection.materialId, inspection.state), 255)}%` })
  }
  if (inspection.materialId === MaterialId.Water || inspection.materialId === MaterialId.SaltWater) {
    rows.push({ label: 'Liquid amount', value: `${percent(inspection.liquidMass, 255)}%` })
  }
  if (properties.electricalConductivity > 0 || properties.moistureCapacity > 0 || properties.chargeSource > 0) {
    rows.push({ label: 'Charge', value: `${percent(inspection.charge, 255)}%` })
    rows.push({ label: 'Conductivity', value: `${percent(inspection.electricalConductivity, 255)}%` })
  }
  const phase = activePhaseRow(inspection)
  if (phase) rows.push(phase)
  return rows
}

function materialRows(inspection: CellInspection, properties: MaterialProperties): InspectionRow[] {
  const rows: InspectionRow[] = [
    { label: 'Form', value: materialForm(properties) },
    { label: 'Heat capacity', value: `${properties.heatCapacity} units/K` },
    { label: 'Heat conduction', value: `${displayNumber(properties.thermalConductivity)} W/m·K` },
  ]

  if (properties.mobility === 'powder' || properties.mobility === 'fluid') rows.push({ label: 'Flow density', value: displayNumber(properties.density) })
  if (properties.phase === 'liquid') rows.push({ label: 'Viscosity', value: `${Math.round(properties.viscosity * 100)}%` })
  if (properties.phase === 'gas' && properties.dispersion > 0) rows.push({ label: 'Gas spread', value: `${Math.round(properties.dispersion * 100)}%` })
  for (const transition of inspection.phaseTransitions) {
    const product = MATERIAL_BY_ID.get(transition.product)?.label ?? 'New phase'
    rows.push({ label: transition.direction === 'above' ? `Above ${transition.temperature} °C` : `Below ${transition.temperature} °C`, value: `→ ${product}` })
  }
  if (properties.fuel > 0) {
    rows.push({ label: 'Burn rate', value: `${properties.burnRate} fuel/tick` })
    rows.push({ label: 'Burn heat', value: `${properties.combustionHeat} / fuel` })
    if (properties.heatEmission > 0) rows.push({ label: 'Heat output', value: displayNumber(properties.heatEmission) })
    if (properties.ashYield > 0) rows.push({ label: 'Ash chance', value: `${Math.round(properties.ashYield * 100)}%` })
  }
  if (properties.explosionRadius > 0) rows.push({ label: 'Explosion', value: `${properties.explosionRadius} cells / ${displayNumber(properties.explosionPressure)}` })
  if (properties.sparkSensitivity > 0) rows.push({ label: 'Spark sensitivity', value: `${percent(properties.sparkSensitivity, 255)}%` })
  if (properties.extinguishingPower > 0) rows.push({ label: 'Extinguishing', value: `${percent(properties.extinguishingPower, 255)}%` })
  if (properties.plantNutrition > 0) rows.push({ label: 'Plant nutrition', value: `${percent(properties.plantNutrition, 255)}%` })
  if (properties.corrosiveness > 0) rows.push({ label: 'Corrosiveness', value: `${Math.round(properties.corrosiveness * 100)}%` })
  if (properties.chargePulsePeriod > 1) rows.push({ label: 'Electrical pulse', value: `Every ${(properties.chargePulsePeriod / 60).toFixed(1)} s` })
  if (inspection.materialId === MaterialId.Source) rows.push({ label: 'Output cycle', value: `Every ${(SOURCE_EMISSION_INTERVAL / 60).toFixed(1)} s` })
  if (properties.indestructible) rows.push({ label: 'Damage', value: 'Eraser only' })
  if (properties.blastResistance >= 0.4 && !properties.indestructible) rows.push({ label: 'Blast resistance', value: displayNumber(properties.blastResistance) })
  return rows
}

export function buildInspectionSections(inspection: CellInspection): readonly InspectionSection[] {
  const properties = MATERIAL_BY_ID.get(inspection.materialId)?.properties
  if (!properties) return []
  return [
    { label: 'Live', rows: liveRows(inspection, properties) },
    { label: 'Material', rows: materialRows(inspection, properties) },
  ]
}
