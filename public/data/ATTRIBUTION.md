# Data attribution

This project uses an adapted subset of the **MaleCNS v1.0 connectome**, from
FlyEM / HHMI Janelia Research Campus, University of Cambridge, MRC Laboratory
of Molecular Biology and Google Research; Berg et al., Cell (2026).

- Source and downloads: https://male-cns.janelia.org/download/
- License: Creative Commons Attribution 4.0 International,
  https://creativecommons.org/licenses/by/4.0/
- Adaptations: circuit selection, restoration of all retained-cell connections,
  assumed transmitter signs and point-neuron dynamics, centered soma positions,
  simplified sensory input and movement output.

Neuron IDs and original synaptic contact counts are preserved. Model parameters,
selection rules, retained connection fractions and source file checksums are
included in every `circuit*.json` graph manifest. `circuits.json` lists four
nested selections, from 1,088 to 6,000 actual neurons. `calibration.json` and
`tier-calibration.json` contain synthetic model outputs, not physiological
measurements. The MDN retreat signal is mapped to an engineered arcade flight
dodge; the graph is not a validated flight controller. The data creators have not
endorsed this toy. This is not a full-brain or whole-animal emulation.
