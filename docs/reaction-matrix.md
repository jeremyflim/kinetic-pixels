# Element interaction model

This document describes the implemented simulation. It distinguishes shared physics from
identity-specific chemistry so new materials can participate without adding rules for every
possible pair.

## How every pair interacts

Every one of the 120 distinct non-empty material pairs exchanges temperature when adjacent.
Heat crosses only cardinal cell boundaries. Empty air participates locally but also exchanges
energy rapidly with a 20°C external environment, so an air gap is not equivalent to solid contact
and long hot-air bridges decay.

Additional interactions are selected by properties rather than material names:

| Property combination | Shared result |
| --- | --- |
| Any two cells with different temperatures | Capacity-weighted heat conduction |
| Denser moving material + lighter liquid/gas | The denser material can displace and settle through it |
| Water + a porous material | Water mass becomes absorbed moisture |
| Any two porous materials | Moisture diffuses from higher to lower saturation, even when their identities differ |
| Hot moist material | Moisture evaporates, consumes heat, and can emit Steam |
| Combustible material + sufficient temperature and dryness | Ignition; fuel then produces heat and limited Smoke |
| Fire or an actively burning fuel + nearby cells | Fixed emitted energy; each target's heat capacity determines its temperature rise |
| Material crossing one of its phase thresholds | Latent progress accumulates before conversion |
| Spark + conductive material | The existing Charged status is applied; electricity propagation is intentionally unchanged |

Consequently, “no chemical reaction” no longer means “no interaction.” Stone and Water have no
pair rule, for example, but they exchange heat. A Stone layer between Lava and Water slows their
interaction while continuing to conduct energy.

## Material property table

Temperature is integer Celsius. Thermal capacity is derived as `round(ρ × c / 10,000)` in
10 kJ/m³·K units; the minimum value is one unit for integer-grid stability. Gameplay density,
which controls movement, remains separate from physical mass density.

| Material | Representative form | ρ kg/m³ | c J/kg·K | k W/m·K | Capacity | Initial °C | Phase transitions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Air | Dry air, 20°C | 1.2 | 1,005 | 0.026 | 1 | 20 | — |
| Sand | Packed quartz | 1,600 | 830 | 0.27 | 133 | 20 | Above 1,700 → Glass |
| Water | Liquid water | 998 | 4,180 | 0.6 | 417 | 20 | Above 100 → Steam; below 0 → Ice |
| Stone | Basalt | 2,900 | 840 | 1.7 | 244 | 20 | Above 1,200 → Lava |
| Wood | Dry medium-density wood | 500 | 1,300 | 0.12 | 65 | 20 | Ignites at 160 |
| Fire | Effective burning cell | 100 | 1,200 | 0.08 | 12 | 600 | — |
| Smoke | Hot gas/aerosol | 1.2 | 1,100 | 0.04 | 1 | 120 | — |
| Oil | Liquid n-octane | 700 | 2,220 | 0.13 | 155 | 20 | Ignites at 110 |
| Plant | Fresh water-rich biomass | 700 | 3,500 | 0.2 | 245 | 20 | Ignites at 180 |
| Acid | 20% HCl solution | 1,100 | 3,600 | 0.5 | 396 | 20 | Above 108 → Steam |
| Metal | Mild steel | 7,850 | 470 | 54 | 369 | 20 | — |
| Lava | Molten basalt | 2,700 | 1,000 | 1.5 | 270 | 1,200 | Below 1,000 → Stone |
| Ice | Water ice | 917 | 2,100 | 2.2 | 193 | −10 | Above 0 → Water |
| Spark | Electrical pulse | 0.1 | 1,000 | 0.005 | 1 | 800 | — |
| Gunpowder | Packed black powder | 1,000 | 1,000 | 0.1 | 100 | 20 | Ignites at 140 |
| Glass | Soda-lime glass | 2,500 | 840 | 1 | 210 | 20 | — |
| Steam | Water vapor | 0.6 | 2,000 | 0.025 | 1 | 110 | Below 95 → Water |

Each transition has a latent-energy requirement. Excess temperature is consumed into progress
and the cell remains at its threshold until continued energy transfer completes the conversion.
Water vaporization uses 18% of the reference latent requirement as a gameplay time scale while
retaining Water's full sensible heat capacity. Steam uses vapor-cell mass for condensation and has
no lifetime deletion, so cooled vapor becomes Water instead of disappearing. Stone melts at a
higher threshold than Lava freezes, which also prevents rapid oscillation.

Blast resistance is separate from hardness so brittle Glass can resist corrosion yet shatter.
Metal is highest at 1.2, followed by Stone at 0.95; Wood is 0.48, most liquids and powders are
0.05–0.18, and energy/gas cells are zero.

## Moisture network

The porous set is Sand, Wood, Plant, and Gunpowder. All combinations within this set exchange
moisture through the same saturation-based algorithm:

| Pair group | Behavior |
| --- | --- |
| Water + Sand/Wood/Plant/Gunpowder | Water donates finite liquid mass according to the receiver's absorption rate |
| Sand/Wood/Plant/Gunpowder + any porous material | Moisture diffuses through the boundary according to the lower diffusivity |
| Moist porous material + heat | Evaporation lowers moisture and temperature; sufficiently large evaporation can create Steam |

Moisture above 15% saturation prevents ignition and extinguishes active combustion. Lesser
moisture raises the ignition temperature. Wetness is therefore continuous state, not a Wet
material variant or a Gunpowder-only flag.

## Combustion

Wood, Oil, Plant, and Gunpowder share the same ignition evaluator. Ordinary burning consumes the
cell's fuel, adds energy to its own temperature, emits local heat, and may emit Smoke. Fire also
maintains an active hot core during its finite lifetime. The thermal solver then decides whether
surrounding cells become hot enough to ignite.

| Material | Fuel | Burn rate per 60 Hz update | Heat per consumed fuel | Neighbor heat | Smoke chance | Special outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Fire | — | — | — | 320 | — | Maintains at least 500°C while its lifetime remains |
| Wood | 255 | 3 | 600 | 70 | 1.2% | Burns away after about 85 updates if uninterrupted |
| Oil | 255 | 3 | 600 | 90 | 1.2% | Ignites readily and continues flowing while burning |
| Plant | 180 | 4 | 600 | 60 | 0.8% | Stops growth while burning |
| Gunpowder | 255 | 255 | 1,500 | — | 2% | Converts to Fire and emits a radius-5 heat/pressure explosion |

There is no Fire + Wood ignition rule and no Wood + Wood spread rule. Fire is a hot rising cell;
Wood ignites only if conduction raises its temperature enough while it is dry. Gunpowder uses
the generic explosion profile: heat is deposited by distance, pressure may destroy targets whose
blast resistance is low enough, and destroyed cells retain hot air. Explosive targets are heated
and marked to detonate instead of being deleted.

## Identity-specific chemistry

These are the only entries in the pair registry:

| Pair | Initiator | Configured base rate | Result |
| --- | --- | ---: | --- |
| Acid + Plant | Acid | 85%/s | Plant becomes Empty, reduced by Plant hardness |
| Acid + Wood | Acid | 15%/s | Wood becomes Empty, reduced by Wood hardness |
| Acid + Metal | Acid | 45%/s | Metal becomes Empty, reduced by Metal hardness |
| Acid + Water | Acid | 30%/s | The Acid cell becomes Water |

Plant growth beside Water remains a biological material behavior: after 120 updates of exposure,
Plant attempts to grow into an empty cardinal neighbor and has a 10% chance to consume its Water
cell.

## Update rates and determinism

| System | Rate |
| --- | ---: |
| Movement, combustion, lifetimes, and charge | 60 Hz |
| Temperature conduction, phase evaluation, and ignition | 30 Hz |
| Moisture absorption, diffusion, and evaporation | 10 Hz |
| Active Fire and burning-fuel heat emission | 10 Hz batches, preserving the listed per-tick average |
| Ambient air cooling | 8% of air-to-room energy difference per thermal pass |

The Time rate control changes only how quickly fixed steps accrue in real time: `½×`, `1×`, and
`2×`. It does not enlarge a step or alter seeded update order, so a given tick count remains deterministic.

Temperature uses a reusable energy-delta buffer so a conduction pass does not depend on scan
direction. Equal and opposite pair transfers conserve energy, including a fractional remainder
carried with moving particles. Material, lifetime/growth/charge, status, temperature, moisture,
fuel, liquid mass, and latent progress remain separate typed-array channels.

Electricity remains on the earlier single-path Charged implementation. Reworking Spark and
conductive-network propagation is intentionally outside this revision.
