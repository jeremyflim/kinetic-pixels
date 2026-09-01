import { describe, expect, it } from 'vitest'
import { buildInspectionSections } from './inspection'
import { MATERIAL_PROPERTIES, MaterialId, StatusFlag } from './simulation/materials'
import type { CellInspection } from './simulation/types'

function inspect(materialId: number, overrides: Partial<CellInspection> = {}): CellInspection {
  const properties = MATERIAL_PROPERTIES[materialId as keyof typeof MATERIAL_PROPERTIES]
  return {
    x: 4,
    y: 7,
    materialId,
    state: 0,
    status: 0,
    charge: 0,
    temperature: 20,
    moisture: 0,
    fuel: properties.fuel,
    liquidMass: properties.phase === 'liquid' ? 255 : 0,
    phaseProgress: 0,
    electricalConductivity: properties.electricalConductivity,
    phaseTransitions: properties.phaseTransitions,
    ...overrides,
  }
}

function labels(inspection: CellInspection): string[] {
  return buildInspectionSections(inspection).flatMap((section) => section.rows.map((row) => row.label))
}

function value(inspection: CellInspection, label: string): string | undefined {
  return buildInspectionSections(inspection).flatMap((section) => section.rows).find((row) => row.label === label)?.value
}

describe('context-sensitive pixel inspection', () => {
  it('keeps Air compact and omits irrelevant storage and combustion fields', () => {
    const rows = labels(inspect(MaterialId.Empty))
    expect(rows).toEqual(['Material', 'Temperature', 'Condition', 'Form', 'Heat capacity', 'Heat conduction'])
    expect(rows).not.toContain('State channel')
    expect(rows).not.toContain('Burn rate')
    expect(rows).not.toContain('Phase progress')
  })

  it('shows live combustible state and only relevant Wood behavior', () => {
    const wood = inspect(MaterialId.Wood, { status: StatusFlag.Burning, fuel: 129, moisture: 45, temperature: 178 })
    expect(value(wood, 'Condition')).toBe('Burning, Wet')
    expect(value(wood, 'Fuel')).toBe('51%')
    expect(value(wood, 'Moisture')).toBe('25%')
    expect(value(wood, 'Ignition point')).toBe('223 °C')
    expect(labels(wood)).toEqual(expect.arrayContaining(['Burn rate', 'Burn heat', 'Heat output', 'Ash chance', 'Blast resistance']))
    expect(labels(wood)).not.toContain('Viscosity')
  })

  it('reports the effective values of a diluted conductive solution', () => {
    const brine = inspect(MaterialId.SaltWater, {
      state: 80,
      liquidMass: 128,
      electricalConductivity: 108,
      phaseTransitions: [
        { direction: 'above', temperature: 102, product: MaterialId.Steam, latentHeat: 200 },
        { direction: 'below', temperature: -2, product: MaterialId.Ice, latentHeat: 100 },
      ],
    })
    expect(value(brine, 'Solution strength')).toBe('31%')
    expect(value(brine, 'Liquid amount')).toBe('50%')
    expect(value(brine, 'Conductivity')).toBe('42%')
    expect(value(brine, 'Above 102 °C')).toBe('→ Steam')
  })

  it('turns raw transient and latent state into useful live readouts', () => {
    expect(value(inspect(MaterialId.Fire, { state: 30 }), 'Time left')).toBe('0.5 s')
    expect(value(inspect(MaterialId.Plant, { state: 60 }), 'Growth')).toBe('50%')
    const water = inspect(MaterialId.Water, {
      temperature: 100,
      phaseProgress: 50,
      phaseTransitions: [{ direction: 'above', temperature: 100, product: MaterialId.Steam, latentHeat: 200 }],
    })
    expect(value(water, 'Phase change')).toBe('25% → Steam')
  })
})
