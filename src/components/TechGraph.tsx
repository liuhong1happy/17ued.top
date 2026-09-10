import { useMemo, useState } from "react";

interface Category {
  name: string;
  color: string;
  items: string[];
}

// 参考 dataviz 暗色分类色板（按固定顺序分配，不做循环）
const CATEGORIES: Category[] = [
  { name: "AI Agent 编程", color: "#3987e5", items: ["需求定义", "产品设计", "编码实现", "自动化测试", "部署运维"] },
  { name: "大模型 / 推理", color: "#d95926", items: ["vLLM", "ASR / TTS", "GGUF / ONNX", "TRT / RKNN", "KV-Cache"] },
  { name: "实时音视频", color: "#06b6d4", items: ["WebRTC", "LiveKit"] },
  { name: "后端开发", color: "#199e70", items: ["Go", "Java", "Python"] },
  { name: "前端 / 跨端开发", color: "#c98500", items: ["Web", "Flutter", "Electron"] },
  { name: "云原生", color: "#d55181", items: ["Kubernetes", "Docker", "Traefik", "CI/CD"] },
  { name: "物联网", color: "#9085e9", items: ["Mochi-MQTT", "设备接入", "指令下发"] },
  { name: "机器人调度", color: "#e66767", items: ["OpenTCS", "VDA5050", "ROS2"] },
  { name: "工业 / 边缘", color: "#008300", items: ["MES", "IoT 平台", "烧录上位机", "RK3588"] },
];

const W = 980;
const H = 700;
const CX = W / 2;
const CY = H / 2;
const R_CAT = 195;
const R_ITEM = 320;

interface Pos {
  x: number;
  y: number;
}

interface ItemNode {
  label: string;
  pos: Pos;
}

interface CatNode {
  name: string;
  color: string;
  pos: Pos;
  items: ItemNode[];
}

const polar = (r: number, angle: number): Pos => ({
  x: CX + r * Math.cos(angle),
  y: CY + r * Math.sin(angle),
});

const catCount = CATEGORIES.length;

// ─── Layout A: 放射（中心 -> 分类环 -> 条目环）────────────────
function radialNodes(): CatNode[] {
  return CATEGORIES.map((cat, i) => {
    const angle = (i / catCount) * Math.PI * 2 - Math.PI / 2;
    const n = cat.items.length;
    const spread = n > 1 ? 0.7 : 0;
    const items = cat.items.map((label, j) => {
      const a = angle + (j - (n - 1) / 2) * (spread / (n - 1 || 1));
      return { label, pos: polar(R_ITEM, a) };
    });
    return { name: cat.name, color: cat.color, pos: polar(R_CAT, angle), items };
  });
}

// ─── Layout B: 力导向（斥力 + 弹簧 + 向心，迭代收敛）──────────
function forceNodes(): CatNode[] {
  interface SimNode {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
  }
  interface SimLink {
    source: number;
    target: number;
    dist: number;
  }

  const nodes: SimNode[] = [];
  const links: SimLink[] = [];

  // 中心节点（固定）
  const centerIdx = 0;
  nodes.push({ x: CX, y: CY, vx: 0, vy: 0, fixed: true });

  // 分类节点
  const catStart: number[] = [];
  CATEGORIES.forEach((_, i) => {
    const idx = nodes.length;
    catStart.push(idx);
    const a = (i / catCount) * Math.PI * 2 - Math.PI / 2;
    nodes.push({ x: CX + R_CAT * Math.cos(a), y: CY + R_CAT * Math.sin(a), vx: 0, vy: 0, fixed: false });
    links.push({ source: centerIdx, target: idx, dist: 170 });
  });

  // 条目节点
  const itemIdx: number[][] = CATEGORIES.map(() => []);
  CATEGORIES.forEach((cat, c) => {
    cat.items.forEach((_, i) => {
      const idx = nodes.length;
      itemIdx[c].push(idx);
      const a = (c / catCount) * Math.PI * 2 - Math.PI / 2;
      const jitter = (i - (cat.items.length - 1) / 2) * 0.5;
      nodes.push({
        x: CX + (R_ITEM + 40) * Math.cos(a + jitter),
        y: CY + (R_ITEM + 40) * Math.sin(a + jitter),
        vx: 0,
        vy: 0,
        fixed: false,
      });
      links.push({ source: catStart[c], target: idx, dist: 72 });
    });
  });

  const iterations = 400;
  const repulsion = 1800;
  const springK = 0.06;
  const centering = 0.02;
  const damping = 0.85;
  const maxStep = 6;

  for (let iter = 0; iter < iterations; iter++) {
    // 两两斥力
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const na = nodes[a];
        const nb = nodes[b];
        const dx = na.x - nb.x;
        const dy = na.y - nb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) d2 = 0.01;
        const d = Math.sqrt(d2);
        const f = repulsion / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (!na.fixed) {
          na.vx += fx;
          na.vy += fy;
        }
        if (!nb.fixed) {
          nb.vx -= fx;
          nb.vy -= fy;
        }
      }
    }
    // 弹簧
    for (const l of links) {
      const s = nodes[l.source];
      const t = nodes[l.target];
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - l.dist) * springK;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!s.fixed) {
        s.vx += fx;
        s.vy += fy;
      }
      if (!t.fixed) {
        t.vx -= fx;
        t.vy -= fy;
      }
    }
    // 向心
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx += (CX - n.x) * centering;
      n.vy += (CY - n.y) * centering;
    }
    // 积分
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx *= damping;
      n.vy *= damping;
      const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (sp > maxStep) {
        n.vx = (n.vx / sp) * maxStep;
        n.vy = (n.vy / sp) * maxStep;
      }
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  const pad = 50;
  const clamp = (p: Pos): Pos => ({
    x: Math.min(W - pad, Math.max(pad, p.x)),
    y: Math.min(H - pad, Math.max(pad, p.y)),
  });

  return CATEGORIES.map((cat, c) => ({
    name: cat.name,
    color: cat.color,
    pos: clamp({ x: nodes[catStart[c]].x, y: nodes[catStart[c]].y }),
    items: cat.items.map((label, i) => ({
      label,
      pos: clamp({ x: nodes[itemIdx[c][i]].x, y: nodes[itemIdx[c][i]].y }),
    })),
  }));
}

// ─── SVG 渲染（放射 / 力导向共用）────────────────────────
function GraphSVG({ nodes }: { nodes: CatNode[] }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="tech-graph w-full h-auto"
      role="img"
      aria-label="技术栈与能力知识图谱"
    >
      <defs>
        <radialGradient id="center-grad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </radialGradient>
      </defs>

      {/* edges: center -> category */}
      {nodes.map((cat) => (
        <line
          key={`e-${cat.name}`}
          x1={CX}
          y1={CY}
          x2={cat.pos.x}
          y2={cat.pos.y}
          stroke={cat.color}
          strokeOpacity={0.35}
          strokeWidth={2}
        />
      ))}

      {/* edges: category -> item */}
      {nodes.map((cat) =>
        cat.items.map((item) => (
          <line
            key={`i-${cat.name}-${item.label}`}
            x1={cat.pos.x}
            y1={cat.pos.y}
            x2={item.pos.x}
            y2={item.pos.y}
            stroke={cat.color}
            strokeOpacity={0.16}
            strokeWidth={1}
          />
        ))
      )}

      {/* center node */}
      <g className="node">
        <circle
          cx={CX}
          cy={CY}
          r={34}
          fill="url(#center-grad)"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
        />
        <text x={CX} y={CY - 5} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700}>
          技术栈
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle" fill="#c3c2b7" fontSize={11}>
          与能力
        </text>
      </g>

      {/* category nodes */}
      {nodes.map((cat) => (
        <g key={cat.name} className="node">
          <title>{cat.name}</title>
          <circle
            className="node-dot"
            cx={cat.pos.x}
            cy={cat.pos.y}
            r={13}
            fill={cat.color}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
          />
          <text
            x={cat.pos.x}
            y={cat.pos.y + 30}
            textAnchor="middle"
            fill="#e2e8f0"
            fontSize={13}
            fontWeight={600}
          >
            {cat.name}
          </text>
        </g>
      ))}

      {/* item nodes */}
      {nodes.map((cat) =>
        cat.items.map((item) => (
          <g key={`it-${cat.name}-${item.label}`} className="node">
            <title>{`${cat.name} · ${item.label}`}</title>
            <circle
              className="node-dot"
              cx={item.pos.x}
              cy={item.pos.y}
              r={4.5}
              fill={cat.color}
              fillOpacity={0.85}
            />
            <text
              x={item.pos.x}
              y={item.pos.y + 16}
              textAnchor="middle"
              fill="#cbd5e1"
              fontSize={11}
            >
              {item.label}
            </text>
          </g>
        ))
      )}
    </svg>
  );
}

// ─── Layout C: 网格卡片 ─────────────────────────────────
function GridLayout() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {CATEGORIES.map((cat) => (
        <div
          key={cat.name}
          className="rounded-xl border border-white/10 bg-white/5 p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: cat.color }}
            />
            <h3 className="text-sm font-semibold text-white">{cat.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {cat.items.map((it) => (
              <span key={it} className="tag">
                {it}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 组件 ───────────────────────────────────────────────
type LayoutId = "radial" | "force" | "grid";

const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "radial", label: "放射" },
  { id: "force", label: "力导向" },
  { id: "grid", label: "网格" },
];

// 首页背景用的静态放射图（无按钮、无交互）
export function TechGraphBackground() {
  return <GraphSVG nodes={radialNodes()} />;
}

export default function TechGraph() {
  const [layout, setLayout] = useState<LayoutId>("radial");

  const nodes = useMemo(
    () => (layout === "force" ? forceNodes() : radialNodes()),
    [layout]
  );

  return (
    <div>
      {/* 排版切换按钮 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 mr-1">排版</span>
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLayout(l.id)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              layout === l.id
                ? "bg-indigo-500/20 text-indigo-200 border-indigo-400/40"
                : "text-gray-400 border-white/10 hover:text-gray-200 hover:border-white/20"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {layout === "grid" ? <GridLayout /> : <GraphSVG nodes={nodes} />}
    </div>
  );
}
