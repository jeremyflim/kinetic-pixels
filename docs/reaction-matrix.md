# Element interaction matrix

This document describes the behavior implemented by the current simulation, not a proposed
chemistry design. It covers all 16 non-empty materials. `Empty` is omitted because it is space,
not an element: falling and rising materials can move into it, and fluids search through it.

The simulation checks all eight neighboring cells for reactions and heat. Movement itself uses
the three cells in the direction of travel plus horizontal fluid searches.

## Complete pairwise map

Each unordered pair appears exactly once in the upper triangle. The diagonal records what a
material does beside more of itself.

- **X** — explicit transformation, status change, corrosion, extinguishing, or growth rule
- **H** — heat can pass between the pair and can cause a thermal transition or ignition
- **Q** — electrical charge can enter or travel through the pair
- **L** — density can make one material pass through and layer above or below the other
- **B** — no programmed material change; occupied cells block one another's attempted movement
- **S** — ordinary same-material behavior
- **·** — duplicate pair already represented above the diagonal

| Element | Sand | Water | Stone | Wood | Fire | Smoke | Oil | Plant | Acid | Metal | Lava | Ice | Spark | Gunpowder | Glass | Steam |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Sand** | S | L | B | B | H | L | L | B | L | B | H/B | B | H | B | B | L |
| **Water** | · | S | B | X/B | X/H | L | X/L | X | X | Q/B | X/H | B | Q/H | X/L | B | L |
| **Stone** | · | · | S | B | H/B | B | B | B | B | B | H/B | B | H/B | B | B | B |
| **Wood** | · | · | · | S/X | X/H | B | B | B | X | B | H/B | B | H/B | H/B | B | B |
| **Fire** | · | · | · | · | S | B | H | H | H/B | H/B | H/B | H | H/B | H | H/B | H/B |
| **Smoke** | · | · | · | · | · | S | L | B | L | B | L/H | L | H/B | L | B | B |
| **Oil** | · | · | · | · | · | · | S/H | B | L | B | L/H | L | H | L/H | B | L |
| **Plant** | · | · | · | · | · | · | · | S/H | X | B | H/B | B | H | H/B | B | B |
| **Acid** | · | · | · | · | · | · | · | · | S | X | L/H | B | H/B | L | B | L |
| **Metal** | · | · | · | · | · | · | · | · | · | S/Q | H/B | B | Q/H | B | B | B |
| **Lava** | · | · | · | · | · | · | · | · | · | · | S/H | X/H | H/B | H/B | H/B | L/H |
| **Ice** | · | · | · | · | · | · | · | · | · | · | · | S | H | B | B | X |
| **Spark** | · | · | · | · | · | · | · | · | · | · | · | · | S | H | H/B | H/B |
| **Gunpowder** | · | · | · | · | · | · | · | · | · | · | · | · | · | S/X | B | L |
| **Glass** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | S | B |
| **Steam** | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | S |

`B` does not mean that one cell is an indestructible wall. It only means this pair has no direct
rule. Fire, Lava, Spark, burning materials, or an explosion can still change heat; Acid and
Gunpowder affect only the targets explicitly listed below.

## Explicit and special interactions

These are all current non-movement rules. Rates are real-time rates at the fixed 60 Hz update
rate. A configured probabilistic rate is converted to a per-tick chance, so it remains stable if
the implementation's tick loop is reorganized.

| Pair | Initiator / condition | Current result | Timing |
| --- | --- | --- | --- |
| Water + Fire | Either cell updates while touching | Fire becomes Empty; Water gains 45 heat | Instant |
| Water + burning Wood | Water updates while touching | Burning clears, Wood loses 60 heat, burn progress resets | Instant |
| Water + burning Plant | Water updates while touching | Burning clears, Plant loses 60 heat, burn progress resets | Instant |
| Water + burning Oil | Water updates while touching | Burning clears, Oil loses 60 heat, burn progress resets | Instant |
| Water + Gunpowder | Water updates while touching | Gunpowder becomes Wet, stops burning, loses 80 heat, and resets progress | Instant; Wet dries at 35%/s once no Water touches it |
| Water + Plant | A non-burning Plant remains beside Water | Plant accumulates growth; at 120 updates it creates one Plant in an empty cardinal neighbor. The source Water has a 10% chance to be consumed | About 2 s per successful growth attempt |
| Water + Acid | Acid updates while touching | The Acid cell becomes Water | 30%/s configured chance |
| Water + Lava | Either cell updates while touching | Lava becomes Stone; Water becomes Steam | Instant |
| Water + Metal | A charged Water or Metal cell updates | Charge can move one cell through either conductive material; the charged cell emits 12 heat | One step per update; Water starts with an 8-cell budget, Metal with 20 |
| Water + Spark | Spark updates while touching | Spark disappears; Water becomes Charged after first receiving Spark heat | Instant |
| Wood + Fire | Fire updates beside unburned Wood | Fire always heats Wood; additionally, Wood has a rare direct flash into Smoke | 3%/s base, multiplied by Wood flammability 0.8 |
| Wood + burning Wood | Burning Wood updates beside unburned Wood | The unburned Wood gains Burning | 8%/s base, multiplied by Wood flammability 0.8 |
| Wood + Acid | Acid updates while touching | Wood becomes Empty | 15%/s base, reduced by Wood hardness |
| Plant + Acid | Acid updates while touching | Plant becomes Empty | 85%/s base, reduced by Plant hardness |
| Metal + Acid | Acid updates while touching | Metal becomes Empty | 45%/s base, reduced by Metal hardness |
| Metal + Spark | Spark updates while touching | Spark disappears; Metal becomes Charged after first receiving Spark heat | Instant; initial propagation budget is 20 cells |
| Lava + Ice | Either cell updates while touching | Lava becomes Stone; Ice becomes Steam | Instant |
| Ice + Steam | Either cell updates while touching | Both cells become Water with heat reset to zero | Instant |
| Gunpowder + heat | Dry Gunpowder reaches 28 heat | It gains Burning and explodes on its next own update | Normally within one update after crossing the threshold |
| Gunpowder + Gunpowder explosion | Another exploding grain is within radius 4 | Wet clears and the target gains Burning, producing a chain explosion | Instant status change; detonation on target's next update |
| Gunpowder explosion + Wood/Oil/Plant | A flammable cell is within radius 4 | The cell receives 90 raw heat, divided by its heat capacity | Instant; one blast ignites Oil and Plant, while Wood normally needs more heat |

Acid deliberately does **not** corrode Sand, Stone, Fire, Smoke, Oil, Ice, Spark, Gunpowder,
Glass, Steam, Lava, or other Acid. Gunpowder blasts deliberately do **not** damage nonflammable
materials; only nearby empty cells have a 2.5% chance to become Fire.

## Thermal behavior

Fire, Lava, and Spark heat every one of their eight neighbors before moving. Burning Wood,
Plant, and Oil also emit heat. A receiver gains `ceil(output / heat capacity)` heat, with a
minimum of one. Heat caps at 255.

| Source | Heat output | Frequency | Important targets |
| --- | ---: | --- | --- |
| Fire | 3 | Every update | Slowly melts Ice, ignites Oil/Plant/Wood/Gunpowder, and turns Sand to Glass or Water to Steam |
| Lava | 16 | Every update | Quickly causes the same threshold effects; Water and Ice use their instant contact rules first |
| Spark | 30 | Every update for its 3–6 update lifetime | Rapidly ignites Oil, Plant, and Gunpowder; repeated exposure melts Ice or heats Wood/Sand/Water |
| Burning Wood | 1 | Every 8 updates | Low ambient heat; Wood lasts 55 updates once burning |
| Burning Plant | 2 | Every 3 updates | Plant lasts about 37 updates once burning |
| Burning Oil | 5 | Every update | Can thermally ignite adjacent Oil; Oil lasts 110 updates once burning |

| Receiver | Threshold | Result | Heat capacity | Cooling every 4 updates |
| --- | ---: | --- | ---: | ---: |
| Sand | 180 | Glass | 4 | 1 |
| Water | 180 | Steam | 2 | 4 |
| Ice | 45 | Water | 1 | 8 |
| Wood | 80 | Burning | 2 | 1 |
| Oil | 22 | Burning | 1 | 1 |
| Plant | 30 | Burning | 1 | 1 |
| Gunpowder | 28 | Burning, then explosion | 1 | 1 |

Stone, Smoke, Acid, Metal, Lava, Spark, Glass, Steam, and Fire can store heat but have no
heat-triggered transformation or ignition. Lava, Spark, and Fire do not cool. This is why an
`H/B` cell in the matrix may only mean “heat is recorded” rather than a visible reaction.

## Density and movement interactions

Only a moving material can initiate displacement. It can swap through a target only when the
target is a liquid or gas and the mover is denser. Solids and energy are never displaced by this
rule. Rising Fire, Smoke, Spark, and Steam move only into Empty cells.

| Moving material | Density | Can currently displace while falling |
| --- | ---: | --- |
| Sand | 5 | Water, Acid, Oil, Smoke, Steam |
| Water | 2 | Oil, Smoke, Steam |
| Stone | 10 | Nothing; immovable |
| Wood | 8 | Nothing; immovable |
| Fire | 0.02 | Nothing; rises only into Empty |
| Smoke | 0.01 | Nothing; rises only into Empty |
| Oil | 1 | Smoke, Steam |
| Plant | 4 | Nothing; immovable |
| Acid | 2.5 | Oil, Smoke, Steam; touching Water can dilute Acid before displacement |
| Metal | 12 | Nothing; immovable |
| Lava | 7 | Acid, Oil, Smoke, Steam; touching Water reacts before displacement |
| Ice | 1.6 | Oil, Smoke, Steam |
| Spark | 0.005 | Nothing; rises only into Empty |
| Gunpowder | 4 | Water, Acid, Oil, Smoke, Steam; Water can wet it first |
| Glass | 9 | Nothing; immovable |
| Steam | 0.015 | Nothing; rises only into Empty |

The four fluids use friction to choose their horizontal search distance. Water spreads farthest
enough to seek nearby drops and level itself; Oil is slightly more mobile, Acid slightly less,
and Lava substantially less. Powders fall with randomized diagonal drift and form piles.

## Same-material behavior

| Material | Behavior beside itself |
| --- | --- |
| Sand | Falls, swaps through lighter liquids/gases, and piles according to friction |
| Water | Flows and levels; charged Water can carry charge through neighboring Water |
| Stone | Remains immovable |
| Wood | Remains immovable; Burning can spread to adjacent Wood at the low rate above |
| Fire | Independent particles rise, heat one another, and expire after 38–72 updates |
| Smoke | Independent particles rise every other update and expire after 90–180 updates |
| Oil | Flows; burning Oil can heat neighboring Oil until it ignites |
| Plant | Remains immovable; does not grow without neighboring Water |
| Acid | Flows; does not consume other Acid |
| Metal | Remains immovable; charge can travel through connected Metal |
| Lava | Flows slowly and continuously emits heat; does not solidify by itself |
| Ice | Falls as a high-friction movable solid and piles |
| Spark | Independent particles rise and expire after 3–6 updates |
| Gunpowder | Falls as powder; an explosion directly arms nearby Gunpowder within radius 4 |
| Glass | Remains immovable |
| Steam | Independent particles rise; after 180–360 updates, cool Steam condenses to Water and hot Steam disappears |

## Implementation references

The authoritative values and pair registry live in `src/simulation/materials.ts`. Material,
progress/lifetime, status, and heat occupy separate typed-array channels, so variants such as
Burning Wood, Wet Gunpowder, and Charged Metal remain statuses rather than additional materials.
