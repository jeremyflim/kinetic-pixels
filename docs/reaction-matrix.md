# Element interaction model

This document describes the implemented simulation. It distinguishes shared physics from
identity-specific chemistry so new materials can participate without adding rules for every
possible pair.

## How every pair interacts

Every one of the 120 distinct non-empty material pairs exchanges temperature when adjacent.
Heat can continue through chains of cells, including empty air, so the effect is not limited to
the first touching pair. Exposed hot surfaces also radiate along four directions through up to
two air cells, stopping at the first occupied cell.

Additional interactions are selected by properties rather than material names:

| Property combination | Shared result |
| --- | --- |
| Any two cells with different temperatures | Capacity-weighted heat conduction |
| Exposed hot material + air or another material within the radiation path | Short-range radiant heating |
| Denser moving material + lighter liquid/gas | The denser material can displace and settle through it |
| Water + a porous material | Water mass becomes absorbed moisture |
| Any two porous materials | Moisture diffuses from higher to lower saturation, even when their identities differ |
| Hot moist material | Moisture evaporates, consumes heat, and can emit Steam |
| Combustible material + sufficient temperature and dryness | Ignition; fuel then produces heat and limited Smoke |
| Material crossing one of its phase thresholds | Latent progress accumulates before conversion |
| Spark + conductive material | The existing Charged status is applied; electricity propagation is intentionally unchanged |

Consequently, “no chemical reaction” no longer means “no interaction.” Stone and Water have no
pair rule, for example, but they exchange heat. A Stone layer between Lava and Water slows their
interaction while continuing to conduct energy.

## Material property table

Temperature values are Celsius-like gameplay units. The relative ordering and thresholds are
intentional; this is not an SI-unit thermodynamics solver.

| Material | Phase / movement | Density | Conductivity / capacity | Initial temperature | Phase transitions | Ignition | Moisture capacity |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
| Sand | Movable solid / powder | 5 | 24 / 4 | 20 | Above 900 → Glass | — | 96 |
| Water | Liquid / fluid | 2 | 48 / 4 | 20 | Above 100 → Steam; below −2 → Ice | — | — |
| Stone | Solid / immovable | 10 | 72 / 8 | 20 | Above 1,000 → Lava | — | — |
| Wood | Solid / immovable | 8 | 20 / 3 | 20 | — | 160 | 180 |
| Fire | Energy / rising | 0.02 | 48 / 1 | 850 | — | — | — |
| Smoke | Gas / rising | 0.01 | 10 / 1 | 120 | — | — | — |
| Oil | Liquid / fluid | 1 | 12 / 3 | 20 | — | 220 | — |
| Plant | Solid / immovable | 4 | 12 / 2 | 20 | — | 180 | 220 |
| Acid | Liquid / fluid | 2.5 | 40 / 4 | 20 | — | — | — |
| Metal | Solid / immovable | 12 | 220 / 6 | 20 | — | — | — |
| Lava | Liquid / fluid | 7 | 68 / 8 | 1,200 | Below 850 → Stone | — | — |
| Ice | Movable solid / powder | 1.6 | 76 / 5 | −10 | Above 2 → Water | — | — |
| Spark | Energy / rising | 0.005 | 80 / 1 | 1,600 | — | — | — |
| Gunpowder | Movable solid / powder | 4 | 18 / 2 | 20 | — | 160 | 255 |
| Glass | Solid / immovable | 9 | 34 / 5 | 20 | — | — | — |
| Steam | Gas / rising | 0.015 | 14 / 2 | 110 | Below 90 → Water | — | — |

Each transition has a latent-energy requirement. Crossing a threshold starts progress; it does
not replace the material immediately. Stone melts at a higher threshold than Lava freezes, which
also prevents rapid Stone/Lava oscillation.

## Moisture network

The porous set is Sand, Wood, Plant, and Gunpowder. All combinations within this set exchange
moisture through the same saturation-based algorithm:

| Pair group | Behavior |
| --- | --- |
| Water + Sand/Wood/Plant/Gunpowder | Water donates finite liquid mass according to the receiver's absorption rate |
| Sand/Wood/Plant/Gunpowder + any porous material | Moisture diffuses through the boundary according to the lower diffusivity |
| Moist porous material + heat | Evaporation lowers moisture and temperature; sufficiently large evaporation can create Steam |

Moisture above 35% saturation prevents ignition and extinguishes active combustion. Lesser
moisture raises the ignition temperature. Wetness is therefore continuous state, not a Wet
material variant or a Gunpowder-only flag.

## Combustion

Wood, Oil, Plant, and Gunpowder share the same ignition evaluator. Ordinary burning consumes the
cell's fuel, adds energy to its own temperature, and may emit Smoke. The thermal solver then
decides whether surrounding cells become hot enough to ignite.

| Material | Fuel | Burn rate per 60 Hz update | Heat per consumed fuel | Smoke chance per update | Special outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Wood | 255 | 3 | 18 | 1.2% | Burns away after about 85 updates if uninterrupted |
| Oil | 255 | 2 | 14 | 0.9% | Continues flowing while burning |
| Plant | 180 | 4 | 10 | 0.8% | Stops growth while burning |
| Gunpowder | 255 | 255 | 80 | 2% | Converts to Fire and emits a radius-4 thermal impulse |

There is no Fire + Wood ignition rule and no Wood + Wood spread rule. Fire is a hot rising cell;
Wood ignites only if conduction or radiation raises its temperature enough while it is dry.
Gunpowder's impulse heats every material according to heat capacity rather than selecting only
flammable identities. Nearby dry Gunpowder therefore chains through the normal ignition system.

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
| Temperature conduction, phase evaluation, and ignition | 20 Hz |
| Moisture absorption, diffusion, and evaporation | 10 Hz |
| Surface radiation | Sources are deterministically staggered across thermal updates |

Temperature uses a reusable integer delta buffer so a conduction pass does not depend on scan
direction. Material, lifetime/growth/charge, status, temperature, moisture, fuel, liquid mass,
and latent progress live in separate typed-array channels and travel with moving particles.

Electricity remains on the earlier single-path Charged implementation. Reworking Spark and
conductive-network propagation is intentionally outside this revision.
