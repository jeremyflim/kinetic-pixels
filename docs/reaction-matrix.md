# Element interaction model

This document describes the implemented simulation. It distinguishes shared physics from
identity-specific chemistry so new materials can participate without adding rules for every
possible pair.

## How every pair interacts

Every one of the 465 distinct non-empty material pairs exchanges temperature when adjacent.
Heat crosses only cardinal cell boundaries. Empty air participates locally but also exchanges
energy rapidly with a 20°C external environment, so an air gap is not equivalent to solid contact
and long hot-air bridges decay.

Additional interactions are selected by properties rather than material names:

| Property combination | Shared result |
| --- | --- |
| Any two cells with different temperatures | Capacity-weighted heat conduction |
| Denser moving material + lighter liquid/gas | The denser material can displace and settle through it |
| Liquid with lower viscosity | Longer left/right movement during an open spread step |
| Water + Alcohol, Acid, or Salt Water | Solute concentration equalizes between cells |
| Gas with dispersion | Occasional lateral movement while rising and along the ceiling |
| Water + a porous material | Water mass becomes absorbed moisture |
| Any two porous materials | Moisture diffuses from higher to lower saturation, even when their identities differ |
| Hot moist material | Moisture evaporates, consumes heat, and can emit Steam |
| Combustible material + sufficient temperature and dryness | Ignition; fuel then produces heat, limited Smoke, and probabilistic residue |
| Fire or an actively burning fuel + nearby cells | Fixed emitted energy; each target's heat capacity determines its temperature rise |
| Material crossing one of its phase thresholds | Latent progress accumulates before conversion |
| Connected cells with electrical conductivity | A full-strength current front travels four cells per tick and splits at branches |
| Charge source + conductive neighbor | Spark launches current while present; Battery launches one pulse every 30 ticks |
| Porous material + absorbed moisture | Effective electrical conductivity rises with saturation |
| Strong charge + electrically sensitive fuel | The fuel ignites through a generic contact-arc check |
| Extinguishing liquid + Fire/burning fuel | Fire becomes Smoke or active combustion is cleared |
| Water + hot or burning Oil | Water flashes to Steam without extinguishing the Oil |
| Plant + nutritional neighbor | Water, Salt Water, or Soil supports growth |

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
| Acid | 20% HCl solution | 1,100 | 3,600 | 0.5 | 396 | 20 | Above 100–108 → Steam by concentration |
| Metal | Mild steel | 7,850 | 470 | 54 | 369 | 20 | — |
| Lava | Molten basalt | 2,700 | 1,000 | 1.5 | 270 | 1,200 | Below 1,000 → Stone |
| Ice | Water ice | 917 | 2,100 | 2.2 | 193 | −10 | Above 0 → Water |
| Spark | Electrical pulse | 0.1 | 1,000 | 0.005 | 1 | 20 | — |
| Gunpowder | Packed black powder | 1,000 | 1,000 | 0.1 | 100 | 20 | Ignites at 140 |
| Glass | Soda-lime glass | 2,500 | 840 | 1 | 210 | 20 | — |
| Steam | Water vapor | 0.6 | 2,000 | 0.025 | 1 | 110 | Below 95 → Water |
| Salt | Sodium chloride crystals | 2,160 | 850 | 6.5 | 184 | 20 | — |
| Salt Water | Brine | 1,025 | 3,900 | 0.62 | 400 | 20 | 100–103 → Steam/Salt; 0 to −4 → Ice |
| Coal | Packed coal | 1,350 | 1,260 | 0.25 | 170 | 20 | Ignites at 260 |
| Ash | Porous residue | 700 | 900 | 0.16 | 63 | 20 | — |
| Rubber | Dense elastomer | 1,100 | 1,800 | 0.14 | 198 | 20 | Ignites at 300 |
| Copper | Solid copper | 8,960 | 385 | 401 | 345 | 20 | — |
| Battery | Composite cell | 2,800 | 900 | 4 | 252 | 20 | Ignites at 180 |
| Mercury | Liquid mercury | 13,534 | 140 | 8.3 | 189 | 20 | — |
| Alcohol | Ethanol-like liquid | 789 | 2,440 | 0.17 | 193 | 20 | 78–100 → Alcohol Vapor or Steam by concentration; auto-ignites at 363 |
| Alcohol Vapor | Fuel vapor | 1.6 | 1,600 | 0.018 | 1 | 82 | Below 70 → Alcohol; auto-ignites at 363 |
| Sodium | Metallic sodium | 968 | 1,230 | 142 | 119 | 20 | — |
| Hydrogen | Hydrogen gas | 0.09 | 14,300 | 0.18 | 1 | 20 | Ignites at 45 |
| Soil | Moist porous soil | 1,400 | 1,480 | 0.5 | 207 | 20 | — |
| Foam | Firefighting foam | 120 | 2,800 | 0.08 | 34 | 20 | — |
| Source | Indestructible utility block | 7,800 | 500 | 18 | 390 | 20 | — |

Copper, Mercury, Foam, and direct-paint Ash remain registered only so existing version-6 saves
load without losing cells. They are no longer offered in the Elements rail. Ash remains an
emergent combustion product.

Each transition has a latent-energy requirement. Excess temperature is consumed into progress
and the cell remains at its threshold until continued energy transfer completes the conversion.
Water vaporization uses 18% of the reference latent requirement as a gameplay time scale while
retaining Water's full sensible heat capacity. Steam uses vapor-cell mass for condensation and has
no lifetime deletion, so cooled vapor becomes Water instead of disappearing. Stone melts at a
higher threshold than Lava freezes, which also prevents rapid oscillation.

Alcohol, Acid, and Salt Water store normalized solution concentration in their existing state
channel. Water contact diffuses the concentration. Diluted Alcohol shifts from 78°C toward 100°C
and water-rich cells emit Steam; diluted Acid shifts toward Water's boiling point; diluted Salt
Water shifts toward Water's freezing and boiling points. Boiling brine can emit Steam while leaving
Salt in its original cell.

Blast resistance is separate from hardness so brittle Glass can resist corrosion yet shatter.
Source bypasses destruction entirely. Among destructible materials, Metal is highest at 1.2,
followed by Stone at 0.95; Wood is 0.48, most liquids and powders are 0.05–0.18, and energy/gas
cells are zero.

## Moisture network

The porous set is Sand, Wood, Plant, Gunpowder, Salt, Ash, and Soil. All combinations within this set exchange
moisture through the same saturation-based algorithm:

| Pair group | Behavior |
| --- | --- |
| Water or Salt Water + porous material | The liquid donates finite mass according to the receiver's absorption rate |
| Any two porous materials | Moisture diffuses through the boundary according to the lower diffusivity |
| Moist porous material + heat | Evaporation lowers moisture and temperature; sufficiently large evaporation can create Steam |

Moisture above 15% saturation prevents ignition and extinguishes active combustion. Lesser
moisture raises the ignition temperature. Wetness is therefore continuous state, not a Wet
material variant or a Gunpowder-only flag.

## Combustion

Wood, Oil, Plant, Gunpowder, Coal, Rubber, Battery, Alcohol, Alcohol Vapor, and Hydrogen share the same ignition evaluator. Ordinary burning consumes the
cell's fuel, adds energy to its own temperature, emits local heat, and may emit Smoke. Fire also
maintains an active hot core during its finite lifetime. The thermal solver then decides whether
surrounding cells become hot enough to ignite.

| Material | Fuel | Burn rate per 60 Hz update | Heat per consumed fuel | Neighbor heat | Smoke chance | Special outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Fire | — | — | — | 320 | — | Maintains at least 500°C while its lifetime remains |
| Wood | 255 | 3 | 600 | 70 | 1.2% | ~30% Ash yield; structural, wettable kindling |
| Oil | 255 | 3 | 600 | 90 | 1.2% | Ignites readily and continues flowing while burning |
| Plant | 180 | 4 | 600 | 60 | 0.8% | Stops growth; ~18% Ash yield |
| Gunpowder | 255 | 255 | 1,500 | — | 2% | Converts to Fire and emits a radius-5 heat/pressure explosion |
| Coal | 255 | 1 | 1,050 | 105 | 1.8% | Long, hot ember burn; ~50% Ash yield |
| Rubber | 240 | 2 | 720 | 65 | 2.5% | Insulates while intact; ~24% Ash yield |
| Battery | 180 | 4 | 850 | 95 | 2% | Heat-triggered radius-3 failure |
| Alcohol | 255 | 7 | 700 | 80 | 0.4% | Low ignition and boiling points |
| Alcohol Vapor | 220 | 220 | 1,100 | — | — | Electrically sensitive radius-3 vapor flash |
| Hydrogen | 220 | 220 | 1,300 | — | — | Electrically sensitive radius-4 gas explosion |

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
| Acid + Metal | Acid | 45%/s | Acid becomes dilute Salt Water; Metal releases Hydrogen |
| Acid + Copper | Acid | 28%/s | Acid becomes dilute Salt Water; Copper releases Hydrogen |
| Salt + Water | Salt | 45%/s base chance | Both cells become half-strength Salt Water; dissolution is visible rather than immediate |
| Salt + Salt Water | Salt | 45%/s base chance, reduced by concentration | The crystal joins the solution and raises both cells' Salt concentration |
| Salt + Ice | Salt | 90%/s | Both cells become cold half-strength Salt Water |
| Sodium + Water | Sodium | 100%/s | Sodium becomes Fire; Water becomes Hydrogen |
| Sodium + Salt Water | Sodium | 100%/s | Sodium becomes Fire; Salt Water becomes Hydrogen |
| Sodium + Acid | Sodium | 100%/s | Sodium becomes Fire; Acid releases hot Hydrogen |
| Sodium + Alcohol | Sodium | 70%/s | Sodium becomes Fire; Alcohol releases Hydrogen |

Plant growth beside a neighbor with nutrition remains a biological material behavior: after 120
updates of exposure, Plant attempts to grow into an empty cardinal neighbor. Water and Salt Water
can be consumed; Soil remains in place as a reusable growth bed.

## Electrical network

Electrical behavior is property-driven rather than a list of Spark pair rules:

| Material or condition | Base conductivity (0–255) | Electrical role |
| --- | ---: | --- |
| Spark | 255 | Short-lived 255-strength pulse source at room temperature |
| Battery | 255 | One traveling network pulse every 30 ticks |
| Metal | 255 | General solid conductor |
| Salt Water | Up to 215 | Conductive liquid; conductivity falls with dilution |
| Sodium | 170 | Conductive reactive powder |
| Water | 0 | Insulator in the game model; adding Salt creates the conductive liquid |
| Rubber, dry Wood, dry Soil | 0 | Insulators |
| Saturated porous material | Base + up to 150 | Moisture can create an otherwise absent conductive path |

Charge uses a bounded fixed-size breadth-first traversal with a visited map per launched pulse. A
pulse advances four cells per tick, splits across connected branches, and continues at full
strength for any distance available in the play space. Overlapping pulses remain independent and
terminate after each has visited its connected network, so collisions cannot create reflected
current loops. The Charged status is a visual projection of the current front and its short fading
trail. Resistive heating is deliberately modest and
still enters the capacity-aware thermal field. Contact with a sufficiently charged cell can ignite
sensitive fuel: Gunpowder and Hydrogen are most sensitive, followed by Alcohol Vapor, Oil,
Alcohol, and Coal.

Source stores the first non-empty neighboring material ID that touches it. Every six ticks it
uses the normal material initializer to emit one copy into a random neighboring empty cell. Its
indestructible property bypasses explosion destruction, and it has no corrosive, combustible, or
phase transition path. The Eraser and Clear command remain explicit user overrides.

## Flow properties

Liquid viscosity is normalized from 0–1 and directly controls maximum open horizontal travel per
update. Alcohol (0.04), Water (0.10), Salt Water (0.12), Acid (0.18), and Oil (0.48) spread in that
order; Lava (0.92) creeps one cell at a time. Gas dispersion is also normalized from 0–1. Smoke,
Steam, Alcohol Vapor, and Hydrogen use increasingly strong lateral drift both while rising and
when upward movement is blocked, preventing a motionless ceiling layer.

## Update rates and determinism

| System | Rate |
| --- | ---: |
| Movement, combustion, lifetimes, and electrical propagation | 60 Hz |
| Temperature conduction, phase evaluation, and ignition | 30 Hz |
| Moisture absorption, diffusion, and evaporation | 10 Hz |
| Active Fire and burning-fuel heat emission | 10 Hz batches, preserving the listed per-tick average |
| Ambient air cooling | 8% of air-to-room energy difference per thermal pass |

The Time rate control changes only how quickly fixed steps accrue in real time: `½×`, `1×`, and
`2×`. It does not enlarge a step or alter seeded update order, so a given tick count remains deterministic.

Temperature and electricity use reusable fixed-size work buffers. Equal and opposite thermal pair transfers conserve energy, including a fractional remainder
carried with moving particles. Material, lifetime/growth, charge, status, temperature, moisture,
fuel, liquid mass, and latent progress remain separate typed-array channels.
