import type { GraphEdge, GraphNode, MermaidDirection, MermaidGraph } from "./types";
import type { StyleTokens } from "./styles";

export type Point = { x: number; y: number };

export type GraphLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  lane: number;
};

export type GraphLayoutEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: GraphEdge["style"];
  start: Point;
  end: Point;
  midpoint: Point;
  points: Point[];
};

export type GraphLayout = {
  width: number;
  height: number;
  titleHeight: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
};

export function computeGraphLayout(diagram: MermaidGraph, tokens: StyleTokens): GraphLayout {
  const titleHeight = diagram.title ? tokens.type.title + tokens.space.lg : 0;
  const horizontal = isHorizontal(diagram.direction);
  const forward = diagram.direction !== "BT" && diagram.direction !== "RL";
  const rankById = computeRanks(diagram.nodes, diagram.edges);
  const ranks = orderRanks(diagram.nodes, diagram.edges, rankById);
  const rankCount = Math.max(1, ranks.length);
  const nodeWidth = tokens.graph.nodeWidth;
  const nodeHeight = tokens.graph.nodeHeight;
  const laneGapByRank = ranks.map((rank) => laneGapForRank(rank, diagram.edges, tokens.graph.laneGap));
  const rankGapByIndex = ranks.map((rank) => rankGapAfterRank(rank, diagram.edges, tokens.graph.rankGap));
  const maxCrossSize = Math.max(1, ...ranks.map((rank, index) => crossSizeForRank(rank.length, horizontal ? nodeHeight : nodeWidth, laneGapByRank[index])));
  const padding = tokens.graph.padding;
  const rowWidth = horizontal ? maxCrossSize : maxCrossSize;
  const columnHeight = maxCrossSize;
  const nodeLayouts = new Map<string, GraphLayoutNode>();
  const primaryOffsets = cumulativeRankOffsets(ranks, horizontal ? nodeWidth : nodeHeight, rankGapByIndex);

  ranks.forEach((rankNodes, rankIndex) => {
    const visualRank = forward ? rankIndex : rankCount - 1 - rankIndex;
    const laneCount = Math.max(rankNodes.length, 1);
    const laneGap = laneGapByRank[rankIndex];
    const rankCrossSize = crossSizeForRank(laneCount, horizontal ? nodeHeight : nodeWidth, laneGap);
    const crossOffset = ((horizontal ? columnHeight : rowWidth) - rankCrossSize) / 2;

    rankNodes.forEach((id, lane) => {
      const primary = padding + primaryOffsets[visualRank];
      const secondary = padding + titleHeight + crossOffset + lane * ((horizontal ? nodeHeight : nodeWidth) + laneGap);
      const layout: GraphLayoutNode = horizontal
        ? { id, x: primary, y: secondary, width: nodeWidth, height: nodeHeight, rank: rankIndex, lane }
        : { id, x: secondary, y: primary + titleHeight, width: nodeWidth, height: nodeHeight, rank: rankIndex, lane };
      nodeLayouts.set(id, layout);
    });
  });

  const graphWidth = horizontal
    ? padding * 2 + primaryOffsets[rankCount - 1] + nodeWidth
    : padding * 2 + rowWidth;
  const graphHeight = horizontal
    ? padding * 2 + titleHeight + columnHeight
    : padding * 2 + titleHeight + primaryOffsets[rankCount - 1] + nodeHeight;

  const edges = diagram.edges.flatMap((edge) => {
    const from = nodeLayouts.get(edge.from);
    const to = nodeLayouts.get(edge.to);
    if (!from || !to) return [];
    const points = orthogonalPoints(from, to, horizontal);
    return [{
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      style: edge.style,
      start: points[0],
      end: points[points.length - 1],
      midpoint: midpointForPath(points),
      points,
    }];
  });

  return {
    width: graphWidth,
    height: graphHeight,
    titleHeight,
    nodes: [...nodeLayouts.values()],
    edges,
  };
}

function computeRanks(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, GraphEdge[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (queue.length === 0) queue.push(...nodes.map((node) => node.id));

  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      ranks.set(edge.to, Math.max(ranks.get(edge.to) ?? 0, (ranks.get(id) ?? 0) + 1));
      indegree.set(edge.to, Math.max(0, (indegree.get(edge.to) ?? 0) - 1));
      if ((indegree.get(edge.to) ?? 0) === 0) queue.push(edge.to);
    }
  }

  return ranks;
}

function orderRanks(nodes: GraphNode[], edges: GraphEdge[], rankById: Map<string, number>): string[][] {
  const maxRank = Math.max(...[...rankById.values(), 0]);
  const ranks = Array.from({ length: maxRank + 1 }, () => [] as string[]);
  for (const node of nodes) ranks[rankById.get(node.id) ?? 0].push(node.id);

  const incoming = adjacency(edges, "to", "from");
  const outgoing = adjacency(edges, "from", "to");

  for (let pass = 0; pass < 6; pass += 1) {
    for (let rank = 1; rank < ranks.length; rank += 1) sortByBarycenter(ranks[rank], ranks[rank - 1], incoming);
    for (let rank = ranks.length - 2; rank >= 0; rank -= 1) sortByBarycenter(ranks[rank], ranks[rank + 1], outgoing);
  }
  reduceAdjacentCrossings(ranks, edges);

  return ranks;
}

function reduceAdjacentCrossings(ranks: string[][], edges: GraphEdge[]): void {
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
      const rank = ranks[rankIndex];
      for (let lane = 0; lane < rank.length - 1; lane += 1) {
        const before = crossingScore(ranks, edges);
        [rank[lane], rank[lane + 1]] = [rank[lane + 1], rank[lane]];
        const after = crossingScore(ranks, edges);
        if (after < before) changed = true;
        else [rank[lane], rank[lane + 1]] = [rank[lane + 1], rank[lane]];
      }
    }
    if (!changed) return;
  }
}

function crossingScore(ranks: string[][], edges: GraphEdge[]): number {
  const rankIndex = new Map<string, number>();
  const laneIndex = new Map<string, number>();
  ranks.forEach((rank, rankNumber) => rank.forEach((id, lane) => {
    rankIndex.set(id, rankNumber);
    laneIndex.set(id, lane);
  }));

  let score = 0;
  for (let rank = 0; rank < ranks.length - 1; rank += 1) {
    const adjacentEdges = edges
      .filter((edge) => rankIndex.get(edge.from) === rank && rankIndex.get(edge.to) === rank + 1)
      .map((edge) => ({ from: laneIndex.get(edge.from) ?? 0, to: laneIndex.get(edge.to) ?? 0 }));
    for (let a = 0; a < adjacentEdges.length; a += 1) {
      for (let b = a + 1; b < adjacentEdges.length; b += 1) {
        const first = adjacentEdges[a];
        const second = adjacentEdges[b];
        if ((first.from - second.from) * (first.to - second.to) < 0) score += 1;
      }
    }
  }
  return score;
}

function laneGapForRank(rank: string[], edges: GraphEdge[], baseGap: number): number {
  if (rank.length <= 2) return baseGap;
  const outgoingCounts = countBy(edges, "from");
  const incomingCounts = countBy(edges, "to");
  const ids = new Set(rank);
  const parentFanout = Math.max(...edges.filter((edge) => ids.has(edge.to)).map((edge) => outgoingCounts.get(edge.from) ?? 0), 0);
  const pressure = Math.max(...rank.map((id) => Math.max(outgoingCounts.get(id) ?? 0, incomingCounts.get(id) ?? 0)), parentFanout, 0);
  return baseGap + Math.max(0, pressure - 2) * Math.max(6, Math.round(baseGap * 0.75));
}

function rankGapAfterRank(rank: string[], edges: GraphEdge[], baseGap: number): number {
  const outgoingCounts = countBy(edges, "from");
  const fanout = Math.max(...rank.map((id) => outgoingCounts.get(id) ?? 0), 0);
  return baseGap + Math.max(0, fanout - 3) * Math.max(8, Math.round(baseGap * 0.35));
}

function crossSizeForRank(count: number, nodeCrossSize: number, laneGap: number): number {
  return Math.max(1, count) * nodeCrossSize + Math.max(0, count - 1) * laneGap;
}

function cumulativeRankOffsets(ranks: string[][], nodePrimarySize: number, rankGaps: number[]): number[] {
  const offsets = [0];
  for (let index = 1; index < ranks.length; index += 1) {
    offsets[index] = offsets[index - 1] + nodePrimarySize + rankGaps[index - 1];
  }
  return offsets;
}

function countBy(edges: GraphEdge[], key: "from" | "to"): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edge[key], (counts.get(edge[key]) ?? 0) + 1);
  return counts;
}

function adjacency(edges: GraphEdge[], key: "from" | "to", value: "from" | "to"): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) map.set(edge[key], [...(map.get(edge[key]) ?? []), edge[value]]);
  return map;
}

function sortByBarycenter(rank: string[], neighborRank: string[], adjacencyMap: Map<string, string[]>): void {
  const neighborIndex = new Map(neighborRank.map((id, index) => [id, index]));
  const original = new Map(rank.map((id, index) => [id, index]));
  rank.sort((a, b) => {
    const aScore = barycenter(a, adjacencyMap, neighborIndex, original.get(a) ?? 0);
    const bScore = barycenter(b, adjacencyMap, neighborIndex, original.get(b) ?? 0);
    return aScore - bScore || (original.get(a) ?? 0) - (original.get(b) ?? 0);
  });
}

function barycenter(id: string, adjacencyMap: Map<string, string[]>, neighborIndex: Map<string, number>, fallback: number): number {
  const neighbors = (adjacencyMap.get(id) ?? []).map((neighbor) => neighborIndex.get(neighbor)).filter((value): value is number => typeof value === "number");
  if (neighbors.length === 0) return fallback;
  return neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
}

function orthogonalPoints(from: GraphLayoutNode, to: GraphLayoutNode, horizontal: boolean): Point[] {
  if (horizontal) {
    const fromRight = to.x >= from.x;
    const start = { x: fromRight ? from.x + from.width : from.x, y: from.y + from.height / 2 };
    const end = { x: fromRight ? to.x : to.x + to.width, y: to.y + to.height / 2 };
    const midX = (start.x + end.x) / 2;
    return dedupePoints([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
  }

  const toBelow = to.y >= from.y;
  const start = { x: from.x + from.width / 2, y: toBelow ? from.y + from.height : from.y };
  const end = { x: to.x + to.width / 2, y: toBelow ? to.y : to.y + to.height };
  const midY = (start.y + end.y) / 2;
  return dedupePoints([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
}

function midpointForPath(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = distance(points[index - 1], points[index]);
    lengths.push(length);
    total += length;
  }
  let walked = 0;
  const half = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const length = lengths[index - 1];
    if (walked + length >= half) {
      const t = length === 0 ? 0 : (half - walked) / length;
      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * t,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * t,
      };
    }
    walked += length;
  }
  return points[Math.floor(points.length / 2)];
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function dedupePoints(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function isHorizontal(direction: MermaidDirection): boolean {
  return direction === "LR" || direction === "RL";
}
