// Visual Builder — Craft.js based JSX / TSX / HTML editor (lucide icons, minimal Figma-like)
import React, { useState, useEffect, useCallback } from "react";
import { Editor, Frame, Element, useEditor, useNode } from "@craftjs/core";
import {
  Heading1, Type, Square, Box, Image as ImageIcon, Minus, MousePointerClick,
  TextCursorInput, Container as ContainerIcon, Layers, Settings2, Trash2, Copy,
  Eye, Code2, Save, RefreshCw, FilePlus, Download, Palette, Move
} from "lucide-react";
import { useInputDialog } from "../shared/InputDialog.jsx";

// ── Craft Components ────────────────────────────────────────────────────────
const Container = ({ background, padding, gap, display, flexDirection, borderRadius, children }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((node) => ({
    selected: node.events.selected, hovered: node.events.hovered,
  }));
  return (
    <div
      ref={(ref) => connect(drag(ref))}
      style={{
        background: background || "#ffffff", padding: padding ?? 16,
        display: display || "block", flexDirection: flexDirection || "column",
        gap: gap ?? 0, borderRadius: borderRadius ?? 8,
        minHeight: 60, minWidth: 40,
        border: selected ? "1.5px solid #4ec9b0" : hovered ? "1px dashed #569cd6" : "1px dashed #3a3a3a",
        boxShadow: selected ? "0 0 0 2px rgba(78,201,176,0.15)" : "none",
      }}
    >
      {children}
    </div>
  );
};
Container.craft = {
  displayName: "Container",
  props: { background: "#ffffff", padding: 16, gap: 12, display: "flex", flexDirection: "column", borderRadius: 8 },
  rules: { canDrag: () => true },
  related: { settings: ContainerSettings },
};

function ContainerSettings() {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Slider label="Padding" value={props.padding} min={0} max={48} onChange={(v) => setProp((p) => (p.padding = v))} />
      <Slider label="Gap" value={props.gap} min={0} max={32} onChange={(v) => setProp((p) => (p.gap = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={24} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Select label="Display" value={props.display} options={["block","flex","grid"]} onChange={(v) => setProp((p) => (p.display = v))} />
      {props.display === "flex" && <Select label="Direction" value={props.flexDirection} options={["column","row"]} onChange={(v) => setProp((p) => (p.flexDirection = v))} />}
    </div>
  );
}

const Text = ({ text, fontSize, color, textAlign, fontWeight, lineHeight }) => {
  const { connectors: { connect, drag }, selected, hovered, actions: { setProp } } = useNode((n) => ({
    selected: n.events.selected, hovered: n.events.hovered,
  }));
  const [editing, setEditing] = React.useState(false);
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2, borderRadius: 2 }}>
      <p
        contentEditable={editing}
        suppressContentEditableWarning
        onClick={() => setEditing(true)}
        onBlur={(e) => { setProp((p) => (p.text = e.target.innerText)); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }}
        style={{ fontSize, color, textAlign, fontWeight, lineHeight: lineHeight || 1.4, margin: 0, outline: "none", cursor: "text" }}
      >
        {text}
      </p>
    </div>
  );
};
Text.craft = {
  displayName: "Text",
  props: { text: "Double click to edit text", fontSize: 14, color: "#1a1a1a", textAlign: "left", fontWeight: "400", lineHeight: 1.5 },
  related: { settings: TextSettings },
};
function TextSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Text</label>
      <textarea value={props.text} onChange={(e) => setProp((p) => (p.text = e.target.value))} rows={3} style={ta} />
      <Slider label="Size" value={props.fontSize} min={10} max={48} onChange={(v) => setProp((p) => (p.fontSize = v))} />
      <Color label="Color" value={props.color} onChange={(v) => setProp((p) => (p.color = v))} />
      <Select label="Align" value={props.textAlign} options={["left","center","right"]} onChange={(v) => setProp((p) => (p.textAlign = v))} />
      <Select label="Weight" value={props.fontWeight} options={["400","500","600","700"]} onChange={(v) => setProp((p) => (p.fontWeight = v))} />
    </div>
  );
}

const Heading = ({ text, level, color, textAlign }) => {
  const { connectors: { connect, drag }, selected, hovered, actions: { setProp } } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  const Tag = `h${level}`;
  const [editing, setEditing] = React.useState(false);
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2 }}>
      <Tag
        contentEditable={editing} suppressContentEditableWarning
        onClick={() => setEditing(true)}
        onBlur={(e) => { setProp((p) => (p.text = e.target.innerText)); setEditing(false); }}
        style={{ color, textAlign, margin: 0, fontWeight: 700, outline: "none", cursor: "text", fontSize: level === 1 ? 28 : level === 2 ? 22 : 18 }}
      >{text}</Tag>
    </div>
  );
};
Heading.craft = {
  displayName: "Heading",
  props: { text: "Heading", level: 2, color: "#111", textAlign: "left" },
  related: { settings: HeadingSettings },
};
function HeadingSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Text</label><input value={props.text} onChange={(e) => setProp((p) => (p.text = e.target.value))} style={inp} />
      <Select label="Level" value={String(props.level)} options={["1","2","3"]} onChange={(v) => setProp((p) => (p.level = parseInt(v)))} />
      <Color label="Color" value={props.color} onChange={(v) => setProp((p) => (p.color = v))} />
      <Select label="Align" value={props.textAlign} options={["left","center","right"]} onChange={(v) => setProp((p) => (p.textAlign = v))} />
    </div>
  );
}

const ButtonComp = ({ text, background, color, padding, borderRadius, width }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ display: "inline-block", border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2 }}>
      <button style={{ background, color, padding: `${padding}px ${padding * 1.6}px`, borderRadius, border: "none", cursor: "pointer", width: width || "auto", fontSize: 14, fontWeight: 600 }}>{text}</button>
    </div>
  );
};
ButtonComp.craft = {
  displayName: "Button",
  props: { text: "Button", background: "#0e639c", color: "#ffffff", padding: 10, borderRadius: 6, width: "" },
  related: { settings: ButtonSettings },
};
function ButtonSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Label</label><input value={props.text} onChange={(e) => setProp((p) => (p.text = e.target.value))} style={inp} />
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Color label="Text" value={props.color} onChange={(v) => setProp((p) => (p.color = v))} />
      <Slider label="Padding" value={props.padding} min={4} max={24} onChange={(v) => setProp((p) => (p.padding = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={16} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
    </div>
  );
}

const InputComp = ({ placeholder, width }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2, display: "inline-block", width: width || 220 }}>
      <input placeholder={placeholder} style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none" }} readOnly />
    </div>
  );
};
InputComp.craft = {
  displayName: "Input",
  props: { placeholder: "Enter text…", width: 220 },
  related: { settings: InputSettings },
};
function InputSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Placeholder</label><input value={props.placeholder} onChange={(e) => setProp((p) => (p.placeholder = e.target.value))} style={inp} />
      <Slider label="Width" value={props.width} min={120} max={400} onChange={(v) => setProp((p) => (p.width = v))} />
    </div>
  );
}

const ImageComp = ({ src, width, height, borderRadius }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ border: selected ? "1px dashed #4ec9b0" : hovered ? "1px dashed #569cd688" : "1px dashed transparent", padding: 2, display: "inline-block" }}>
      <img src={src} alt="" style={{ width, height, borderRadius, objectFit: "cover", display: "block", background: "#f3f4f6" }} />
    </div>
  );
};
ImageComp.craft = {
  displayName: "Image",
  props: { src: "https://via.placeholder.com/320x180?text=Image", width: 320, height: 180, borderRadius: 8 },
  related: { settings: ImageSettings },
};
function ImageSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={lb}>Src</label><input value={props.src} onChange={(e) => setProp((p) => (p.src = e.target.value))} style={inp} />
      <Slider label="Width" value={props.width} min={80} max={600} onChange={(v) => setProp((p) => (p.width = v))} />
      <Slider label="Height" value={props.height} min={60} max={400} onChange={(v) => setProp((p) => (p.height = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={24} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
    </div>
  );
}

const BoxComp = ({ background, width, height, borderRadius }) => {
  const { connectors: { connect, drag }, selected, hovered } = useNode((n) => ({ selected: n.events.selected, hovered: n.events.hovered }));
  return (
    <div ref={(ref) => connect(drag(ref))} style={{ width, height, background, borderRadius, border: selected ? "1.5px solid #4ec9b0" : hovered ? "1px dashed #569cd6" : "1px solid #e5e7eb" }} />
  );
};
BoxComp.craft = {
  displayName: "Box",
  props: { background: "#e0e7ff", width: 100, height: 100, borderRadius: 8 },
  related: { settings: BoxSettings },
};
function BoxSettings() {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Color label="Background" value={props.background} onChange={(v) => setProp((p) => (p.background = v))} />
      <Slider label="Width" value={props.width} min={40} max={400} onChange={(v) => setProp((p) => (p.width = v))} />
      <Slider label="Height" value={props.height} min={40} max={400} onChange={(v) => setProp((p) => (p.height = v))} />
      <Slider label="Radius" value={props.borderRadius} min={0} max={24} onChange={(v) => setProp((p) => (p.borderRadius = v))} />
    </div>
  );
}

const DividerComp = () => {
  const { connectors: { connect, drag }, selected } = useNode((n) => ({ selected: n.events.selected }));
  return <div ref={(ref) => connect(drag(ref))} style={{ borderTop: selected ? "2px solid #4ec9b0" : "1px solid #e5e7eb", margin: "8px 0", height: 1 }} />;
};
DividerComp.craft = { displayName: "Divider", props: {}, related: { settings: () => <div style={{ fontSize: 11, color: "#888" }}>Divider — no props</div> } };

// ── Shared settings UI helpers ──────────────────────────────────────────────
const lb = { fontSize: 11, color: "#bbb", fontWeight: 600 };
const inp = { background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#ddd", borderRadius: 4, padding: "6px 8px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" };
const ta = { ...inp, resize: "vertical", fontFamily: "Consolas, monospace" };
const Slider = ({ label, value, min, max, onChange }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 2 }}><span>{label}</span><span>{value}</span></div>
    <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value))} style={{ width: "100%" }} />
  </div>
);
const Color = ({ label, value, onChange }) => (
  <div>
    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{label}</div>
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 32, height: 26, border: "1px solid #3a3a3a", borderRadius: 4, background: "transparent", padding: 2 }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inp, flex: 1 }} />
    </div>
  </div>
);
const Select = ({ label, value, options, onChange }) => (
  <div>
    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{label}</div>
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inp }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// ── Toolbox ─────────────────────────────────────────────────────────────────
const Toolbox = () => {
  const { connectors } = useEditor();
  const items = [
    { icon: ContainerIcon, label: "Container", comp: <Element is={Container} canvas background="#ffffff" padding={16} /> },
    { icon: Heading1, label: "Heading", comp: <Heading text="Heading" level={2} /> },
    { icon: Type, label: "Text", comp: <Text text="Sample text — drag to canvas" /> },
    { icon: MousePointerClick, label: "Button", comp: <ButtonComp text="Click me" /> },
    { icon: TextCursorInput, label: "Input", comp: <InputComp /> },
    { icon: ImageIcon, label: "Image", comp: <ImageComp /> },
    { icon: Square, label: "Shape", comp: <BoxComp /> },
    { icon: Minus, label: "Divider", comp: <DividerComp /> },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {items.map((it) => (
        <div
          key={it.label}
          ref={(ref) => connectors.create(ref, it.comp)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            padding: "10px 6px", background: "#2d2d2d", border: "1px solid #3a3a3a", borderRadius: 6,
            cursor: "grab", color: "#ccc", fontSize: 11, fontWeight: 500,
          }}
          title={`Drag ${it.label} to canvas`}
        >
          <it.icon size={16} style={{ color: "#4ec9b0" }} />
          {it.label}
        </div>
      ))}
    </div>
  );
};

// ── Settings Panel ───────────────────────────────────────────────────────────
const SettingsPanel = () => {
  const { actions, selected, query } = useEditor((state, query) => {
    const [id] = state.events.selected;
    let selected;
    if (id) selected = state.nodes[id];
    return { selected, query };
  });
  const selectedId = useEditor((state) => state.events.selected.values().next().value);
  if (!selected) {
    return <div style={{ padding: 12, color: "#666", fontSize: 11, textAlign: "center" }}>Select an element to edit its props</div>;
  }
  const { displayName } = selected.data;
  const related = selected.related?.settings;
  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2d2d2d", paddingBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 6 }}><Settings2 size={12} /> {displayName}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => {
              const p = selected.data.parent;
              if (selectedId) actions.delete(selectedId);
            }}
            title="Delete"
            style={{ background: "#3a1d1d", border: "1px solid #5a2a2a", color: "#f48771", borderRadius: 4, padding: "4px 6px", cursor: "pointer", display: "flex", alignItems: "center" }}
          ><Trash2 size={12} /></button>
          <button
            onClick={() => {
              if (selectedId) {
                const node = query.node(selectedId).toSerializedNode();
                const newId = query.parseFreshNode({ data: node }).id;
                actions.addNodeTree?.(query.parseFreshNode({ data: node }), selected.data.parent);
              }
            }}
            title="Duplicate"
            style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", borderRadius: 4, padding: "4px 6px", cursor: "pointer", display: "flex", alignItems: "center" }}
          ><Copy size={12} /></button>
        </div>
      </div>
      {related && React.createElement(related)}
      <div style={{ fontSize: 10, color: "#555", borderTop: "1px solid #2d2d2d", paddingTop: 8 }}>
        Drag to move • Drop inside Container to nest • Select to see outline
      </div>
    </div>
  );
};

// ── Layers (simple) ──────────────────────────────────────────────────────────
const LayersPanel = () => {
  const { nodes } = useEditor((state) => ({ nodes: state.nodes }));
  const { actions, query } = useEditor();
  const selectedId = useEditor((state) => state.events.selected.values().next().value);
  const renderLayer = (id, depth = 0) => {
    const node = nodes[id];
    if (!node) return null;
    const isSel = id === selectedId;
    const hasChildren = node.data.nodes?.length > 0 || node.data.linkedNodes && Object.keys(node.data.linkedNodes).length > 0;
    return (
      <div key={id}>
        <div
          onClick={() => actions.selectNode(id)}
          style={{
            padding: "4px 8px",
            paddingLeft: 8 + depth * 12,
            background: isSel ? "#094771" : "transparent",
            color: isSel ? "#fff" : "#ccc",
            fontSize: 11,
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            borderBottom: "1px solid #232323",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: isSel ? "#4ec9b0" : "#555", flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.data.displayName || node.data.name || id.slice(0, 6)}</span>
          {hasChildren && <span style={{ fontSize: 9, color: "#777" }}>{node.data.nodes?.length || 0}</span>}
        </div>
        {node.data.nodes?.map((cid) => renderLayer(cid, depth + 1))}
        {node.data.linkedNodes && Object.values(node.data.linkedNodes).map((cid) => renderLayer(cid, depth + 1))}
      </div>
    );
  };
  const rootId = query.getSerializedNodes ? Object.keys(nodes).find((k) => nodes[k].data.isCanvas && !nodes[k].data.parent) : "ROOT";
  return <div>{renderLayer(rootId || "ROOT")}</div>;
};

// ── Main Builder Panel ───────────────────────────────────────────────────────
const BuilderCanvas = () => {
  const { connectors } = useEditor();
  return (
    <div ref={(ref) => connectors.select(connectors.hover(ref, "div"), "div")} style={{ minHeight: "100%", padding: 2 }}>
      <Frame>
        <Element is={Container} canvas background="#ffffff" padding={16} gap={12}>
          <Heading text="Welcome to Builder" level={2} color="#111" textAlign="left" />
          <Text text="Drag elements from the left palette to the canvas. Select any element to edit its props on the right. Nest elements by dropping inside Containers." fontSize={14} color="#444" />
          <Container background="#f9fafb" padding={16} gap={8} display="flex" flexDirection="row">
            <ButtonComp text="Primary" background="#0e639c" />
            <ButtonComp text="Secondary" background="#2d2d2d" />
          </Container>
        </Element>
      </Frame>
    </div>
  );
};

const BuilderPanel = () => {
  const { dialog, ask } = useInputDialog();
  const editorRef = React.useRef(null);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");

  const handleExport = useCallback(() => {
    try {
      const editor = editorRef.current?.query;
      if (!editor) return;
      // query is inside Editor context, need to get via useEditor — fallback: use window temp
    } catch {}
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#181818", overflow: "hidden" }}>
      {dialog}
      <Editor
        resolver={{ Container, Text, Heading, Button: ButtonComp, Input: InputComp, Image: ImageComp, Box: BoxComp, Divider: DividerComp }}
        onRender={({ render }) => render}
      >
        <InnerBuilder setCode={setCode} showCode={showCode} setShowCode={setShowCode} ask={ask} editorRef={editorRef} />
      </Editor>
    </div>
  );
};

const InnerBuilder = ({ setCode, showCode, setShowCode, ask, editorRef }) => {
  const { query, actions } = useEditor();
  // expose query for export
  useEffect(() => { if (editorRef) editorRef.current = { query, actions }; }, [query, actions, editorRef]);

  const doExport = useCallback(async () => {
    try {
      const json = query.serialize();
      const pretty = JSON.stringify(JSON.parse(json), null, 2);
      // naive JSX generation — walk ROOT
      const nodes = JSON.parse(json);
      const gen = (id) => {
        const n = nodes[id];
        if (!n) return "";
        const { type, props, nodes: children, linkedNodes } = n;
        const name = type?.resolvedName || "div";
        const compMap = { Container: "div", Text: "p", Heading: "h2", Button: "button", Input: "input", Image: "img", Box: "div", Divider: "hr" };
        const tag = compMap[name] || "div";
        const propsStr = Object.entries(props || {})
          .filter(([k, v]) => !["children","text"].includes(k) && v !== undefined && v !== "")
          .map(([k, v]) => {
            if (typeof v === "string") return ` ${k}="${v}"`;
            if (typeof v === "number") return ` ${k}={${v}}`;
            return "";
          }).join("");
        const inner = n.type?.resolvedName === "Text" || n.type?.resolvedName === "Heading" || n.type?.resolvedName === "Button" ? (props?.text || "") : "";
        const childIds = [...(children || []), ...Object.values(linkedNodes || {})];
        const childCode = childIds.map(gen).join("\n");
        const content = inner || childCode;
        if (tag === "img" || tag === "input" || tag === "hr") return `<${tag}${propsStr} />`;
        return `<${tag}${propsStr}>${content}</${tag}>`;
      };
      const jsx = gen("ROOT");
      const full = `// Craft.js serialized\n${pretty}\n\n// Generated JSX (lightweight)\n${jsx}`;
      await navigator.clipboard.writeText(full);
      // also try electron clipboard
      try { await window.electronAPI?.clipboardWrite?.(full); } catch {}
      const name = await ask("Export — copied to clipboard. Save as file? Enter filename (or Cancel):", "Builder.jsx");
      if (name) {
        const root = window.__currentProjectPath;
        if (root) {
          const target = root + "/" + name.replace(/^\//, "");
          const content = name.endsWith(".html") ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:system-ui}</style></head><body>${jsx}</body></html>` : `export default function BuilderPage(){\n  return (\n${jsx.split("\n").map(l=>"    "+l).join("\n")}\n  );\n}`;
          await window.electronAPI.writeFileText(target, content);
        }
      }
    } catch (e) { console.error(e); }
  }, [query, ask]);

  const doClear = useCallback(() => {
    const root = query.node("ROOT").get();
    // remove all children
    root.data.nodes.forEach((id) => query.node(id).delete());
  }, [query]);

  return (
    <>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#bbb", display: "flex", alignItems: "center", gap: 6 }}>
          <Palette size={14} style={{ color: "#4ec9b0" }} /> Builder
          <span style={{ fontSize: 10, color: "#666", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— JSX / TSX / HTML</span>
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={doClear} title="Clear canvas" style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Trash2 size={12}/> Clear</button>
        <button onClick={doExport} title="Export JSX/HTML" style={{ background: "#0e639c", border: "1px solid #0e639c", color: "#fff", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Download size={12}/> Export</button>
        <button onClick={() => setShowCode((v) => !v)} title="Toggle code view" style={{ background: showCode ? "#333" : "#2d2d2d", border: "1px solid #3a3a3a", color: showCode ? "#fff" : "#bbb", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>{showCode ? <Eye size={12}/> : <Code2 size={12}/>} {showCode ? "Canvas" : "Code"}</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Palette */}
        <div style={{ width: 160, background: "#252526", borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 8px 4px", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}><Box size={10}/> Add Elements</div>
          <div style={{ padding: 8, overflowY: "auto", flex: 1 }}><Toolbox /></div>
          <div style={{ padding: 8, borderTop: "1px solid #2d2d2d", fontSize: 10, color: "#555", lineHeight: 1.4 }}>
            Drag & drop • Nest inside Container • Select to edit
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#1e1e1e", overflow: "hidden", minWidth: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: 12, background: "repeating-conic-gradient(#1e1e1e 0% 25%, #252526 0% 50%) 50% / 24px 24px" }}>
            <div style={{ minHeight: "100%", background: "#fff", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.45)", overflow: "hidden", maxWidth: 960, margin: "0 auto" }}>
              <BuilderCanvas />
            </div>
          </div>
        </div>

        {/* Properties + Layers */}
        <div style={{ width: 260, background: "#252526", borderLeft: "1px solid #2d2d2d", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", borderBottom: "1px solid #2d2d2d" }}>
            <div style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6, background: "#2d2d2d" }}><Settings2 size={10}/> Properties</div>
            <SettingsPanel />
          </div>
          <div style={{ height: 180, overflowY: "auto" }}>
            <div style={{ padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6, background: "#2d2d2d", borderBottom: "1px solid #2d2d2d" }}><Layers size={10}/> Layers</div>
            <LayersPanel />
          </div>
        </div>
      </div>
    </>
  );
};

export default BuilderPanel;
