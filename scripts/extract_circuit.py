#!/usr/bin/env python3
"""Reproducible selection of real MaleCNS LC16/MDN paths and their neighbours.

Run with data/.venv/bin/python scripts/extract_circuit.py. Raw inputs are official
v1.0 Feather tables from https://male-cns.janelia.org/download/. No token needed.
The original table is scanned in batches so fragments never inflate RAM usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather
import pyarrow.ipc as ipc

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
BASE = 'https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/'
FILES = {
    'annotations': 'body-annotations-male-cns-v1.0-minconf-0.5.feather',
    'transmitters': 'body-neurotransmitters-male-cns-v1.0.feather',
    'connections': 'connectome-weights-male-cns-v1.0-minconf-0.5.feather',
}


def digest(path: Path) -> str:
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def scan(min_weight: int, ids: np.ndarray, any_end: bool = False) -> pd.DataFrame:
    values = pa.array(ids, type=pa.int64())
    reader = ipc.open_file(pa.memory_map(str(RAW / FILES['connections'])))
    chunks = []
    for batch_index in range(reader.num_record_batches):
        batch = reader.get_batch(batch_index)
        batch = batch.filter(pc.greater_equal(batch['weight'], min_weight))
        pre = pc.is_in(batch['body_pre'], value_set=values)
        post = pc.is_in(batch['body_post'], value_set=values)
        batch = batch.filter(pc.or_(pre, post) if any_end else pc.and_(pre, post))
        if batch.num_rows:
            chunks.append(batch)
        if batch_index % 500 == 0:
            print(f'  scanning {batch_index}/{reader.num_record_batches}', flush=True)
    return pa.Table.from_batches(chunks).to_pandas()


def distances(start: np.ndarray, sources: np.ndarray, targets: np.ndarray, n: int, hops: int) -> np.ndarray:
    distance = np.full(n, 99, dtype=np.int16)
    distance[start] = 0
    for depth in range(hops):
        reached = targets[distance[sources] == depth]
        distance[reached[distance[reached] > depth + 1]] = depth + 1
    return distance


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--path-hops', type=int, default=3)
    parser.add_argument('--neighbors', type=int, default=1800)
    parser.add_argument('--output', type=Path, default=ROOT / 'public' / 'data' / 'circuit.json')
    parser.add_argument('--tier-id', default='standard')
    parser.add_argument('--boundary-cache', type=Path, help='Optional superset boundary cache, verified to cover all selected IDs.')
    args = parser.parse_args()
    a = feather.read_feather(RAW / FILES['annotations']).set_index('bodyId')
    a = a[a['status'] == 'Traced'].sort_index()
    nt = feather.read_feather(RAW / FILES['transmitters']).set_index('body')
    index = pd.Index(a.index)
    seeds = a.index[a.type == 'LC16'].to_numpy()
    outputs = a.index[a.type == 'MDN'].to_numpy()
    print(f'LC16: {len(seeds)}; MDN: {outputs.tolist()}; annotated traced cells: {len(a)}', flush=True)
    cache = RAW / 'traced-edges-min3.feather'
    if cache.exists():
        graph = feather.read_feather(cache)
    else:
        graph = scan(3, a.index.to_numpy())
        feather.write_feather(graph, cache)
    print(f'Traced-cell candidate edges (>=3 contacts): {len(graph)}', flush=True)
    source = index.get_indexer(graph.body_pre)
    target = index.get_indexer(graph.body_post)
    fwd = distances(index.get_indexer(seeds), source, target, len(a), args.path_hops)
    back = distances(index.get_indexer(outputs), target, source, len(a), args.path_hops)
    core_mask = fwd + back <= args.path_hops
    core_mask[index.get_indexer(seeds)] = True
    core_mask[index.get_indexer(outputs)] = True
    core_ids = a.index[core_mask].to_numpy()
    print(f'Path core (<= {args.path_hops} edges): {len(core_ids)} cells', flush=True)
    print('MDN shortest LC16 distances:', fwd[index.get_indexer(outputs)].tolist(), flush=True)
    if np.any(fwd[index.get_indexer(outputs)] == 99):
        raise RuntimeError('Not all bilateral MDNs reachable: inspect graph or increase path hop audit.')
    # Ranked neighbourhood is selected structurally, before model calibration.
    # Include recurrent/inhibitory partners in both directions. Selection cuts
    # are quantified below; all >=1-contact edges among retained cells survive.
    scores = np.zeros(len(a), dtype=np.int64)
    contacts = graph.weight.to_numpy()
    np.add.at(scores, target[core_mask[source]], contacts[core_mask[source]])
    np.add.at(scores, source[core_mask[target]], contacts[core_mask[target]])
    scores[core_mask] = 0
    ranked = np.argsort(-scores, kind='stable')
    chosen = ranked[scores[ranked] >= 20][:args.neighbors]
    retained_mask = core_mask.copy()
    retained_mask[chosen] = True
    retained_ids = a.index[retained_mask].to_numpy()
    print(f'Retained {len(retained_ids)} cells including {len(chosen)} neighbourhood cells', flush=True)
    selection_hash = hashlib.sha256(retained_ids.tobytes()).hexdigest()[:16]
    boundary_cache = RAW / f'boundary-{selection_hash}.feather'
    if args.boundary_cache:
        boundary = feather.read_feather(args.boundary_cache)
        # A larger selection's boundary is a complete boundary for its subsets.
        # Caller must pass the matching larger graph for this proof.
        larger_graph = json.loads((ROOT / 'public' / 'data' / 'circuit.json').read_text())
        larger_ids = {int(n['id']) for n in larger_graph['neurons']}
        if not set(retained_ids).issubset(larger_ids):
            raise RuntimeError('The supplied boundary is not a proven superset of the selection.')
        larger_hash = hashlib.sha256(np.array(sorted(larger_ids), dtype=np.int64).tobytes()).hexdigest()[:16]
        if args.boundary_cache.name != f'boundary-{larger_hash}.feather':
            raise RuntimeError('Boundary cache name does not match the verified larger selection.')
    elif boundary_cache.exists():
        boundary = feather.read_feather(boundary_cache)
    else:
        boundary = scan(1, retained_ids, any_end=True)
        feather.write_feather(boundary, boundary_cache)
    selected_pre = boundary.body_pre.isin(retained_ids)
    selected_post = boundary.body_post.isin(retained_ids)
    edges = boundary[selected_pre & selected_post].copy()
    incoming = boundary[selected_post].groupby('body_post').weight.sum()
    outgoing = boundary[selected_pre].groupby('body_pre').weight.sum()
    internal_in = edges.groupby('body_post').weight.sum()
    internal_out = edges.groupby('body_pre').weight.sum()
    aa = a.loc[retained_ids]
    local = pd.Index(retained_ids)
    neurons = []
    confidence = {}
    missing_positions = []
    center = np.array([49000., 25000., 30000.])
    for body_id, row in aa.iterrows():
        transmitter = nt.loc[body_id, 'consensus_nt'] if body_id in nt.index else None
        if pd.isna(transmitter):
            transmitter = 'unknown'
        side = row.somaSide if row.somaSide in ('L', 'R') else 'M'
        loc = row.somaLocation
        if not isinstance(loc, (np.ndarray, list)) or len(loc) != 3:
            loc = row.tosomaLocation
        if not isinstance(loc, (np.ndarray, list)) or len(loc) != 3:
            missing_positions.append(str(body_id))
            loc = center
        # Anatomical soma positions in microns, centered for rendering. Raw
        # voxel axes are retained and explicitly recorded (no claimed eye map).
        xyz = (np.asarray(loc, dtype=float) - center) * 0.008
        role = 'sensory' if row.type == 'LC16' else 'descending' if row.superclass == 'descending_neuron' else 'motor' if row.superclass == 'motor_neuron' else 'interneuron'
        neurons.append(dict(id=str(body_id), type=str(row.type) if pd.notna(row.type) else 'untyped', side=side, nt=transmitter, role=role, x=round(float(xyz[0]), 3), y=round(float(xyz[1]), 3), z=round(float(xyz[2]), 3)))
        if body_id in nt.index:
            val = nt.loc[body_id, 'predicted_nt_confidence']
            confidence[str(body_id)] = round(float(val), 4) if pd.notna(val) else None
    # Histamine is inhibitory; monoamines and unknown transmitter cells have
    # zero effective fast current, retained structurally, not guessed excitatory.
    signs = {'acetylcholine': 1, 'gaba': -1, 'glutamate': -1, 'histamine': -1}
    pre_local = local.get_indexer(edges.body_pre)
    post_local = local.get_indexer(edges.body_post)
    exported = [[int(i), int(j), int(w), signs.get(neurons[i]['nt'], 0)] for i, j, w in zip(pre_local, post_local, edges.weight)]
    cut_audit = {}
    for label, ids in [('LC16', seeds), ('MDN', outputs), ('core', core_ids), ('all', retained_ids)]:
        total_in = int(incoming.reindex(ids, fill_value=0).sum())
        total_out = int(outgoing.reindex(ids, fill_value=0).sum())
        kept_in = int(internal_in.reindex(ids, fill_value=0).sum())
        kept_out = int(internal_out.reindex(ids, fill_value=0).sum())
        cut_audit[label] = dict(incomingContacts=total_in, retainedIncomingContacts=kept_in, incomingRetainedFraction=round(kept_in/max(1,total_in),4), outgoingContacts=total_out, retainedOutgoingContacts=kept_out, outgoingRetainedFraction=round(kept_out/max(1,total_out),4))
    input_edges = graph[graph.body_pre.isin(seeds)]
    output_edges = graph[graph.body_post.isin(outputs)]
    shared = sorted(set(input_edges.body_post) & set(output_edges.body_pre))
    routes = []
    for middle in shared:
        in_rows = input_edges[input_edges.body_post == middle]
        out_rows = output_edges[output_edges.body_pre == middle]
        routes.append(dict(intermediateId=str(middle), type=str(a.loc[middle, 'type']), lc16InputContacts=int(in_rows.weight.sum()), mdnOutputContacts=int(out_rows.weight.sum()), mdnTargets=[str(x) for x in out_rows.body_post], transmitter=str(nt.loc[middle, 'consensus_nt']) if middle in nt.index else 'unknown'))
    routes.sort(key=lambda route: -(route['lc16InputContacts'] * route['mdnOutputContacts']))
    source_urls = [BASE + name for name in FILES.values()] + ['https://male-cns.janelia.org/download/', 'https://pubmed.ncbi.nlm.nih.gov/28238656/', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11446845/']
    manifest = dict(dataset='male-cns:v1.0', neuronCount=len(neurons), edgeCount=len(exported), contactCount=int(edges.weight.sum()), description='Individual traced MaleCNS neurons along LC16-to-MDN paths and a ranked recurrent neighbourhood. No invented edges. Soma positions are anatomical, not a full neuron skeleton.',
        assumptions=[
            f'Cell selection: all <={args.path_hops}-edge LC16-to-MDN paths using >=3-contact candidate edges, plus {args.neighbors} highest-contact bidirectional neighbours with at least 20 contacts to the core. Every >=1-contact edge among retained cells is restored.',
            'Inputs bypass unmodelled early vision: normalized local looming current is injected into LC16 by soma-side annotation. All LC16 cells on a side receive that feature; receptive fields are not reconstructed.',
            'Point-neuron LIF dynamics, uniform delay and time constants, count-to-current gain, sensory-current amplitude and MDN-rate body decoder are model assumptions calibrated for this toy, not measured MaleCNS physiology.',
            'Acetylcholine is modeled excitatory; GABA, histamine and glutamate inhibitory. Glutamate sign is receptor-dependent. Monoamine/unknown cells have zero fast outgoing current; their modulatory actions are not modeled.',
            'No gap junctions, graded nonspiking dynamics, receptor diversity, neuromodulation, plasticity or full-body biomechanics are modeled. The LC16-to-MDN retreat output drives an engineered arcade flight dodge; it is not a biologically validated flight controller.',
            'Neuron coordinates are soma positions in centered microns; connecting segments are a connectivity visualization, not actual axon reconstructions.',
        ], sourceUrls=source_urls, license='CC BY 4.0', licenseUrl='https://creativecommons.org/licenses/by/4.0/', attribution='MaleCNS: FlyEM / HHMI Janelia, University of Cambridge, MRC LMB and Google Research; Berg et al., Cell 2026. Adapted by circuit selection, numerical modeling and position normalization.',
        sources=[dict(file=name, url=BASE+name, sha256=digest(RAW/name)) for name in FILES.values()],
        sensoryIds=[str(x) for x in seeds], outputIds=[str(x) for x in outputs], coreIds=[str(x) for x in core_ids],
        cutBoundary=cut_audit, transmitterConfidence=confidence, missingSomaPositionIds=missing_positions,
        coordinateTransform=dict(sourceUnits='8nm voxels', subtractVoxels=center.tolist(), multiply=0.008, targetUnits='microns'),
        selection=dict(pathMaximumEdges=args.path_hops, pathMinimumContacts=3, neighborhoodCells=len(chosen), neighborhoodMinimumContacts=20, finalMinimumContacts=1),
        twoEdgeRoutes=routes,
        modelParameters=dict(synapseMvPerContact=0.275, sensoryCurrentMv=36, tonicCurrentMv=0, decoderHz=40, turnHz=35))
    manifest['tierId'] = args.tier_id
    result = dict(version='malecns-v1.0-retreat-1', name='MaleCNS retreat circuit', source='https://male-cns.janelia.org/', neurons=neurons, edges=exported, manifest=manifest)
    out = args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False))
    print(json.dumps(dict(neurons=len(neurons), edges=len(exported), contacts=manifest['contactCount'], bytes=out.stat().st_size, boundary=cut_audit, transmitters=pd.Series([x['nt'] for x in neurons]).value_counts().to_dict()), indent=2), flush=True)


if __name__ == '__main__':
    main()
