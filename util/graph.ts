type Edge = [number, number];

export class GraphBase {
  n: number;
  m: number;

  constructor(n: number, m: number) {
    this.n = n;
    this.m = m;
  }
}

export class EdgeList extends GraphBase {
  edges: Edge[];

  constructor(n: number, edges: Edge[]) {
    super(n, edges.length);
    this.edges = edges;
    this.edges.sort((a, b) => (a[0] > b[0]) ? 1 : -1);
  }

  bidirectional(): EdgeList {
    const edges: Edge[] = [];
    for (const [u, v] of this.edges) {
      edges.push([u, v]);
      edges.push([v, u]);
    }
    return new EdgeList(this.n, edges);
  }

  to_adjacency_list(): AdjacencyList {
    const adj: number[][] = [];
    for (let i = 0; i < this.n; i++) {
      adj.push([]);
    }
    for (const [u, v] of this.edges) {
      adj[u].push(v);
    }
    return new AdjacencyList(this.n, adj);
  }
}

export class AdjacencyList extends GraphBase {
  adj: number[][];

  constructor(n: number, adj: number[][]) {
    super(n, 0);
    if (adj.length !== n) {
      throw new Error("Invalid adjacency list");
    }
    this.adj = adj;
    for (let i = 0; i < n; i++) {
      this.m += adj[i].length;
    }
  }
}

export class AdjacencyMatrix extends GraphBase {
  adj: boolean[][];

  constructor(n: number, adj: boolean[][]) {
    super(n, 0);
    if (adj.length !== n) {
      throw new Error("Invalid adjacency matrix");
    }
    this.adj = adj;
    for (let i = 0; i < n; i++) {
      if (adj[i].length !== n) {
        throw new Error("Invalid adjacency matrix");
      }
      for (let j = 0; j < n; j++) {
        if (adj[i][j]) {
          this.m++;
        }
      }
    }
  }
}

export type Graph = EdgeList | AdjacencyList | AdjacencyMatrix;
