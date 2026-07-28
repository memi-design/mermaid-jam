(function() {
	//#region src/shared/layout.ts
	function computeGraphLayout(diagram, tokens) {
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
		const nodeLayouts = /* @__PURE__ */ new Map();
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
				const layout = horizontal ? {
					id,
					x: primary,
					y: secondary,
					width: nodeWidth,
					height: nodeHeight,
					rank: rankIndex,
					lane
				} : {
					id,
					x: secondary,
					y: primary + titleHeight,
					width: nodeWidth,
					height: nodeHeight,
					rank: rankIndex,
					lane
				};
				nodeLayouts.set(id, layout);
			});
		});
		const graphWidth = horizontal ? padding * 2 + primaryOffsets[rankCount - 1] + nodeWidth : padding * 2 + rowWidth;
		const graphHeight = horizontal ? padding * 2 + titleHeight + columnHeight : padding * 2 + titleHeight + primaryOffsets[rankCount - 1] + nodeHeight;
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
				points
			}];
		});
		return {
			width: graphWidth,
			height: graphHeight,
			titleHeight,
			nodes: [...nodeLayouts.values()],
			edges
		};
	}
	function computeRanks(nodes, edges) {
		const ranks = new Map(nodes.map((node) => [node.id, 0]));
		const outgoing = /* @__PURE__ */ new Map();
		const indegree = new Map(nodes.map((node) => [node.id, 0]));
		for (const edge of edges) {
			var _outgoing$get, _indegree$get;
			outgoing.set(edge.from, [...(_outgoing$get = outgoing.get(edge.from)) !== null && _outgoing$get !== void 0 ? _outgoing$get : [], edge]);
			indegree.set(edge.to, ((_indegree$get = indegree.get(edge.to)) !== null && _indegree$get !== void 0 ? _indegree$get : 0) + 1);
		}
		const queue = nodes.filter((node) => {
			var _indegree$get2;
			return ((_indegree$get2 = indegree.get(node.id)) !== null && _indegree$get2 !== void 0 ? _indegree$get2 : 0) === 0;
		}).map((node) => node.id);
		if (queue.length === 0) queue.push(...nodes.map((node) => node.id));
		const visited = /* @__PURE__ */ new Set();
		while (queue.length > 0) {
			var _outgoing$get2;
			const id = queue.shift();
			if (visited.has(id)) continue;
			visited.add(id);
			for (const edge of (_outgoing$get2 = outgoing.get(id)) !== null && _outgoing$get2 !== void 0 ? _outgoing$get2 : []) {
				var _ranks$get, _ranks$get2, _indegree$get3, _indegree$get4;
				ranks.set(edge.to, Math.max((_ranks$get = ranks.get(edge.to)) !== null && _ranks$get !== void 0 ? _ranks$get : 0, ((_ranks$get2 = ranks.get(id)) !== null && _ranks$get2 !== void 0 ? _ranks$get2 : 0) + 1));
				indegree.set(edge.to, Math.max(0, ((_indegree$get3 = indegree.get(edge.to)) !== null && _indegree$get3 !== void 0 ? _indegree$get3 : 0) - 1));
				if (((_indegree$get4 = indegree.get(edge.to)) !== null && _indegree$get4 !== void 0 ? _indegree$get4 : 0) === 0) queue.push(edge.to);
			}
		}
		return ranks;
	}
	function orderRanks(nodes, edges, rankById) {
		var _rankById$get;
		const maxRank = Math.max(...[...rankById.values(), 0]);
		const ranks = Array.from({ length: maxRank + 1 }, () => []);
		for (const node of nodes) ranks[(_rankById$get = rankById.get(node.id)) !== null && _rankById$get !== void 0 ? _rankById$get : 0].push(node.id);
		const incoming = adjacency(edges, "to", "from");
		const outgoing = adjacency(edges, "from", "to");
		for (let pass = 0; pass < 6; pass += 1) {
			for (let rank = 1; rank < ranks.length; rank += 1) sortByBarycenter(ranks[rank], ranks[rank - 1], incoming);
			for (let rank = ranks.length - 2; rank >= 0; rank -= 1) sortByBarycenter(ranks[rank], ranks[rank + 1], outgoing);
		}
		reduceAdjacentCrossings(ranks, edges);
		return ranks;
	}
	function reduceAdjacentCrossings(ranks, edges) {
		for (let pass = 0; pass < 4; pass += 1) {
			let changed = false;
			for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
				const rank = ranks[rankIndex];
				for (let lane = 0; lane < rank.length - 1; lane += 1) {
					const before = crossingScore(ranks, edges);
					[rank[lane], rank[lane + 1]] = [rank[lane + 1], rank[lane]];
					if (crossingScore(ranks, edges) < before) changed = true;
					else [rank[lane], rank[lane + 1]] = [rank[lane + 1], rank[lane]];
				}
			}
			if (!changed) return;
		}
	}
	function crossingScore(ranks, edges) {
		const rankIndex = /* @__PURE__ */ new Map();
		const laneIndex = /* @__PURE__ */ new Map();
		ranks.forEach((rank, rankNumber) => rank.forEach((id, lane) => {
			rankIndex.set(id, rankNumber);
			laneIndex.set(id, lane);
		}));
		let score = 0;
		for (let rank = 0; rank < ranks.length - 1; rank += 1) {
			const adjacentEdges = edges.filter((edge) => rankIndex.get(edge.from) === rank && rankIndex.get(edge.to) === rank + 1).map((edge) => {
				var _laneIndex$get, _laneIndex$get2;
				return {
					from: (_laneIndex$get = laneIndex.get(edge.from)) !== null && _laneIndex$get !== void 0 ? _laneIndex$get : 0,
					to: (_laneIndex$get2 = laneIndex.get(edge.to)) !== null && _laneIndex$get2 !== void 0 ? _laneIndex$get2 : 0
				};
			});
			for (let a = 0; a < adjacentEdges.length; a += 1) for (let b = a + 1; b < adjacentEdges.length; b += 1) {
				const first = adjacentEdges[a];
				const second = adjacentEdges[b];
				if ((first.from - second.from) * (first.to - second.to) < 0) score += 1;
			}
		}
		return score;
	}
	function laneGapForRank(rank, edges, baseGap) {
		if (rank.length <= 2) return baseGap;
		const outgoingCounts = countBy(edges, "from");
		const incomingCounts = countBy(edges, "to");
		const ids = new Set(rank);
		const parentFanout = Math.max(...edges.filter((edge) => ids.has(edge.to)).map((edge) => {
			var _outgoingCounts$get;
			return (_outgoingCounts$get = outgoingCounts.get(edge.from)) !== null && _outgoingCounts$get !== void 0 ? _outgoingCounts$get : 0;
		}), 0);
		const pressure = Math.max(...rank.map((id) => {
			var _outgoingCounts$get2, _incomingCounts$get;
			return Math.max((_outgoingCounts$get2 = outgoingCounts.get(id)) !== null && _outgoingCounts$get2 !== void 0 ? _outgoingCounts$get2 : 0, (_incomingCounts$get = incomingCounts.get(id)) !== null && _incomingCounts$get !== void 0 ? _incomingCounts$get : 0);
		}), parentFanout, 0);
		return baseGap + Math.max(0, pressure - 2) * Math.max(6, Math.round(baseGap * .75));
	}
	function rankGapAfterRank(rank, edges, baseGap) {
		const outgoingCounts = countBy(edges, "from");
		const fanout = Math.max(...rank.map((id) => {
			var _outgoingCounts$get3;
			return (_outgoingCounts$get3 = outgoingCounts.get(id)) !== null && _outgoingCounts$get3 !== void 0 ? _outgoingCounts$get3 : 0;
		}), 0);
		return baseGap + Math.max(0, fanout - 3) * Math.max(8, Math.round(baseGap * .35));
	}
	function crossSizeForRank(count, nodeCrossSize, laneGap) {
		return Math.max(1, count) * nodeCrossSize + Math.max(0, count - 1) * laneGap;
	}
	function cumulativeRankOffsets(ranks, nodePrimarySize, rankGaps) {
		const offsets = [0];
		for (let index = 1; index < ranks.length; index += 1) offsets[index] = offsets[index - 1] + nodePrimarySize + rankGaps[index - 1];
		return offsets;
	}
	function countBy(edges, key) {
		var _counts$get;
		const counts = /* @__PURE__ */ new Map();
		for (const edge of edges) counts.set(edge[key], ((_counts$get = counts.get(edge[key])) !== null && _counts$get !== void 0 ? _counts$get : 0) + 1);
		return counts;
	}
	function adjacency(edges, key, value) {
		var _map$get;
		const map = /* @__PURE__ */ new Map();
		for (const edge of edges) map.set(edge[key], [...(_map$get = map.get(edge[key])) !== null && _map$get !== void 0 ? _map$get : [], edge[value]]);
		return map;
	}
	function sortByBarycenter(rank, neighborRank, adjacencyMap) {
		const neighborIndex = new Map(neighborRank.map((id, index) => [id, index]));
		const original = new Map(rank.map((id, index) => [id, index]));
		rank.sort((a, b) => {
			var _original$get, _original$get2, _original$get3, _original$get4;
			return barycenter(a, adjacencyMap, neighborIndex, (_original$get = original.get(a)) !== null && _original$get !== void 0 ? _original$get : 0) - barycenter(b, adjacencyMap, neighborIndex, (_original$get2 = original.get(b)) !== null && _original$get2 !== void 0 ? _original$get2 : 0) || ((_original$get3 = original.get(a)) !== null && _original$get3 !== void 0 ? _original$get3 : 0) - ((_original$get4 = original.get(b)) !== null && _original$get4 !== void 0 ? _original$get4 : 0);
		});
	}
	function barycenter(id, adjacencyMap, neighborIndex, fallback) {
		var _adjacencyMap$get;
		const neighbors = ((_adjacencyMap$get = adjacencyMap.get(id)) !== null && _adjacencyMap$get !== void 0 ? _adjacencyMap$get : []).map((neighbor) => neighborIndex.get(neighbor)).filter((value) => typeof value === "number");
		if (neighbors.length === 0) return fallback;
		return neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
	}
	function orthogonalPoints(from, to, horizontal) {
		if (horizontal) {
			const fromRight = to.x >= from.x;
			const start = {
				x: fromRight ? from.x + from.width : from.x,
				y: from.y + from.height / 2
			};
			const end = {
				x: fromRight ? to.x : to.x + to.width,
				y: to.y + to.height / 2
			};
			const midX = (start.x + end.x) / 2;
			return dedupePoints([
				start,
				{
					x: midX,
					y: start.y
				},
				{
					x: midX,
					y: end.y
				},
				end
			]);
		}
		const toBelow = to.y >= from.y;
		const start = {
			x: from.x + from.width / 2,
			y: toBelow ? from.y + from.height : from.y
		};
		const end = {
			x: to.x + to.width / 2,
			y: toBelow ? to.y : to.y + to.height
		};
		const midY = (start.y + end.y) / 2;
		return dedupePoints([
			start,
			{
				x: start.x,
				y: midY
			},
			{
				x: end.x,
				y: midY
			},
			end
		]);
	}
	function midpointForPath(points) {
		if (points.length === 0) return {
			x: 0,
			y: 0
		};
		const lengths = [];
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
					y: points[index - 1].y + (points[index].y - points[index - 1].y) * t
				};
			}
			walked += length;
		}
		return points[Math.floor(points.length / 2)];
	}
	function distance(a, b) {
		return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
	}
	function dedupePoints(points) {
		return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
	}
	function isHorizontal(direction) {
		return direction === "LR" || direction === "RL";
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.139.0/helpers/esm/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.139.0/helpers/esm/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.139.0/helpers/esm/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.139.0/helpers/esm/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.139.0/helpers/esm/objectSpread2.js
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r) {
				return Object.getOwnPropertyDescriptor(e, r).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread2(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
				_defineProperty(e, r, t[r]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
				Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
			});
		}
		return e;
	}
	//#endregion
	//#region src/shared/styles.ts
	var densityScale = {
		compact: {
			canvasWidth: 720,
			radius: 5,
			borderWidth: 1,
			space: {
				xs: 3,
				sm: 5,
				md: 8,
				lg: 12,
				xl: 18
			},
			type: {
				body: 24,
				small: 24,
				title: 28,
				lineHeight: 1.2
			},
			graph: {
				nodeWidth: 280,
				nodeHeight: 88,
				rankGap: 96,
				laneGap: 48,
				padding: 64
			}
		},
		comfy: {
			canvasWidth: 860,
			radius: 5,
			borderWidth: 1,
			space: {
				xs: 4,
				sm: 6,
				md: 10,
				lg: 15,
				xl: 22
			},
			type: {
				body: 26,
				small: 24,
				title: 30,
				lineHeight: 1.2
			},
			graph: {
				nodeWidth: 340,
				nodeHeight: 104,
				rankGap: 120,
				laneGap: 62,
				padding: 76
			}
		},
		spacious: {
			canvasWidth: 1040,
			radius: 5,
			borderWidth: 1,
			space: {
				xs: 5,
				sm: 8,
				md: 12,
				lg: 18,
				xl: 28
			},
			type: {
				body: 30,
				small: 26,
				title: 34,
				lineHeight: 1.22
			},
			graph: {
				nodeWidth: 420,
				nodeHeight: 128,
				rankGap: 154,
				laneGap: 82,
				padding: 92
			}
		}
	};
	var layoutScale = {
		compact: {
			node: 1,
			nodeY: 1,
			rank: 1,
			lane: 1,
			padding: 1,
			canvas: 1
		},
		readable: {
			node: 1.12,
			nodeY: 1.08,
			rank: 1.18,
			lane: 1.22,
			padding: 1.12,
			canvas: 1.08
		},
		presentation: {
			node: 1.32,
			nodeY: 1.24,
			rank: 1.35,
			lane: 1.35,
			padding: 1.25,
			canvas: 1.2
		},
		print: {
			node: 1.08,
			nodeY: 1.08,
			rank: 1.12,
			lane: 1.18,
			padding: 1.08,
			canvas: 1.05
		},
		"wide-map": {
			node: 1.04,
			nodeY: 1,
			rank: 1.55,
			lane: 1.05,
			padding: 1.1,
			canvas: 1.35
		},
		"deep-tree": {
			node: 1,
			nodeY: 1,
			rank: 1.24,
			lane: 1.38,
			padding: 1.1,
			canvas: 1.1
		}
	};
	var routingScale = {
		direct: {
			rank: .9,
			lane: .9,
			padding: 1
		},
		elbow: {
			rank: 1,
			lane: 1,
			padding: 1
		},
		"avoid-nodes": {
			rank: 1.28,
			lane: 1.45,
			padding: 1.12
		},
		"more-spacing": {
			rank: 1.58,
			lane: 1.7,
			padding: 1.22
		},
		"loop-friendly": {
			rank: 1.42,
			lane: 1.52,
			padding: 1.18
		}
	};
	var minimalColors = {
		canvas: "#FFFFFF",
		surface: "#FFFFFF",
		text: "#151515",
		muted: "#5F6368",
		border: "#DADCE0",
		accent: "#111111",
		accentSoft: "#F1F3F4",
		connector: "#111111",
		node: {
			rectangle: {
				bg: "#FFFFFF",
				fg: "#151515",
				border: "#CFCFCA"
			},
			rounded: {
				bg: "#FFFFFF",
				fg: "#151515",
				border: "#CFCFCA"
			},
			decision: {
				bg: "#FFF6D8",
				fg: "#604400",
				border: "#D9B94B"
			},
			terminal: {
				bg: "#EAF7EE",
				fg: "#165A32",
				border: "#8ACB99"
			},
			flag: {
				bg: "#FFFFFF",
				fg: "#151515",
				border: "#CFCFCA"
			}
		},
		depth: [
			{
				bg: "#111111",
				fg: "#FFFFFF",
				border: "#111111"
			},
			{
				bg: "#EAF4FF",
				fg: "#16466F",
				border: "#91BDE4"
			},
			{
				bg: "#EAF7EE",
				fg: "#165A32",
				border: "#8ACB99"
			},
			{
				bg: "#FFF6D8",
				fg: "#604400",
				border: "#D9B94B"
			},
			{
				bg: "#F8F5FF",
				fg: "#4A2A74",
				border: "#C8B7EA"
			},
			{
				bg: "#F1F3F4",
				fg: "#303134",
				border: "#C9CCCF"
			}
		],
		semantic: {
			default: {
				bg: "#111111",
				fg: "#FFFFFF",
				border: "#111111"
			},
			sink: {
				bg: "#EAF7EE",
				fg: "#165A32",
				border: "#8ACB99"
			},
			error: {
				bg: "#FFE3E3",
				fg: "#7A1F1F",
				border: "#E58D8D"
			},
			warning: {
				bg: "#FFF6D8",
				fg: "#604400",
				border: "#D9B94B"
			},
			success: {
				bg: "#EAF7EE",
				fg: "#165A32",
				border: "#8ACB99"
			},
			backend: {
				bg: "#F1F3F4",
				fg: "#303134",
				border: "#B8BDC2"
			},
			auth: {
				bg: "#F3ECFF",
				fg: "#4A2A74",
				border: "#BBA4E4"
			},
			payment: {
				bg: "#FFF0D9",
				fg: "#704400",
				border: "#D8AA60"
			},
			data: {
				bg: "#E8F7F4",
				fg: "#14574D",
				border: "#83C9BD"
			},
			external: {
				bg: "#EEF1FF",
				fg: "#283B77",
				border: "#9AA7E6"
			},
			screen: {
				bg: "#EAF4FF",
				fg: "#16466F",
				border: "#91BDE4"
			},
			user: {
				bg: "#FFFFFF",
				fg: "#151515",
				border: "#CFCFCA"
			},
			decision: {
				bg: "#FFF6D8",
				fg: "#604400",
				border: "#D9B94B"
			},
			note: {
				bg: "#FAFAF8",
				fg: "#444440",
				border: "#D7D7D1"
			}
		}
	};
	var printColors = _objectSpread2(_objectSpread2({}, minimalColors), {}, {
		connector: "#000000",
		depth: [
			{
				bg: "#FFFFFF",
				fg: "#111111",
				border: "#111111"
			},
			{
				bg: "#F7F7F5",
				fg: "#111111",
				border: "#777777"
			},
			{
				bg: "#FFFFFF",
				fg: "#111111",
				border: "#777777"
			}
		],
		semantic: Object.fromEntries(Object.entries(minimalColors.semantic).map(([key, value]) => [key, _objectSpread2(_objectSpread2({}, value), {}, { border: key === "default" ? "#111111" : value.border })]))
	});
	var themeColors = {
		blueprint: minimalColors,
		editorial: minimalColors,
		"product-map": minimalColors,
		minimal: minimalColors
	};
	function getStyleTokens(options) {
		var _normalizeDensity, _normalizeFontSize, _normalizeLayoutPrese, _normalizeRoutingMode, _normalizeSemanticMod, _normalizeManualLayou, _normalizeJourneyView, _themeColors$options$, _normalizeTheme, _normalizeColorLayers;
		const densityName = (_normalizeDensity = normalizeDensity(options.density)) !== null && _normalizeDensity !== void 0 ? _normalizeDensity : "compact";
		const density = densityScale[densityName];
		const fontSize = (_normalizeFontSize = normalizeFontSize(options.fontSize)) !== null && _normalizeFontSize !== void 0 ? _normalizeFontSize : density.type.body;
		const layoutPreset = (_normalizeLayoutPrese = normalizeLayoutPreset(options.layoutPreset)) !== null && _normalizeLayoutPrese !== void 0 ? _normalizeLayoutPrese : "compact";
		const routingMode = (_normalizeRoutingMode = normalizeRoutingMode(options.routingMode)) !== null && _normalizeRoutingMode !== void 0 ? _normalizeRoutingMode : "elbow";
		const semanticMode = (_normalizeSemanticMod = normalizeSemanticMode(options.semanticMode)) !== null && _normalizeSemanticMod !== void 0 ? _normalizeSemanticMod : "auto";
		const manualLayout = (_normalizeManualLayou = normalizeManualLayout(options.manualLayout)) !== null && _normalizeManualLayou !== void 0 ? _normalizeManualLayou : "preserve";
		const journeyView = (_normalizeJourneyView = normalizeJourneyView(options.journeyView)) !== null && _normalizeJourneyView !== void 0 ? _normalizeJourneyView : "clean";
		const layout = layoutScale[layoutPreset];
		const route = routingScale[routingMode];
		const colors = layoutPreset === "print" ? printColors : (_themeColors$options$ = themeColors[options.theme]) !== null && _themeColors$options$ !== void 0 ? _themeColors$options$ : minimalColors;
		return _objectSpread2(_objectSpread2({
			theme: (_normalizeTheme = normalizeTheme(options.theme)) !== null && _normalizeTheme !== void 0 ? _normalizeTheme : "minimal",
			density: densityName,
			colorLayers: (_normalizeColorLayers = normalizeColorLayers(options.colorLayers)) !== null && _normalizeColorLayers !== void 0 ? _normalizeColorLayers : 3,
			layoutPreset,
			routingMode,
			semanticMode,
			semanticRules: normalizeSemanticRules(options.semanticRules),
			manualLayout,
			journeyView
		}, density), {}, {
			canvasWidth: Math.round(density.canvasWidth * layout.canvas),
			type: _objectSpread2(_objectSpread2({}, density.type), {}, {
				body: fontSize,
				small: Math.max(24, Math.round(fontSize * .92)),
				title: Math.max(28, Math.round(fontSize * 1.16))
			}),
			graph: {
				nodeWidth: Math.round(density.graph.nodeWidth * layout.node),
				nodeHeight: Math.round(density.graph.nodeHeight * layout.nodeY),
				rankGap: Math.round(density.graph.rankGap * layout.rank * route.rank),
				laneGap: Math.round(density.graph.laneGap * layout.lane * route.lane),
				padding: Math.round(density.graph.padding * layout.padding * route.padding)
			},
			colors
		});
	}
	function normalizeTheme(value) {
		return value === "blueprint" || value === "editorial" || value === "product-map" || value === "minimal" ? value : null;
	}
	function normalizeDensity(value) {
		return value === "compact" || value === "comfy" || value === "spacious" ? value : null;
	}
	function normalizeLayoutPreset(value) {
		return value === "compact" || value === "readable" || value === "presentation" || value === "print" || value === "wide-map" || value === "deep-tree" ? value : null;
	}
	function normalizeRoutingMode(value) {
		return value === "direct" || value === "elbow" || value === "avoid-nodes" || value === "more-spacing" || value === "loop-friendly" ? value : null;
	}
	function normalizeSemanticMode(value) {
		return value === "depth" || value === "auto" || value === "custom" ? value : null;
	}
	function normalizeManualLayout(value) {
		return value === "preserve" || value === "reset" ? value : null;
	}
	function normalizeJourneyView(value) {
		return value === "clean" || value === "scores" || value === "insights" ? value : null;
	}
	function normalizeSemanticCategory(value) {
		return value === "error" || value === "warning" || value === "success" || value === "backend" || value === "auth" || value === "payment" || value === "data" || value === "external" || value === "screen" || value === "user" || value === "decision" || value === "note" ? value : null;
	}
	function normalizeFontSize(value) {
		const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
		if (!Number.isFinite(parsed)) return null;
		return Math.min(64, Math.max(24, Math.round(parsed)));
	}
	function normalizeColorLayers(value) {
		const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
		if (!Number.isFinite(parsed)) return null;
		return Math.min(6, Math.max(1, Math.round(parsed)));
	}
	function normalizeSemanticRules(value) {
		if (!Array.isArray(value)) return [];
		return value.flatMap((rule, index) => {
			if (!rule || typeof rule !== "object") return [];
			const record = rule;
			const category = normalizeSemanticCategory(record.category);
			const keywords = Array.isArray(record.keywords) ? record.keywords.map((keyword) => String(keyword).trim()).filter(Boolean) : [];
			if (!category || keywords.length === 0) return [];
			return [{
				id: typeof record.id === "string" ? record.id : `rule-${index + 1}`,
				keywords,
				category,
				fill: normalizeHexColor(record.fill),
				stroke: normalizeHexColor(record.stroke),
				text: normalizeHexColor(record.text),
				enabled: record.enabled !== false,
				priority: typeof record.priority === "number" && Number.isFinite(record.priority) ? record.priority : void 0
			}];
		});
	}
	function normalizeHexColor(value) {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed.toUpperCase() : void 0;
	}
	function hexToRgb(hex) {
		const normalized = hex.replace("#", "").trim();
		const value = normalized.length === 3 ? normalized.split("").map((char) => `${char}${char}`).join("") : normalized;
		const int = Number.parseInt(value, 16);
		return {
			r: (int >> 16 & 255) / 255,
			g: (int >> 8 & 255) / 255,
			b: (int & 255) / 255
		};
	}
	//#endregion
	//#region src/plugin/main/renderer.ts
	var ROOT_KEY = "mermaidjam.root";
	var GROUP_KEY = "mermaidjam.group";
	var METADATA_KEY = "mermaidjam.metadata";
	var SOURCE_KEY = "mermaidjam.source";
	var NODE_ID_KEY = "mermaidjam.nodeId";
	var NODE_KIND_KEY = "mermaidjam.nodeKind";
	var SOURCE_LINE_KEY = "mermaidjam.sourceLine";
	var legacyPrefix = String.fromCharCode(117, 110, 105, 99, 111, 114, 110, 106, 97, 109);
	var LEGACY_ROOT_KEY = `${legacyPrefix}.root`;
	var LEGACY_GROUP_KEY = `${legacyPrefix}.group`;
	var LEGACY_METADATA_KEY = `${legacyPrefix}.metadata`;
	var LEGACY_SOURCE_KEY = `${legacyPrefix}.source`;
	var LEGACY_NODE_ID_KEY = `${legacyPrefix}.nodeId`;
	var SAFE_SOURCE_LIMIT = 8e4;
	var regularFont = {
		family: "Inter",
		style: "Regular"
	};
	var categoryPriority = {
		error: 10,
		warning: 20,
		success: 30,
		backend: 40,
		auth: 50,
		payment: 60,
		data: 70,
		external: 80,
		screen: 90,
		user: 100,
		decision: 110,
		note: 120
	};
	var defaultSemanticRules = [
		{
			category: "error",
			keywords: [
				"error",
				"fail",
				"failed",
				"failure",
				"blocked",
				"denied",
				"invalid",
				"incomplete",
				"friction",
				"problem",
				"crash",
				"old"
			]
		},
		{
			category: "warning",
			keywords: [
				"warn",
				"warning",
				"retry",
				"again",
				"forgot",
				"reset",
				"pending",
				"review",
				"maybe",
				"unknown"
			]
		},
		{
			category: "success",
			keywords: [
				"success",
				"done",
				"complete",
				"completed",
				"ready",
				"accepted",
				"approved",
				"home",
				"dashboard",
				"main app",
				"goal"
			]
		},
		{
			category: "backend",
			keywords: [
				"backend",
				"server",
				"api",
				"service",
				"system",
				"session",
				"database",
				"queue",
				"worker"
			]
		},
		{
			category: "auth",
			keywords: [
				"auth",
				"login",
				"log in",
				"sign in",
				"sign up",
				"signed",
				"password",
				"account",
				"session",
				"verification",
				"privacy",
				"terms"
			]
		},
		{
			category: "payment",
			keywords: [
				"pay",
				"payment",
				"checkout",
				"cart",
				"subscription",
				"billing",
				"invoice",
				"purchase",
				"revenue"
			]
		},
		{
			category: "data",
			keywords: [
				"data",
				"store",
				"storage",
				"cache",
				"sync",
				"fetch",
				"load",
				"loading",
				"save",
				"persist"
			]
		},
		{
			category: "external",
			keywords: [
				"google",
				"apple",
				"stripe",
				"webhook",
				"email",
				"sms",
				"external",
				"third party"
			]
		},
		{
			category: "screen",
			keywords: [
				"screen",
				"page",
				"view",
				"tab",
				"drawer",
				"modal",
				"profile",
				"games",
				"swipe",
				"chat"
			]
		},
		{
			category: "user",
			keywords: [
				"user",
				"guest",
				"tap",
				"click",
				"opens",
				"chooses",
				"enters",
				"types",
				"scans",
				"browses"
			]
		},
		{
			category: "decision",
			keywords: [
				"decision",
				"choice",
				"if",
				"whether",
				"gate",
				"check",
				"checks",
				"condition"
			]
		},
		{
			category: "note",
			keywords: [
				"note",
				"insight",
				"constraint",
				"risk",
				"frustration",
				"success:"
			]
		}
	];
	async function loadRendererFonts() {
		await figma.loadFontAsync(regularFont);
	}
	async function renderNewDocument(payload) {
		assertFigJam();
		await loadRendererFonts();
		const tokens = getStyleTokens(payload.diagram.style);
		const layout = computeInitialLayout(payload.diagram, tokens);
		const center = figma.viewport.center;
		const generated = renderDiagramAt(payload, {
			x: center.x - layout.width / 2,
			y: center.y - Math.min(layout.height / 2, 220)
		}, /* @__PURE__ */ new Map());
		figma.currentPage.selection = [generated.root];
		figma.viewport.scrollAndZoomIntoView([generated.root]);
		return generated.root;
	}
	async function updateSelectedDocument(payload) {
		assertFigJam();
		const root = findSelectedMermaidJamRoot();
		if (!root) throw new Error("Select a Mermaid Jam section or one of its diagram nodes before updating.");
		await loadRendererFonts();
		const groupId = getPluginDataAny(root, GROUP_KEY, LEGACY_GROUP_KEY);
		const preserved = payload.diagram.style.manualLayout === "reset" ? /* @__PURE__ */ new Map() : captureManualPositions(groupId);
		const origin = {
			x: root.x,
			y: root.y
		};
		removeGeneratedGroup(groupId);
		const generated = renderDiagramAt(payload, origin, preserved);
		figma.currentPage.selection = [generated.root];
		figma.viewport.scrollAndZoomIntoView([generated.root]);
		return generated.root;
	}
	function readSelectedSource() {
		assertFigJam();
		const root = findSelectedMermaidJamRoot();
		if (!root) throw new Error("Select a Mermaid Jam section or one of its diagram nodes with stored source.");
		const rawMetadata = getPluginDataAny(root, METADATA_KEY, LEGACY_METADATA_KEY);
		if (!rawMetadata) throw new Error("Selected Mermaid Jam diagram is missing metadata.");
		const metadata = JSON.parse(rawMetadata);
		const source = getPluginDataAny(root, SOURCE_KEY, LEGACY_SOURCE_KEY);
		if (!source) throw new Error("This diagram only stored a source hash. Paste the Mermaid source to update it.");
		return {
			source,
			metadata
		};
	}
	function renderDiagramAt(payload, origin, preserved) {
		if (payload.diagram.journey) return renderJourneyAt(payload, origin, preserved);
		const tokens = getStyleTokens(payload.diagram.style);
		const layout = computeRenderLayout(payload.diagram, tokens);
		const nodeLayouts = layout.nodes.map((nodeLayout) => applyPreservedNodePosition(nodeLayout, preserved.get(graphNodeKey(nodeLayout.id))));
		const groupId = createGroupId();
		const section = createRootSection(payload.diagram, tokens, layout.width, layout.height, origin);
		const children = [];
		const shapeById = /* @__PURE__ */ new Map();
		const layoutById = new Map(nodeLayouts.map((nodeLayout) => [nodeLayout.id, nodeLayout]));
		const outgoingIds = new Set(payload.diagram.edges.map((edge) => edge.from));
		const nodeById = new Map(payload.diagram.nodes.map((node) => [node.id, node]));
		for (const nodeLayout of nodeLayouts) {
			const graphNode = nodeById.get(nodeLayout.id);
			if (!graphNode) continue;
			const shape = createGraphNode(graphNode, payload.diagram.edges, tokens, nodeLayout.width, nodeLayout.height, {
				isSink: !outgoingIds.has(graphNode.id),
				depth: nodeLayout.rank
			});
			section.appendChild(shape);
			shape.x = nodeLayout.x;
			shape.y = nodeLayout.y;
			tagGeneratedNode(shape, "graph-node", graphNodeKey(graphNode.id), graphNode.sourceLine);
			shapeById.set(graphNode.id, shape);
			children.push(shape);
		}
		for (const edge of payload.diagram.edges) {
			const from = shapeById.get(edge.from);
			const to = shapeById.get(edge.to);
			const fromLayout = layoutById.get(edge.from);
			const toLayout = layoutById.get(edge.to);
			if (!from || !to) continue;
			const connector = figma.createConnector();
			section.appendChild(connector);
			connector.name = `Edge/${edge.from}->${edge.to}`;
			connector.connectorLineType = connectorLineType(tokens.routingMode);
			const magnets = connectorMagnets(fromLayout, toLayout, payload.diagram.direction, tokens.routingMode);
			connector.connectorStart = {
				endpointNodeId: from.id,
				magnet: magnets.start
			};
			connector.connectorEnd = {
				endpointNodeId: to.id,
				magnet: magnets.end
			};
			connector.connectorStartStrokeCap = "NONE";
			connector.connectorEndStrokeCap = "ARROW_LINES";
			connector.strokes = solid(tokens.colors.connector);
			connector.strokeWeight = connectorStrokeWeight(tokens, edge.style);
			connector.dashPattern = edge.style === "dotted" ? [5, 4] : [];
			if (edge.label) setText(connector.text, edge.label, tokens.type.small, tokens.colors.muted);
			connector.textBackground.fills = solid(tokens.colors.surface);
			tagGeneratedNode(connector, "edge", `edge:${edge.id}`, edge.sourceLine);
			children.push(connector);
		}
		if (children.length === 0) throw new Error("Nothing was generated from this source.");
		containSection(section, children, Math.max(24, Math.round(tokens.graph.padding / 2)));
		const allNodes = [section, ...children];
		writeMetadata(allNodes, section, payload, groupId);
		return {
			groupId,
			root: section,
			allNodes
		};
	}
	function renderJourneyAt(payload, origin, preserved) {
		var _ref, _journey$title, _journey$actor;
		const tokens = getStyleTokens(payload.diagram.style);
		const journey = payload.diagram.journey;
		const layout = computeJourneyLayout(journey, tokens);
		applyPreservedJourneyPositions(layout, preserved);
		const groupId = createGroupId();
		const section = createRootSection(payload.diagram, tokens, layout.width, layout.height, origin, "#FFFFFF");
		const children = [];
		const colors = journeyColors();
		const title = (_ref = (_journey$title = journey.title) !== null && _journey$title !== void 0 ? _journey$title : payload.diagram.title) !== null && _ref !== void 0 ? _ref : "";
		const actor = (_journey$actor = journey.actor) !== null && _journey$actor !== void 0 ? _journey$actor : "User";
		const scores = layout.stepLayouts.map((item) => item.score);
		const average = averageScore(scores);
		scores.length > 0 && Math.min(...scores);
		const lowStep = [...layout.stepLayouts].sort((a, b) => a.score - b.score)[0];
		const bottlenecks = layout.stepLayouts.filter((item) => item.score <= 2);
		const showScores = tokens.journeyView === "scores" || tokens.journeyView === "insights";
		const showInsights = tokens.journeyView === "insights";
		createJourneyShape(section, children, {
			name: "Journey/Panel",
			text: "",
			x: layout.padding / 2,
			y: layout.padding / 2,
			width: layout.width - layout.padding,
			height: layout.height - layout.padding,
			fill: colors.panel,
			stroke: colors.panelBorder,
			fontSize: tokens.type.body
		});
		if (title) createJourneyShape(section, children, {
			name: "Journey/Title",
			text: title,
			x: layout.padding,
			y: layout.titleY,
			width: showInsights ? Math.max(680, layout.width - layout.padding * 2 - 580) : layout.width - layout.padding * 2,
			height: Math.max(72, tokens.type.title * 2.1),
			fill: "transparent",
			stroke: "transparent",
			color: colors.text,
			fontSize: Math.max(30, tokens.type.title)
		});
		if (showInsights) {
			const statY = layout.titleY + 10;
			const statWidth = Math.max(142, Math.round(tokens.type.body * 6.4));
			const statGap = 8;
			const statStartX = Math.max(layout.padding, layout.width - layout.padding - statWidth * 4 - statGap * 3);
			[
				`Steps ${layout.stepLayouts.length}`,
				average === void 0 ? "Avg n/a" : `Avg ${formatAverage(average)}/5`,
				lowStep ? `Lowest ${lowStep.score}/5` : "Lowest n/a",
				`Blocks ${bottlenecks.length}`
			].forEach((label, index) => {
				createJourneyShape(section, children, {
					name: `Journey/Metric/${index + 1}`,
					text: label,
					x: statStartX + index * (statWidth + statGap),
					y: statY,
					width: statWidth,
					height: Math.max(42, tokens.type.body * 1.6),
					fill: colors.metric,
					stroke: colors.metricBorder,
					color: colors.muted,
					fontSize: Math.max(24, tokens.type.small)
				});
			});
		}
		createJourneyShape(section, children, {
			name: "Journey/ActorDot",
			text: "",
			x: layout.padding,
			y: layout.metaY + 10,
			width: 16,
			height: 16,
			fill: colors.good,
			stroke: colors.good,
			shapeType: "ELLIPSE",
			fontSize: tokens.type.small
		});
		createJourneyShape(section, children, {
			name: "Journey/Actor",
			text: actor,
			x: layout.padding + 34,
			y: layout.metaY,
			width: 220,
			height: 42,
			fill: "transparent",
			stroke: "transparent",
			color: colors.text,
			fontSize: Math.max(24, tokens.type.small)
		});
		for (const phase of layout.phaseLayouts) {
			const palette = showScores ? journeyPhasePalette(phase.average, colors) : {
				fill: colors.phase,
				border: colors.phaseBorder,
				text: colors.text
			};
			createJourneyShape(section, children, {
				name: `Journey/Section/${phase.section.id}`,
				text: phase.section.title,
				x: phase.x,
				y: phase.y,
				width: phase.width,
				height: phase.height,
				fill: palette.fill,
				stroke: palette.border,
				color: palette.text,
				fontSize: Math.max(24, tokens.type.small),
				sourceId: journeySectionKey(phase.section.id),
				sourceLine: phase.section.sourceLine,
				kind: "journey-section"
			});
			if (showScores && typeof phase.average === "number") createJourneyShape(section, children, {
				name: `Journey/SectionAverage/${phase.section.id}`,
				text: `${formatAverage(phase.average)}/5`,
				x: phase.x + phase.width - Math.max(104, tokens.type.body * 4.2),
				y: phase.y + 6,
				width: Math.max(92, tokens.type.body * 3.8),
				height: Math.max(34, tokens.type.body * 1.35),
				fill: colors.metric,
				stroke: colors.metricBorder,
				color: colors.muted,
				fontSize: Math.max(24, tokens.type.small)
			});
		}
		for (const item of layout.stepLayouts) {
			const palette = showScores && item.score <= 2 ? scorePalette(item.score, colors) : {
				fill: colors.card,
				border: colors.cardBorder,
				text: colors.text
			};
			createJourneyShape(section, children, {
				name: `Journey/Step/${item.step.id}`,
				text: item.step.label,
				x: item.x,
				y: item.y,
				width: item.width,
				height: item.height,
				fill: palette.fill,
				stroke: palette.border,
				color: palette.text,
				fontSize: Math.max(24, tokens.type.small),
				sourceId: journeyStepKey(item.step.id),
				sourceLine: item.step.sourceLine,
				kind: "journey-step"
			});
		}
		const first = layout.stepLayouts[0];
		const last = layout.stepLayouts[layout.stepLayouts.length - 1];
		if (first && last) createJourneyConnector(section, children, {
			name: "Journey/Timeline",
			start: {
				x: first.x - 34,
				y: layout.timelineY
			},
			end: {
				x: last.x + last.width + 80,
				y: layout.timelineY
			},
			color: colors.timeline,
			weight: 2,
			arrow: true
		});
		if (showScores) for (let index = 1; index < layout.stepLayouts.length; index += 1) {
			const previous = layout.stepLayouts[index - 1];
			const current = layout.stepLayouts[index];
			createJourneyConnector(section, children, {
				name: `Journey/ScoreLine/${index}`,
				start: {
					x: previous.scoreX,
					y: previous.scoreY
				},
				end: {
					x: current.scoreX,
					y: current.scoreY
				},
				color: colors.scoreLine,
				weight: 2
			});
		}
		for (const item of layout.stepLayouts) {
			createJourneyConnector(section, children, {
				name: `Journey/MarkerLine/${item.step.id}`,
				start: {
					x: item.scoreX,
					y: item.y + item.height
				},
				end: {
					x: item.scoreX,
					y: item.scoreY - 24
				},
				color: colors.markerLine,
				weight: 1,
				dash: [5, 5]
			});
			const palette = scorePalette(item.score, colors);
			createJourneyShape(section, children, {
				name: `Journey/ScorePoint/${item.step.id}`,
				text: showScores ? `${item.score}` : "",
				x: item.scoreX - 17,
				y: item.scoreY - 17,
				width: 34,
				height: 34,
				fill: showScores ? palette.fill : colors.subtleDot,
				stroke: showScores ? palette.border : colors.subtleDotBorder,
				color: palette.text,
				shapeType: "ELLIPSE",
				fontSize: 24
			});
			if (showInsights && item.score <= 2) createJourneyShape(section, children, {
				name: `Journey/Bottleneck/${item.step.id}`,
				text: "Bottleneck",
				x: item.x,
				y: item.y + item.height + 12,
				width: Math.min(item.width, Math.max(150, tokens.type.body * 6.2)),
				height: Math.max(36, tokens.type.body * 1.45),
				fill: colors.badFill,
				stroke: colors.badBorder,
				color: colors.badText,
				fontSize: Math.max(24, tokens.type.small)
			});
		}
		journey.notes.forEach((note, index) => {
			createJourneyShape(section, children, {
				name: `Journey/Note/${index + 1}`,
				text: note,
				x: layout.padding,
				y: layout.notesY + index * Math.max(58, tokens.type.body * 2.2),
				width: layout.width - layout.padding * 2,
				height: Math.max(50, tokens.type.body * 1.8),
				fill: colors.note,
				stroke: colors.noteBorder,
				color: colors.text,
				fontSize: Math.max(24, tokens.type.small)
			});
		});
		if (showInsights && lowStep) createJourneyShape(section, children, {
			name: "Journey/LowestCallout",
			text: `Lowest friction: ${lowStep.step.label}`,
			x: layout.padding,
			y: layout.notesY + journey.notes.length * Math.max(58, tokens.type.body * 2.2),
			width: Math.min(layout.width - layout.padding * 2, Math.max(620, tokens.type.body * 28)),
			height: Math.max(52, tokens.type.body * 1.9),
			fill: colors.badFill,
			stroke: colors.badBorder,
			color: colors.badText,
			fontSize: Math.max(24, tokens.type.small)
		});
		if (children.length === 0) throw new Error("Nothing was generated from this journey.");
		containSection(section, children, Math.max(24, Math.round(tokens.graph.padding / 2)));
		const allNodes = [section, ...children];
		writeMetadata(allNodes, section, payload, groupId);
		return {
			groupId,
			root: section,
			allNodes
		};
	}
	function createRootSection(diagram, tokens, width, height, origin, fill = tokens.colors.surface) {
		const section = figma.createSection();
		section.name = sectionName(diagram);
		section.x = origin.x;
		section.y = origin.y;
		section.fills = solid(fill);
		section.sectionContentsHidden = false;
		section.resizeWithoutConstraints(Math.max(width, tokens.graph.nodeWidth + tokens.graph.padding * 2), Math.max(height, tokens.graph.nodeHeight + tokens.graph.padding * 2));
		return section;
	}
	function createGraphNode(node, edges, tokens, width, height, options) {
		const palette = nodePalette(node, edges, tokens, options);
		const shape = figma.createShapeWithText();
		shape.name = `Node/${node.id}`;
		shape.shapeType = figJamShapeFor(node.shape);
		shape.resize(widthForShape(width, node.shape), heightForShape(height, node.shape));
		shape.fills = solid(palette.bg);
		shape.strokes = solid(palette.border);
		shape.strokeWeight = nodeStrokeWeight(tokens);
		shape.dashPattern = [];
		setText(shape.text, node.label, tokens.type.body, palette.fg);
		return shape;
	}
	function setText(node, characters, fontSize, color) {
		node.fontName = regularFont;
		node.characters = characters;
		node.fontSize = fontSize;
		node.lineHeight = {
			unit: "PIXELS",
			value: Math.round(fontSize * 1.2)
		};
		node.fills = solid(color);
	}
	function connectorStrokeWeight(tokens, style) {
		const base = Math.max(2, Math.round(tokens.type.body / 10));
		return style === "thick" ? Math.max(base + 1, Math.round(base * 1.5)) : base;
	}
	function nodeStrokeWeight(tokens) {
		return Math.max(1, Math.round(tokens.type.body / 24));
	}
	function connectorLineType(mode) {
		return mode === "direct" ? "STRAIGHT" : "ELBOWED";
	}
	function connectorMagnets(from, to, direction, mode = "elbow") {
		if (!from || !to || mode === "direct") return {
			start: "AUTO",
			end: "AUTO"
		};
		const fromCenter = {
			x: from.x + from.width / 2,
			y: from.y + from.height / 2
		};
		const toCenter = {
			x: to.x + to.width / 2,
			y: to.y + to.height / 2
		};
		const dx = toCenter.x - fromCenter.x;
		const dy = toCenter.y - fromCenter.y;
		const horizontalFlow = direction === "LR" || direction === "RL";
		if (mode === "loop-friendly" && (from.rank >= to.rank || from.rank === to.rank)) {
			if (horizontalFlow) return dy >= 0 ? {
				start: "BOTTOM",
				end: "TOP"
			} : {
				start: "TOP",
				end: "BOTTOM"
			};
			return dx >= 0 ? {
				start: "RIGHT",
				end: "LEFT"
			} : {
				start: "LEFT",
				end: "RIGHT"
			};
		}
		if (from.rank !== to.rank) {
			if (horizontalFlow) return dx >= 0 ? {
				start: "RIGHT",
				end: "LEFT"
			} : {
				start: "LEFT",
				end: "RIGHT"
			};
			return dy >= 0 ? {
				start: "BOTTOM",
				end: "TOP"
			} : {
				start: "TOP",
				end: "BOTTOM"
			};
		}
		if (!horizontalFlow && Math.abs(dx) > 1) return dx >= 0 ? {
			start: "RIGHT",
			end: "LEFT"
		} : {
			start: "LEFT",
			end: "RIGHT"
		};
		if (horizontalFlow && Math.abs(dy) > 1) return dy >= 0 ? {
			start: "BOTTOM",
			end: "TOP"
		} : {
			start: "TOP",
			end: "BOTTOM"
		};
		if (horizontalFlow) return dx >= 0 ? {
			start: "RIGHT",
			end: "LEFT"
		} : {
			start: "LEFT",
			end: "RIGHT"
		};
		return dy >= 0 ? {
			start: "BOTTOM",
			end: "TOP"
		} : {
			start: "TOP",
			end: "BOTTOM"
		};
	}
	function figJamShapeFor(shape) {
		switch (shape) {
			case "decision": return "DIAMOND";
			case "flag": return "PARALLELOGRAM_RIGHT";
			case "rounded":
			case "terminal": return "ROUNDED_RECTANGLE";
			default: return "ROUNDED_RECTANGLE";
		}
	}
	function nodePalette(node, edges, tokens, options) {
		var _ref2, _depthPalette;
		if (tokens.semanticMode !== "depth") {
			const semantic = semanticPalette(node, edges, tokens, options);
			if (semantic) return semantic;
		}
		if (node.shape === "terminal" || options.isSink) return tokens.colors.semantic.sink;
		return (_ref2 = (_depthPalette = depthPalette(tokens, options.depth)) !== null && _depthPalette !== void 0 ? _depthPalette : tokens.colors.semantic.default) !== null && _ref2 !== void 0 ? _ref2 : tokens.colors.node[node.shape];
	}
	function semanticPalette(node, edges, tokens, options) {
		const match = semanticMatch(node, edges, tokens);
		if (match) return paletteForSemantic(match.category, tokens, match.rule);
		if (node.shape === "decision") return tokens.colors.semantic.decision;
		if (node.shape === "terminal" || options.isSink || isSuccessNode(node)) return tokens.colors.semantic.success;
		return depthPalette(tokens, options.depth);
	}
	function semanticMatch(node, edges, tokens) {
		var _matches$;
		const relatedLabels = edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => {
			var _edge$label;
			return (_edge$label = edge.label) !== null && _edge$label !== void 0 ? _edge$label : "";
		}).join(" ");
		const text = `${node.id} ${node.label} ${relatedLabels}`.toLowerCase();
		const matches = [...tokens.semanticMode === "custom" ? tokens.semanticRules.filter((rule) => rule.enabled !== false) : [], ...defaultSemanticRules].flatMap((rule, order) => {
			if (!rule.keywords.some((keyword) => keyword && text.includes(keyword.toLowerCase()))) return [];
			return [{
				category: rule.category,
				rule,
				priority: typeof rule.priority === "number" ? rule.priority : categoryPriority[rule.category],
				order
			}];
		});
		matches.sort((a, b) => a.priority - b.priority || categoryPriority[a.category] - categoryPriority[b.category] || a.order - b.order);
		return (_matches$ = matches[0]) !== null && _matches$ !== void 0 ? _matches$ : null;
	}
	function paletteForSemantic(category, tokens, rule) {
		var _tokens$colors$semant, _rule$fill, _rule$text, _rule$stroke;
		const base = (_tokens$colors$semant = tokens.colors.semantic[category]) !== null && _tokens$colors$semant !== void 0 ? _tokens$colors$semant : tokens.colors.semantic.default;
		return {
			bg: (_rule$fill = rule === null || rule === void 0 ? void 0 : rule.fill) !== null && _rule$fill !== void 0 ? _rule$fill : base.bg,
			fg: (_rule$text = rule === null || rule === void 0 ? void 0 : rule.text) !== null && _rule$text !== void 0 ? _rule$text : base.fg,
			border: (_rule$stroke = rule === null || rule === void 0 ? void 0 : rule.stroke) !== null && _rule$stroke !== void 0 ? _rule$stroke : base.border
		};
	}
	function depthPalette(tokens, depth) {
		var _tokens$colors$depth;
		const requestedLayers = Math.max(1, Math.min(tokens.colorLayers, tokens.colors.depth.length));
		if (requestedLayers <= 1) return tokens.colors.semantic.default;
		return (_tokens$colors$depth = tokens.colors.depth[Math.abs(depth) % requestedLayers]) !== null && _tokens$colors$depth !== void 0 ? _tokens$colors$depth : tokens.colors.semantic.default;
	}
	function isSuccessNode(node) {
		return /\b(success|done|complete|completed|ready|accepted|approved|main app|dashboard|home)\b/i.test(`${node.id} ${node.label}`);
	}
	function widthForShape(width, shape) {
		if (shape === "terminal") return width * .92;
		if (shape === "flag") return width * .94;
		return width;
	}
	function heightForShape(height, shape) {
		if (shape === "terminal") return height * .86;
		return height;
	}
	function computeJourneyLayout(journey, tokens) {
		const sections = journey.sections.filter((section) => section.steps.length > 0);
		const padding = Math.max(80, tokens.graph.padding);
		const leftRail = Math.max(130, Math.round(tokens.type.body * 5.2));
		const minTaskWidth = Math.max(280, Math.round(tokens.type.body * 11.8));
		const maxTaskWidth = Math.max(440, Math.round(tokens.type.body * 18));
		const taskHeight = Math.max(90, Math.round(tokens.type.body * 3.55));
		const phaseHeight = Math.max(52, Math.round(tokens.type.body * 2.05));
		const stepGap = Math.max(34, Math.round(tokens.type.body * 1.55));
		const phaseGap = Math.max(54, Math.round(tokens.type.body * 2.2));
		const titleY = padding;
		const metaY = titleY + Math.max(70, Math.round(tokens.type.title * 2.1));
		const phaseY = metaY + Math.max(48, Math.round(tokens.type.body * 1.9));
		const stepY = phaseY + phaseHeight + Math.max(12, Math.round(tokens.type.body * .55));
		const timelineY = stepY + taskHeight + Math.max(52, Math.round(tokens.type.body * 2.1));
		const chartTop = timelineY + Math.max(38, Math.round(tokens.type.body * 1.55));
		const chartBottom = chartTop + Math.max(120, Math.round(tokens.type.body * 5));
		const notesY = chartBottom + Math.max(52, Math.round(tokens.type.body * 2.1));
		const phaseLayouts = [];
		const stepLayouts = [];
		let cursorX = padding + leftRail;
		for (const section of sections) {
			const phaseStart = cursorX;
			for (const step of section.steps) {
				const width = clamp(Math.round(step.label.length * tokens.type.body * .58 + tokens.type.body * 4.8), minTaskWidth, maxTaskWidth);
				const score = clampScore(step.score);
				stepLayouts.push({
					step,
					section,
					x: cursorX,
					y: stepY,
					width,
					height: taskHeight,
					scoreX: cursorX + width / 2,
					scoreY: scoreToY(score, chartTop, chartBottom),
					score
				});
				cursorX += width + stepGap;
			}
			const phaseWidth = Math.max(minTaskWidth, cursorX - stepGap - phaseStart);
			phaseLayouts.push({
				section,
				x: phaseStart,
				y: phaseY,
				width: phaseWidth,
				height: phaseHeight,
				average: averageScore(section.steps.map((step) => clampScore(step.score)))
			});
			cursorX += phaseGap;
		}
		const contentWidth = stepLayouts.length > 0 ? cursorX - phaseGap : padding + leftRail + minTaskWidth;
		const notesHeight = journey.notes.length > 0 ? journey.notes.length * Math.max(50, tokens.type.body * 1.9) + Math.max(32, tokens.type.body * 1.3) : 0;
		const insightHeight = tokens.journeyView === "insights" ? Math.max(80, tokens.type.body * 3) : 0;
		return {
			width: Math.max(contentWidth + padding, 1040),
			height: notesY + notesHeight + insightHeight + padding / 2,
			padding,
			titleY,
			metaY,
			phaseY,
			stepY,
			timelineY,
			chartTop,
			chartBottom,
			taskHeight,
			phaseHeight,
			phaseLayouts,
			stepLayouts,
			notesY
		};
	}
	function createJourneyShape(section, children, options) {
		var _options$shapeType, _options$color, _options$kind, _options$sourceLine;
		const shape = figma.createShapeWithText();
		section.appendChild(shape);
		shape.name = options.name;
		shape.shapeType = (_options$shapeType = options.shapeType) !== null && _options$shapeType !== void 0 ? _options$shapeType : "ROUNDED_RECTANGLE";
		shape.x = options.x;
		shape.y = options.y;
		shape.resize(options.width, options.height);
		shape.fills = options.fill === "transparent" ? [] : solid(options.fill);
		shape.strokes = options.stroke === "transparent" ? [] : solid(options.stroke);
		shape.strokeWeight = options.stroke === "transparent" ? 0 : 1;
		shape.dashPattern = [];
		setText(shape.text, options.text, options.fontSize, (_options$color = options.color) !== null && _options$color !== void 0 ? _options$color : "#FFFFFF");
		if (options.sourceId) tagGeneratedNode(shape, (_options$kind = options.kind) !== null && _options$kind !== void 0 ? _options$kind : "journey-node", options.sourceId, (_options$sourceLine = options.sourceLine) !== null && _options$sourceLine !== void 0 ? _options$sourceLine : 1);
		children.push(shape);
		return shape;
	}
	function createJourneyConnector(section, children, options) {
		var _options$dash;
		const connector = figma.createConnector();
		section.appendChild(connector);
		connector.name = options.name;
		connector.connectorLineType = "STRAIGHT";
		connector.connectorStart = { position: options.start };
		connector.connectorEnd = { position: options.end };
		connector.connectorStartStrokeCap = "NONE";
		connector.connectorEndStrokeCap = options.arrow ? "ARROW_LINES" : "NONE";
		connector.strokes = solid(options.color);
		connector.strokeWeight = options.weight;
		connector.dashPattern = (_options$dash = options.dash) !== null && _options$dash !== void 0 ? _options$dash : [];
		children.push(connector);
		return connector;
	}
	function journeyColors() {
		return {
			panel: "#FAFAF8",
			panelBorder: "#DDDDD8",
			phase: "#EFEFEB",
			phaseBorder: "#D8D8D2",
			card: "#FFFFFF",
			cardBorder: "#D1D1CB",
			metric: "#FFFFFF",
			metricBorder: "#DADAD4",
			note: "#FFFFFF",
			noteBorder: "#DADAD4",
			text: "#171717",
			muted: "#666662",
			good: "#65B978",
			goodFill: "#DDF5E4",
			goodBorder: "#8BD59B",
			goodText: "#1E5D32",
			midFill: "#F8E9A8",
			midBorder: "#D7BF56",
			midText: "#5A4600",
			badFill: "#FFDADA",
			badBorder: "#EF8C8C",
			badText: "#7A1F1F",
			subtleDot: "#FFFFFF",
			subtleDotBorder: "#BDBDB7",
			timeline: "#B8B8B2",
			markerLine: "#D4D4CE",
			scoreLine: "#8E8E88"
		};
	}
	function journeyPhasePalette(average, colors) {
		if (average === void 0) return {
			fill: colors.phase,
			border: colors.phaseBorder,
			text: colors.text
		};
		if (average >= 4) return {
			fill: colors.goodFill,
			border: colors.goodBorder,
			text: colors.goodText
		};
		if (average <= 2.5) return {
			fill: colors.badFill,
			border: colors.badBorder,
			text: colors.badText
		};
		return {
			fill: colors.midFill,
			border: colors.midBorder,
			text: colors.midText
		};
	}
	function scorePalette(score, colors) {
		if (score >= 4) return {
			fill: colors.goodFill,
			border: colors.goodBorder,
			text: colors.goodText
		};
		if (score <= 2) return {
			fill: colors.badFill,
			border: colors.badBorder,
			text: colors.badText
		};
		return {
			fill: colors.midFill,
			border: colors.midBorder,
			text: colors.midText
		};
	}
	function scoreToY(score, top, bottom) {
		return bottom - (clampScore(score) - 1) / 4 * (bottom - top);
	}
	function clampScore(score) {
		if (typeof score !== "number" || !Number.isFinite(score)) return 3;
		return Math.max(1, Math.min(5, Math.round(score)));
	}
	function averageScore(scores) {
		if (scores.length === 0) return void 0;
		return scores.reduce((sum, score) => sum + score, 0) / scores.length;
	}
	function formatAverage(value) {
		return value.toFixed(1).replace(/\.0$/, "");
	}
	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value));
	}
	function writeMetadata(nodes, root, payload, groupId) {
		const sourceStored = payload.source.length <= SAFE_SOURCE_LIMIT;
		const metadata = {
			schemaVersion: payload.diagram.schemaVersion,
			sourceHash: payload.sourceHash,
			sourceStored,
			style: payload.diagram.style,
			title: payload.diagram.title,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		const encodedMetadata = JSON.stringify(metadata);
		for (const node of nodes) {
			node.setPluginData(GROUP_KEY, groupId);
			node.setPluginData(METADATA_KEY, encodedMetadata);
			node.setPluginData(SOURCE_KEY, sourceStored ? payload.source : "");
			node.setRelaunchData({ open: "Edit in Mermaid Jam" });
		}
		root.setPluginData(ROOT_KEY, "true");
	}
	function tagGeneratedNode(node, kind, sourceId, sourceLine) {
		node.setPluginData(NODE_KIND_KEY, kind);
		node.setPluginData(NODE_ID_KEY, sourceId);
		node.setPluginData(SOURCE_LINE_KEY, String(sourceLine));
	}
	function captureManualPositions(groupId) {
		const positions = /* @__PURE__ */ new Map();
		for (const node of findGeneratedGroup(groupId)) {
			if (node.type !== "SHAPE_WITH_TEXT") continue;
			const sourceId = getPluginDataAny(node, NODE_ID_KEY, LEGACY_NODE_ID_KEY);
			if (!sourceId) continue;
			positions.set(sourceId, {
				x: node.x,
				y: node.y,
				width: node.width,
				height: node.height
			});
		}
		return positions;
	}
	function applyPreservedNodePosition(nodeLayout, preserved) {
		if (!preserved) return nodeLayout;
		return _objectSpread2(_objectSpread2({}, nodeLayout), {}, {
			x: preserved.x,
			y: preserved.y
		});
	}
	function applyPreservedJourneyPositions(layout, preserved) {
		for (const item of layout.stepLayouts) {
			const match = preserved.get(journeyStepKey(item.step.id));
			if (!match) continue;
			item.x = match.x;
			item.y = match.y;
			item.scoreX = item.x + item.width / 2;
		}
		for (const phase of layout.phaseLayouts) {
			const match = preserved.get(journeySectionKey(phase.section.id));
			if (!match) continue;
			phase.x = match.x;
			phase.y = match.y;
		}
	}
	function containSection(section, children, padding) {
		const bounds = childBounds(children);
		if (!bounds) return;
		const shiftX = bounds.minX < padding ? bounds.minX - padding : 0;
		const shiftY = bounds.minY < padding ? bounds.minY - padding : 0;
		if (shiftX || shiftY) {
			section.x += shiftX;
			section.y += shiftY;
			for (const child of children) shiftChild(child, -shiftX, -shiftY);
		}
		const width = Math.max(section.width, bounds.maxX - shiftX + padding);
		const height = Math.max(section.height, bounds.maxY - shiftY + padding);
		section.resizeWithoutConstraints(width, height);
	}
	function childBounds(children) {
		const boxes = children.flatMap((child) => endpointBoxes(child));
		if (boxes.length === 0) return null;
		return {
			minX: Math.min(...boxes.map((box) => box.minX)),
			minY: Math.min(...boxes.map((box) => box.minY)),
			maxX: Math.max(...boxes.map((box) => box.maxX)),
			maxY: Math.max(...boxes.map((box) => box.maxY))
		};
	}
	function endpointBoxes(child) {
		if (child.type === "SHAPE_WITH_TEXT") return [{
			minX: child.x,
			minY: child.y,
			maxX: child.x + child.width,
			maxY: child.y + child.height
		}];
		return [positionEndpoint(child.connectorStart), positionEndpoint(child.connectorEnd)].filter((point) => Boolean(point)).map((point) => ({
			minX: point.x,
			minY: point.y,
			maxX: point.x,
			maxY: point.y
		}));
	}
	function positionEndpoint(endpoint) {
		return "position" in endpoint ? endpoint.position : null;
	}
	function shiftChild(child, dx, dy) {
		child.x += dx;
		child.y += dy;
		if (child.type !== "CONNECTOR") return;
		child.connectorStart = shiftEndpoint(child.connectorStart, dx, dy);
		child.connectorEnd = shiftEndpoint(child.connectorEnd, dx, dy);
	}
	function shiftEndpoint(endpoint, dx, dy) {
		if (!("position" in endpoint)) return endpoint;
		return { position: {
			x: endpoint.position.x + dx,
			y: endpoint.position.y + dy
		} };
	}
	function graphNodeKey(id) {
		return `graph:${id}`;
	}
	function journeyStepKey(id) {
		return `journey-step:${id}`;
	}
	function journeySectionKey(id) {
		return `journey-section:${id}`;
	}
	function findSelectedMermaidJamRoot() {
		for (const selected of figma.currentPage.selection) {
			const root = findMermaidJamRoot(selected);
			if (root) return root;
		}
		return null;
	}
	function findMermaidJamRoot(node) {
		let cursor = node;
		let fallback = null;
		while (cursor && cursor.type !== "PAGE" && cursor.type !== "DOCUMENT") {
			if (hasPluginData(cursor) && getPluginDataAny(cursor, GROUP_KEY, LEGACY_GROUP_KEY)) {
				if (cursor.type === "SECTION") fallback = cursor;
				if (cursor.type === "SECTION" && getPluginDataAny(cursor, ROOT_KEY, LEGACY_ROOT_KEY) === "true") return cursor;
			}
			cursor = cursor.parent;
		}
		return fallback;
	}
	function findGeneratedGroup(groupId) {
		if (!groupId) return [];
		return figma.currentPage.findAll((node) => hasPluginData(node) && getPluginDataAny(node, GROUP_KEY, LEGACY_GROUP_KEY) === groupId);
	}
	function removeGeneratedGroup(groupId) {
		for (const node of [...findGeneratedGroup(groupId)].reverse()) node.remove();
	}
	function hasPluginData(node) {
		return "getPluginData" in node && typeof node.getPluginData === "function";
	}
	function getPluginDataAny(node, primaryKey, legacyKey) {
		return node.getPluginData(primaryKey) || node.getPluginData(legacyKey);
	}
	function computeRenderLayout(diagram, tokens) {
		return computeGraphLayout(_objectSpread2(_objectSpread2({}, diagram), {}, { title: void 0 }), tokens);
	}
	function computeInitialLayout(diagram, tokens) {
		if (diagram.journey) return computeJourneyLayout(diagram.journey, tokens);
		return computeRenderLayout(diagram, tokens);
	}
	function solid(hex) {
		return [{
			type: "SOLID",
			color: hexToRgb(hex)
		}];
	}
	function createGroupId() {
		return `mj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}
	function sectionName(diagram) {
		var _diagram$title;
		return ((_diagram$title = diagram.title) === null || _diagram$title === void 0 ? void 0 : _diagram$title.trim()) || "";
	}
	function assertFigJam() {
		if (figma.editorType !== "figjam") throw new Error("Mermaid Jam now generates native FigJam flows. Open this plugin from a FigJam board.");
	}
	//#endregion
	//#region src/plugin/main/index.ts
	figma.showUI(__html__, {
		width: 520,
		height: 680,
		themeColors: true
	});
	postToUi({ type: "ready" });
	if (figma.editorType !== "figjam") postToUi({
		type: "render-error",
		message: "Mermaid Jam now generates native FigJam flows. Open this plugin from a FigJam board."
	});
	figma.ui.onmessage = async (message) => {
		try {
			switch (message.type) {
				case "generate":
					postToUi({
						type: "render-success",
						mode: "generate",
						nodeId: (await renderNewDocument(message)).id,
						message: "Generated."
					});
					figma.notify("Mermaid Jam generated the diagram.");
					break;
				case "update-selection":
					postToUi({
						type: "render-success",
						mode: "update",
						nodeId: (await updateSelectedDocument(message)).id,
						message: "Updated."
					});
					figma.notify("Mermaid Jam updated the selected diagram.");
					break;
				case "load-from-selection": {
					const { source, metadata } = readSelectedSource();
					postToUi({
						type: "selection-source",
						source,
						metadata
					});
					break;
				}
				case "resize":
					figma.ui.resize(message.width, message.height);
					break;
				default: throw new Error("Unsupported plugin message.");
			}
		} catch (error) {
			const messageText = error instanceof Error ? error.message : String(error);
			postToUi({
				type: "render-error",
				message: messageText
			});
			if (message.type === "load-from-selection") postToUi({
				type: "selection-source-error",
				message: messageText
			});
		}
	};
	function postToUi(message) {
		figma.ui.postMessage(message);
	}
	//#endregion
})();
