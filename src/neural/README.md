# What the simulated circuit contains

The game uses the Expanded graph extracted from the official MaleCNS v1.0 bulk
tables. It contains 6,000 individual traced neurons, 1,275,994 directed
neuron-pair edges and 10,659,685 synaptic contacts. These three quantities are
deliberately distinct. The active file is `public/data/circuit-expanded.json`.
The sensory population comprises 182 LC16 neurons (88 left, 94 right); the four
MDN output IDs are 10763/R, 11288/L, 11332/R and 12348/L.

Selection starts with every path of up to three edges from LC16 to MDN in the
traced-neuron graph, using at least three contacts per candidate edge. This
gives 1,088 core cells. A further 4,912 cells are ranked by summed bidirectional
contact count with the core. Every original edge of at least one contact among
the retained cells is restored, including recurrent and inhibitory connections.
This is a circuit selection, not a claim to emulate the full CNS.

The manifest keeps original source SHA-256 hashes, transmitter predictions,
cell identities, selection parameters, real two-edge intermediary routes and
boundary statistics. It retains 93.39% of MDN incoming contacts, but only 30.56%
of LC16 incoming contacts. The latter is a material reason early vision is
represented by an explicit stimulus adapter. No direct LC16-to-MDN edge is
invented. Coordinates use real soma locations (8nm voxels converted to centered
microns) where available. Twenty-four cells have neither a soma nor a to-soma position
in the source annotations and are placed at the display center; their IDs are
listed in the manifest. The connecting lines are graph edges, not reconstructed
axons.

## Prepared graphs

The repository includes four **nested real graphs** for reproduction and tests.
The public game runs Expanded with every neuron enabled; there is no circuit-size,
intervention or intelligence slider in the current interface.
Every tier contains the same 182 LC16 input cells, four MDNs and 1,088-cell path
core. Larger tiers add the next most strongly connected neighboring cells,
with every original edge between retained cells restored. No synthetic edges
or duplicate neurons are added. The same model parameters are used throughout.

| Tier     | Neurons | Directed connections | Synaptic contacts | Gzip estimate |
| -------- | ------: | -------------------: | ----------------: | ------------: |
| Compact  |   1,088 |               71,681 |           504,277 |       0.28 MB |
| Balanced |   1,788 |              215,329 |         2,450,738 |       0.81 MB |
| Standard |   2,888 |              470,170 |         4,895,210 |       1.76 MB |
| Expanded |   6,000 |            1,275,994 |        10,659,685 |       4.82 MB |

`public/data/circuits.json` is the small selection catalog. Its byte counts
describe each current file; actual transferred compression depends on hosting.
Expanded restores 93.39% of MDN incoming contacts, versus 89.7% in Standard and
63.98% in Compact. LC16 incoming coverage remains only 30.56% even in Expanded,
so the explicit early-vision adapter is still necessary.

Circuit size is **not an intelligence or difficulty score**. Compact can respond
more strongly because it omits inhibitory context; Expanded may react less
strongly to the same synthetic stimulus. More anatomy costs more CPU, memory and
download time. All selected neurons run in the simulation; the connection-line
display may sample edges for readable and efficient rendering. Loading a different
graph in an offline experiment starts a fresh model state, not a smooth
biological growth or learning process. No online or offline trained controller
is included in the current game.

## Dynamics and movement

The production kernel uses exact exponential decay for the constant-current
membrane update, sampled on a fixed 1ms step. It uses a -52mV rest/reset,
-45mV threshold, 20ms membrane constant, 5ms synaptic-current decay, 2ms
refractory interval and 2ms synaptic delay. A presynaptic spike contributes
original contact count × predicted transmitter sign × 0.275mV to the target's
synaptic-current variable. These are simplified model parameters, informed by
[Shiu et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/), not
measurements of each MaleCNS neuron.

Acetylcholine is assigned positive sign; GABA, histamine and glutamate negative
sign. Glutamate effects are receptor-dependent, so this is an explicit
assumption. Dopamine, octopamine and unclear transmitter cells have zero fast
output gain. Their activity is still computed but no modulatory effect is
claimed. There is no basal firing drive; initial membrane offsets are small,
seeded and below threshold. Inhibition of completely quiescent cells consequently
has no immediate behavioural effect, another limitation of this model.

Only LC16 receives the early-vision adapter's normalized local looming input,
mapped to 0–36mV equivalent membrane drive. All cells on one side receive the
same feature; individual receptive fields are not reconstructed. `frontLoom`
and motion channels are reserved for expansion and are not presently used.
The decoder sees only actual MDN spikes filtered over 80ms. Its retreat gain is
the bilateral mean firing rate / 40Hz; its clockwise-positive heading gain is
(left-MDN mean − right-MDN mean) / 35Hz. In the airborne game this retreat signal
modulates an engineered flight dodge. MDN is a visually evoked retreat pathway,
not a validated flight controller. Baseline flight, aerodynamic-looking body
movement and swatter collision rules are game code, not connectome output.
Soma-side labels do not establish each neuron's full motor effect; the toy does
not claim a quantitative match to flying trajectories.

The recorded Standard-graph parameter probe found rapid responses to strong
synthetic looming (about 22ms until retreat exceeds 0.1 for bilateral 0.8 input),
weaker/transient responses to moderate input, and no response to tiny
input. These are simulation results, not biological reaction-time measurements.
Inhibitory recurrence makes gain-response curves non-monotonic. A larger tested
gain 0.32 produced persistent activity after some stimuli; the shipped 0.275
setting decays after the reference stimulus. A broader tier audit found the
Standard left-sided stimulus leaves 0.17Hz mean activity and 0.013 retreat after
one quiet second; it produces no further spikes in the second quiet second and
then falls below 1e-8Hz. This transient is recorded rather than removed by
retuning weights. No graph advantage over shuffled
wiring has been claimed or tested.

Offline vision lesions disable every LC16 cell; motor lesions disable the four MDNs.
Random lesions disable a seeded 30% sample. Lesions clear the neural state,
pending spikes and decoder filters. All-lesioned inputs and removed graph
edges produce exactly zero retreat. Wing animation, baseline flight, wall
collisions and body mechanics belong to the game, not this circuit.

## Reproduction and checks

Ordinary application builds and tests use the prepared graphs and do not need
Python or a raw-data download. To regenerate the data, start from the repository
root with Python 3.12 or later and sufficient storage for roughly 1.2 GB of raw
inputs plus cached tables. This is a separate, potentially expensive workflow:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
sh scripts/download-data.sh
.venv/bin/python scripts/extract_circuit.py
```

The extractor's default output, `public/data/circuit.json`, is the Standard
fixture; it is not the graph loaded by the game. Raw data and cached tables stay
in ignored `data/raw/` and do not enter browser builds. To regenerate the other
graphs, including the active Expanded graph:

```sh
.venv/bin/python scripts/extract_circuit.py --neighbors 0 --tier-id compact --output public/data/circuit-compact.json
.venv/bin/python scripts/extract_circuit.py --neighbors 700 --tier-id balanced --output public/data/circuit-balanced.json
.venv/bin/python scripts/extract_circuit.py --neighbors 4912 --tier-id expanded --output public/data/circuit-expanded.json
node scripts/probe_tiers.mjs --save
```

The final command validates 28 quiet/stimulus/lesion cases and only publishes
the catalog if every tier remains finite, responds through MDNs, respects
input/output lesions and decays within the two-second quiet observation window.
It preserves one-second results too; `tier-calibration.json` is the full audit.
`npm run test:unit -- src/neural/Tiers.test.ts` independently checks exact catalog counts,
all selected-neuron output arrays, nested identities, unchanged contact weights
and completeness of every smaller induced graph within its larger counterpart.

`npm run test:unit -- src/neural/Brain.test.ts` checks the actual circuit, source counts,
lesions, removal of all edges, deterministic replay, batching independence,
an analytical isolated-neuron reference, stimulus decay and a 0.5ms timestep
comparison. `node scripts/probe_brain.mjs --save` writes a reproducible parameter
sweep to `public/data/calibration.json`. The 0.5ms comparison preserves the main
retreat response; detailed spike times and asymmetric rates differ, so it does
not establish numerical convergence of all microscopic activity.

The biological motivation is
[Sen et al., 2017](https://pubmed.ncbi.nlm.nih.gov/28238656/), which demonstrates
a functional LC16/MDN relationship in visually evoked retreat. Matching simple
responses in this toy does not establish faithful behaviour across conditions.
